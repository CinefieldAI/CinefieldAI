"use client";

import { useState } from "react";
import { ChevronDown, Film, Loader2, Sparkles } from "lucide-react";
import {
  VIDEO_DURATIONS,
  VIDEO_MODELS,
  VIDEO_QUALITIES,
} from "@/components/landing/panelData";

interface VideoControlPanelProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  isGenerating: boolean;
  onGenerate: () => void;
}

function PillGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <div className="flex gap-1.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`flex-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              value === option
                ? "bg-magenta-500/15 text-magenta-400 ring-1 ring-magenta-500/40"
                : "bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function VideoControlPanel({
  prompt,
  onPromptChange,
  isGenerating,
  onGenerate,
}: VideoControlPanelProps) {
  const [modelOpen, setModelOpen] = useState(false);
  const [model, setModel] = useState(0);
  const [duration, setDuration] = useState<typeof VIDEO_DURATIONS[number]>("8s");
  const [resolution, setResolution] = useState<typeof VIDEO_QUALITIES[number]>("1080p");
  const [tier, setTier] = useState<"Standard" | "Pro Max">("Standard");
  const [motion, setMotion] = useState(60);

  const currentModel = VIDEO_MODELS[model];

  return (
    <aside className="flex h-full flex-col border-b border-white/10 bg-zinc-950/60 md:border-b-0 md:border-r">
      {/* Scrollable controls */}
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-magenta-500/15 text-magenta-400">
            <Film className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">Video Controls</p>
            <p className="text-xs text-zinc-500">Configure your shot</p>
          </div>
        </div>

        {/* Prompt */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Prompt
          </p>
          <textarea
            rows={4}
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            placeholder="A slow dolly-in through a neon-lit street at night..."
            className="w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3.5 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-magenta-500/40 focus:outline-none"
          />
        </div>

        {/* Model select */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Model
          </p>
          <div className="relative">
            <button
              type="button"
              onClick={() => setModelOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
            >
              <span>
                <span className="block text-sm font-medium text-white">
                  {currentModel.name}
                </span>
                <span className="block text-xs text-zinc-500">
                  {currentModel.description}
                </span>
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${
                  modelOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {modelOpen && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1.5 space-y-1 rounded-xl border border-white/10 bg-zinc-950/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl">
                {VIDEO_MODELS.map((m, idx) => (
                  <button
                    key={m.name}
                    type="button"
                    onClick={() => {
                      setModel(idx);
                      setModelOpen(false);
                    }}
                    className={`block w-full rounded-lg px-3 py-2 text-left transition-colors ${
                      idx === model
                        ? "bg-magenta-500/10 text-magenta-400"
                        : "text-zinc-300 hover:bg-white/5"
                    }`}
                  >
                    <span className="block text-sm font-medium">{m.name}</span>
                    <span className="block text-xs text-zinc-500">{m.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <PillGroup
          label="Duration"
          options={VIDEO_DURATIONS}
          value={duration}
          onChange={setDuration}
        />
        <PillGroup
          label="Resolution"
          options={VIDEO_QUALITIES}
          value={resolution}
          onChange={setResolution}
        />
        <PillGroup
          label="Render Tier"
          options={["Standard", "Pro Max"] as const}
          value={tier}
          onChange={setTier}
        />

        {/* Motion strength */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Motion Strength
            </p>
            <span className="font-mono text-xs text-magenta-400">{motion}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={motion}
            onChange={(e) => setMotion(Number(e.target.value))}
            className="w-full accent-magenta-500"
          />
        </div>
      </div>

      {/* Generate Video — fixed at the bottom of the sidebar */}
      <div className="border-t border-white/10 p-4">
        <button
          type="button"
          onClick={onGenerate}
          disabled={isGenerating}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-magenta-500 py-3 text-sm font-semibold text-white shadow-lg shadow-magenta-500/30 transition-all hover:bg-magenta-600 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Generate Video
            </>
          )}
        </button>
        <p className="mt-2 text-center text-xs text-zinc-500">
          1,240 credits remaining
        </p>
      </div>
    </aside>
  );
}
