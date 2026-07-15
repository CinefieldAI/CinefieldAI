import { fal } from "@fal-ai/client";
import { NextResponse } from "next/server";

export const maxDuration = 300;

const MODEL_ENDPOINTS = {
  "flux-dev": "fal-ai/flux/dev",
} as const;

const IMAGE_SIZES = {
  "1:1": "square_hd",
  "3:4": "portrait_4_3",
  "4:3": "landscape_4_3",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
} as const;

type ModelId = keyof typeof MODEL_ENDPOINTS;
type AspectRatio = keyof typeof IMAGE_SIZES;

type GenerateBody = {
  prompt?: unknown;
  modelId?: unknown;
  aspectRatio?: unknown;
  quantity?: unknown;
};

type FalImage = {
  url: string;
  content_type?: string;
  width?: number;
  height?: number;
};

type FalResult = {
  images?: FalImage[];
  seed?: number;
};

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  if (!process.env.FAL_KEY) {
    return errorResponse(
      "PROVIDER_NOT_CONFIGURED",
      "Fal API anahtarı yapılandırılmamış.",
      503,
    );
  }

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return errorResponse("INVALID_JSON", "Geçerli bir JSON gövdesi gönderin.", 400);
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length < 3 || prompt.length > 2_000) {
    return errorResponse(
      "INVALID_PROMPT",
      "Prompt 3 ile 2000 karakter arasında olmalıdır.",
      400,
    );
  }

  if (
    typeof body.modelId !== "string" ||
    !(body.modelId in MODEL_ENDPOINTS)
  ) {
    return errorResponse("INVALID_MODEL", "Desteklenmeyen model.", 400);
  }

  if (
    typeof body.aspectRatio !== "string" ||
    !(body.aspectRatio in IMAGE_SIZES)
  ) {
    return errorResponse("INVALID_ASPECT_RATIO", "Desteklenmeyen aspect ratio.", 400);
  }

  const quantity = Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 4) {
    return errorResponse("INVALID_QUANTITY", "Görsel sayısı 1 ile 4 arasında olmalıdır.", 400);
  }

  const modelId = body.modelId as ModelId;
  const aspectRatio = body.aspectRatio as AspectRatio;

  try {
    fal.config({ credentials: process.env.FAL_KEY });

    const result = await fal.subscribe(MODEL_ENDPOINTS[modelId], {
      input: {
        prompt,
        image_size: IMAGE_SIZES[aspectRatio],
        num_images: quantity,
        enable_safety_checker: true,
        output_format: "jpeg",
      },
    });

    const data = result.data as FalResult;
    const images = (data.images ?? []).filter(
      (image): image is FalImage => typeof image?.url === "string" && image.url.length > 0,
    );

    if (images.length === 0) {
      return errorResponse("EMPTY_RESULT", "Provider görsel döndürmedi.", 502);
    }

    return NextResponse.json({
      id: result.requestId,
      status: "completed",
      modelId,
      seed: data.seed,
      images,
    });
  } catch (error) {
    console.error("Fal image generation failed", error);
    return errorResponse(
      "PROVIDER_ERROR",
      "Görsel üretimi şu anda tamamlanamadı. Lütfen tekrar deneyin.",
      502,
    );
  }
}
