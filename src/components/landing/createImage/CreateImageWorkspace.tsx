"use client";

import { useState } from "react";
import { ArrowLeft, Wand2 } from "lucide-react";
import PromptComposer from "./PromptComposer";
import { FEATURED_MODELS } from "./createImageData";

interface CreateImageWorkspaceProps {
  onBack: () => void;
}

export default function CreateImageWorkspace({ onBack }: CreateImageWorkspaceProps) {
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState(FEATURED_MODELS[0].name);

  const handleGenerate = async () => {
    // Simulate render latency so the composer can show its loading state
    await new Promise((resolve) => setTimeout(resolve, 1600));
  };

  return (
    <section className="relative flex min-h-[calc(100vh-4rem)] flex-col overflow-hidden pb-[190px]">
      {/* Ambient magenta glow */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/3 h-[480px] w-[680px] -translate-x-1/2 rounded-full bg-magenta-500/10 blur-[120px]" />
      </div>

      {/* Top bar */}
      <div className="flex items-center justify-between px-6 pt-5">
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

      {/* Open creative workspace area */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
          What will you create today?
        </h1>
        <p className="mt-3 max-w-md text-sm text-zinc-500">
          Describe a scene, drop in references, and pick a model to start
          generating.
        </p>
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
