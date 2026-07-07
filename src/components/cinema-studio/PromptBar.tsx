"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Diamond,
  Minus,
  Monitor,
  Plus,
  Ratio,
  Volume2,
  VolumeX,
} from "lucide-react";
import GenerateButton from "./GenerateButton";
import ModelSelector from "./ModelSelector";
import AspectRatioDropdown from "./AspectRatioDropdown";
import DurationPopover from "./DurationPopover";
import QualityPanel from "./QualityPanel";
import { RESOLUTIONS } from "./cinemaStudioData";

export interface PromptBarProps {
  prompt: string;
  onPromptChange: (value: string) => void;

  model: string;
  onModelChange: (id: string) => void;

  /** Read-only here — the toggle lives in the left sidebar now. */
  mode: "image" | "video";

  aspectRatio: string;
  onAspectRatioChange: (value: string) => void;
  resolution: string;
  onResolutionChange: (value: string) => void;
  quality: string;
  onQualityChange: (value: string) => void;
  duration: number;
  durations: number[];
  onDurationChange: (value: number) => void;
  batch: string;
  onBatchChange: (value: string) => void;
  sound: boolean;
  onSoundChange: (value: boolean) => void;

  creditCost: number;
  onGenerate: () => void;
}

/** Shared h-7 control-pill style. */
const PILL =
  "flex h-7 items-center gap-1.5 rounded-lg bg-card px-2 py-1 text-xs font-medium text-white transition-all duration-200 ease-out hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#00e5ff]";

/** Compact pop-up dropdown matching the h-7 control row. */
function PillDropdown({
  label,
  value,
  options,
  onChange,
  icon: Icon,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  icon: typeof Ratio;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        className={PILL}
      >
        <Icon className="size-3.5 text-neutral-400" />
        {value}
        <ChevronDown className="size-3 text-neutral-500" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 min-w-[110px] overflow-hidden rounded-lg border border-white/10 bg-[#0a0a0a] p-1 shadow-xl">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              className={`w-full rounded-md px-3 py-1.5 text-left text-xs transition-colors ${
                opt === value
                  ? "bg-[#00e5ff]/10 text-[#00e5ff]"
                  : "text-neutral-300 hover:bg-[#1e1e1e]"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Batch size stepper (n/4 with +/- controls). */
function BatchStepper({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [nRaw, dRaw] = value.split("/");
  const n = Number(nRaw) || 1;
  const d = Number(dRaw) || 4;
  const set = (next: number) =>
    onChange(`${Math.max(1, Math.min(d, next))}/${d}`);
  return (
    <div className={`${PILL} gap-1`}>
      <button
        type="button"
        aria-label="Decrease batch"
        onClick={() => set(n - 1)}
        disabled={n <= 1}
        className="flex size-4 items-center justify-center rounded text-neutral-400 hover:text-white disabled:opacity-40"
      >
        <Minus className="size-3" />
      </button>
      <span aria-live="polite" className="w-8 text-center font-semibold tabular-nums text-white">
        {value}
      </span>
      <button
        type="button"
        aria-label="Increase batch"
        onClick={() => set(n + 1)}
        disabled={n >= d}
        className="flex size-4 items-center justify-center rounded text-neutral-400 hover:text-white disabled:opacity-40"
      >
        <Plus className="size-3" />
      </button>
    </div>
  );
}

/** Contenteditable prompt input with CSS placeholder. */
function PromptInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Keep DOM in sync only when the external value diverges (avoids caret jumps).
  useEffect(() => {
    if (ref.current && ref.current.textContent !== value) {
      ref.current.textContent = value;
    }
  }, [value]);

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Prompt"
      data-placeholder={placeholder}
      onInput={(e) => onChange(e.currentTarget.textContent ?? "")}
      className="max-h-[80px] min-h-[24px] overflow-y-auto px-1 text-sm leading-5 text-white focus:outline-none empty:before:pointer-events-none empty:before:text-neutral-500 empty:before:content-[attr(data-placeholder)]"
    />
  );
}

export default function PromptBar(props: PromptBarProps) {
  const [qualityPanelOpen, setQualityPanelOpen] = useState(false);
  const [qualityAnchor, setQualityAnchor] = useState<HTMLElement | null>(null);

  const {
    prompt,
    onPromptChange,
    model,
    onModelChange,
    mode,
    aspectRatio,
    onAspectRatioChange,
    resolution,
    onResolutionChange,
    quality,
    onQualityChange,
    duration,
    durations,
    onDurationChange,
    batch,
    onBatchChange,
    sound,
    onSoundChange,
    creditCost,
    onGenerate,
  } = props;

  const isVideo = mode === "video";
  const placeholder = isVideo
    ? "Describe your scene - use @ to add characters & locations"
    : "Describe your location";

  return (
    <>
      <div
        className="flex min-w-0 flex-1 items-stretch gap-1 rounded-[24px] bg-[#1a1d1f] p-3 opacity-100"
        style={{
          minHeight: 116,
          maxHeight: 400,
          boxShadow:
            "0 4px 6px rgba(0,0,0,0.16), 0 4px 16px rgba(0,0,0,0.08)",
        }}
      >
        {/* Prompt input + controls */}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
          <PromptInput
            value={prompt}
            onChange={onPromptChange}
            placeholder={placeholder}
          />

          <div className="flex flex-wrap items-center gap-1">
            <ModelSelector value={model} onChange={onModelChange} mode={mode} />

            <AspectRatioDropdown value={aspectRatio} onChange={onAspectRatioChange} />

            {/* Quality Button */}
            <button
              ref={(el) => el && !qualityAnchor && setQualityAnchor(el)}
              type="button"
              onClick={(e) => {
                setQualityAnchor(e.currentTarget);
                setQualityPanelOpen(true);
              }}
              aria-label="Quality"
              className={PILL}
            >
              <Diamond className="size-3.5 text-neutral-400" />
              {quality}
              <ChevronDown className="size-3 text-neutral-500" />
            </button>

            <PillDropdown
              label="Resolution"
              value={resolution}
              options={RESOLUTIONS}
              onChange={onResolutionChange}
              icon={Monitor}
            />
            <BatchStepper value={batch} onChange={onBatchChange} />

            {isVideo && (
              <>
                <button
                  type="button"
                  onClick={() => onSoundChange(!sound)}
                  aria-label="Toggle sound"
                  aria-pressed={sound}
                  className={`${PILL} ${
                    sound ? "text-[#00e5ff]" : "text-neutral-400"
                  }`}
                >
                  {sound ? (
                    <Volume2 className="size-3.5" />
                  ) : (
                    <VolumeX className="size-3.5" />
                  )}
                  {sound ? "On" : "Off"}
                </button>

                <DurationPopover
                  value={duration}
                  durations={durations}
                  onChange={onDurationChange}
                />
              </>
            )}
          </div>
        </div>

        {/* C — Generate */}
        <GenerateButton creditCost={creditCost} onGenerate={onGenerate} mode={mode} />
      </div>

      <QualityPanel
        anchor={qualityAnchor}
        isOpen={qualityPanelOpen}
        onClose={() => setQualityPanelOpen(false)}
        onSelect={onQualityChange}
        selectedQuality={quality}
        availableQualities={["720p", "1080p", "4K"]}
      />
    </>
  );
}
