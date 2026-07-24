"use client";

import { useState } from "react";
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
  // Composer / generation
  const [script, setScript] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [clips, setClips] = useState<AudioClip[]>([]);

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
