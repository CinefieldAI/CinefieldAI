"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  FileAudio,
  Filter,
  ImageIcon,
  Info,
  Minus,
  Mic,
  Music2,
  Play,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  AUDIO_MODELS,
  AUDIO_MODE_ORDER,
  type AudioMode,
} from "../audioMenuData";

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

const QWEN_FORMATS = [
  { value: "mp3", description: "small, default" },
  { value: "wav", description: "lossless" },
  { value: "opus", description: "web" },
] as const;

const QWEN_SAMPLE_RATES = [
  { value: "8000 Hz", description: "low / phone quality" },
  { value: "16000 Hz", description: "basic / voice calls" },
  { value: "22050 Hz", description: "legacy audio" },
  { value: "24000 Hz", description: "default — fine for voice" },
  { value: "44100 Hz", description: "CD quality" },
  { value: "48000 Hz", description: "video / studio" },
] as const;

const QWEN_LANGUAGES = [
  "Auto detect",
  "Chinese",
  "English",
  "French",
  "German",
  "Japanese",
  "Korean",
  "Russian",
  "Portuguese",
  "Thai",
  "Indonesian",
  "Vietnamese",
  "Italian",
  "Malay",
] as const;

const MINIMAX_EMOTIONS = [
  "Neutral",
  "Happy",
  "Sad",
  "Angry",
  "Fearful",
  "Surprised",
  "Disgusted",
] as const;

const MINIMAX_SAMPLE_RATES = [
  { value: "16000 Hz", description: "basic voice" },
  { value: "24000 Hz", description: "standard quality" },
  { value: "32000 Hz", description: "default" },
  { value: "44100 Hz", description: "CD quality" },
  { value: "48000 Hz", description: "video / studio" },
] as const;

const MINIMAX_LANGUAGES = [
  "Auto detect",
  "Afrikaans",
  "Arabic",
  "Bulgarian",
  "Catalan",
  "Chinese",
  "Czech",
  "Danish",
  "Dutch",
  "English",
  "Filipino",
  "Finnish",
  "French",
  "German",
  "Greek",
  "Hebrew",
  "Hindi",
  "Hungarian",
  "Indonesian",
  "Italian",
  "Japanese",
  "Korean",
  "Malay",
  "Polish",
  "Portuguese",
  "Romanian",
  "Russian",
  "Spanish",
  "Swedish",
  "Tamil",
  "Thai",
  "Turkish",
  "Ukrainian",
  "Vietnamese",
] as const;

type FloatingPanel =
  | "voice"
  | "model"
  | "stability"
  | "seed-speed"
  | "seed-pitch"
  | "seed-volume"
  | "qwen-speed"
  | "qwen-pitch"
  | "qwen-volume"
  | "qwen-format"
  | "qwen-rate"
  | "qwen-language"
  | "minimax-speed"
  | "minimax-pitch"
  | "minimax-volume"
  | "minimax-rate"
  | "minimax-language"
  | null;

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
  const [batchSize, setBatchSize] = useState(() => {
    if (audioModelIndex === 0 || audioModelIndex === 2) return 1;
    if (audioModelIndex === 3) return 3;
    return 4;
  });
  const [contentTab, setContentTab] = useState<"history" | "how-it-works">(
    "how-it-works",
  );
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saveSettings, setSaveSettings] = useState(false);
  const [voiceDetails, setVoiceDetails] = useState("");
  const [qwenVoiceDetails, setQwenVoiceDetails] = useState("");
  const [expressionIntensity, setExpressionIntensity] = useState(5);
  const [mood, setMood] = useState(0);
  const [seedSpeed, setSeedSpeed] = useState(1);
  const [seedPitch, setSeedPitch] = useState(0);
  const [seedVolume, setSeedVolume] = useState(100);
  const [seedValue, setSeedValue] = useState(0);
  const [qwenSpeed, setQwenSpeed] = useState(1);
  const [qwenPitch, setQwenPitch] = useState(1);
  const [qwenVolume, setQwenVolume] = useState(50);
  const [qwenFormat, setQwenFormat] = useState("mp3");
  const [qwenSampleRate, setQwenSampleRate] = useState("24000 Hz");
  const [qwenLanguage, setQwenLanguage] = useState("Auto detect");
  const [qwenSeed, setQwenSeed] = useState(0);
  const [qwenSaveSettings, setQwenSaveSettings] = useState(false);
  const [minimaxEmotion, setMinimaxEmotion] =
    useState<(typeof MINIMAX_EMOTIONS)[number]>("Neutral");
  const [minimaxSpeed, setMinimaxSpeed] = useState(1);
  const [minimaxPitch, setMinimaxPitch] = useState(0);
  const [minimaxVolume, setMinimaxVolume] = useState(100);
  const [minimaxSampleRate, setMinimaxSampleRate] = useState("32000 Hz");
  const [minimaxLanguage, setMinimaxLanguage] = useState("Auto detect");
  const [minimaxTextNormalization, setMinimaxTextNormalization] =
    useState(false);
  const [minimaxSaveSettings, setMinimaxSaveSettings] = useState(false);
  const [stability, setStability] =
    useState<(typeof STABILITY_OPTIONS)[number]["value"]>("Natural");
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
  const isSeedAudio = audioModelIndex === 0;
  const isElevenV3 = audioModelIndex === 1;
  const isQwenAudio = audioModelIndex === 2;
  const isMiniMax = audioModelIndex === 3;

  const audioSliderConfig =
    floatingPanel === "seed-speed"
      ? {
          label: "Speed",
          value: seedSpeed,
          min: 0.5,
          max: 2,
          step: 0.1,
          display: `${seedSpeed.toFixed(1)}x`,
          setValue: setSeedSpeed,
        }
      : floatingPanel === "seed-pitch"
        ? {
            label: "Pitch",
            value: seedPitch,
            min: -12,
            max: 12,
            step: 1,
            display: `${seedPitch}`,
            setValue: setSeedPitch,
          }
        : floatingPanel === "seed-volume"
          ? {
              label: "Volume",
              value: seedVolume,
              min: 0,
              max: 200,
              step: 1,
              display: `${seedVolume}%`,
              setValue: setSeedVolume,
            }
          : floatingPanel === "qwen-speed"
            ? {
                label: "Speed",
                value: qwenSpeed,
                min: 0.5,
                max: 2,
                step: 0.1,
                display: `${qwenSpeed.toFixed(1)}x`,
                setValue: setQwenSpeed,
              }
            : floatingPanel === "qwen-pitch"
              ? {
                  label: "Pitch",
                  value: qwenPitch,
                  min: 0.5,
                  max: 2,
                  step: 0.1,
                  display: `${qwenPitch.toFixed(1)}x`,
                  setValue: setQwenPitch,
                }
              : floatingPanel === "qwen-volume"
                ? {
                    label: "Volume",
                    value: qwenVolume,
                    min: 0,
                    max: 100,
                    step: 1,
                    display: `${qwenVolume}%`,
                    setValue: setQwenVolume,
                  }
                : floatingPanel === "minimax-speed"
                  ? {
                      label: "Speed",
                      value: minimaxSpeed,
                      min: 0.5,
                      max: 2,
                      step: 0.1,
                      display: `${minimaxSpeed.toFixed(1)}x`,
                      setValue: setMinimaxSpeed,
                    }
                  : floatingPanel === "minimax-pitch"
                    ? {
                        label: "Pitch",
                        value: minimaxPitch,
                        min: -12,
                        max: 12,
                        step: 1,
                        display: `${minimaxPitch}`,
                        setValue: setMinimaxPitch,
                      }
                    : floatingPanel === "minimax-volume"
                      ? {
                          label: "Volume",
                          value: minimaxVolume,
                          min: 0,
                          max: 200,
                          step: 1,
                          display: `${minimaxVolume}%`,
                          setValue: setMinimaxVolume,
                        }
                      : null;
  const audioOptionConfig =
    floatingPanel === "qwen-format"
      ? {
          label: "Output format",
          selected: qwenFormat,
          options: QWEN_FORMATS,
        }
      : floatingPanel === "qwen-rate"
        ? {
            label: "Sample Rate",
            selected: qwenSampleRate,
            options: QWEN_SAMPLE_RATES,
          }
        : floatingPanel === "qwen-language"
          ? {
              label: "Language",
              selected: qwenLanguage,
              options: QWEN_LANGUAGES.map((value) => ({
                value,
                description: "",
              })),
            }
          : floatingPanel === "minimax-rate"
            ? {
                label: "Sample Rate",
                selected: minimaxSampleRate,
                options: MINIMAX_SAMPLE_RATES,
              }
            : floatingPanel === "minimax-language"
              ? {
                  label: "Language boost",
                  selected: minimaxLanguage,
                  options: MINIMAX_LANGUAGES.map((value) => ({
                    value,
                    description: "",
                  })),
                }
              : null;

  const selectAudioOption = (value: string) => {
    if (floatingPanel === "qwen-format") setQwenFormat(value);
    if (floatingPanel === "qwen-rate") setQwenSampleRate(value);
    if (floatingPanel === "qwen-language") setQwenLanguage(value);
    if (floatingPanel === "minimax-rate") setMinimaxSampleRate(value);
    if (floatingPanel === "minimax-language") setMinimaxLanguage(value);
    setFloatingPanel(null);
  };

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
    const sidebarRect = trigger.closest("aside")?.getBoundingClientRect();
    const isSidebarControl =
      panel.startsWith("qwen-") ||
      panel.startsWith("seed-") ||
      panel.startsWith("minimax-");
    const anchorRight = isSidebarControl
      ? (sidebarRect?.right ?? rect.right)
      : rect.right;
    const anchorLeft = isSidebarControl
      ? (sidebarRect?.left ?? rect.left)
      : rect.left;
    const viewportPadding = 12;
    const availableRight = window.innerWidth - anchorRight - viewportPadding;
    const width = Math.min(
      preferredWidth,
      Math.max(280, window.innerWidth - viewportPadding * 2),
    );
    const left =
      availableRight >= width + 12
        ? anchorRight + 12
        : Math.max(viewportPadding, anchorLeft - width - 12);

    setFloatingPosition({
      left,
      top: Math.max(
        68,
        Math.min(
          rect.top,
          window.innerHeight - preferredHeight - viewportPadding,
        ),
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
                <span className="block whitespace-nowrap">
                  {TAB_LABELS[mode]}
                </span>
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
              {isSeedAudio ? "Optional" : "Required"}
            </span>
            {isSeedAudio ? (
              <span className="flex items-center justify-center">
                {[
                  { label: "Voice", Icon: AudioLines },
                  { label: "Audio", Icon: Music2 },
                  { label: "Image", Icon: ImageIcon },
                ].map(({ label, Icon }, index) => (
                  <span
                    key={label}
                    aria-label={label}
                    className={`flex size-10 items-center justify-center rounded-full border border-white/10 bg-gradient-to-b from-white/10 to-white/[0.03] shadow-[inset_0_1px_1px_rgba(255,255,255,0.14)] ${
                      index < 2 ? "-mr-2" : ""
                    }`}
                  >
                    <Icon className="size-4 text-zinc-300" />
                  </span>
                ))}
              </span>
            ) : (
              <span className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-gradient-to-b from-white/10 to-white/[0.03] shadow-[inset_0_1px_1px_rgba(255,255,255,0.14)]">
                <AudioLines className="size-4 text-zinc-300" />
              </span>
            )}
            <span>
              <span className="block text-base font-semibold text-white">
                {isSeedAudio
                  ? "Upload media"
                  : (selectedVoice ?? "Pick a voice")}
              </span>
              <span className="mt-1 block truncate text-sm font-medium text-zinc-400">
                {isSeedAudio
                  ? "Up to 3 Voices/Audios or Image"
                  : selectedVoice
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
                onMouseEnter={() => setInfoOpen(true)}
                onMouseLeave={() => setInfoOpen(false)}
                onFocus={() => setInfoOpen(true)}
                onBlur={() => setInfoOpen(false)}
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
              <span className="block text-xs font-medium text-zinc-400">
                Model
              </span>
              <span className="mt-1 block truncate text-sm font-semibold text-white">
                {isQwenAudio ? "Qwen Audio 3.0 TTS" : model.title}
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

          {(isSeedAudio || isQwenAudio) && (
            <section className="relative flex shrink-0 flex-col gap-1 rounded-xl border border-white/[0.07] bg-[#202224] p-3 focus-within:border-white/15">
              <span className="pointer-events-none absolute right-1.5 top-1.5 rounded-xl bg-white/[0.05] px-2 py-1 text-[10px] font-medium text-zinc-400">
                Optional
              </span>
              <label
                htmlFor="audio-form-sidebar-voice-details"
                className="text-sm font-medium text-zinc-400"
              >
                Voice details
              </label>
              <textarea
                id="audio-form-sidebar-voice-details"
                value={isQwenAudio ? qwenVoiceDetails : voiceDetails}
                onChange={(event) =>
                  isQwenAudio
                    ? setQwenVoiceDetails(event.target.value)
                    : setVoiceDetails(event.target.value)
                }
                maxLength={isQwenAudio ? 128 : 500}
                placeholder="e.g. Young female voice with british accent, soft and loud. Excited, giggling"
                className="h-[52px] resize-none overflow-y-auto bg-transparent pr-1 text-xs leading-[18px] text-white outline-none placeholder:text-zinc-400"
              />
              <span className="mt-0.5 self-end text-[10px] font-medium tabular-nums text-white/40">
                {isQwenAudio ? qwenVoiceDetails.length : voiceDetails.length}/
                {isQwenAudio ? 128 : 500}
              </span>
            </section>
          )}

          {(isSeedAudio || isElevenV3 || isQwenAudio || isMiniMax) && (
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

              {advancedOpen && isSeedAudio && (
                <div className="flex animate-in flex-col gap-2 pb-1 pt-2 duration-200 fade-in-0 slide-in-from-top-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs text-zinc-400">
                      Seed Audio 1.0 controls
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setExpressionIntensity(5);
                        setMood(0);
                        setSeedSpeed(1);
                        setSeedPitch(0);
                        setSeedVolume(100);
                        setSeedValue(0);
                        setSaveSettings(false);
                        setFloatingPanel(null);
                      }}
                      className="flex items-center gap-1 text-xs font-semibold text-white hover:text-[#df7b59]"
                    >
                      <RotateCcw className="size-3" />
                      Reset
                    </button>
                  </div>

                  <label className="relative flex h-12 cursor-pointer items-center justify-between overflow-hidden rounded-xl border border-white/[0.07] bg-[#202224] px-3 hover:border-white/15">
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 left-0 bg-white/[0.05]"
                      style={{ width: `${expressionIntensity * 10}%` }}
                    />
                    {Array.from({ length: 9 }, (_, index) => (
                      <span
                        key={index}
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 h-3 w-px -translate-y-1/2 bg-white/15"
                        style={{ left: `${(index + 1) * 10}%` }}
                      />
                    ))}
                    <span className="relative z-10 text-sm font-semibold text-white">
                      Expression intensity
                    </span>
                    <span className="relative z-10 text-sm font-semibold tabular-nums text-white">
                      {expressionIntensity}
                    </span>
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1/2 z-10 h-6 w-1 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-white/80"
                      style={{ left: `${expressionIntensity * 10}%` }}
                    />
                    <input
                      type="range"
                      min={0}
                      max={10}
                      step={1}
                      value={expressionIntensity}
                      onChange={(event) =>
                        setExpressionIntensity(Number(event.target.value))
                      }
                      aria-label="Expression intensity"
                      className="absolute inset-0 z-20 size-full cursor-pointer opacity-0"
                    />
                  </label>

                  <div className="flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-[#202224] p-3 hover:border-white/15">
                    <div className="flex items-center gap-1 px-0.5">
                      <span className="text-xs font-medium text-zinc-400">
                        Mood
                      </span>
                      <span
                        title="Move toward Angry, Neutral, or Happy"
                        className="flex size-4 items-center justify-center text-zinc-400"
                      >
                        <Info className="size-3.5" />
                      </span>
                    </div>
                    <label className="relative block h-7 cursor-pointer rounded-lg bg-[#191b1d] p-0.5">
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden rounded-lg"
                        style={{
                          width: `${(mood + 1) * 50}%`,
                          background:
                            mood > 0
                              ? "linear-gradient(90deg, #ff2d00 0%, #ff9800 50%, #d1fe17 100%)"
                              : "linear-gradient(90deg, #ff0000 0%, #ff5500 45%, #ff9800 100%)",
                        }}
                      />
                      <span className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center justify-between px-[7px]">
                        {Array.from({ length: 4 }, (_, index) => (
                          <span
                            key={index}
                            className="size-[3px] rounded-[1px] bg-white/15"
                          />
                        ))}
                      </span>
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 h-[30px] w-[21px] -translate-x-1/2 -translate-y-1/2 rounded border border-black/15 bg-white shadow"
                        style={{
                          left: `calc(${(mood + 1) * 50}% - ${mood === 1 ? 10 : mood === -1 ? -10 : 0}px)`,
                        }}
                      />
                      <input
                        type="range"
                        min={-1}
                        max={1}
                        step={0.01}
                        value={mood}
                        onChange={(event) =>
                          setMood(Number(event.target.value))
                        }
                        aria-label="Mood"
                        className="absolute inset-0 z-20 size-full cursor-pointer opacity-0"
                      />
                    </label>
                    <div className="flex items-center justify-between px-1 text-[10px] font-medium text-zinc-400">
                      <span>Angry</span>
                      <span>Neutral</span>
                      <span>Happy</span>
                    </div>
                  </div>

                  <span className="px-1 text-xs text-zinc-400">
                    Audio settings
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      {
                        label: "Speed",
                        value: `${seedSpeed.toFixed(1)}x`,
                        panel: "seed-speed" as const,
                      },
                      {
                        label: "Pitch",
                        value: `${seedPitch}`,
                        panel: "seed-pitch" as const,
                      },
                      {
                        label: "Volume",
                        value: `${seedVolume}%`,
                        panel: "seed-volume" as const,
                      },
                    ].map((control) => (
                      <button
                        key={control.label}
                        type="button"
                        aria-expanded={floatingPanel === control.panel}
                        onClick={(event) =>
                          openFloatingPanel(
                            control.panel,
                            event.currentTarget,
                            244,
                            112,
                          )
                        }
                        className="flex min-w-0 items-center gap-1 rounded-xl border border-white/[0.07] bg-[#202224] px-3 py-2 text-left transition-colors hover:border-white/15"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs text-zinc-400">
                            {control.label}
                          </span>
                          <span className="block truncate text-sm font-medium tabular-nums text-white">
                            {control.value}
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-zinc-400" />
                      </button>
                    ))}
                  </div>
                  {[
                    ["Output format", "MP3"],
                    ["Sample Rate", "24 kHz"],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex h-12 items-center justify-between rounded-xl border border-white/[0.07] bg-[#202224] px-3 text-sm font-medium text-white"
                    >
                      <span>{label}</span>
                      <span className="flex items-center gap-2">
                        {label === "Output format" && (
                          <FileAudio className="size-4" />
                        )}
                        {value}
                        <ChevronRight className="size-4 text-zinc-400" />
                      </span>
                    </div>
                  ))}
                  <label className="flex h-12 items-center justify-between rounded-xl border border-white/[0.07] bg-[#202224] px-3">
                    <span className="flex items-center gap-1 text-sm font-medium text-white">
                      Seed
                      <span
                        title="Use the same seed to reproduce a result"
                        className="flex size-4 items-center justify-center text-zinc-400"
                      >
                        <Info className="size-3.5" />
                      </span>
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={seedValue}
                      onChange={(event) =>
                        setSeedValue(Number(event.target.value))
                      }
                      aria-label="Seed"
                      className="w-20 bg-transparent text-right text-sm font-medium tabular-nums text-white outline-none"
                    />
                  </label>
                  <div className="flex h-12 items-center justify-between rounded-xl border border-white/[0.07] bg-[#202224] px-3">
                    <span className="text-sm font-semibold text-white">
                      Save settings
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={saveSettings}
                      aria-label="Save settings"
                      onClick={() => setSaveSettings((value) => !value)}
                      className={`relative h-6 w-11 rounded-full transition-colors ${
                        saveSettings ? "bg-[#df7b59]" : "bg-zinc-600"
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

              {advancedOpen && isQwenAudio && (
                <div className="flex animate-in flex-col gap-2 pb-1 pt-2 duration-200 fade-in-0 slide-in-from-top-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs text-zinc-400">
                      Qwen Audio 3.0 TTS controls
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setQwenSpeed(1);
                        setQwenPitch(1);
                        setQwenVolume(50);
                        setQwenFormat("mp3");
                        setQwenSampleRate("24000 Hz");
                        setQwenLanguage("Auto detect");
                        setQwenSeed(0);
                        setQwenSaveSettings(false);
                        setFloatingPanel(null);
                      }}
                      className="flex items-center gap-1 text-xs font-semibold text-white hover:text-[#df7b59]"
                    >
                      <RotateCcw className="size-3" />
                      Reset
                    </button>
                  </div>
                  <span className="px-1 text-xs text-zinc-400">
                    Audio settings
                  </span>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      {
                        label: "Speed",
                        value: `${qwenSpeed.toFixed(1)}x`,
                        panel: "qwen-speed" as const,
                      },
                      {
                        label: "Pitch",
                        value: `${qwenPitch.toFixed(1)}x`,
                        panel: "qwen-pitch" as const,
                      },
                      {
                        label: "Volume",
                        value: `${qwenVolume}%`,
                        panel: "qwen-volume" as const,
                      },
                    ].map((control) => (
                      <button
                        key={control.label}
                        type="button"
                        aria-expanded={floatingPanel === control.panel}
                        onClick={(event) =>
                          openFloatingPanel(
                            control.panel,
                            event.currentTarget,
                            244,
                            112,
                          )
                        }
                        className="flex min-w-0 items-center gap-1 rounded-xl border border-white/[0.07] bg-[#202224] px-3 py-2 text-left transition-colors hover:border-white/15"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs text-zinc-400">
                            {control.label}
                          </span>
                          <span className="block truncate text-sm font-medium tabular-nums text-white">
                            {control.value}
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-zinc-400" />
                      </button>
                    ))}
                  </div>

                  {[
                    {
                      label: "Output format",
                      value: qwenFormat.toUpperCase(),
                      panel: "qwen-format" as const,
                      icon: true,
                    },
                    {
                      label: "Sample Rate",
                      value: qwenSampleRate.replace("000 Hz", " kHz"),
                      panel: "qwen-rate" as const,
                      icon: false,
                    },
                    {
                      label: "Language",
                      value: qwenLanguage,
                      panel: "qwen-language" as const,
                      icon: false,
                    },
                  ].map((control) => (
                    <button
                      key={control.label}
                      type="button"
                      aria-expanded={floatingPanel === control.panel}
                      onClick={(event) =>
                        openFloatingPanel(
                          control.panel,
                          event.currentTarget,
                          224,
                          control.panel === "qwen-language" ? 340 : 250,
                        )
                      }
                      className="flex h-12 items-center justify-between rounded-xl border border-white/[0.07] bg-[#202224] px-3 text-sm font-medium text-white transition-colors hover:border-white/15"
                    >
                      <span>{control.label}</span>
                      <span className="flex items-center gap-2">
                        {control.icon && <FileAudio className="size-4" />}
                        {control.value}
                        <ChevronRight className="size-4 text-zinc-400" />
                      </span>
                    </button>
                  ))}

                  <label className="flex h-12 items-center justify-between rounded-xl border border-white/[0.07] bg-[#202224] px-3">
                    <span className="flex items-center gap-1 text-sm font-medium text-white">
                      Seed
                      <span
                        title="Use the same seed to reproduce a result"
                        className="flex size-4 items-center justify-center text-zinc-400"
                      >
                        <Info className="size-3.5" />
                      </span>
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={qwenSeed}
                      onChange={(event) =>
                        setQwenSeed(Number(event.target.value))
                      }
                      aria-label="Seed"
                      className="w-20 bg-transparent text-right text-sm font-medium tabular-nums text-white outline-none"
                    />
                  </label>

                  <div className="flex h-12 items-center justify-between rounded-xl border border-white/[0.07] bg-[#202224] px-3">
                    <span className="text-sm font-semibold text-white">
                      Save settings
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={qwenSaveSettings}
                      aria-label="Save settings"
                      onClick={() => setQwenSaveSettings((value) => !value)}
                      className={`relative h-6 w-11 rounded-full transition-colors ${
                        qwenSaveSettings ? "bg-[#df7b59]" : "bg-zinc-600"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                          qwenSaveSettings ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              )}

              {advancedOpen && isMiniMax && (
                <div className="flex animate-in flex-col gap-2 pb-1 pt-2 duration-200 fade-in-0 slide-in-from-top-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs text-zinc-400">
                      MiniMax Speech 2.8 HD controls
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setMinimaxEmotion("Neutral");
                        setMinimaxSpeed(1);
                        setMinimaxPitch(0);
                        setMinimaxVolume(100);
                        setMinimaxSampleRate("32000 Hz");
                        setMinimaxLanguage("Auto detect");
                        setMinimaxTextNormalization(false);
                        setMinimaxSaveSettings(false);
                        setFloatingPanel(null);
                      }}
                      className="flex items-center gap-1 text-xs font-semibold text-white hover:text-[#df7b59]"
                    >
                      <RotateCcw className="size-3" />
                      Reset
                    </button>
                  </div>

                  <span className="px-1 text-xs text-zinc-400">Emotion</span>
                  <div className="flex flex-wrap gap-1">
                    {MINIMAX_EMOTIONS.map((emotion) => {
                      const selected = minimaxEmotion === emotion;
                      return (
                        <button
                          key={emotion}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setMinimaxEmotion(emotion)}
                          className={`flex h-8 items-center justify-center rounded-lg px-3 text-xs font-medium transition-colors ${
                            selected
                              ? "bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]"
                              : "bg-white/[0.05] text-zinc-400 hover:text-white"
                          }`}
                        >
                          {emotion}
                        </button>
                      );
                    })}
                  </div>

                  <span className="px-1 text-xs text-zinc-400">
                    Audio settings
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      {
                        label: "Speed",
                        value: `${minimaxSpeed.toFixed(1)}x`,
                        panel: "minimax-speed" as const,
                      },
                      {
                        label: "Pitch",
                        value: `${minimaxPitch}`,
                        panel: "minimax-pitch" as const,
                      },
                      {
                        label: "Volume",
                        value: `${minimaxVolume}%`,
                        panel: "minimax-volume" as const,
                      },
                    ].map((control) => (
                      <button
                        key={control.label}
                        type="button"
                        aria-expanded={floatingPanel === control.panel}
                        onClick={(event) =>
                          openFloatingPanel(
                            control.panel,
                            event.currentTarget,
                            244,
                            112,
                          )
                        }
                        className="flex min-w-0 items-center gap-1 rounded-xl border border-white/[0.07] bg-[#202224] px-3 py-2 text-left transition-colors hover:border-white/15"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs text-zinc-400">
                            {control.label}
                          </span>
                          <span className="block truncate text-sm font-medium tabular-nums text-white">
                            {control.value}
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-zinc-400" />
                      </button>
                    ))}
                  </div>

                  {[
                    {
                      label: "Sample Rate",
                      value: minimaxSampleRate.replace("000 Hz", " kHz"),
                      panel: "minimax-rate" as const,
                    },
                    {
                      label: "Language boost",
                      value: minimaxLanguage,
                      panel: "minimax-language" as const,
                    },
                  ].map((control) => (
                    <button
                      key={control.label}
                      type="button"
                      aria-expanded={floatingPanel === control.panel}
                      onClick={(event) =>
                        openFloatingPanel(
                          control.panel,
                          event.currentTarget,
                          224,
                          control.panel === "minimax-language" ? 340 : 250,
                        )
                      }
                      className="flex h-12 items-center justify-between rounded-xl border border-white/[0.07] bg-[#202224] px-3 text-sm font-medium text-white transition-colors hover:border-white/15"
                    >
                      <span>{control.label}</span>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{control.value}</span>
                        <ChevronRight className="size-4 shrink-0 text-zinc-400" />
                      </span>
                    </button>
                  ))}

                  <div className="flex h-12 items-center justify-between rounded-xl border border-white/[0.07] bg-[#202224] px-3">
                    <span className="flex items-center gap-1 text-sm font-semibold text-white">
                      Text normalization
                      <span
                        title="Normalize written text before speech generation"
                        className="flex size-[18px] items-center justify-center text-zinc-400"
                      >
                        <Info className="size-3.5" />
                      </span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={minimaxTextNormalization}
                      aria-label="Text normalization"
                      onClick={() =>
                        setMinimaxTextNormalization((value) => !value)
                      }
                      className={`relative h-6 w-11 rounded-full transition-colors ${
                        minimaxTextNormalization
                          ? "bg-[#df7b59]"
                          : "bg-zinc-600"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform duration-300 ${
                          minimaxTextNormalization
                            ? "translate-x-5"
                            : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex h-12 items-center justify-between rounded-xl border border-white/[0.07] bg-[#202224] px-3">
                    <span className="text-sm font-semibold text-white">
                      Save settings
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={minimaxSaveSettings}
                      aria-label="Save settings"
                      onClick={() => setMinimaxSaveSettings((value) => !value)}
                      className={`relative h-6 w-11 rounded-full transition-colors ${
                        minimaxSaveSettings ? "bg-[#df7b59]" : "bg-zinc-600"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform duration-300 ${
                          minimaxSaveSettings
                            ? "translate-x-5"
                            : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              )}

              {advancedOpen && isElevenV3 && (
                <div className="flex animate-in flex-col gap-2 pb-1 pt-2 duration-200 fade-in-0 slide-in-from-top-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs text-zinc-400">
                      Eleven v3 controls
                    </span>
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
                  <span className="px-1 text-xs text-zinc-400">
                    Audio settings
                  </span>
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
                    <span className="text-sm font-semibold text-white">
                      Save settings
                    </span>
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
            className="mt-auto h-14 w-full shrink-0 rounded-xl bg-[#df7b59] text-base font-bold text-black shadow-[inset_0_-4px_rgba(111,49,32,0.55)] transition hover:brightness-110 active:translate-y-px"
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
              <span className="text-sm font-semibold text-zinc-400">
                Voices
              </span>
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
                      <span
                        className={`size-10 shrink-0 rounded-full bg-gradient-to-br ${voice.color}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-white">
                          {voice.name}
                        </span>
                        <span className="block text-xs text-zinc-400">
                          {voice.gender}
                        </span>
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
                            style={{
                              height: `${22 + ((voiceIndex * 13 + index * 19) % 72)}%`,
                            }}
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
          className="fixed z-[80] max-h-[520px] animate-in overflow-y-auto rounded-2xl border border-white/10 bg-[#1c1e20]/95 p-2 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-2xl duration-200 fade-in-0 slide-in-from-left-2 zoom-in-95"
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
              if (item.title === "VibeVoice") return null;

              const active = index === audioModelIndex;
              return (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => {
                    onAudioModelIndexChange(index);
                    setAdvancedOpen(false);
                    if (index === 0 || index === 2) setBatchSize(1);
                    if (index === 3) setBatchSize(3);
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
                  {active && (
                    <Check className="size-4 shrink-0 text-[#dfff00]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {audioSliderConfig && (
        <div
          ref={floatingPanelRef}
          role="dialog"
          aria-label={`${audioSliderConfig.label} settings`}
          className="fixed z-[90] w-[244px] animate-in rounded-xl border border-white/10 bg-[#1c1e20]/95 px-2 pb-2 pt-1 shadow-[0_18px_50px_rgba(0,0,0,0.65)] backdrop-blur-2xl duration-200 fade-in-0 slide-in-from-left-2 zoom-in-95"
          style={floatingPosition}
        >
          <div className="flex items-center gap-2 px-1 py-1.5">
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">
              {audioSliderConfig.label}
            </span>
            <span className="shrink-0 text-xs font-medium tabular-nums text-white">
              {audioSliderConfig.display}
            </span>
          </div>
          <label className="relative flex h-9 cursor-pointer items-center overflow-hidden rounded-lg bg-[#292e33]">
            <span className="pointer-events-none absolute inset-0 flex justify-around">
              {Array.from({ length: 3 }, (_, index) => (
                <span
                  key={index}
                  className="flex flex-1 items-center justify-center"
                >
                  <span className="h-2 w-px rounded bg-white/15" />
                </span>
              ))}
            </span>
            <span
              className="pointer-events-none absolute inset-y-0 left-0 rounded-l-lg border-r border-white bg-white/[0.06] transition-[width] duration-150"
              style={{
                width: `${
                  ((audioSliderConfig.value - audioSliderConfig.min) /
                    (audioSliderConfig.max - audioSliderConfig.min)) *
                  100
                }%`,
              }}
            />
            <input
              type="range"
              aria-label={audioSliderConfig.label}
              min={audioSliderConfig.min}
              max={audioSliderConfig.max}
              step={audioSliderConfig.step}
              value={audioSliderConfig.value}
              onChange={(event) =>
                audioSliderConfig.setValue(Number(event.target.value))
              }
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </label>
        </div>
      )}

      {audioOptionConfig && (
        <div
          ref={floatingPanelRef}
          role="dialog"
          aria-label={audioOptionConfig.label}
          className="fixed z-[90] max-h-80 animate-in overflow-y-auto rounded-xl border border-white/10 bg-[#1c1e20]/95 p-2 shadow-[0_18px_50px_rgba(0,0,0,0.65)] backdrop-blur-2xl duration-200 fade-in-0 slide-in-from-left-2 zoom-in-95"
          style={floatingPosition}
        >
          <div className="flex h-8 items-center px-2 text-xs font-semibold text-zinc-500">
            {audioOptionConfig.label}
          </div>
          {audioOptionConfig.options.map((option) => {
            const active = option.value === audioOptionConfig.selected;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => selectAudioOption(option.value)}
                className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg p-2 text-left transition-colors ${
                  active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">
                    {option.value}
                  </span>
                  {option.description && (
                    <span className="block truncate text-xs text-zinc-400">
                      {option.description}
                    </span>
                  )}
                </span>
                {active && <Check className="size-4 shrink-0 text-white" />}
              </button>
            );
          })}
        </div>
      )}

      {floatingPanel === "stability" && (
        <div
          ref={floatingPanelRef}
          role="dialog"
          aria-label="Stability"
          className="fixed z-[90] animate-in rounded-xl border border-white/10 bg-[#1c1e20]/95 p-2 shadow-[0_18px_50px_rgba(0,0,0,0.65)] backdrop-blur-2xl duration-200 fade-in-0 slide-in-from-left-2 zoom-in-95"
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
