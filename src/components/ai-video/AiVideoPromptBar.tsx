"use client";

import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Clock, Monitor, Plus, Sparkles, Volume2 } from "lucide-react";
import { useListboxNav } from "@/hooks/useListboxNav";
import { useToolbarNav } from "@/hooks/useToolbarNav";
import MarketingModelSelector from "@/components/marketing-studio/MarketingModelSelector";
import {
  AI_VIDEO_CATEGORIES,
  AI_VIDEO_CONTROLS,
  AI_VIDEO_DEFAULT_MODEL,
  AI_VIDEO_FALLBACK_MODEL,
  type AiVideoControlSpec,
} from "./aiVideoModels";

function AspectIcon({ className = "" }: { className?: string }) {
  return <span className={`block h-3 w-4 rounded-[3px] border border-current ${className}`} />;
}

/** Same option-popover behaviour the /image and /generate control rows use:
 *  selection follows focus, Escape restores what the panel opened with. */
function OptionPopover({
  label,
  value,
  options,
  onChange,
  icon,
  columns = 1,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  icon: React.ReactNode;
  columns?: 1 | 2;
}) {
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.indexOf(value));

  const nav = useListboxNav({
    count: options.length,
    selectedIndex,
    open,
    onSelect: (index) => {
      const next = options[index];
      if (!next) return;
      onChange(next);
      setOpen(false);
    },
    onActivate: (index) => {
      const next = options[index];
      if (next) onChange(next);
    },
  });

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${label}: ${value}`}
          className={`flex h-8 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-semibold text-white transition-colors focus:outline-none ${
            open
              ? "border-[#D97757] bg-[#181a1d]"
              : "border-white/[0.08] bg-[#101112] hover:border-[#D97757] hover:bg-[#181a1d]"
          }`}
        >
          <span className="text-white/80">{icon}</span>
          <span>{value}</span>
          <ChevronDown className={`size-3.5 text-white/45 transition-transform ${open ? "rotate-180 text-[#D97757]" : ""}`} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          onKeyDown={nav.handleKeyDown}
          onOpenAutoFocus={nav.handleOpenAutoFocus}
          onEscapeKeyDown={nav.handleEscapeKeyDown}
          className={`z-[100000] rounded-2xl border border-white/[0.08] bg-[rgba(19,21,23,0.94)] p-3 shadow-[0_20px_55px_rgba(0,0,0,0.5)] outline-none backdrop-blur-[24px] ${
            columns === 2 ? "w-[190px]" : "w-[116px]"
          }`}
        >
          <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wide text-white/45">{label}</div>
          <div className={columns === 2 ? "grid grid-cols-2 gap-1" : "space-y-1"} role="listbox" aria-label={label}>
            {options.map((option, index) => {
              const optionProps = nav.getOptionProps(index);
              const marked = nav.activeIndex === index;
              const selected = value === option;
              return (
                <button
                  key={option}
                  ref={optionProps.ref}
                  tabIndex={optionProps.tabIndex}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  className={`flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold outline-none transition-colors ${
                    marked || selected ? "bg-white/[0.08] text-white" : "bg-transparent text-white/78 hover:bg-white/[0.05]"
                  }`}
                >
                  <span className={`flex size-4 items-center justify-center rounded border ${selected ? "border-[#D97757] text-[#D97757]" : "border-white/40 text-transparent"}`}>
                    {selected && <Check className="size-3" />}
                  </span>
                  <span>{option}</span>
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A control the model exposes but that has no options to pick from —
 *  shown so the row still reflects what the model actually supports. */
function StaticControl({ label, icon }: { label: string; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-white/[0.08] bg-[#101112] px-2.5 text-xs font-semibold text-white transition-colors hover:border-[#D97757] hover:bg-[#181a1d] focus:outline-none"
    >
      {icon && <span className="text-[#D97757]">{icon}</span>}
      <span className="max-w-[150px] truncate">{label}</span>
    </button>
  );
}

/** Duration list for a model: either its explicit values, or every whole
 *  second across a slider range (kept as a list so the control behaves the
 *  same either way). */
function durationOptions(spec: AiVideoControlSpec): string[] {
  if (spec.durations) return spec.durations;
  if (spec.durationRange) {
    const [min, max] = spec.durationRange;
    const steps = [min, 5, 8, 10, 12, 15, 20, 25, max].filter((n, i, arr) => n >= min && n <= max && arr.indexOf(n) === i);
    return steps.sort((a, b) => a - b).map((n) => `${n}s`);
  }
  return [];
}

/**
 * Sized and styled after Marketing Studio's ComposerBar (rounded-[24px],
 * orange glow border, same GENERATE button), with the AI Video model
 * selector and a control row that rebuilds itself from whatever the
 * selected model actually supports. No Image/Video mode toggle — this page
 * is video only.
 */
export default function AiVideoPromptBar() {
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState(AI_VIDEO_DEFAULT_MODEL);
  const toolbarNav = useToolbarNav();

  const spec = AI_VIDEO_CONTROLS[selectedModel] ?? {};
  const durations = useMemo(() => durationOptions(spec), [spec]);

  const [duration, setDuration] = useState(durations[0] ?? "");
  const [resolution, setResolution] = useState(spec.resolutions?.[0] ?? "");
  const [ratio, setRatio] = useState(spec.ratios?.[0] ?? "");

  // Switching model rebuilds the row, so any value the new model doesn't
  // offer has to snap back to one it does.
  const handleModelChange = (name: string) => {
    const next = AI_VIDEO_CONTROLS[name] ?? {};
    setSelectedModel(name);
    setDuration(durationOptions(next)[0] ?? "");
    setResolution(next.resolutions?.[0] ?? "");
    setRatio(next.ratios?.[0] ?? "");
  };

  return (
    <div
      className="relative mx-auto flex w-full max-w-[900px] items-stretch gap-3 rounded-[24px] p-3 animate-pulse-orange-white"
      style={{
        minHeight: 116,
        background:
          "linear-gradient(180deg, rgba(217,119,87,0.28) 0%, rgba(217,119,87,0.16) 55%, rgba(217,119,87,0.10) 100%), #141414",
        border: "1px solid rgba(217, 119, 87, 0.45)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.15), inset 0 0 25px rgba(217,119,87,0.18), 0 10px 30px rgba(0,0,0,0.5)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-end gap-3">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe any visual idea. We will generate a video."
          className="min-h-[32px] w-full bg-transparent pt-1 text-sm text-white outline-none placeholder:text-white/55"
        />

        <div
          {...toolbarNav.containerProps}
          className="prompt-control-row hide-scrollbar flex min-w-0 items-center gap-1.5 overflow-x-auto"
        >
          <button
            type="button"
            aria-label="Add media"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#101112] text-white/90 transition-colors hover:border-[#D97757] hover:bg-[#181a1d]"
          >
            <Plus className="size-4" />
          </button>

          <MarketingModelSelector
            ariaLabel="AI Video models"
            selected={selectedModel}
            fallback={AI_VIDEO_FALLBACK_MODEL}
            categories={AI_VIDEO_CATEGORIES}
            onSelect={handleModelChange}
            triggerMinWidth="168px"
          />

          {spec.ratios && spec.ratios.length > 0 && (
            <OptionPopover
              label="Aspect Ratio"
              value={ratio}
              options={spec.ratios}
              onChange={setRatio}
              icon={<AspectIcon className="text-white/80" />}
              columns={spec.ratios.length > 4 ? 2 : 1}
            />
          )}

          {spec.resolutions && spec.resolutions.length > 0 && (
            <OptionPopover
              label="Resolution"
              value={resolution}
              options={spec.resolutions}
              onChange={setResolution}
              icon={<Monitor className="size-4" />}
            />
          )}

          {durations.length > 0 && (
            <OptionPopover
              label="Duration"
              value={duration}
              options={durations}
              onChange={setDuration}
              icon={<Clock className="size-4" />}
            />
          )}

          {spec.audio && <StaticControl label="Sound on" icon={<Volume2 className="size-4" />} />}
          {spec.multiReference && <StaticControl label={`References (${spec.multiReference})`} />}
          {spec.startFrame && <StaticControl label="Start frame" />}
          {spec.endFrame && <StaticControl label="End frame" />}
          {spec.referenceVideo && <StaticControl label="Reference video" />}
          {spec.multiShot && <StaticControl label="Multi-shot" />}
          {spec.elements && <StaticControl label="Elements on" />}
          {spec.bitrate && <StaticControl label="Bitrate: High" />}
          {spec.promptEnhance && <StaticControl label="Enhance on" icon={<Sparkles className="size-4" />} />}
          {spec.presetDriven && <StaticControl label="Camera presets" />}
          {spec.advancedSettings && <StaticControl label="Advanced settings" />}
        </div>
      </div>

      <button
        type="button"
        className="flex h-20 w-[120px] shrink-0 flex-col items-center justify-center self-end rounded-xl bg-[linear-gradient(135deg,#D97757_0%,#B85A3E_100%)] text-sm font-bold text-black transition-opacity hover:opacity-90"
      >
        <span>GENERATE</span>
        <div className="mt-1 text-[10px]">✦ {spec.credits ?? 240}</div>
      </button>
    </div>
  );
}
