"use client";

import { useState } from "react";
import { ArrowLeft, Film } from "lucide-react";
import VideoControlPanel from "./VideoControlPanel";
import VideoPreviewCanvas, { type VideoShot } from "./VideoPreviewCanvas";

interface CreateVideoWorkspaceProps {
  onBack: () => void;
}

const SHOT_GRADIENTS = [
  "from-rose-500/35 via-pink-600/25 to-black",
  "from-sky-500/35 via-indigo-600/25 to-black",
  "from-amber-500/35 via-orange-600/25 to-black",
  "from-emerald-500/35 via-teal-600/25 to-black",
];

let shotCounter = 0;

export default function CreateVideoWorkspace({ onBack }: CreateVideoWorkspaceProps) {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [shots, setShots] = useState<VideoShot[]>([]);

  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    await new Promise((resolve) => setTimeout(resolve, 1800));
    shotCounter += 1;
    setShots((prev) => [
      {
        id: `shot-${shotCounter}`,
        label: prompt.trim() ? prompt.trim().slice(0, 28) : `Shot ${shotCounter}`,
        gradient: SHOT_GRADIENTS[(shotCounter - 1) % SHOT_GRADIENTS.length],
      },
      ...prev,
    ]);
    setIsGenerating(false);
  };

  return (
    <section className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden">
      {/* Slim top bar */}
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Explore
        </button>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-magenta-500/10 px-3 py-1 text-xs font-semibold text-magenta-400">
          <Film className="h-3 w-3" />
          Create Video
        </span>
      </div>

      {/* Sidebar control panel + center preview canvas */}
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[340px_1fr]">
        <VideoControlPanel
          prompt={prompt}
          onPromptChange={setPrompt}
          isGenerating={isGenerating}
          onGenerate={handleGenerate}
        />
        <VideoPreviewCanvas isGenerating={isGenerating} shots={shots} />
      </div>
    </section>
  );
}
