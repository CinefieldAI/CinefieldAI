"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import AudioComposer from "./AudioComposer";
import SelectVoiceModal from "./SelectVoiceModal";
import ChooseLanguageModal from "./ChooseLanguageModal";
import AudioFeed, { type AudioClip } from "./AudioFeed";
import AudioTopControls, {
  type AudioLayout,
  type AudioTab,
} from "./AudioTopControls";
import { AUDIO_MODE_ORDER, type AudioMode } from "../audioMenuData";
import {
  VOICEOVER_MODEL_ORDER,
  DEFAULT_SEED_AUDIO_SETTINGS,
  DEFAULT_QWEN_SETTINGS,
  type SeedAudioSettings,
  type QwenSettings,
} from "./voiceoverModelConfig";
import { isOrchestrationModel } from "@/lib/orchestration/orchestration-models";
import { useGeneration } from "@/hooks/useGeneration";

interface CreateAudioWorkspaceProps {
  onBack: () => void;
  /** Shared Audio mode — same state the top-nav Audio dropdown reads/writes. */
  audioMode: AudioMode;
  onAudioModeChange: (mode: AudioMode) => void;
  /** Shared selected model index — same state the top-nav Audio dropdown reads/writes. */
  audioModelIndex: number;
  onAudioModelIndexChange: (index: number) => void;
}

let clipCounter = 0;

export default function CreateAudioWorkspace({
  onBack,
  audioMode,
  onAudioModeChange,
  audioModelIndex,
  onAudioModelIndexChange,
}: CreateAudioWorkspaceProps) {
  const searchParams = useSearchParams();

  // Composer / generation
  const [script, setScript] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [clips, setClips] = useState<AudioClip[]>([]);

  // Shared generation workflow — same hook /generate and /image use. Gated to
  // Voiceover mode only (feature === 0): Change Voice and Translate are not
  // text-to-speech workflows, and the registry has no model for either yet.
  const {
    status: flowStatus,
    message: flowMessage,
    result: resultPreview,
    generate,
  } = useGeneration({ sourcePage: "/audio/create" });

  /**
   * Development-only orchestration model override — identical contract to
   * CinemaStudioWorkspace.tsx / CreateImageWorkspace.tsx. `?model=` must name
   * a model registered in the orchestration pipeline (model-registry.ts);
   * the visible Voiceover model catalog (voiceoverModelConfig.ts) is
   * deliberately never routed to a real provider by this override.
   */
  const orchestrationModelOverride = useMemo(() => {
    const requested = searchParams.get("model");
    return requested && isOrchestrationModel(requested) ? requested : null;
  }, [searchParams]);

  // Rotary mode (0 Voiceover · 1 Change Voice · 2 Translate) — derived from
  // the shared AudioMode so the rotary selector, the top Audio panel, and
  // the prompt bar all read one source of truth.
  const feature = AUDIO_MODE_ORDER.indexOf(audioMode);
  const setFeature = (index: number) => onAudioModeChange(AUDIO_MODE_ORDER[index]);

  // Active model for the in-prompt pill — shared with the top Audio panel.
  const selectedModel = audioModelIndex;
  const setSelectedModel = onAudioModelIndexChange;

  // "Select or add a voice" modal + chosen voice
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);

  // Translate mode: target language + reference video
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState(false);
  const [language, setLanguage] = useState("English");
  const [referenceVideo, setReferenceVideo] = useState<string | null>(null);

  // Translate mode's own Sample Rate/Speed/Volume/Pitch/Output row — kept
  // generic and separate from Voiceover's per-model settings below (Translate
  // isn't in scope for the Voiceover model-specific rework).
  const [translateSampleRate, setTranslateSampleRate] = useState(24000);
  const [translateSpeed, setTranslateSpeed] = useState(1.2);
  const [translateVolume, setTranslateVolume] = useState(1.0);
  const [translatePitch, setTranslatePitch] = useState(-3);
  const [translateOutputFormat, setTranslateOutputFormat] = useState("mp3");

  // Voiceover model-specific settings — kept in separate objects per model
  // since e.g. Qwen's volume (0-100) and Seed Audio's volume (0.5-2) are
  // incompatible ranges and must never bleed into each other on switch.
  const [seedAudioSettings, setSeedAudioSettings] = useState<SeedAudioSettings>(
    DEFAULT_SEED_AUDIO_SETTINGS,
  );
  const [qwenSettings, setQwenSettings] = useState<QwenSettings>(DEFAULT_QWEN_SETTINGS);

  // Feed view
  const [activeTab, setActiveTab] = useState<AudioTab>("all");
  const [layoutMode, setLayoutMode] = useState<AudioLayout>("list");
  const [density, setDensity] = useState(3);

  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);

    if (orchestrationModelOverride && feature === 0) {
      try {
        await generate({ model: orchestrationModelOverride, uiMode: "audio", prompt: script });
      } finally {
        setIsGenerating(false);
      }
      return;
    }

    // Build a model-aware payload: only the fields the selected Voiceover
    // model actually supports are included (no Seed Audio image reference
    // leaking into a Qwen request, no fake sample-rate field for Eleven v3,
    // etc). There is no real generation API yet — this local mock just
    // demonstrates the shape a future backend integration would receive.
    const voiceoverModelId = VOICEOVER_MODEL_ORDER[selectedModel];
    const voiceoverPayload =
      feature === 0
        ? {
            model: voiceoverModelId,
            prompt: script,
            voicePresetId: selectedVoice,
            ...(voiceoverModelId === "seed-audio-1"
              ? {
                  audioReferences: seedAudioSettings.audioReferences,
                  imageReference: seedAudioSettings.imageReference,
                  sampleRate: seedAudioSettings.sampleRate,
                  speed: seedAudioSettings.speed,
                  volume: seedAudioSettings.volume,
                  pitch: seedAudioSettings.pitch,
                  outputFormat: seedAudioSettings.outputFormat,
                }
              : {}),
            ...(voiceoverModelId === "qwen-audio-3"
              ? {
                  language: qwenSettings.language,
                  speed: qwenSettings.speed,
                  volume: qwenSettings.volume,
                  pitch: qwenSettings.pitch,
                  outputFormat: qwenSettings.outputFormat,
                }
              : {}),
          }
        : null;
    if (voiceoverPayload) {
      console.log("Voiceover generation payload:", voiceoverPayload);
    }

    await new Promise((resolve) => setTimeout(resolve, 1600));
    clipCounter += 1;
    setClips((prev) => [
      {
        id: `clip-${clipCounter}`,
        label: script.trim() ? script.trim().slice(0, 24) : `Clip ${clipCounter}`,
        liked: false,
      },
      ...prev,
    ]);
    setIsGenerating(false);
  };

  const toggleLike = (id: string) => {
    setClips((prev) =>
      prev.map((c) => (c.id === id ? { ...c, liked: !c.liked } : c)),
    );
  };

  return (
    <section className="relative flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-black">
      <AudioTopControls
        activeTab={activeTab}
        onTabChange={setActiveTab}
        layout={layoutMode}
        onLayoutChange={setLayoutMode}
        density={density}
        onDensityChange={setDensity}
        onBack={onBack}
      />

      <AudioFeed
        clips={clips}
        isGenerating={isGenerating}
        activeTab={activeTab}
        layout={layoutMode}
        density={density}
        onToggleLike={toggleLike}
      />

      {/* Generation flow feedback — additive only, a new sibling positioned
          just above the fixed composer. Does not modify AudioComposer or
          AudioFeed. Only visible when the dev orchestration override
          (?model=, Voiceover mode) actually dispatched a request. */}
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

      {/* Bottom composer — rotary + prompt(model pill) + Choose Voice + Generate */}
      <AudioComposer
        feature={feature}
        onFeatureChange={setFeature}
        script={script}
        onScriptChange={setScript}
        isGenerating={isGenerating}
        onGenerate={handleGenerate}
        onChooseVoice={() => setIsVoiceModalOpen(true)}
        selectedVoiceLabel={selectedVoice ?? undefined}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        language={language}
        onOpenLanguage={() => setIsLanguageModalOpen(true)}
        referenceVideo={referenceVideo}
        onReferenceVideo={setReferenceVideo}
        translateSampleRate={translateSampleRate}
        onTranslateSampleRateChange={setTranslateSampleRate}
        translateSpeed={translateSpeed}
        onTranslateSpeedChange={setTranslateSpeed}
        translateVolume={translateVolume}
        onTranslateVolumeChange={setTranslateVolume}
        translatePitch={translatePitch}
        onTranslatePitchChange={setTranslatePitch}
        translateOutputFormat={translateOutputFormat}
        onTranslateOutputFormatChange={setTranslateOutputFormat}
        seedAudioSettings={seedAudioSettings}
        onSeedAudioSettingsChange={setSeedAudioSettings}
        qwenSettings={qwenSettings}
        onQwenSettingsChange={setQwenSettings}
      />

      {/* Centered overlays */}
      <SelectVoiceModal
        open={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        selectedVoice={selectedVoice}
        onSelectVoice={setSelectedVoice}
      />
      <ChooseLanguageModal
        open={isLanguageModalOpen}
        onClose={() => setIsLanguageModalOpen(false)}
        selected={language}
        onSelect={setLanguage}
      />
    </section>
  );
}
