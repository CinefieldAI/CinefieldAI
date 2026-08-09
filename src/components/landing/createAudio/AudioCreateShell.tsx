"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  FileAudio,
  Filter,
  Info,
  Minus,
  Mic,
  Play,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
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

const VOICES = [
  { name: "Grady", gender: "Male", color: "from-amber-300 to-amber-600" },
  { name: "Ainsley", gender: "Female", color: "from-amber-200 to-orange-500" },
  { name: "Brielle", gender: "Female", color: "from-yellow-300 to-orange-600" },
  { name: "Holden", gender: "Male", color: "from-emerald-200 to-emerald-500" },
  { name: "Arthur", gender: "Male", color: "from-yellow-200 to-orange-500" },
  { name: "Faye", gender: "Female", color: "from-amber-300 to-amber-700" },
  { name: "Archie", gender: "Male", color: "from-blue-300 to-blue-700" },
  { name: "Fraser", gender: "Male", color: "from-cyan-200 to-cyan-600" },
  { name: "Benji", gender: "Male", color: "from-yellow-200 to-amber-600" },
] as const;

const STABILITY_OPTIONS = [
  { value: "Creative", description: "most expressive, less consistent" },
  { value: "Natural", description: "balanced — default" },
  { value: "Robust", description: "most consistent, muted tags" },
] as const;

type FloatingPanel = "voice" | "model" | "stability" | null;

type FloatingPosition = CSSProperties;

function ModelBadge({ index }: { index: number }) {
  const item = AUDIO_MODELS[index];
  const Icon = item.icon;

  return (
    <span
      className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[11px] border border-white/30 shadow-[0_-2px_8px_rgba(255,255,255,0.34),0_4px_14px_rgba(217,119,87,0.5)]"
      style={{
        background:
          "linear-gradient(180deg, #e8e8e8 0%, #9b9b9b 42%, #d97757 72%, #a8482a 100%)",
      }}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/70 to-transparent" />
      <Icon className="relative z-10 size-5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]" />
    </span>
  );
}

export default function AudioCreateShell({
  audioModelIndex,
  onAudioModelIndexChange,
}: AudioCreateShellProps) {
  const [script, setScript] = useState("");
  const [batchSize, setBatchSize] = useState(4);
  const [contentTab, setContentTab] = useState<"history" | "how-it-works">(
    "how-it-works",
  );
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saveSettings, setSaveSettings] = useState(false);
  const [stability, setStability] = useState<
    (typeof STABILITY_OPTIONS)[number]["value"]
  >("Natural");
  const [floatingPanel, setFloatingPanel] = useState<FloatingPanel>(null);
  const [floatingPosition, setFloatingPosition] = useState<FloatingPosition>({
    left: 0,
    top: 0,
    width: 0,
  });

  const voiceButtonRef = useRef<HTMLButtonElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const stabilityButtonRef = useRef<HTMLButtonElement>(null);
  const floatingPanelRef = useRef<HTMLDivElement>(null);

  const model = AUDIO_MODELS[audioModelIndex] ?? AUDIO_MODELS[0];
  const isElevenV3 = audioModelIndex === 1;

  const openFloatingPanel = (
    panel: Exclude<FloatingPanel, null>,
    trigger: HTMLButtonElement | null,
    preferredWidth: number,
    preferredHeight: number,
  ) => {
    if (!trigger) return;
    if (floatingPanel === panel) {
      setFloatingPanel(null);
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const availableRight = window.innerWidth - rect.right - viewportPadding;
    const width = Math.min(
      preferredWidth,
      Math.max(280, window.innerWidth - viewportPadding * 2),
    );
    const left =
      availableRight >= width + 12
        ? rect.right + 12
        : Math.max(viewportPadding, rect.left - width - 12);

    setFloatingPosition({
      left,
      top: Math.max(
        68,
        Math.min(rect.top, window.innerHeight - preferredHeight - viewportPadding),
      ),
      width,
    });
    setFloatingPanel(panel);
  };

  useEffect(() => {
    if (!floatingPanel) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFloatingPanel(null);
    };
    const closeOnResize = () => setFloatingPanel(null);

    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnResize);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [floatingPanel]);

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col gap-3 p-3 lg:h-[calc(100dvh-4rem)] lg:min-h-0 lg:flex-row">
      {/* ------------------------- Left control panel ------------------------- */}
      <aside className="flex w-full shrink-0 flex-col rounded-2xl border border-white/[0.07] bg-[#111315] lg:h-full lg:w-[340px]">
        <div
          role="tablist"
          aria-label="Audio mode"
          className="grid h-[52px] shrink-0 grid-cols-[1.15fr_1fr_0.75fr] border-b border-white/[0.06] px-3"
        >
          {AUDIO_MODE_ORDER.map((mode) => {
            const enabled = mode === "voiceover";
            return (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={enabled}
                disabled={!enabled}
                className={`relative min-w-0 px-1 text-sm font-semibold tracking-[0px] focus-visible:outline-none ${
                  enabled ? "text-white" : "cursor-default text-zinc-400"
                }`}
              >
                <span className="block whitespace-nowrap">{TAB_LABELS[mode]}</span>
                {enabled && (
                  <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-white" />
                )}
              </button>
            );
          })}
        </div>

        <div className="hide-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <button
            ref={voiceButtonRef}
            type="button"
            aria-expanded={floatingPanel === "voice"}
            onClick={() =>
              openFloatingPanel("voice", voiceButtonRef.current, 660, 560)
            }
            className="relative flex h-40 shrink-0 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/10 bg-[#202224] px-4 text-center transition-colors hover:border-white/20"
          >
            <span className="absolute right-1.5 top-1.5 rounded-xl bg-white/[0.05] px-2 py-1 text-[10px] font-medium text-zinc-400">
              Required
            </span>
            <span className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-gradient-to-b from-white/10 to-white/[0.03] shadow-[inset_0_1px_1px_rgba(255,255,255,0.14)]">
              <AudioLines className="size-4 text-zinc-300" />
            </span>
            <span>
              <span className="block text-base font-semibold text-white">
                {selectedVoice ?? "Pick a voice"}
              </span>
              <span className="mt-1 block truncate text-sm font-medium text-zinc-400">
                {selectedVoice
                  ? "Voice selected"
                  : "Choose a preset or an uploaded voice"}
              </span>
            </span>
          </button>

          <section className="relative flex h-40 shrink-0 flex-col gap-1 rounded-xl border border-white/[0.07] bg-[#202224] p-3 focus-within:border-white/15">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-zinc-400">Script</span>
              <button
                type="button"
                aria-label="Script information"
                aria-expanded={infoOpen}
                onClick={() => setInfoOpen((value) => !value)}
                className="flex size-[18px] items-center justify-center rounded-full text-zinc-400 hover:text-white"
              >
                <Info className="size-4" />
              </button>
            </div>
            <textarea
              value={script}
              onChange={(event) => setScript(event.target.value)}
              aria-label="Script"
              placeholder={
                "Write exactly what the voice will read out loud.\nType @ to reference attachments"
              }
              className="min-h-0 flex-1 resize-none bg-transparent text-sm leading-5 text-white placeholder:text-zinc-400 focus:outline-none"
            />
            {infoOpen && (
              <div className="absolute right-0 top-7 z-40 w-64 rounded-xl border border-white/10 bg-[#17191b]/95 p-3 text-left shadow-2xl backdrop-blur-xl">
                <p className="text-xs text-zinc-400">What the voice says:</p>
                <p className="mt-1 text-xs font-semibold leading-5 text-white">
                  Write exactly what the voice will read out loud, word for word
                </p>
              </div>
            )}
          </section>

          <button
            ref={modelButtonRef}
            type="button"
            aria-expanded={floatingPanel === "model"}
            onClick={() =>
              openFloatingPanel("model", modelButtonRef.current, 320, 500)
            }
            className="flex h-14 shrink-0 items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-[#202224] px-3 text-left transition-colors hover:border-white/15"
          >
            <span className="min-w-0">
              <span className="block text-xs font-medium text-zinc-400">Model</span>
              <span className="mt-1 block truncate text-sm font-semibold text-white">
                {model.title}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-zinc-400" />
          </button>

          <div className="flex h-12 shrink-0 items-center justify-between rounded-xl border border-white/[0.07] bg-[#202224] px-3">
            <span className="text-sm font-semibold text-white">Batch size</span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                disabled={batchSize <= 1}
                onClick={() => setBatchSize((value) => Math.max(1, value - 1))}
                aria-label="Decrease batch size"
                className="flex size-6 items-center justify-center rounded-md text-white transition-colors hover:bg-white/5 disabled:opacity-40"
              >
                <Minus className="size-4" />
              </button>
              <span className="px-1 text-sm font-semibold tabular-nums text-white">
                {batchSize}/4
              </span>
              <button
                type="button"
                disabled={batchSize >= 4}
                onClick={() => setBatchSize((value) => Math.min(4, value + 1))}
                aria-label="Increase batch size"
                className="flex size-6 items-center justify-center rounded-md text-white transition-colors hover:bg-white/5 disabled:opacity-40"
              >
                <Plus className="size-4" />
              </button>
            </div>
          </div>

          {isElevenV3 && (
            <div className="shrink-0">
              <button
                type="button"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((value) => !value)}
                className="flex h-11 w-full items-center gap-3 px-1 text-left text-white"
              >
                <SlidersHorizontal className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  Advanced settings
                </span>
                <ChevronDown
                  className={`size-4 shrink-0 opacity-70 transition-transform ${
                    advancedOpen ? "rotate-0" : "-rotate-90"
                  }`}
                />
              </button>

              {advancedOpen && (
                <div className="flex flex-col gap-2 pb-1 pt-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs text-zinc-400">Eleven v3 controls</span>
                    <button
                      type="button"
                      onClick={() => {
                        setStability("Natural");
                        setSaveSettings(false);
                      }}
                      className="flex items-center gap-1 text-xs font-semibold text-white hover:text-[#D97757]"
                    >
                      <RotateCcw className="size-3" />
                      Reset
                    </button>
                  </div>
                  <span className="px-1 text-xs text-zinc-400">Audio settings</span>
                  <button
                    ref={stabilityButtonRef}
                    type="button"
                    aria-expanded={floatingPanel === "stability"}
                    onClick={() =>
                      openFloatingPanel(
                        "stability",
                        stabilityButtonRef.current,
                        224,
                        224,
                      )
                    }
                    className="flex h-12 items-center justify-between rounded-xl border border-white/[0.07] bg-[#202224] px-3 text-sm font-semibold text-white hover:border-white/15"
                  >
                    <span>Stability</span>
                    <span className="flex items-center gap-2">
                      {stability}
                      <ChevronRight className="size-4 opacity-60" />
                    </span>
                  </button>
                  <div className="flex h-12 items-center justify-between rounded-xl border border-white/[0.07] bg-[#202224] px-3 text-sm font-medium text-zinc-400">
                    <span>Output format</span>
                    <span className="flex items-center gap-1">
                      <FileAudio className="size-4" />
                      MP3
                    </span>
                  </div>
                  <div className="flex h-12 items-center justify-between rounded-xl border border-white/[0.07] bg-[#202224] px-3">
                    <span className="text-sm font-semibold text-white">Save settings</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={saveSettings}
                      aria-label="Save settings"
                      onClick={() => setSaveSettings((value) => !value)}
                      className={`relative h-6 w-11 rounded-full transition-colors ${
                        saveSettings ? "bg-[#D97757]" : "bg-zinc-600"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                          saveSettings ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            className="mt-auto h-14 w-full shrink-0 rounded-xl bg-[#96aa00] text-base font-bold text-black shadow-[inset_0_-4px_rgba(0,0,0,0.22)] transition hover:brightness-110 active:translate-y-px"
          >
            Generate
          </button>
        </div>
      </aside>

      {floatingPanel === "voice" && (
        <div
          ref={floatingPanelRef}
          role="dialog"
          aria-label="Select or add a voice"
          className="fixed z-[80] flex max-h-[calc(100vh-80px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#17191b]/95 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-2xl"
          style={floatingPosition}
        >
          <div className="relative grid min-h-[188px] grid-cols-[1fr_1.05fr] items-center gap-5 border-b border-white/[0.06] px-6 py-5">
            <div>
              <h2 className="text-2xl font-black uppercase text-white">
                Select or add a voice
              </h2>
              <p className="mt-2 max-w-[280px] text-sm text-zinc-400">
                Select from presets, record your own, or upload an audio.
              </p>
              <button
                type="button"
                className="mt-5 flex h-10 items-center gap-2 rounded-xl bg-[#dfff00] px-4 text-sm font-bold text-black shadow-[inset_0_-3px_rgba(0,0,0,0.28)]"
              >
                <Sparkles className="size-4" />
                Create custom voice
              </button>
            </div>
            <div className="flex items-center justify-center gap-4">
              <span className="hidden h-20 items-center gap-1 sm:flex">
                {Array.from({ length: 11 }, (_, index) => (
                  <span
                    key={index}
                    className="w-px bg-zinc-500"
                    style={{ height: `${24 + ((index * 17) % 52)}%` }}
                  />
                ))}
              </span>
              <span className="flex size-24 items-center justify-center rounded-full bg-[#e7fa00] text-black shadow-[0_0_30px_rgba(231,250,0,0.28)]">
                <Mic className="size-10" />
              </span>
              <span className="hidden h-20 items-center gap-1 sm:flex">
                {Array.from({ length: 11 }, (_, index) => (
                  <span
                    key={index}
                    className="w-px bg-zinc-500"
                    style={{ height: `${24 + ((index * 23) % 52)}%` }}
                  />
                ))}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setFloatingPanel(null)}
              aria-label="Close voice panel"
              className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="min-h-0 overflow-y-auto p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-400">Voices</span>
              <button
                type="button"
                className="flex h-8 items-center gap-1.5 rounded-lg bg-white/5 px-3 text-xs font-semibold text-white"
              >
                <Filter className="size-3.5" />
                Filter
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {VOICES.map((voice, voiceIndex) => {
                const selected = selectedVoice === voice.name;
                return (
                  <button
                    key={voice.name}
                    type="button"
                    onClick={() => {
                      setSelectedVoice(voice.name);
                      setFloatingPanel(null);
                    }}
                    className={`min-w-0 rounded-xl border p-2 text-left transition-colors ${
                      selected
                        ? "border-[#D97757]/60 bg-[#D97757]/10"
                        : "border-white/[0.06] bg-[#222427] hover:border-white/15"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`size-10 shrink-0 rounded-full bg-gradient-to-br ${voice.color}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-white">
                          {voice.name}
                        </span>
                        <span className="block text-xs text-zinc-400">{voice.gender}</span>
                      </span>
                      {selected && <Check className="size-4 text-[#D97757]" />}
                    </span>
                    <span className="mt-2 flex items-center gap-2">
                      <Play className="size-4 shrink-0 fill-white text-white" />
                      <span className="flex h-5 flex-1 items-center gap-0.5 overflow-hidden">
                        {Array.from({ length: 22 }, (_, index) => (
                          <span
                            key={index}
                            className="w-px shrink-0 bg-white/20"
                            style={{ height: `${22 + ((voiceIndex * 13 + index * 19) % 72)}%` }}
                          />
                        ))}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {floatingPanel === "model" && (
        <div
          ref={floatingPanelRef}
          role="dialog"
          aria-label="Select audio model"
          className="fixed z-[80] max-h-[520px] overflow-y-auto rounded-2xl border border-white/10 bg-[#1c1e20]/95 p-2 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-2xl"
          style={floatingPosition}
        >
          <div className="flex h-9 items-center gap-2 px-2 text-xs text-zinc-400">
            <Search className="size-4" />
            <span>Search</span>
          </div>
          <div className="flex items-center gap-2 px-2 py-2 text-xs font-semibold text-zinc-400">
            <Sparkles className="size-4" />
            Featured models
          </div>
          <div className="flex flex-col gap-1">
            {AUDIO_MODELS.map((item, index) => {
              const active = index === audioModelIndex;
              return (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => {
                    onAudioModelIndexChange(index);
                    if (index !== 1) setAdvancedOpen(false);
                    setFloatingPanel(null);
                  }}
                  className={`flex min-h-[62px] items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors ${
                    active ? "bg-white/10" : "hover:bg-white/5"
                  }`}
                >
                  <ModelBadge index={index} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-zinc-400">
                      {item.description}
                    </span>
                  </span>
                  {active && <Check className="size-4 shrink-0 text-[#dfff00]" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {floatingPanel === "stability" && (
        <div
          ref={floatingPanelRef}
          role="dialog"
          aria-label="Stability"
          className="fixed z-[90] rounded-xl border border-white/10 bg-[#1c1e20]/95 p-2 shadow-[0_18px_50px_rgba(0,0,0,0.65)] backdrop-blur-2xl"
          style={floatingPosition}
        >
          <div className="flex h-8 items-center px-2 text-xs font-semibold text-zinc-500">
            Stability
          </div>
          {STABILITY_OPTIONS.map((option) => {
            const active = option.value === stability;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setStability(option.value);
                  setFloatingPanel(null);
                }}
                className={`flex min-h-14 w-full items-center justify-between gap-2 rounded-lg p-2 text-left ${
                  active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">
                    {option.value}
                  </span>
                  <span className="block truncate text-xs text-zinc-400">
                    {option.description}
                  </span>
                </span>
                {active && <Check className="size-4 shrink-0 text-white" />}
              </button>
            );
          })}
        </div>
      )}

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
          <div className="@container w-full overflow-hidden rounded-xl border border-white/5 bg-[#111214]">
            <div className="flex min-h-[640px] flex-col px-8 pb-8 pt-[42px] @max-[640px]:px-4 @max-[640px]:pt-7">
              <header className="flex flex-col items-center gap-2">
                <h1 className="text-center font-grotesk text-[40px] font-bold uppercase leading-[48px] text-white [font-feature-settings:'ss04'] @max-[640px]:text-[28px] @max-[640px]:leading-9">
                  Turn text into speech
                </h1>
                <p className="text-center text-[18px] font-medium leading-7 text-[#898A8B]">
                  Lifelike speech from any script — ready for your projects
                </p>
              </header>

              <div className="mt-[38px] flex w-full flex-col gap-5 @[640px]:flex-row">
                <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-6 overflow-hidden rounded-[24px] border border-[rgba(217,217,217,0.04)] bg-[#18191C] px-4 pb-4 pt-5">
                  <div className="flex w-full flex-col gap-2 px-2">
                    <h2 className="text-[24px] font-medium leading-7 text-white">
                      Pick or clone a voice
                    </h2>
                    <p className="max-w-[266px] text-[16px] font-medium leading-6 text-[#828282]">
                      Choose a preset, clone your own, or pick a model
                    </p>
                  </div>
                  <div className="relative h-[300px] w-full overflow-hidden rounded-xl">
                    <video
                      autoPlay
                      loop
                      muted
                      playsInline
                      disablePictureInPicture
                      preload="metadata"
                      aria-label="Voice presets carousel"
                      className="size-full object-cover"
                    >
                      <source
                        src="https://static.higgsfield.ai/voice/how-to-use/tts-left.mp4"
                        type="video/mp4"
                      />
                      Your browser does not support the video.
                    </video>
                  </div>
                </section>

                <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-6 overflow-hidden rounded-[24px] border border-[rgba(217,217,217,0.04)] bg-[#18191C] px-4 pb-4 pt-5">
                  <div className="flex w-full flex-col gap-2 px-2">
                    <h2 className="text-[24px] font-medium leading-7 text-white">
                      Write, describe and generate
                    </h2>
                    <p className="max-w-[328px] text-[16px] font-medium leading-6 text-[#828282]">
                      Type your script, describe how it sounds, and create
                    </p>
                  </div>
                  <div className="relative h-[300px] w-full overflow-hidden rounded-xl">
                    <video
                      autoPlay
                      loop
                      muted
                      playsInline
                      disablePictureInPicture
                      preload="metadata"
                      aria-label="Text to speech form with a script prompt"
                      className="size-full object-cover"
                    >
                      <source
                        src="https://static.higgsfield.ai/voice/how-to-use/tts-right.mp4"
                        type="video/mp4"
                      />
                      Your browser does not support the video.
                    </video>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
