"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Wand2 } from "lucide-react";
import HeroSection from "@/components/image-tools/HeroSection";
import ImageAtmosphereBackground from "./ImageAtmosphereBackground";
import PromptComposer from "./PromptComposer";
import { FEATURED_MODELS } from "./createImageData";
import { isOrchestrationModel } from "@/lib/orchestration/orchestration-models";
import { useGeneration } from "@/hooks/useGeneration";

/**
 * Visible catalog display name → orchestration registry id.
 *
 * The composer identifies a model by its display name (ModelItem calls
 * onSelect(model.name)), while the registry keys off its own ids, so the two
 * are bridged here explicitly rather than by string munging. Only models
 * that are actually registered and verified against the provider belong in
 * this map — anything absent keeps the old placeholder behaviour instead of
 * being silently routed somewhere it was never tested against.
 */
const CATALOG_TO_REGISTRY_MODEL: Record<string, string> = {
  "Nano Banana 2": "fal-nano-banana-2",
};

interface CreateImageWorkspaceProps {
  onBack: () => void;
  /** Model clicked in the navbar's Image mega-dropdown — preselects the
   * composer instead of always opening on the default ("Auto"). */
  initialModel?: string;
}

export default function CreateImageWorkspace({ onBack, initialModel }: CreateImageWorkspaceProps) {
  const searchParams = useSearchParams();
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState(initialModel ?? FEATURED_MODELS[0].name);

  // useState only reads initialModel on first mount, so picking a model from
  // the navbar while this workspace is already open would otherwise leave the
  // composer on the previous one. Syncing here keeps the navbar and composer
  // in agreement without remounting (which would discard the typed prompt).
  useEffect(() => {
    if (initialModel) setSelectedModel(initialModel);
  }, [initialModel]);

  // Shared generation workflow — same hook CinemaStudioWorkspace.tsx (/generate)
  // uses: project resolution, row insert, orchestration dispatch, polling,
  // signed URL, and flow state all live in the hook.
  const {
    status: flowStatus,
    message: flowMessage,
    result: resultPreview,
    generate,
  } = useGeneration({ sourcePage: "/image" });

  /**
   * Development-only orchestration model override — identical contract to
   * CinemaStudioWorkspace.tsx's orchestrationModelOverride. `?model=` must
   * name a model registered in the orchestration pipeline (model-registry.ts);
   * the visible model catalog (createImageData.ts / imageModelCapabilities.ts)
   * is deliberately never routed to a real provider by this override, since
   * no orchestration id collides with a visible-catalog id.
   */
  const orchestrationModelOverride = useMemo(() => {
    const requested = searchParams.get("model");
    return requested && isOrchestrationModel(requested) ? requested : null;
  }, [searchParams]);

  const handleGenerate = async ({
    prompt: submittedPrompt,
    model: pickedModel,
    aspectRatio,
    resolution,
    outputCount,
  }: {
    prompt: string;
    model: string;
    aspectRatio: string;
    resolution: string;
    outputCount: number;
  }) => {
    // The dev `?model=` override still wins when present; otherwise the
    // model the user actually picked in the composer is looked up in the
    // catalog→registry map above.
    const registryModel =
      orchestrationModelOverride ?? CATALOG_TO_REGISTRY_MODEL[pickedModel] ?? null;

    if (registryModel) {
      await generate({
        model: registryModel,
        uiMode: "image",
        prompt: submittedPrompt,
        // Key names match what the orchestrator reads out of metadata
        // (orchestrator.ts's settings block): aspect_ratio, resolution and
        // image_count, the last one parsed from its numerator.
        metadata: {
          aspect_ratio: aspectRatio,
          resolution,
          image_count: String(outputCount),
        },
      });
      return;
    }

    // Model has no registry entry yet: preserve the existing placeholder
    // delay for every remaining visible-catalog model — unchanged behavior.
    await new Promise((resolve) => setTimeout(resolve, 1600));
  };

  return (
    <section className="relative flex min-h-[calc(100vh-4rem)] flex-col overflow-hidden pb-[190px]">
      <ImageAtmosphereBackground />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-6 pt-5">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Explore
        </button>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-magenta-500/10 px-3 py-1 text-xs font-semibold text-magenta-400">
          <Wand2 className="h-3 w-3" />
          Create Image
        </span>
      </div>

      <div className="relative z-10 flex flex-1">
        <HeroSection modelLabel={selectedModel} />
      </div>

      {/* Generation flow feedback — additive only, a new sibling positioned
          just above the fixed composer. Does not modify PromptComposer or
          any existing element on this page. Only visible when the dev
          orchestration override (?model=) actually dispatched a request. */}
      {flowStatus !== "idle" && (
        <div className="pointer-events-none fixed bottom-[170px] left-1/2 z-[100] w-full max-w-[calc(100vw-32px)] -translate-x-1/2 px-2">
          <div className="pointer-events-auto mx-auto flex w-fit flex-col items-center gap-2">
            <span
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                flowStatus === "error"
                  ? "border-red-500/30 bg-red-500/10 text-red-300"
                  : flowStatus === "success"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-white/10 bg-white/5 text-neutral-300"
              }`}
            >
              {flowStatus === "uploading"
                ? "Uploading attachment..."
                : flowStatus === "queued" && !flowMessage
                  ? "Queuing generation..."
                  : flowStatus === "processing"
                    ? "Processing..."
                    : flowMessage}
            </span>
            {resultPreview &&
              (resultPreview.type === "audio" ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption -- mock/dev result preview, not user-facing content
                <audio controls src={resultPreview.url} className="w-full max-w-md" />
              ) : (
                <img
                  src={resultPreview.url}
                  alt="Generated result"
                  className="max-h-48 rounded-lg border border-white/10 object-contain"
                />
              ))}
          </div>
        </div>
      )}

      {/* Premium fixed bottom prompt composer */}
      <PromptComposer
        prompt={prompt}
        onPromptChange={setPrompt}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        onGenerate={handleGenerate}
      />
    </section>
  );
}
