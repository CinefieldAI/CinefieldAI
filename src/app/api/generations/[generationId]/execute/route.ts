import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { getGeminiClient, isGeminiConfigured } from "@/lib/gemini/geminiClient";
import {
  isSupportedNanoBananaModel,
  getGeminiModelId,
  IMAGE_SIZE_SUPPORT,
  SUPPORTS_THINKING_LEVEL,
  SUPPORTED_ASPECT_RATIOS,
  GEMINI_OUTPUT_MIME_TYPE,
  type SupportedNanoBananaModelId,
} from "@/lib/gemini/geminiModelMapping";
import { buildOutputStoragePath } from "@/lib/gemini/outputStorage";
import type { Generation, Project } from "@/types/database";

const SUPPORTED_INPUT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

type InputPart =
  | { type: "text"; text: string }
  | { type: "image"; mime_type: string; data: string };

/**
 * Server-only Gemini image-generation execution for the three Nano Banana
 * UI models. Requires a signed-in Clerk user; verifies the generation and
 * its project both belong to that user before doing anything else. Uses
 * the privileged Supabase admin client (never exposed to the browser) to
 * update protected generation fields and to upload into the private
 * generation-outputs bucket — both of which the browser-authenticated
 * client is intentionally blocked from doing by RLS/Storage policies.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ generationId: string }> }
) {
  const { generationId } = await params;

  if (!generationId || typeof generationId !== "string") {
    return NextResponse.json({ error: "Generation ID is required" }, { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: "Server is not fully configured." }, { status: 503 });
  }

  const admin = getSupabaseAdminClient();

  const projectsProbe = await admin.from("projects").select("id").limit(1);

  const { data: generationRow, error: generationError } = await admin
    .from("generations")
    .select("*")
    .eq("id", generationId)
    .maybeSingle();

  if (generationError || !generationRow) {
    return NextResponse.json(
      {
        error: "Generation not found.",
        debug: "query_failed",
        detail: generationError?.message,
        projectsProbeError: projectsProbe.error?.message ?? null,
        projectsProbeCount: projectsProbe.data?.length ?? null,
      },
      { status: 404 }
    );
  }

  const generation = generationRow as Generation;

  // Never trust a browser-supplied user id — ownership is checked against
  // the authenticated Clerk session only.
  if (generation.clerk_user_id !== userId) {
    return NextResponse.json(
      { error: "Generation not found.", debug: "owner_mismatch" },
      { status: 404 }
    );
  }

  const { data: projectRow, error: projectError } = await admin
    .from("projects")
    .select("*")
    .eq("id", generation.project_id)
    .maybeSingle();

  if (projectError || !projectRow) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const project = projectRow as Project;

  if (project.clerk_user_id !== userId) {
    return NextResponse.json({ error: "Generation not found." }, { status: 404 });
  }

  if (!isSupportedNanoBananaModel(generation.model)) {
    return NextResponse.json(
      { error: "This generation's model is not supported by this endpoint." },
      { status: 400 }
    );
  }

  const nanoBananaModelId: SupportedNanoBananaModelId = generation.model;

  // Atomic claim: only proceed if this row is still queued. Prevents
  // duplicate/concurrent execution of the same generation.
  const { data: claimedRow, error: claimError } = await admin
    .from("generations")
    .update({ status: "processing" })
    .eq("id", generationId)
    .eq("status", "queued")
    .select()
    .maybeSingle();

  if (claimError) {
    return NextResponse.json({ error: "Failed to start generation." }, { status: 500 });
  }

  if (!claimedRow) {
    return NextResponse.json(
      { error: "This generation is already being processed or has finished." },
      { status: 409 }
    );
  }

  if (!isGeminiConfigured()) {
    await admin
      .from("generations")
      .update({
        status: "failed",
        error_message: "Gemini API key is not configured.",
        completed_at: new Date().toISOString(),
      })
      .eq("id", generationId);

    return NextResponse.json(
      { status: "failed", error: "Gemini API key is not configured." },
      { status: 503 }
    );
  }

  try {
    const metadata = (generation.metadata ?? {}) as Record<string, unknown>;

    // Optional input attachment — only forward supported image MIME types
    // to Gemini. Video/audio attachments are safely omitted rather than
    // crashing; the omission is surfaced back to the client as a warning.
    let inputImagePart: InputPart | null = null;
    let attachmentSkippedReason: string | null = null;

    if (generation.input_url) {
      const inputMimeType = typeof metadata.mime_type === "string" ? metadata.mime_type : "";
      if (SUPPORTED_INPUT_IMAGE_MIME_TYPES.includes(inputMimeType)) {
        const { data: fileBlob, error: downloadError } = await admin.storage
          .from("generation-inputs")
          .download(generation.input_url);

        if (!downloadError && fileBlob) {
          const arrayBuffer = await fileBlob.arrayBuffer();
          const base64Data = Buffer.from(arrayBuffer).toString("base64");
          inputImagePart = { type: "image", mime_type: inputMimeType, data: base64Data };
        } else {
          attachmentSkippedReason = "Attached file could not be retrieved.";
        }
      } else if (inputMimeType) {
        attachmentSkippedReason =
          "Attached file type is not supported by Gemini image generation and was not used.";
      }
    }

    const aspectRatioValue =
      typeof metadata.aspect_ratio === "string" &&
      (SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(metadata.aspect_ratio)
        ? metadata.aspect_ratio
        : undefined;

    const resolutionValue = typeof metadata.resolution === "string" ? metadata.resolution : "";
    const imageSizeValue = IMAGE_SIZE_SUPPORT[nanoBananaModelId].includes(resolutionValue)
      ? resolutionValue
      : undefined;

    const thinkingValue = typeof metadata.thinking === "string" ? metadata.thinking : undefined;
    const thinkingLevel =
      SUPPORTS_THINKING_LEVEL[nanoBananaModelId] && thinkingValue
        ? thinkingValue.toLowerCase()
        : undefined;

    const ai = getGeminiClient();

    const inputParts: InputPart[] = [{ type: "text", text: generation.prompt }];
    if (inputImagePart) {
      inputParts.push(inputImagePart);
    }

    const interaction = await ai.interactions.create({
      model: getGeminiModelId(nanoBananaModelId),
      input: inputParts,
      response_format: {
        type: "image",
        mime_type: GEMINI_OUTPUT_MIME_TYPE,
        ...(aspectRatioValue ? { aspect_ratio: aspectRatioValue } : {}),
        ...(imageSizeValue ? { image_size: imageSizeValue } : {}),
      },
      ...(thinkingLevel ? { generation_config: { thinking_level: thinkingLevel } } : {}),
    });

    if (interaction.status !== "completed" || !interaction.output_image?.data) {
      const sanitizedError = "Image generation did not complete successfully.";
      await admin
        .from("generations")
        .update({
          status: "failed",
          error_message: sanitizedError,
          completed_at: new Date().toISOString(),
        })
        .eq("id", generationId);

      return NextResponse.json({ status: "failed", error: sanitizedError }, { status: 502 });
    }

    const outputMimeType = interaction.output_image.mime_type || GEMINI_OUTPUT_MIME_TYPE;
    const outputPath = buildOutputStoragePath(userId, project.id, generationId, outputMimeType);
    const outputBuffer = Buffer.from(interaction.output_image.data, "base64");

    const { error: uploadError } = await admin.storage
      .from("generation-outputs")
      .upload(outputPath, outputBuffer, {
        contentType: outputMimeType,
        upsert: false,
      });

    if (uploadError) {
      const sanitizedError = "Failed to store the generated image.";
      await admin
        .from("generations")
        .update({
          status: "failed",
          error_message: sanitizedError,
          completed_at: new Date().toISOString(),
        })
        .eq("id", generationId);

      return NextResponse.json({ status: "failed", error: sanitizedError }, { status: 500 });
    }

    await admin
      .from("generations")
      .update({
        status: "completed",
        output_url: outputPath,
        error_message: null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", generationId);

    const { data: signedUrlData } = await admin.storage
      .from("generation-outputs")
      .createSignedUrl(outputPath, 3600);

    return NextResponse.json({
      status: "completed",
      generationId,
      signedUrl: signedUrlData?.signedUrl ?? null,
      ...(attachmentSkippedReason ? { warning: attachmentSkippedReason } : {}),
    });
  } catch (caughtError) {
    const sanitizedError = "Image generation failed. Please try again.";
    await admin
      .from("generations")
      .update({
        status: "failed",
        error_message: sanitizedError,
        completed_at: new Date().toISOString(),
      })
      .eq("id", generationId);

    return NextResponse.json(
      {
        status: "failed",
        error: sanitizedError,
        debugCaught: caughtError instanceof Error ? caughtError.message : String(caughtError),
      },
      { status: 500 }
    );
  }
}
