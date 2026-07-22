"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import * as Popover from "@radix-ui/react-popover";
import {
  ChevronDown,
  Globe,
  Loader2,
  Sparkles,
  Video,
} from "lucide-react";
import { AUDIO_MODELS } from "@/components/landing/audioMenuData";
import RotarySelector from "./RotarySelector";

/** Neon turquoise brand accent (per 1:1 spec). */
const NEON = "#00F0FF";

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
  /** Active model index for the in-prompt model pill. */
  selectedModel: number;
  onSelectModel: (index: number) => void;
  /** Translate-mode target language + its picker. */
  language: string;
  onOpenLanguage: () => void;
  /** Translate-mode reference video file name. */
  referenceVideo: string | null;
  onReferenceVideo: (name: string | null) => void;
  /** Audio control values */
  sampleRate: number;
  onSampleRateChange: (value: number) => void;
  speed: number;
  onSpeedChange: (value: number) => void;
  volume: number;
  onVolumeChange: (value: number) => void;
  pitch: number;
  onPitchChange: (value: number) => void;
  outputFormat: string;
  onOutputFormatChange: (value: string) => void;
}

/** Retro vertical wave bars for the Choose Voice capsule (illuminate turquoise). */
const PRESET_BARS = Array.from({ length: 22 }, (_, i) =>
  24 + Math.round(Math.abs(Math.sin(i * 0.8)) * 70),
);

/**
 * Bottom floating composer bar for the Audio workspace — mirrors the real
 * Higgsfield layout: rotary mode selector → prompt (with model pill) → Choose
 * Voice capsule → Generate. In Translate mode a Reference Video drop slot is
 * inserted to the left of the prompt and a language picker appears.
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
  sampleRate,
  onSampleRateChange,
  speed,
  onSpeedChange,
  volume,
  onVolumeChange,
  pitch,
  onPitchChange,
  outputFormat,
  onOutputFormatChange,
}: AudioComposerProps) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [sampleRateMenuOpen, setSampleRateMenuOpen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [volumeMenuOpen, setVolumeMenuOpen] = useState(false);
  const [pitchMenuOpen, setPitchMenuOpen] = useState(false);
  const [outputFormatMenuOpen, setOutputFormatMenuOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isTranslate = feature === 2;
  const activeModel = AUDIO_MODELS[selectedModel];
  const ModelIcon = activeModel.icon;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div
        className={`pointer-events-auto w-full ${
          isTranslate ? "max-w-[1200px]" : "max-w-[1040px]"
        }`}
      >
        {/* Outer glass shell */}
        <div
          className="flex items-end gap-2 rounded-[22px] p-2"
          style={{
            background:
              "linear-gradient(115deg, rgba(0,229,255,0.10) 27%, rgba(219,219,219,0.10) 86%), rgba(15,17,19,0.96)",
            boxShadow:
              "0 12px 28px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.06)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
          {/* Rotary mode selector */}
          <RotarySelector value={feature} onChange={onFeatureChange} />

          {/* Translate-only: Reference Video drop slot (left of the prompt) */}
          {isTranslate && (
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
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-[120px] w-[150px] shrink-0 flex-col items-center justify-center gap-2 rounded-[18px] px-3 text-center transition-colors"
                style={{
                  border: `1.5px dashed rgba(0,240,255,0.45)`,
                  background: "rgba(0,240,255,0.04)",
                }}
              >
                <Video className="h-5 w-5" style={{ color: NEON }} />
                <span className="text-xs font-semibold text-white">
                  Reference Video
                </span>
                <span className="text-[10px] leading-tight text-zinc-400">
                  {referenceVideo ? (
                    <span className="block truncate" style={{ color: NEON }}>
                      {referenceVideo}
                    </span>
                  ) : (
                    "Drop name of scene from files"
                  )}
                </span>
              </button>
            </>
          )}

          {/* Prompt input + model pill (+ language chip in Translate) */}
          <div className="relative flex h-[120px] min-w-0 flex-1 flex-col justify-between rounded-[18px] bg-white/[0.03] p-3">
            <textarea
              rows={2}
              value={script}
              onChange={(e) => onScriptChange(e.target.value)}
              placeholder="Describe the sound you imagine…"
              className="min-h-0 flex-1 resize-none bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            />

            <div className="flex items-center justify-between gap-2">
              {/* Active model pill (bottom-left, dynamic) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setModelMenuOpen((o) => !o)}
                  className="inline-flex h-8 items-center gap-2 rounded-lg bg-white/[0.05] px-2 text-xs font-medium text-white transition-colors hover:bg-white/[0.09]"
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded">
                    {selectedModel === 0 ? (
                      <Image
                        src="/de397d3b-0644-47ac-a4fe-49d64ede48d3.png"
                        alt={activeModel.title}
                        width={16}
                        height={16}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <ModelIcon className="h-3.5 w-3.5" style={{ color: NEON }} />
                    )}
                  </span>
                  {activeModel.title}
                  <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                </button>

                {/* Upward model dropdown */}
                {modelMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setModelMenuOpen(false)}
                    />
                    <div
                      className="absolute bottom-full left-0 z-50 mb-2 w-[260px] overflow-hidden rounded-xl border border-white/10 p-1.5"
                      style={{
                        background: "rgba(13,15,17,0.98)",
                        boxShadow:
                          "0 16px 50px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,240,255,0.06)",
                      }}
                    >
                      {AUDIO_MODELS.map((model, i) => {
                        const Icon = model.icon;
                        const active = i === selectedModel;
                        return (
                          <button
                            key={model.title}
                            type="button"
                            onClick={() => {
                              onSelectModel(i);
                              setModelMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors"
                            style={{
                              background: active
                                ? "rgba(0,240,255,0.10)"
                                : "transparent",
                            }}
                            onMouseEnter={(e) => {
                              if (!active)
                                e.currentTarget.style.background =
                                  "rgba(255,255,255,0.05)";
                            }}
                            onMouseLeave={(e) => {
                              if (!active)
                                e.currentTarget.style.background = "transparent";
                            }}
                          >
                            <span
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                              style={{
                                background: active
                                  ? "rgba(0,240,255,0.16)"
                                  : "rgba(255,255,255,0.06)",
                              }}
                            >
                              <Icon
                                className="h-3.5 w-3.5"
                                style={{ color: active ? NEON : "#d4d4d8" }}
                              />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-xs font-semibold text-white">
                                  {model.title}
                                </span>
                                {model.badge && (
                                  <span
                                    className="rounded px-1 py-0.5 text-[9px] font-bold uppercase leading-none"
                                    style={{
                                      background: "rgba(0,240,255,0.18)",
                                      color: NEON,
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
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Translate-only: target language chip → Choose Language modal */}
              {isTranslate && (
                <button
                  type="button"
                  onClick={onOpenLanguage}
                  className="inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs font-semibold transition-colors"
                  style={{
                    border: "1px solid rgba(0,240,255,0.35)",
                    background: "rgba(0,240,255,0.06)",
                    color: NEON,
                  }}
                >
                  <Globe className="h-3.5 w-3.5" />
                  {language}
                  <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                </button>
              )}
            </div>
          </div>

          {/* Audio controls row — Sample Rate, Speed, Volume, Pitch, Output Format */}
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Sample Rate */}
            <Popover.Root open={sampleRateMenuOpen} onOpenChange={setSampleRateMenuOpen}>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className="flex h-8 items-center gap-1 rounded-lg bg-white/[0.05] px-2 text-xs font-medium text-white transition-colors hover:bg-white/[0.09]"
                >
                  {sampleRate / 1000}k Hz
                  <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                </button>
              </Popover.Trigger>
              <Popover.Content
                side="top"
                align="start"
                className="z-50 w-40 overflow-hidden rounded-xl border border-white/10 p-1.5"
                style={{
                  background: "rgba(13,15,17,0.98)",
                  boxShadow: "0 16px 50px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,240,255,0.06)",
                }}
              >
                <div className="mb-1 px-2 py-1 text-xs font-semibold text-zinc-400">Sample Rate</div>
                {[8000, 16000, 24000, 32000, 44100, 48000].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => {
                      onSampleRateChange(rate);
                      setSampleRateMenuOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-lg p-2 text-left text-xs transition-colors"
                    style={{
                      background: sampleRate === rate ? "rgba(0,240,255,0.10)" : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (sampleRate !== rate) e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                    }}
                    onMouseLeave={(e) => {
                      if (sampleRate !== rate) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <span className="text-white font-medium">{rate / 1000}k Hz</span>
                    {sampleRate === rate && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-[#D1FE17]">
                        <path d="M5 13.875 9.2 18 19 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
                      </svg>
                    )}
                  </button>
                ))}
              </Popover.Content>
            </Popover.Root>

            {/* Speed */}
            <Popover.Root open={speedMenuOpen} onOpenChange={setSpeedMenuOpen}>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className="flex h-8 items-center gap-1 rounded-lg bg-white/[0.05] px-2 text-xs font-medium text-white transition-colors hover:bg-white/[0.09]"
                >
                  {speed.toFixed(1)}x
                  <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                </button>
              </Popover.Trigger>
              <Popover.Content
                side="top"
                align="start"
                className="z-50 w-[240px] overflow-hidden rounded-xl border border-white/10 p-2"
                style={{
                  background: "rgba(13,15,17,0.98)",
                  boxShadow: "0 16px 50px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,240,255,0.06)",
                }}
              >
                <div className="mb-2 flex items-center gap-2 px-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-white">
                    <path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M6.252 19.248a9.25 9.25 0 1 1 11.496 0" />
                    <path fill="currentColor" d="M10.468 14.285a2 2 0 1 1 3.064-2.572c1.141 1.36 1.834 3.755 2.14 5.029a.449.449 0 0 1-.624.523c-1.201-.523-3.439-1.62-4.58-2.98" />
                  </svg>
                  <span className="text-xs font-semibold text-white">Speed</span>
                </div>
                <div className="flex items-center gap-2 px-2">
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={speed}
                    onChange={(e) => onSpeedChange(Number(e.target.value))}
                    className="flex-1 h-6 appearance-none rounded-md cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.2) ${((speed - 0.5) / 1.5) * 100}%, rgba(255,255,255,0.05) ${((speed - 0.5) / 1.5) * 100}%, rgba(255,255,255,0.05) 100%)`,
                      border: "1px solid #424242",
                    }}
                  />
                  <span className="text-xs font-semibold text-white min-w-[30px]">{speed.toFixed(1)}x</span>
                </div>
              </Popover.Content>
            </Popover.Root>

            {/* Volume */}
            <Popover.Root open={volumeMenuOpen} onOpenChange={setVolumeMenuOpen}>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className="flex h-8 items-center gap-1 rounded-lg bg-white/[0.05] px-2 text-xs font-medium text-white transition-colors hover:bg-white/[0.09]"
                >
                  Vol
                  <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                </button>
              </Popover.Trigger>
              <Popover.Content
                side="top"
                align="start"
                className="z-50 w-[240px] overflow-hidden rounded-xl border border-white/10 p-2"
                style={{
                  background: "rgba(13,15,17,0.98)",
                  boxShadow: "0 16px 50px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,240,255,0.06)",
                }}
              >
                <div className="mb-2 flex items-center gap-2 px-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-white">
                    <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19.248 4.752A10.22 10.22 0 0 1 22.25 12c0 2.83-1.147 5.393-3.002 7.248M15.889 8.11a5.48 5.48 0 0 1 1.611 3.89 5.48 5.48 0 0 1-1.61 3.889M2.75 7.75h2.957a1 1 0 0 0 .54-.158L12.25 3.75v16.5l-6.004-3.842a1 1 0 0 0-.539-.158H2.75a1 1 0 0 1-1-1v-6.5a1 1 0 0 1 1-1" />
                  </svg>
                  <span className="text-xs font-semibold text-white">Volume</span>
                </div>
                <div className="flex items-center gap-2 px-2">
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={volume}
                    onChange={(e) => onVolumeChange(Number(e.target.value))}
                    className="flex-1 h-6 appearance-none rounded-md cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.2) ${((volume - 0.5) / 1.5) * 100}%, rgba(255,255,255,0.05) ${((volume - 0.5) / 1.5) * 100}%, rgba(255,255,255,0.05) 100%)`,
                      border: "1px solid #424242",
                    }}
                  />
                  <span className="text-xs font-semibold text-white min-w-[30px]">{volume.toFixed(1)}</span>
                </div>
              </Popover.Content>
            </Popover.Root>

            {/* Pitch */}
            <Popover.Root open={pitchMenuOpen} onOpenChange={setPitchMenuOpen}>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className="flex h-8 items-center gap-1 rounded-lg bg-white/[0.05] px-2 text-xs font-medium text-white transition-colors hover:bg-white/[0.09]"
                >
                  {pitch >= 0 ? '+' : ''}{pitch}
                  <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                </button>
              </Popover.Trigger>
              <Popover.Content
                side="top"
                align="start"
                className="z-50 w-[240px] overflow-hidden rounded-xl border border-white/10 p-2"
                style={{
                  background: "rgba(13,15,17,0.98)",
                  boxShadow: "0 16px 50px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,240,255,0.06)",
                }}
              >
                <div className="mb-2 flex items-center gap-2 px-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-white">
                    <path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M7.75 5.75v12.5m-4-7.5v2.5M12 9.75v4.5m4.25-6.5v8.5m4-5.5v2.5" />
                  </svg>
                  <span className="text-xs font-semibold text-white">Pitch</span>
                </div>
                <div className="flex items-center gap-2 px-2">
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="1"
                    value={pitch}
                    onChange={(e) => onPitchChange(Number(e.target.value))}
                    className="flex-1 h-6 appearance-none rounded-md cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.2) ${((pitch + 12) / 24) * 100}%, rgba(255,255,255,0.05) ${((pitch + 12) / 24) * 100}%, rgba(255,255,255,0.05) 100%)`,
                      border: "1px solid #424242",
                    }}
                  />
                  <span className="text-xs font-semibold text-white min-w-[30px]">{pitch >= 0 ? '+' : ''}{pitch}</span>
                </div>
              </Popover.Content>
            </Popover.Root>

            {/* Output Format */}
            <Popover.Root open={outputFormatMenuOpen} onOpenChange={setOutputFormatMenuOpen}>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className="flex h-8 items-center gap-1 rounded-lg bg-white/[0.05] px-2 text-xs font-medium text-white transition-colors hover:bg-white/[0.09]"
                >
                  {outputFormat}
                  <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                </button>
              </Popover.Trigger>
              <Popover.Content
                side="top"
                align="start"
                className="z-50 w-40 overflow-hidden rounded-xl border border-white/10 p-1.5"
                style={{
                  background: "rgba(13,15,17,0.98)",
                  boxShadow: "0 16px 50px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,240,255,0.06)",
                }}
              >
                <div className="mb-1 px-2 py-1 text-xs font-semibold text-zinc-400">Output format</div>
                {["mp3", "wav", "opus"].map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => {
                      onOutputFormatChange(fmt);
                      setOutputFormatMenuOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-lg p-2 text-left text-xs transition-colors"
                    style={{
                      background: outputFormat === fmt ? "rgba(0,240,255,0.10)" : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (outputFormat !== fmt) e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                    }}
                    onMouseLeave={(e) => {
                      if (outputFormat !== fmt) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <span className="text-white font-medium uppercase">{fmt}</span>
                    {outputFormat === fmt && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-[#D1FE17]">
                        <path d="M5 13.875 9.2 18 19 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
                      </svg>
                    )}
                  </button>
                ))}
              </Popover.Content>
            </Popover.Root>
          </div>

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
                  className="truncate text-base font-black uppercase tracking-tight"
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

          {/* Generate (locked turquoise brand button) */}
          <button
            type="button"
            onClick={onGenerate}
            disabled={isGenerating}
            className="flex h-[120px] w-[120px] shrink-0 flex-col items-center justify-center gap-1 rounded-[18px] bg-magenta-500 text-sm font-bold uppercase tracking-wide text-white shadow-lg shadow-magenta-500/30 transition-all hover:bg-magenta-600 hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
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
        </div>
      </div>
    </div>
  );
}
