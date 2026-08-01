"use client";

import {
  AtSign,
  Check,
  ChevronDown,
  Grid2x2,
  Info,
  Minus,
  Plus,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AspectRatioChoice, ResolutionChoice } from "./imageModelCapabilities";
import { GPT_QUALITY_OPTIONS, GRID_GENERATION_OPTIONS } from "./imageModelCapabilities";

const LIME = "rgb(209, 254, 23)";

/** Shared controlled-open plumbing so only one popover in a control row is
 *  ever open at a time (clicking a different trigger closes the previous one). */
export interface PopoverCoordination {
  id: string;
  openId: string | null;
  onOpenIdChange: (id: string | null) => void;
}

/** Shared translucent dark popover surface matching the compact control language. */
const POPOVER_SURFACE =
  "rounded-2xl border border-white/10 bg-[#141618]/95 p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.65)] backdrop-blur-xl animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 duration-200";

/** 32px-tall h-8 trigger with crisp thin orange border ring shared by every image control. */
const COMPACT_TRIGGER =
  "flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[rgba(217,119,87,0.45)] bg-[#101112] px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out hover:border-[#D97757] hover:bg-[#181a1d] hover:shadow-[0_0_10px_rgba(217,119,87,0.20)] focus:outline-none focus:ring-2 focus:ring-[#D97757]";

function RatioIcon({ ratio, active }: { ratio: AspectRatioChoice; active?: boolean }) {
  if (ratio.value === "Auto") {
    return (
      <span
        className="shrink-0 rounded-[3px] border-[1.5px] border-dashed"
        style={{
          width: `${ratio.width}px`,
          height: `${ratio.height}px`,
          borderColor: active ? LIME : "rgba(255,255,255,0.45)",
        }}
      />
    );
  }
  return (
    <span
      className="shrink-0 rounded-[2px] border-[1.5px]"
      style={{
        width: `${ratio.width}px`,
        height: `${ratio.height}px`,
        borderColor: active ? LIME : "rgba(255,255,255,0.45)",
      }}
    />
  );
}

function CinematicBadge() {
  return (
    <span
      className="ml-1.5 rounded-lg border px-1.5 py-0.5 text-[10px] font-semibold leading-none"
      style={{
        color: "#d1fe17",
        background: "rgba(209,254,23,0.1)",
        borderColor: "rgba(209,254,23,0.25)",
      }}
    >
      Cinematic
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Plus (assets) + Reference (@) compact button group                  */
/* ------------------------------------------------------------------ */

export function AssetsButtonGroup({
  onOpenPicker,
  onOpenElementsPicker,
  showElementButton = true,
}: {
  onOpenPicker: () => void;
  /** Opens the shared Assets Picker with its Elements tab active instead of
   *  Uploads. Falls back to `onOpenPicker` when omitted. */
  onOpenElementsPicker?: () => void;
  /** Set false for models that only expose the plus button, no @ element
   *  reference (Seedream 4.0). */
  showElementButton?: boolean;
}) {
  return (
    <div className="group flex h-7 shrink-0 items-center rounded-lg bg-white/5 px-0.5">
      <button
        type="button"
        onClick={onOpenPicker}
        aria-label="Add media"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 active:bg-white/20"
      >
        <Plus className="h-4 w-4" />
      </button>
      {showElementButton && (
        <>
          <span className="h-4 w-px shrink-0 bg-white/10 transition-opacity duration-150 group-hover:opacity-0" />
          <button
            type="button"
            onClick={onOpenElementsPicker ?? onOpenPicker}
            aria-label="Add element reference"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 active:bg-white/20"
          >
            <AtSign className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Quality (GPT Image 2)                                                */
/* ------------------------------------------------------------------ */

export function QualityPopover({
  value,
  onChange,
  options = GPT_QUALITY_OPTIONS,
  id,
  openId,
  onOpenIdChange,
}: {
  value: string;
  onChange: (v: string) => void;
  options?: { value: string; description: string }[];
} & PopoverCoordination) {
  return (
    <Popover open={openId === id} onOpenChange={(v) => onOpenIdChange(v ? id : null)}>
      <PopoverTrigger asChild>
        <button type="button" className={COMPACT_TRIGGER}>
          {value}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className={`w-[300px] ${POPOVER_SURFACE}`}
      >
        <p className="px-2 py-1.5 text-xs font-semibold text-white/70">Select quality</p>
        <div role="listbox" className="flex flex-col gap-0.5">
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(opt.value);
                  onOpenIdChange(null);
                }}
                className={`flex items-center justify-between rounded-xl px-2.5 py-2 text-left transition-colors ${
                  selected ? "bg-white/10" : "hover:bg-white/[0.06]"
                }`}
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-white">{opt.value}</span>
                  <span className="text-xs text-white/45">{opt.description}</span>
                </span>
                {selected && <Check className="h-4 w-4 shrink-0 text-white" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Resolution (simple + detailed variants)                             */
/* ------------------------------------------------------------------ */

export function ResolutionPopover({
  value,
  onChange,
  options,
  detailed,
  compactWidth,
  lime,
  label = "Select resolution",
  id,
  openId,
  onOpenIdChange,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ResolutionChoice[];
  detailed?: boolean;
  /** Soul Cinema's simple resolution popup is only 160px wide. */
  compactWidth?: boolean;
  /** Use lime checkmarks/selection (Soul Cinema). */
  lime?: boolean;
  /** Header caption shown when `detailed` — Seedream 5.0 Pro uses "QUALITY". */
  label?: string;
} & PopoverCoordination) {
  return (
    <Popover open={openId === id} onOpenChange={(v) => onOpenIdChange(v ? id : null)}>
      <PopoverTrigger asChild>
        <button type="button" className={COMPACT_TRIGGER}>
          {value}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className={`${compactWidth ? "w-[160px]" : "w-[300px]"} ${POPOVER_SURFACE}`}
      >
        {detailed && (
          <p className="px-2 py-1.5 text-xs font-semibold text-white/70">{label}</p>
        )}
        <div role="listbox" className="flex flex-col gap-0.5">
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(opt.value);
                  onOpenIdChange(null);
                }}
                className={`flex items-center justify-between rounded-xl px-2.5 py-2 text-left transition-colors ${
                  selected
                    ? lime
                      ? "bg-[rgba(255,255,255,0.08)]"
                      : "bg-white/10"
                    : "hover:bg-white/[0.06]"
                }`}
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-white">{opt.value}</span>
                  {opt.description && (
                    <span className="text-xs text-white/45">{opt.description}</span>
                  )}
                </span>
                {selected && (
                  <Check
                    className="h-4 w-4 shrink-0"
                    style={{ color: lime ? LIME : "#fff" }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Aspect ratio (simple GPT / cinematic Soul Cinema & Studio Digital)   */
/* ------------------------------------------------------------------ */

export function AspectRatioPopover({
  value,
  onChange,
  options,
  large,
  id,
  openId,
  onOpenIdChange,
}: {
  value: string;
  onChange: (v: string) => void;
  options: AspectRatioChoice[];
  /** GPT Image 2's large 40px trigger; otherwise the 28px compact trigger. */
  large?: boolean;
} & PopoverCoordination) {
  const active = options.find((r) => r.value === value) ?? options[0];
  return (
    <Popover open={openId === id} onOpenChange={(v) => onOpenIdChange(v ? id : null)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={
            large
              ? "flex h-10 shrink-0 items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 text-xs font-medium text-white/85 transition-colors hover:bg-white/[0.08]"
              : COMPACT_TRIGGER
          }
        >
          <RatioIcon ratio={active} />
          {active.value}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className="w-[200px] rounded-2xl p-2"
        style={{
          background: "rgba(35,38,42,0.75)",
          border: "1px solid rgba(217,217,217,0.04)",
          backdropFilter: "blur(40px)",
          WebkitBackdropFilter: "blur(40px)",
          boxShadow: "0 4px 4px rgba(0,0,0,0.12)",
        }}
      >
        <div role="listbox" className="flex flex-col gap-1">
          {options.map((ratio) => {
            const selected = ratio.value === value;
            return (
              <button
                key={ratio.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(ratio.value);
                  onOpenIdChange(null);
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[#131517]"
                style={selected ? { background: "#131517" } : undefined}
              >
                <RatioIcon ratio={ratio} active={selected} />
                <span className="truncate text-[13px] font-medium text-white">{ratio.value}</span>
                {ratio.cinematic && <CinematicBadge />}
                {selected && (
                  <Check className="ml-auto h-4 w-4 shrink-0" style={{ color: LIME }} />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Batch size counter                                                   */
/* ------------------------------------------------------------------ */

export function BatchSizeCounter({
  value,
  onChange,
  max = 4,
}: {
  value: number;
  onChange: (v: number) => void;
  max?: number;
}) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-1 rounded-lg bg-white/5 px-1">
      <button
        type="button"
        disabled={value <= 1}
        onClick={() => onChange(Math.max(1, value - 1))}
        aria-label="Decrease batch size"
        className="flex h-5 w-5 items-center justify-center rounded text-white/80 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/25 disabled:hover:bg-transparent"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="w-8 shrink-0 text-center text-xs font-medium text-white">
        {value}
        <span className="text-white/40">/{max}</span>
      </span>
      <button
        type="button"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label="Increase batch size"
        className="flex h-5 w-5 items-center justify-center rounded text-white/80 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/25 disabled:hover:bg-transparent"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Grid generation (Studio Digital S35)                                 */
/* ------------------------------------------------------------------ */

export function GridGenerationPopover({
  value,
  onChange,
  id,
  openId,
  onOpenIdChange,
}: {
  value: string;
  onChange: (v: string) => void;
} & PopoverCoordination) {
  return (
    <Popover open={openId === id} onOpenChange={(v) => onOpenIdChange(v ? id : null)}>
      <PopoverTrigger asChild>
        <button type="button" className={COMPACT_TRIGGER}>
          <Grid2x2 className="h-4 w-4" />
          {value}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className={`w-[180px] ${POPOVER_SURFACE}`}
      >
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <p className="text-xs font-semibold text-white/70">Grid generation</p>
          <Info className="h-3.5 w-3.5 text-white/40" />
        </div>
        <div role="listbox" className="flex flex-col gap-0.5">
          {GRID_GENERATION_OPTIONS.map((opt) => {
            const selected = opt === value;
            return (
              <button
                key={opt}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(opt);
                  onOpenIdChange(null);
                }}
                className={`flex items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm font-medium text-white transition-colors ${
                  selected ? "bg-white/10" : "hover:bg-white/[0.06]"
                }`}
              >
                {opt}
                {selected && <Check className="h-4 w-4 shrink-0" style={{ color: LIME }} />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* WAN 2.2 enhancement On/Off toggle                                    */
/* ------------------------------------------------------------------ */

export function EnhancementToggle({
  enabled,
  onToggle,
  icon,
}: {
  enabled: boolean;
  onToggle: () => void;
  /** Overrides the default Sparkles icon — WAN 2.2 uses the magic-wand icon. */
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      className={`${COMPACT_TRIGGER} w-[68px] justify-center`}
    >
      {icon ?? <Sparkles className="h-4 w-4" style={{ color: enabled ? LIME : undefined }} />}
      {enabled ? "On" : "Off"}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Flux.2 Flex compact settings/sliders trigger + popover               */
/* ------------------------------------------------------------------ */

export interface FluxFlexSettings {
  strength: number;
  guidance: number;
}

function SettingsSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-2 py-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-white/70">{label}</span>
        <span className="text-white/45">{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-[rgb(209,254,23)]"
      />
    </div>
  );
}

export function SettingsPopover({
  settings,
  onChange,
  id,
  openId,
  onOpenIdChange,
}: {
  settings: FluxFlexSettings;
  onChange: (settings: FluxFlexSettings) => void;
} & PopoverCoordination) {
  return (
    <Popover open={openId === id} onOpenChange={(v) => onOpenIdChange(v ? id : null)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Settings"
          className="gen-panel-settings-popup-trigger flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/5 px-1.5 text-white/85 transition-colors hover:bg-white/10 active:bg-white/20"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className={`w-[260px] ${POPOVER_SURFACE}`}
      >
        <p className="px-2 py-1.5 text-xs font-semibold text-white/70">Settings</p>
        <div className="flex flex-col gap-1">
          <SettingsSlider
            label="Strength"
            value={settings.strength}
            onChange={(strength) => onChange({ ...settings, strength })}
          />
          <SettingsSlider
            label="Guidance"
            value={settings.guidance}
            onChange={(guidance) => onChange({ ...settings, guidance })}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Labeled toggle switch (Recraft V4.1 Utility's Vector mode / Color    */
/* transfer) — icon + label + switch pill, distinct from the plain      */
/* On/Off text button used by EnhancementToggle.                       */
/* ------------------------------------------------------------------ */

export function LabeledToggle({
  label,
  enabled,
  onToggle,
  icon,
  disabled,
  badge,
  hideSwitch,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** Small lime caption pill after the label (Cinematic Locations' "New"). */
  badge?: string;
  /** Omit the On/Off switch pill — used when the trigger just opens a
   *  dialog and selection state is shown inside that dialog instead
   *  (Cinematic Locations' Color transfer button). */
  hideSwitch?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={enabled}
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-white/5 px-2 text-xs font-medium text-white/85 transition-colors ${
        disabled ? "cursor-not-allowed opacity-40" : "hover:bg-white/10"
      }`}
    >
      {icon ?? <Info className="h-3.5 w-3.5 opacity-60" />}
      <span className="whitespace-nowrap">{label}</span>
      {badge && (
        <span
          className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-none"
          style={{ color: LIME, background: "rgba(209,254,23,0.12)" }}
        >
          {badge}
        </span>
      )}
      {!hideSwitch && (
        <span
          className="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors"
          style={{ background: enabled ? LIME : "rgba(255,255,255,0.15)" }}
        >
          <span
            className="absolute h-3 w-3 rounded-full bg-white transition-transform"
            style={{ transform: enabled ? "translateX(13px)" : "translateX(2px)" }}
          />
        </span>
      )}
    </button>
  );
}
