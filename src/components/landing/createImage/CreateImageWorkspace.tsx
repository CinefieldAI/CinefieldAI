"use client";

import { useState } from "react";
import { ArrowLeft, Wand2 } from "lucide-react";
import HeroSection from "@/components/image-tools/HeroSection";
import ImageAtmosphereBackground from "./ImageAtmosphereBackground";
import PromptComposer from "./PromptComposer";
import { FEATURED_MODELS } from "./createImageData";

interface CreateImageWorkspaceProps {
  onBack: () => void;
  /** Model clicked in the navbar's Image mega-dropdown — preselects the
   * composer instead of always opening on the default ("Auto"). */
  initialModel?: string;
}

export default function CreateImageWorkspace({ onBack, initialModel }: CreateImageWorkspaceProps) {
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState(initialModel ?? FEATURED_MODELS[0].name);

  const handleGenerate = async () => {
    // Simulate render latency so the composer can show its loading state
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
