"use client";

import { useState } from "react";
import {
  AudioLines,
  ChevronDown,
  ChevronRight,
  Minus,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { AUDIO_MODELS, AUDIO_MODE_ORDER, type AudioMode } from "../audioMenuData";

/**
 * Phase-1 shell for the rebuilt /audio/create workspace: left control panel +
 * right hero, mirroring the /video/create layout. Interactions beyond tab and
 * local control state arrive in the integration phase — the old
 * CreateAudioWorkspace/AudioComposer stay in the codebase untouched as the
 * source for that wiring (voice modal, language modal, per-model capability
 * controls, generation flow).
 *
 * Tabs are the existing shared AudioMode, not a new state: "Text to Speech" is
 * voiceover, "Voice Change" is change-voice, "Translate" is translation, so
 * the navbar's Audio dropdown and this panel keep agreeing about the mode the
 * same way they did with the old rotary.
 */
interface AudioCreateShellProps {
  onBack: () => void;
  audioMode: AudioMode;
  onAudioModeChange: (mode: AudioMode) => void;
  audioModelIndex: number;
  onAudioModelIndexChange: (index: number) => void;
}

const TAB_LABELS: Record<AudioMode, string> = {
  voiceover: "Text to Speech",
  "change-voice": "Voice Change",
  translation: "Translate",
};

const CARD = "rounded-2xl border border-white/[0.07] bg-[#101113]";

export default function AudioCreateShell({
  audioMode,
  onAudioModeChange,
  audioModelIndex,
}: AudioCreateShellProps) {
  const [script, setScript] = useState("");
  const [batchSize, setBatchSize] = useState(1);
  const [contentTab, setContentTab] = useState<"history" | "how-it-works">(
    "how-it-works",
  );

  const model = AUDIO_MODELS[audioModelIndex] ?? AUDIO_MODELS[0];
  const ModelIcon = model.icon;

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col gap-3 p-3 lg:h-[calc(100dvh-4rem)] lg:min-h-0 lg:flex-row">
      {/* ------------------------- Left control panel ------------------------- */}
      <aside className="flex w-full shrink-0 flex-col rounded-2xl border border-white/[0.07] bg-[#17191b] lg:h-full lg:w-[400px]">
        {/* Mode tabs — active is white with a thin white underline. */}
        <div
          role="tablist"
          aria-label="Audio mode"
          className="flex shrink-0 items-center gap-5 border-b border-white/[0.06] px-4"
        >
          {AUDIO_MODE_ORDER.map((mode) => {
            const selected = mode === audioMode;
            return (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onAudioModeChange(mode)}
                className={`-mb-px border-b-2 py-3.5 text-sm font-medium transition-colors focus-visible:outline-none ${
                  selected
                    ? "border-white text-white"
                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {TAB_LABELS[mode]}
              </button>
            );
          })}
        </div>

        <div className="hide-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {/* Voice picker */}
          <button
            type="button"
            className={`${CARD} relative flex flex-col items-center gap-3 px-4 py-7 text-center transition-colors hover:border-white/[0.14]`}
          >
            <span className="absolute right-3 top-3 rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              Required
            </span>
            <span className="flex size-12 items-center justify-center rounded-full bg-white/[0.06]">
              <AudioLines className="size-5 text-zinc-300" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-white">Pick a voice</span>
              <span className="mt-1 block text-xs text-zinc-500">
                Choose a preset or an uploaded voice
              </span>
            </span>
          </button>

          {/* Script */}
          <div className={`${CARD} flex flex-col gap-2 p-4`}>
            <span className="text-sm font-semibold text-white">Script</span>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={7}
              placeholder={
                "Write exactly what the voice will read out loud.\nType @ to reference attachments"
              }
              className="w-full resize-none bg-transparent text-sm leading-relaxed text-white placeholder:text-zinc-600 focus:outline-none"
            />
          </div>

          {/* Model — displays the existing shared selection; the picker itself
              is wired in the integration phase. */}
          <button
            type="button"
            className={`${CARD} flex items-center gap-3 px-4 py-3 text-left transition-colors hover:border-white/[0.14]`}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
              <ModelIcon className="size-4 text-zinc-200" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Model
              </span>
              <span className="block truncate text-sm font-semibold text-white">
                {model.title}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-zinc-500" />
          </button>

          {/* Batch size */}
          <div className={`${CARD} flex items-center justify-between px-4 py-3`}>
            <span className="text-sm font-medium text-zinc-300">Batch size</span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                disabled={batchSize <= 1}
                onClick={() => setBatchSize((v) => Math.max(1, v - 1))}
                aria-label="Decrease batch size"
                className="flex size-7 items-center justify-center rounded-md text-zinc-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-zinc-600"
              >
                <Minus className="size-3.5" />
              </button>
              <span className="w-9 text-center text-sm font-semibold text-white">
                {batchSize}
                <span className="text-zinc-500">/4</span>
              </span>
              <button
                type="button"
                disabled={batchSize >= 4}
                onClick={() => setBatchSize((v) => Math.min(4, v + 1))}
                aria-label="Increase batch size"
                className="flex size-7 items-center justify-center rounded-md text-zinc-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-zinc-600"
              >
                <Plus className="size-3.5" />
              </button>
            </span>
          </div>

          {/* Advanced settings — collapsible-ready, contents arrive later. */}
          <button
            type="button"
            aria-expanded={false}
            className={`${CARD} flex items-center gap-3 px-4 py-3 text-left transition-colors hover:border-white/[0.14]`}
          >
            <SlidersHorizontal className="size-4 shrink-0 text-zinc-400" />
            <span className="flex-1 text-sm font-medium text-zinc-300">
              Advanced settings
            </span>
            <ChevronDown className="size-4 shrink-0 text-zinc-500" />
          </button>

          {/* Generate */}
          <button
            type="button"
            className="mt-auto h-12 w-full shrink-0 rounded-xl bg-gradient-to-b from-[#E58E6D] to-[#D97757] text-sm font-bold text-white transition-transform hover:brightness-105 active:scale-[0.99]"
          >
            Generate
          </button>
        </div>
      </aside>

      {/* --------------------------- Right workspace --------------------------- */}
      <main className="flex min-h-0 flex-1 flex-col gap-2.5 pb-3">
        <div
          role="tablist"
          aria-label="Audio page content"
          className="flex h-11 shrink-0 items-center gap-1 self-start rounded-xl border border-white/[0.07] bg-[#181a1c] p-1"
        >
          {(
            [
              { value: "history", label: "History" },
              { value: "how-it-works", label: "How it works" },
            ] as const
          ).map((tab) => {
            const selected = tab.value === contentTab;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setContentTab(tab.value)}
                className={`h-9 min-w-28 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D97757]/60 ${
                  selected
                    ? "bg-white/10 text-white"
                    : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 pt-10">
            <header className="text-center">
              <h1 className="text-3xl font-extrabold uppercase tracking-wide text-white md:text-4xl">
                Turn text into speech
              </h1>
              <p className="mt-3 text-sm text-zinc-400 md:text-base">
                Lifelike speech from any script — ready for your projects
              </p>
            </header>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <section className="rounded-2xl border border-white/[0.07] bg-[#17191b] p-5">
                <h2 className="text-lg font-semibold text-white">
                  Pick or clone a voice
                </h2>
                <p className="mt-1 whitespace-pre-line text-sm text-zinc-400">
                  {"Choose a preset, clone your own,\nor pick a model"}
                </p>
                {/* Media placeholder — no matching internal promo asset exists
                    yet, and external reference media must not be hotlinked. */}
                <div className="mt-4 flex aspect-video items-center justify-center rounded-xl border border-white/[0.05] bg-[#101113]">
                  <AudioLines className="size-8 text-zinc-700" />
                </div>
              </section>

              <section className="rounded-2xl border border-white/[0.07] bg-[#17191b] p-5">
                <h2 className="text-lg font-semibold text-white">
                  Write, describe and generate
                </h2>
                <p className="mt-1 whitespace-pre-line text-sm text-zinc-400">
                  {"Type your script, describe how it sounds,\nand create"}
                </p>
                <div className="mt-4 flex aspect-video items-center justify-center rounded-xl border border-white/[0.05] bg-[#101113]">
                  <AudioLines className="size-8 text-zinc-700" />
                </div>
              </section>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
