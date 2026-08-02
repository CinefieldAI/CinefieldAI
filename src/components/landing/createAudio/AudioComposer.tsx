"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Check,
  ChevronDown,
  Image as ImageRefIcon,
  Loader2,
  Music2,
  Plus,
  Sparkles,
  Video,
} from "lucide-react";
import { AUDIO_MODELS } from "@/components/landing/audioMenuData";
import {
  VOICEOVER_MODEL_ORDER,
  VOICEOVER_CAPABILITIES,
  QWEN_LANGUAGES,
  type SeedAudioSettings,
  type QwenSettings,
} from "./voiceoverModelConfig";
import RotarySelector from "./RotarySelector";
import { usePromptSurfaceResize } from "@/hooks/usePromptSurfaceResize";
import PromptResizeHandles from "@/components/shared/PromptResizeHandles";
import {
  PROMPT_BAR_OUTER_SHELL,
  PROMPT_BAR_SURFACE_TRANSLUCENT,
  PROMPT_BAR_PANEL_SURFACE,
} from "@/lib/promptBarChassis";

/** Neon turquoise brand accent (per 1:1 spec) — kept only on the Voice Preset card. */
const NEON = "#00F0FF";

const MIN_PROMPT_HEIGHT = 120;
const DEFAULT_PROMPT_HEIGHT = 120;
const MAX_PROMPT_HEIGHT = 420;
const PROMPT_VIEWPORT_SAFE_OFFSET = 160;
const PROMPT_RESIZE_STEP = 16;
const PROMPT_SINGLE_LINE_SCROLL_HEIGHT = 40;
const DEFAULT_COMPOSER_WIDTH = 1040;
const MAX_COMPOSER_WIDTH = 1180;
const COMPOSER_VIEWPORT_GUTTER = 32;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getViewportSafePromptHeight = () =>
  typeof window === "undefined"
    ? MAX_PROMPT_HEIGHT
    : Math.max(
        MIN_PROMPT_HEIGHT,
        Math.min(MAX_PROMPT_HEIGHT, window.innerHeight - PROMPT_VIEWPORT_SAFE_OFFSET),
      );

const getViewportSafeComposerWidth = () =>
  typeof window === "undefined"
    ? MAX_COMPOSER_WIDTH
    : (() => {
        const defaultViewportWidth = Math.min(
          DEFAULT_COMPOSER_WIDTH,
          window.innerWidth - COMPOSER_VIEWPORT_GUTTER,
        );
        const anchoredLeft = (window.innerWidth - defaultViewportWidth) / 2;
        return Math.min(
          MAX_COMPOSER_WIDTH,
          Math.max(
            320,
            window.innerWidth - anchoredLeft - COMPOSER_VIEWPORT_GUTTER / 2,
          ),
        );
      })();

/** Shared dark translucent popover surface used by every Voiceover popover. */
const POPOVER_SURFACE = {
  background: "rgba(28,30,32,0.95)",
  backdropFilter: "blur(32px)",
  WebkitBackdropFilter: "blur(32px)",
  boxShadow: "0 16px 50px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.04)",
};

interface AudioComposerProps {
  feature: number;
  onFeatureChange: (index: number) => void;
  script: string;
  onScriptChange: (value: string) => void;
  isGenerating: boolean;
  onGenerate: () => void;
  /** Opens the "Select or add a voice" modal. */
  onChooseVoice: () => void;
  /** Currently selected voice name (shown on the Choose Voice card). */
  selectedVoiceLabel?: string;
  /** Active model index for the in-prompt model pill (shared with the top-nav Audio dropdown). */
  selectedModel: number;
  onSelectModel: (index: number) => void;
  /** Translate-mode target language + its picker. */
  language: string;
  onOpenLanguage: () => void;
  /** Change Voice / Translate-mode reference video file name. */
  referenceVideo: string | null;
  onReferenceVideo: (name: string | null) => void;
  /** Translate mode's own generic Sample Rate/Speed/Volume/Pitch/Output row. */
  translateSampleRate: number;
  onTranslateSampleRateChange: (value: number) => void;
  translateSpeed: number;
  onTranslateSpeedChange: (value: number) => void;
  translateVolume: number;
  onTranslateVolumeChange: (value: number) => void;
  translatePitch: number;
  onTranslatePitchChange: (value: number) => void;
  translateOutputFormat: string;
  onTranslateOutputFormatChange: (value: string) => void;
  /** Voiceover mode: Seed Audio 1.0's own settings. */
  seedAudioSettings: SeedAudioSettings;
  onSeedAudioSettingsChange: (value: SeedAudioSettings) => void;
  /** Voiceover mode: Qwen Audio 3.0's own settings. */
  qwenSettings: QwenSettings;
  onQwenSettingsChange: (value: QwenSettings) => void;
}

/** Retro vertical wave bars for the Choose Voice capsule (illuminate turquoise). */
const PRESET_BARS = Array.from({ length: 22 }, (_, i) =>
  24 + Math.round(Math.abs(Math.sin(i * 0.8)) * 70),
);

/** Compact slider popover — reused for every model's Speed/Volume/Pitch control. */
function SliderPopover({
  open,
  onOpenChange,
  label,
  icon,
  value,
  onChange,
  min,
  max,
  step,
  format,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  label: string;
  icon: React.ReactNode;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={label}
          className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-white/[0.05] px-2 text-xs font-medium text-white transition-colors hover:bg-white/[0.09]"
        >
          {format(value)}
          <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
        </button>
      </Popover.Trigger>
      <Popover.Content
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="z-[100000] w-[220px] overflow-hidden rounded-xl border border-white/10 p-2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        style={POPOVER_SURFACE}
      >
        <div className="mb-2 flex items-center gap-2 px-2">
          {icon}
          <span className="text-xs font-semibold text-white">{label}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="ml-auto text-zinc-500">
            <path
              d="M10.75 11H12L12 16.25M21.25 12C21.25 17.1086 17.1086 21.25 12 21.25C6.89137 21.25 2.75 17.1086 2.75 12C2.75 6.89137 6.89137 2.75 12 2.75C17.1086 2.75 21.25 6.89137 21.25 12Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M12 7.375C11.6548 7.375 11.375 7.65482 11.375 8C11.375 8.34518 11.6548 8.625 12 8.625C12.3452 8.625 12.625 8.34518 12.625 8C12.625 7.65482 12.3452 7.375 12 7.375Z"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="0.25"
            />
          </svg>
        </div>
        <div className="flex items-center gap-2 px-2">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label={label}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            className="h-6 flex-1 cursor-pointer appearance-none rounded-md"
            style={{
              background: `linear-gradient(to right, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.2) ${pct}%, rgba(255,255,255,0.05) ${pct}%, rgba(255,255,255,0.05) 100%)`,
              border: "1px solid #424242",
            }}
          />
          <span className="min-w-[36px] text-xs font-semibold text-white">{format(value)}</span>
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}

interface SelectOption {
  value: string;
  title: string;
  subtitle?: string;
}

/** Compact dark option-list popover — reused for Sample Rate, Output format, and Qwen's Language. */
function SelectPopover({
  open,
  onOpenChange,
  triggerLabel,
  header,
  options,
  selected,
  onSelect,
  width = 160,
  maxHeight,
  seedValue,
  onSeedChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  triggerLabel: string;
  header: string;
  options: SelectOption[];
  selected: string;
  onSelect: (value: string) => void;
  width?: number;
  maxHeight?: number;
  /** Sample Rate's bottom Seed field — omit for every other SelectPopover instance. */
  seedValue?: number;
  onSeedChange?: (value: number) => void;
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-white/[0.05] px-2 text-xs font-medium text-white transition-colors hover:bg-white/[0.09]"
        >
          {triggerLabel}
          <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
        </button>
      </Popover.Trigger>
      <Popover.Content
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        role="listbox"
        aria-label={header}
        className="z-[100000] overflow-y-auto rounded-xl border border-white/10 p-1.5 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        style={{ ...POPOVER_SURFACE, width, maxHeight }}
      >
        <div className="mb-1 px-2 py-1 text-xs font-semibold text-zinc-400">{header}</div>
        {options.map((opt) => {
          const active = opt.value === selected;
          return (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => {
                onSelect(opt.value);
                onOpenChange(false);
              }}
              className="flex min-h-[36px] w-full items-center justify-between gap-2 rounded-lg p-2 text-left transition-colors"
              style={{ background: active ? "rgba(255,255,255,0.08)" : "transparent" }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.05)";
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = "transparent";
              }}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white">{opt.title}</span>
                {opt.subtitle && (
                  <span className="block truncate text-xs text-zinc-500">{opt.subtitle}</span>
                )}
              </span>
              {active && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0 text-[#D1FE17]">
                  <path
                    d="M5 13.875 9.2 18 19 7"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                  />
                </svg>
              )}
            </button>
          );
        })}
        {onSeedChange && (
          <div className="mt-1 border-t border-white/[0.06] px-2 pt-2">
            <label className="mb-1 block text-xs font-semibold text-zinc-400">Seed</label>
            <input
              type="number"
              min={0}
              max={65535}
              step={1}
              value={seedValue ?? 0}
              onChange={(e) => {
                const v = Math.min(65535, Math.max(0, Number(e.target.value) || 0));
                onSeedChange(v);
              }}
              aria-label="Seed"
              className="h-8 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 text-xs text-white focus:border-white/30 focus:outline-none"
            />
          </div>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}

const SAMPLE_RATE_OPTIONS: SelectOption[] = [
  { value: "8000", title: "8000 Hz", subtitle: "low / phone quality" },
  { value: "16000", title: "16000 Hz", subtitle: "basic / voice calls" },
  { value: "22050", title: "22050 Hz", subtitle: "legacy audio" },
  { value: "24000", title: "24000 Hz", subtitle: "default — fine for voice" },
  { value: "44100", title: "44100 Hz", subtitle: "CD quality" },
  { value: "48000", title: "48000 Hz", subtitle: "video / studio" },
];

const OUTPUT_FORMAT_OPTIONS: SelectOption[] = [
  { value: "mp3", title: "mp3", subtitle: "small" },
  { value: "wav", title: "wav", subtitle: "lossless, default" },
  { value: "opus", title: "opus", subtitle: "web" },
];

const QWEN_LANGUAGE_OPTIONS: SelectOption[] = QWEN_LANGUAGES.map((l) => ({ value: l, title: l }));

const SPEED_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-white">
    <path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M6.252 19.248a9.25 9.25 0 1 1 11.496 0" />
    <path fill="currentColor" d="M10.468 14.285a2 2 0 1 1 3.064-2.572c1.141 1.36 1.834 3.755 2.14 5.029a.449.449 0 0 1-.624.523c-1.201-.523-3.439-1.62-4.58-2.98" />
  </svg>
);
const VOLUME_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-white">
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      d="M19.248 4.752A10.22 10.22 0 0 1 22.25 12c0 2.83-1.147 5.393-3.002 7.248M15.889 8.11a5.48 5.48 0 0 1 1.611 3.89 5.48 5.48 0 0 1-1.61 3.889M2.75 7.75h2.957a1 1 0 0 0 .54-.158L12.25 3.75v16.5l-6.004-3.842a1 1 0 0 0-.539-.158H2.75a1 1 0 0 1-1-1v-6.5a1 1 0 0 1 1-1"
    />
  </svg>
);
const PITCH_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-white">
    <path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M7.75 5.75v12.5m-4-7.5v2.5M12 9.75v4.5m4.25-6.5v8.5m4-5.5v2.5" />
  </svg>
);

/**
 * Bottom floating composer bar for the Audio workspace — mirrors the real
 * Higgsfield layout: rotary mode selector → prompt (with model pill) → Choose
 * Voice capsule → Generate.
 *
 * Voiceover renders a fully model-capability-driven control row (six models,
 * each with its own settings/ranges — see voiceoverModelConfig.ts). Change
 * Voice and Translate keep their own previously-established layouts.
 */
export default function AudioComposer({
  feature,
  onFeatureChange,
  script,
  onScriptChange,
  isGenerating,
  onGenerate,
  onChooseVoice,
  selectedVoiceLabel,
  selectedModel,
  onSelectModel,
  language,
  onOpenLanguage,
  referenceVideo,
  onReferenceVideo,
  translateSampleRate,
  onTranslateSampleRateChange,
  translateSpeed,
  onTranslateSpeedChange,
  translateVolume,
  onTranslateVolumeChange,
  translatePitch,
  onTranslatePitchChange,
  translateOutputFormat,
  onTranslateOutputFormatChange,
  seedAudioSettings,
  onSeedAudioSettingsChange,
  qwenSettings,
  onQwenSettingsChange,
}: AudioComposerProps) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [addReferenceOpen, setAddReferenceOpen] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [sampleRateMenuOpen, setSampleRateMenuOpen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [volumeMenuOpen, setVolumeMenuOpen] = useState(false);
  const [pitchMenuOpen, setPitchMenuOpen] = useState(false);
  const [outputFormatMenuOpen, setOutputFormatMenuOpen] = useState(false);
  const [promptHeight, setPromptHeight] = useState(DEFAULT_PROMPT_HEIGHT);
  const [maxPromptHeight, setMaxPromptHeight] = useState(MAX_PROMPT_HEIGHT);
  const [hasManualHeight, setHasManualHeight] = useState(false);
  const [composerWidth, setComposerWidth] = useState(DEFAULT_COMPOSER_WIDTH);
  const [maxComposerWidth, setMaxComposerWidth] = useState(MAX_COMPOSER_WIDTH);

  // Translate mode's own menu-open state (kept separate from Voiceover's above).
  const [translateSampleRateMenuOpen, setTranslateSampleRateMenuOpen] = useState(false);
  const [translateSpeedMenuOpen, setTranslateSpeedMenuOpen] = useState(false);
  const [translateVolumeMenuOpen, setTranslateVolumeMenuOpen] = useState(false);
  const [translatePitchMenuOpen, setTranslatePitchMenuOpen] = useState(false);
  const [translateOutputFormatMenuOpen, setTranslateOutputFormatMenuOpen] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const audioRefInputRef = useRef<HTMLInputElement>(null);
  const imageRefInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const contentRequiredHeightRef = useRef(MIN_PROMPT_HEIGHT);
  const manualPromptHeightRef = useRef(DEFAULT_PROMPT_HEIGHT);

  useEffect(() => {
    const updateMaximum = () => {
      const nextMaximum = getViewportSafePromptHeight();
      setMaxPromptHeight(nextMaximum);
      manualPromptHeightRef.current = Math.min(
        manualPromptHeightRef.current,
        nextMaximum,
      );
      setPromptHeight((current) => Math.min(current, nextMaximum));

      const nextMaximumWidth = getViewportSafeComposerWidth();
      setMaxComposerWidth(nextMaximumWidth);
      setComposerWidth((current) => Math.min(current, nextMaximumWidth));
    };
    updateMaximum();
    window.addEventListener("resize", updateMaximum);
    return () => window.removeEventListener("resize", updateMaximum);
  }, []);

  // Content can temporarily exceed the user's chosen height, then returns to
  // that manual baseline when text is removed.
  useEffect(() => {
    const textarea = promptRef.current;
    if (!textarea) return;

    textarea.style.flex = "none";
    textarea.style.height = "0px";
    const contentHeight = Math.max(PROMPT_SINGLE_LINE_SCROLL_HEIGHT, textarea.scrollHeight);
    textarea.style.flex = "";
    textarea.style.height = "100%";

    const requiredHeight = clamp(
      DEFAULT_PROMPT_HEIGHT + contentHeight - PROMPT_SINGLE_LINE_SCROLL_HEIGHT,
      MIN_PROMPT_HEIGHT,
      maxPromptHeight,
    );
    contentRequiredHeightRef.current = requiredHeight;
    setPromptHeight(
      hasManualHeight
        ? Math.max(manualPromptHeightRef.current, requiredHeight)
        : requiredHeight,
    );
  }, [script, hasManualHeight, maxPromptHeight]);

  const setPromptHeightFromCorner = useCallback((nextHeight: number) => {
    manualPromptHeightRef.current = nextHeight;
    setHasManualHeight(true);
    setPromptHeight(nextHeight);
  }, []);

  const handleCornerManualResize = useCallback(
    (_nextWidth: number, nextHeight: number) => {
      manualPromptHeightRef.current = nextHeight;
      setHasManualHeight(true);
    },
    [],
  );

  const audioCornerResize = usePromptSurfaceResize({
    width: composerWidth,
    height: promptHeight,
    minWidth: Math.min(DEFAULT_COMPOSER_WIDTH, maxComposerWidth),
    maxWidth: maxComposerWidth,
    minHeight: Math.max(MIN_PROMPT_HEIGHT, contentRequiredHeightRef.current),
    maxHeight: maxPromptHeight,
    defaultWidth: DEFAULT_COMPOSER_WIDTH,
    defaultHeight: DEFAULT_PROMPT_HEIGHT,
    setWidth: setComposerWidth,
    setHeight: setPromptHeightFromCorner,
    storageKey: "audioPromptDimensions",
    step: PROMPT_RESIZE_STEP,
    onManualResize: handleCornerManualResize,
  });

  // feature: 0 Voiceover · 1 Change Voice · 2 Translate (same index the
  // standalone rotary selector uses).
  const isVoiceover = feature === 0;
  const isChangeVoice = feature === 1;
  const isTranslate = feature === 2;
  const showReferenceVideo = isChangeVoice || isTranslate;
  const activeModel = AUDIO_MODELS[selectedModel];
  const ModelIcon = activeModel.icon;

  // Voiceover: capability-driven per-model controls.
  const voiceoverModelId = VOICEOVER_MODEL_ORDER[selectedModel];
  const capabilities = VOICEOVER_CAPABILITIES[voiceoverModelId];
  const isSeedAudioModel = voiceoverModelId === "seed-audio-1";
  const isQwenModel = voiceoverModelId === "qwen-audio-3";

  const speedRange = capabilities.speedRange;
  const volumeRange = capabilities.volumeRange;
  const pitchRange = capabilities.pitchRange;

  const speedValue = isSeedAudioModel ? seedAudioSettings.speed : isQwenModel ? qwenSettings.speed : 0;
  const setSpeedValue = (v: number) => {
    if (isSeedAudioModel) onSeedAudioSettingsChange({ ...seedAudioSettings, speed: v });
    else if (isQwenModel) onQwenSettingsChange({ ...qwenSettings, speed: v });
  };

  const volumeValue = isSeedAudioModel ? seedAudioSettings.volume : isQwenModel ? qwenSettings.volume : 0;
  const setVolumeValue = (v: number) => {
    if (isSeedAudioModel) onSeedAudioSettingsChange({ ...seedAudioSettings, volume: v });
    else if (isQwenModel) onQwenSettingsChange({ ...qwenSettings, volume: v });
  };

  const pitchValue = isSeedAudioModel ? seedAudioSettings.pitch : isQwenModel ? qwenSettings.pitch : 0;
  const setPitchValue = (v: number) => {
    if (isSeedAudioModel) onSeedAudioSettingsChange({ ...seedAudioSettings, pitch: v });
    else if (isQwenModel) onQwenSettingsChange({ ...qwenSettings, pitch: v });
  };

  const outputFormatValue = isSeedAudioModel
    ? seedAudioSettings.outputFormat
    : isQwenModel
      ? qwenSettings.outputFormat
      : "mp3";
  const setOutputFormatValue = (v: string) => {
    if (isSeedAudioModel) onSeedAudioSettingsChange({ ...seedAudioSettings, outputFormat: v });
    else if (isQwenModel) onQwenSettingsChange({ ...qwenSettings, outputFormat: v });
  };

  const hasAnyVoiceoverControls =
    capabilities.supportsReferences ||
    capabilities.supportsSampleRate ||
    capabilities.supportsLanguage ||
    capabilities.supportsSpeed ||
    capabilities.supportsVolume ||
    capabilities.supportsPitch ||
    capabilities.supportsOutputFormat;

  const handleReferenceDrop = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) onReferenceVideo(file.name);
  };

  const handleAddAudioReferences = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    const remaining = Math.max(0, 3 - seedAudioSettings.audioReferences.length);
    const names = files.slice(0, remaining).map((f) => f.name);
    if (names.length) {
      onSeedAudioSettingsChange({
        ...seedAudioSettings,
        audioReferences: [...seedAudioSettings.audioReferences, ...names],
      });
    }
  };

  const handleAddImageReference = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    onSeedAudioSettingsChange({ ...seedAudioSettings, imageReference: file.name });
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div
        className={`pointer-events-auto relative flex w-full items-end gap-2 ${
          audioCornerResize.isResizing
            ? ""
            : "transition-[max-width,transform] duration-150 ease-out"
        }`}
        style={{
          maxWidth: composerWidth,
          transform: `translateX(${Math.max(
            0,
            composerWidth - Math.min(DEFAULT_COMPOSER_WIDTH, maxComposerWidth),
          ) / 2}px)`,
        }}
      >
        {/* Standalone rotary mode selector — visually separate card on the left */}
        <RotarySelector value={feature} onChange={onFeatureChange} />

        {/* One persistent resizable shell for every Audio mode. Only the
            controls inside this surface change when the rotary mode changes. */}
        <div
          className={`relative flex min-w-0 flex-1 items-stretch rounded-[24px] p-1 ${
            audioCornerResize.isResizing
              ? ""
              : "transition-[height,width,background,border-radius,padding] duration-150 ease-out"
          }`}
          style={{
            height: promptHeight,
            background:
              "linear-gradient(180deg, rgba(217,119,87,0.28) 0%, rgba(217,119,87,0.16) 55%, rgba(217,119,87,0.10) 100%), #141414",
            border: "1px solid rgba(217, 119, 87, 0.45)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.15), inset 0 0 25px rgba(217,119,87,0.18), 0 10px 30px rgba(0,0,0,0.5)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          {/* Full frame glowing pulsing orange border shimmer overlay around prompt bar */}
          <div className="pointer-events-none absolute -inset-[1px] rounded-[25px] border-2 border-[#D97757] opacity-85 shadow-[0_0_25px_rgba(217,119,87,0.75)] animate-pulse z-30" />

          <div
            className="relative flex min-w-0 flex-1 items-end gap-2 overflow-hidden rounded-[20px] p-2 bg-transparent"
          >
            <PromptResizeHandles
              verticalHandleProps={audioCornerResize.verticalHandleProps}
              cornerHandleProps={audioCornerResize.cornerHandleProps}
              isResizing={audioCornerResize.isResizing}
              verticalLabel="Resize audio prompt height"
              cornerLabel="Resize audio prompt width and height"
            />

        {/* Change Voice & Translate: dedicated dark-neutral bar — Reference Video
            (large) + Voice Preset + Generate only. Translate no longer shows a
            Language chip or the sample-rate/speed/volume/pitch/output row. */}
        {showReferenceVideo && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) =>
                onReferenceVideo(e.target.files?.[0]?.name ?? null)
              }
            />
            {/* Reference Video upload — sits directly on the glass surface without dark slab */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleReferenceDrop}
              aria-label="Upload reference video"
              className="flex h-full min-w-0 flex-1 items-center justify-center gap-4 rounded-2xl px-6 text-left transition-all hover:bg-white/[0.04] bg-white/[0.02] border border-white/10"
            >
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
                style={{ background: "rgba(255,255,255,0.06)" }}
              >
                <Video className="h-5 w-5 text-zinc-300" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold text-white">
                  Reference Video
                </span>
                <span className="truncate text-xs text-zinc-500">
                  {referenceVideo ? (
                    <span className="text-zinc-300">{referenceVideo}</span>
                  ) : (
                    "Drop here or Choose from files"
                  )}
                </span>
              </span>
            </button>

            {/* Voice Preset — matches the Voiceover composer's card exactly */}
            <button
              type="button"
              onClick={onChooseVoice}
              className="group relative flex h-20 w-[172px] shrink-0 flex-col self-end overflow-hidden rounded-xl border-2 border-black pt-3 text-left transition-all hover:brightness-110"
              style={{
                background: "linear-gradient(rgb(36,36,36), rgb(19,19,18), rgb(0,0,0))",
                boxShadow:
                  "rgb(39,41,44) 0px 0px 0px 1px, rgba(0,0,0,0.4) 0px -1px 0px 0px inset",
              }}
            >
              <img
                aria-hidden="true"
                src="/asset/glare.svg"
                alt=""
                className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              />
              <div className="flex w-full items-start justify-between gap-3 px-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="text-[10px] font-semibold uppercase leading-none text-white/25">
                    Voice Preset
                  </p>
                  <p
                    className="truncate font-mono text-base font-bold uppercase tracking-wider"
                    style={{ color: NEON, textShadow: "0 0 16px rgba(0,240,255,0.4)" }}
                  >
                    {selectedVoiceLabel ?? "Choose Voice"}
                  </p>
                </div>
                <svg viewBox="0 0 24 24" className="size-6 shrink-0 text-white" fill="none">
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22ZM10.7817 8.78296C10.4498 8.55666 10 8.79436 10 9.19607V14.8039C10 15.2056 10.4498 15.4433 10.7817 15.217L14.8941 12.4131C15.1852 12.2146 15.1852 11.7854 14.8941 11.5869L10.7817 8.78296Z"
                    fill="currentColor"
                  />
                </svg>
              </div>
              <div className="pointer-events-none absolute bottom-0 left-3 right-3 h-6 overflow-hidden opacity-80">
                <div className="flex h-full items-end justify-center gap-[3px]">
                  {PRESET_BARS.map((h, i) => (
                    <span
                      key={i}
                      className="w-[3px]"
                      style={{
                        height: `${h}%`,
                        background: NEON,
                        boxShadow: "0 0 6px rgba(0,240,255,0.7)",
                      }}
                    />
                  ))}
                </div>
              </div>
            </button>

            {/* Generate — orange accent, fixed height self-end (never stretches) */}
            <button
              type="button"
              onClick={onGenerate}
              disabled={isGenerating}
              className="flex h-20 w-[120px] shrink-0 self-end flex-col items-center justify-center gap-1 rounded-[18px] text-sm font-bold uppercase tracking-wide text-black transition-all hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                background: "linear-gradient(135deg, #D97757 0%, #B85A3E 100%)",
                boxShadow:
                  "0 12px 24px rgba(217,119,87,0.25), inset 0px -3px 0px 0px #8A4A32, inset 0px 1px 0px 0px #F0A98C",
              }}
            >
              {isGenerating ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate
                </>
              )}
            </button>
          </>
        )}

        {/* Voiceover controls live inside the same persistent Audio shell. */}
        {isVoiceover && (
        <>
          {/* Voiceover: text prompt input + model selector (shared by all six models).
              No extra inner frame here — the chassis→gray-surface layering
              above already provides the depth; this box is just the plain
              panel surface. min-height keeps it visually aligned with the
              Voice Preset card / Generate button at rest, while the textarea
              is free to grow the surface with real content. */}
          {isVoiceover && (
          <div
            className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col self-stretch overflow-hidden rounded-2xl p-3"
          >
            <textarea
              ref={promptRef}
              rows={1}
              value={script}
              onChange={(e) => onScriptChange(e.target.value)}
              placeholder="Describe the sound you imagine..."
              spellCheck
              className="min-h-0 w-full flex-1 resize-none overflow-y-auto bg-transparent pt-1 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            />

            <div className="mt-auto flex h-8 min-w-0 shrink-0 items-center gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {/* Active model pill (bottom-left, dynamic) — a real Popover so the
                  six-model list is a temporary, portal-rendered, collision-aware
                  popup anchored to this trigger (never a page-level element). */}
              <Popover.Root open={modelMenuOpen} onOpenChange={setModelMenuOpen}>
                <Popover.Trigger asChild>
                  <button
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={modelMenuOpen}
                    className="inline-flex h-8 min-w-[90px] shrink-0 items-center gap-2 rounded-lg bg-white/[0.05] px-2 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/[0.09] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded">
                      {activeModel.iconSrc ? (
                        <img
                          src={activeModel.iconSrc}
                          alt=""
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <ModelIcon className="h-3.5 w-3.5 text-zinc-300" />
                      )}
                    </span>
                    {activeModel.title}
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform duration-200 ease-out ${
                        modelMenuOpen ? "rotate-180 text-[#D97757]" : "text-zinc-400"
                      }`}
                    />
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    side="top"
                    align="start"
                    sideOffset={8}
                    collisionPadding={12}
                    role="listbox"
                    aria-label="Audio model"
                    className="z-[100000] w-[300px] overflow-hidden rounded-2xl border border-white/10 p-1.5"
                    style={{
                      ...POPOVER_SURFACE,
                      maxHeight: "min(420px, var(--radix-popover-content-available-height, 420px))",
                      overflowY: "auto",
                    }}
                  >
                    {/* Decorative top glow */}
                    <div
                      className="pointer-events-none absolute inset-x-0 top-0 h-[37px]"
                      style={{ background: "rgba(139,213,244,0.24)", filter: "blur(50px)" }}
                    />
                    <div className="relative flex flex-col gap-2">
                      {AUDIO_MODELS.map((model, i) => {
                        const Icon = model.icon;
                        const active = i === selectedModel;
                        return (
                          <button
                            key={model.title}
                            type="button"
                            role="option"
                            aria-selected={active}
                            onClick={() => {
                              onSelectModel(i);
                              setModelMenuOpen(false);
                            }}
                            className="group/model-row flex h-[52px] w-full items-center gap-3 rounded-xl px-2 text-left transition-colors duration-200 hover:bg-white/5 focus-visible:outline-none cursor-pointer"
                          >
                            <div
                              className={`size-10 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200 ${
                                active
                                  ? "bg-[rgba(217,119,87,0.20)] text-[#D97757] border border-[rgba(217,119,87,0.50)] shadow-[0_0_14px_rgba(217,119,87,0.40)]"
                                  : "bg-white/5 text-gray-400 border border-white/5 shadow-[inset_0px_2px_3px_0px_rgba(255,255,255,0.03)] group-hover/model-row:bg-[rgba(217,119,87,0.22)] group-hover/model-row:text-[#D97757] group-hover/model-row:border-[#D97757]/40 group-hover/model-row:shadow-[0_0_16px_rgba(217,119,87,0.45)]"
                              }`}
                            >
                              {model.iconSrc ? (
                                <img
                                  src={model.iconSrc}
                                  alt=""
                                  className="h-4 w-4 object-contain"
                                />
                              ) : (
                                <Icon
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                />
                              )}
                            </div>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-xs font-semibold text-white">
                                  {model.title}
                                </span>
                                {model.badge && (
                                  <span
                                    className="rounded px-1 py-0.5 text-[9px] font-bold uppercase leading-none"
                                    style={{
                                      background: "rgba(209,254,23,0.18)",
                                      color: "#D1FE17",
                                    }}
                                  >
                                    {model.badge}
                                  </span>
                                )}
                              </span>
                              <span className="block truncate text-[10px] text-zinc-500">
                                {model.description}
                              </span>
                            </span>
                            <span className="flex w-5 shrink-0 items-center justify-center">
                              {active && <Check className="h-4 w-4 text-[#D97757]" />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>

              {/* Voiceover: model-capability-driven controls — only what the selected model supports */}
              {hasAnyVoiceoverControls && (
                <>
              {capabilities.supportsReferences && (
                <Popover.Root open={addReferenceOpen} onOpenChange={setAddReferenceOpen}>
                  <Popover.Trigger asChild>
                    <button
                      type="button"
                      aria-label="Add audio reference"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-white transition-colors hover:bg-white/[0.09]"
                      style={{ boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.06)" }}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </Popover.Trigger>
                  <Popover.Content
                    side="top"
                    align="start"
                    sideOffset={8}
                    collisionPadding={12}
                    className="z-[100000] w-64 overflow-hidden rounded-xl border border-white/10 px-2 pb-2 pt-2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
                    style={POPOVER_SURFACE}
                  >
                    <div className="px-2 pb-2">
                      <p className="text-xs font-semibold text-white">Add Reference</p>
                      <p className="text-[11px] text-zinc-500">Pick one source for the voice</p>
                    </div>

                    <input
                      ref={audioRefInputRef}
                      type="file"
                      accept="audio/*"
                      multiple
                      className="hidden"
                      onChange={handleAddAudioReferences}
                    />
                    <button
                      type="button"
                      onClick={() => audioRefInputRef.current?.click()}
                      disabled={seedAudioSettings.audioReferences.length >= 3}
                      className="flex min-h-[60px] w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                        <Music2 className="h-4 w-4 text-zinc-300" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-white">Add audio</span>
                          <span className="shrink-0 text-xs text-zinc-500">
                            {seedAudioSettings.audioReferences.length}/3
                          </span>
                        </span>
                        <span className="block truncate text-xs text-zinc-500">
                          Clone a voice from a clip
                        </span>
                      </span>
                    </button>

                    <div className="relative my-1 flex items-center justify-center py-1">
                      <div className="absolute inset-x-0 h-px bg-white/[0.08]" />
                      <span
                        className="relative rounded px-2 text-[10px] text-zinc-500"
                        style={{ background: "rgba(28,30,32,0.95)" }}
                      >
                        or
                      </span>
                    </div>

                    <input
                      ref={imageRefInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAddImageReference}
                    />
                    <button
                      type="button"
                      onClick={() => imageRefInputRef.current?.click()}
                      disabled={!!seedAudioSettings.imageReference}
                      className="flex min-h-[60px] w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                        <ImageRefIcon className="h-4 w-4 text-zinc-300" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-white">Add image</span>
                          <span className="shrink-0 text-xs text-zinc-500">
                            {seedAudioSettings.imageReference ? 1 : 0}/1
                          </span>
                        </span>
                        <span className="block truncate text-xs text-zinc-500">
                          Shape the voice from an image
                        </span>
                      </span>
                    </button>
                  </Popover.Content>
                </Popover.Root>
              )}

              {capabilities.supportsSampleRate && (
                <SelectPopover
                  open={sampleRateMenuOpen}
                  onOpenChange={setSampleRateMenuOpen}
                  triggerLabel={`${seedAudioSettings.sampleRate} Hz`}
                  header="Sample Rate"
                  options={SAMPLE_RATE_OPTIONS}
                  selected={String(seedAudioSettings.sampleRate)}
                  onSelect={(v) =>
                    onSeedAudioSettingsChange({ ...seedAudioSettings, sampleRate: Number(v) })
                  }
                  width={176}
                  seedValue={seedAudioSettings.sampleRateSeed}
                  onSeedChange={(v) =>
                    onSeedAudioSettingsChange({ ...seedAudioSettings, sampleRateSeed: v })
                  }
                />
              )}

              {capabilities.supportsLanguage && (
                <SelectPopover
                  open={languageMenuOpen}
                  onOpenChange={setLanguageMenuOpen}
                  triggerLabel={qwenSettings.language}
                  header="Language"
                  options={QWEN_LANGUAGE_OPTIONS}
                  selected={qwenSettings.language}
                  onSelect={(v) => onQwenSettingsChange({ ...qwenSettings, language: v })}
                  width={176}
                  maxHeight={320}
                />
              )}

              {capabilities.supportsSpeed && speedRange && (
                <SliderPopover
                  open={speedMenuOpen}
                  onOpenChange={setSpeedMenuOpen}
                  label="Speed"
                  icon={SPEED_ICON}
                  value={speedValue}
                  onChange={setSpeedValue}
                  min={speedRange.min}
                  max={speedRange.max}
                  step={speedRange.step}
                  format={(v) => `${Number(v.toFixed(2))}x`}
                />
              )}

              {capabilities.supportsVolume && volumeRange && (
                <SliderPopover
                  open={volumeMenuOpen}
                  onOpenChange={setVolumeMenuOpen}
                  label="Volume"
                  icon={VOLUME_ICON}
                  value={volumeValue}
                  onChange={setVolumeValue}
                  min={volumeRange.min}
                  max={volumeRange.max}
                  step={volumeRange.step}
                  format={(v) => (volumeRange.max === 100 ? `${Math.round(v)}` : v.toFixed(1))}
                />
              )}

              {capabilities.supportsPitch && pitchRange && (
                <SliderPopover
                  open={pitchMenuOpen}
                  onOpenChange={setPitchMenuOpen}
                  label="Pitch"
                  icon={PITCH_ICON}
                  value={pitchValue}
                  onChange={setPitchValue}
                  min={pitchRange.min}
                  max={pitchRange.max}
                  step={pitchRange.step}
                  format={(v) =>
                    pitchRange.max === 12
                      ? `${v >= 0 ? "+" : ""}${v}`
                      : v.toFixed(1)
                  }
                />
              )}

              {capabilities.supportsOutputFormat && (
                <SelectPopover
                  open={outputFormatMenuOpen}
                  onOpenChange={setOutputFormatMenuOpen}
                  triggerLabel={outputFormatValue}
                  header="Output format"
                  options={OUTPUT_FORMAT_OPTIONS}
                  selected={outputFormatValue}
                  onSelect={setOutputFormatValue}
                  width={160}
                />
              )}
                </>
              )}
            </div>
          </div>
          )}

          {/* Choose Voice capsule — opens "Select or add a voice" modal */}
          <button
            type="button"
            onClick={onChooseVoice}
            className="group relative flex h-20 w-[172px] shrink-0 flex-col self-end overflow-hidden rounded-xl border-2 border-black pt-3 text-left transition-all hover:brightness-110"
            style={{
              background: "linear-gradient(rgb(36,36,36), rgb(19,19,18), rgb(0,0,0))",
              boxShadow:
                "rgb(39,41,44) 0px 0px 0px 1px, rgba(0,0,0,0.4) 0px -1px 0px 0px inset",
            }}
          >
            <img
              aria-hidden="true"
              src="/asset/glare.svg"
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            />
            <div className="flex w-full items-start justify-between gap-3 px-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="text-[10px] font-semibold uppercase leading-none text-white/25">
                  Voice Preset
                </p>
                <p
                  className="truncate font-mono text-base font-bold uppercase tracking-wider"
                  style={{ color: NEON, textShadow: "0 0 16px rgba(0,240,255,0.4)" }}
                >
                  {selectedVoiceLabel ?? "Choose Voice"}
                </p>
              </div>
              <svg viewBox="0 0 24 24" className="size-6 shrink-0 text-white" fill="none">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22ZM10.7817 8.78296C10.4498 8.55666 10 8.79436 10 9.19607V14.8039C10 15.2056 10.4498 15.4433 10.7817 15.217L14.8941 12.4131C15.1852 12.2146 15.1852 11.7854 14.8941 11.5869L10.7817 8.78296Z"
                  fill="currentColor"
                />
              </svg>
            </div>
            {/* Retro digital vertical wave bars — illuminate in neon turquoise */}
            <div className="pointer-events-none absolute bottom-0 left-3 right-3 h-6 overflow-hidden opacity-80">
              <div className="flex h-full items-end justify-center gap-[3px]">
                {PRESET_BARS.map((h, i) => (
                  <span
                    key={i}
                    className="w-[3px]"
                    style={{
                      height: `${h}%`,
                      background: NEON,
                      boxShadow: "0 0 6px rgba(0,240,255,0.7)",
                    }}
                  />
                ))}
              </div>
            </div>
          </button>

          {/* Generate — orange accent, matching the other audio modes.
              h-full so it always fits the gray surface's actual height and
              never overflows past the chassis edge. */}
          <button
            type="button"
            onClick={onGenerate}
            disabled={isGenerating}
            className="flex h-20 w-[120px] shrink-0 self-end flex-col items-center justify-center gap-1 rounded-[18px] text-sm font-bold uppercase tracking-wide text-black transition-all hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              background: "linear-gradient(135deg, #D97757 0%, #B85A3E 100%)",
              boxShadow:
                "0 12px 24px rgba(217,119,87,0.25), inset 0px -3px 0px 0px #8A4A32, inset 0px 1px 0px 0px #F0A98C",
            }}
          >
            {isGenerating ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate
              </>
            )}
          </button>
          </>
        )}
          </div>
        </div>
      </div>
    </div>
  );
}
