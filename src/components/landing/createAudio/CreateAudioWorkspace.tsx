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

  // Audio controls (sample rate, speed, volume, pitch, output format)
  const [sampleRate, setSampleRate] = useState(24000);
  const [speed, setSpeed] = useState(1.2);
  const [volume, setVolume] = useState(1.0);
  const [pitch, setPitch] = useState(-3);
  const [outputFormat, setOutputFormat] = useState("mp3");

  // Feed view
  const [activeTab, setActiveTab] = useState<AudioTab>("all");
  const [layoutMode, setLayoutMode] = useState<AudioLayout>("list");
  const [density, setDensity] = useState(3);

  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
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
        sampleRate={sampleRate}
        onSampleRateChange={setSampleRate}
        speed={speed}
        onSpeedChange={setSpeed}
        volume={volume}
        onVolumeChange={setVolume}
        pitch={pitch}
        onPitchChange={setPitch}
        outputFormat={outputFormat}
        onOutputFormatChange={setOutputFormat}
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
