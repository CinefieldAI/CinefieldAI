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

interface CreateAudioWorkspaceProps {
  onBack: () => void;
}

let clipCounter = 0;

export default function CreateAudioWorkspace({ onBack }: CreateAudioWorkspaceProps) {
  // Composer / generation
  const [script, setScript] = useState("");
  // Rotary mode (0 Voiceover · 1 Change Voice · 2 Translate)
  const [feature, setFeature] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [clips, setClips] = useState<AudioClip[]>([]);

  // Active model for the in-prompt pill (defaults to Eleven v3)
  const [selectedModel, setSelectedModel] = useState(0);

  // "Select or add a voice" modal + chosen voice
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);

  // Translate mode: target language + reference video
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState(false);
  const [language, setLanguage] = useState("English");
  const [referenceVideo, setReferenceVideo] = useState<string | null>(null);

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
