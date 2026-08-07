"use client";

import { useEffect, useRef, useState } from "react";
import {
  AtSign,
  Blend,
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
import { getAspectRatioDescription, GPT_QUALITY_OPTIONS, GRID_GENERATION_OPTIONS } from "./imageModelCapabilities";

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
  "flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[rgba(217,119,87,0.45)] bg-[#101112] px-2.5 py-1 text-xs font-bold text-white transition-all duration-200 ease-out hover:border-[#D97757] hover:bg-[#181a1d] focus:outline-none";

/** Scrollable option list: the bar stays hidden (globals.css `.hide-scrollbar`)
 *  but wheel/trackpad/touch/keyboard scrolling all keep working. */
const LISTBOX_SCROLL = "hide-scrollbar max-h-[264px] overflow-y-auto";

/**
 * Background for one option row. Keyboard focus is shown with the same quiet
 * fill the mouse uses — no ring and no glow — so the panels read like the model
 * list. Rows also carry `outline-none`, otherwise the browser paints its own
 * white focus ring on top once an option takes real DOM focus.
 */
function optionSurface(selected: boolean, active: boolean, selectedClass = "bg-white/10") {
  if (selected) return selectedClass;
  return active ? "bg-white/[0.06]" : "hover:bg-white/[0.06]";
}

/**
 * Roving-tabindex keyboard navigation for a popover's option list.
 *
 * The active option holds real DOM focus (and is the only tabbable row), so the
 * highlight, the focus ring and what a screen reader announces can never drift
 * apart. Handlers are bound to the popover content, so arrow keys are only ever
 * intercepted while that panel is open — nothing is registered at the document
 * level. Escape-to-close and focus-return-to-trigger are left to Radix, which
 * already does both.
 */
function useListboxNav({
  count,
  selectedIndex,
  open,
  onSelect,
}: {
  count: number;
  selectedIndex: number;
  open: boolean;
  onSelect: (index: number) => void;
}) {
  const initialIndex = selectedIndex < 0 ? 0 : selectedIndex;
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (open) setActiveIndex(initialIndex);
  }, [open, initialIndex]);

  const focusOption = (index: number) => {
    const el = optionRefs.current[index];
    if (!el) return;
    // preventScroll stops the browser nudging the whole page; the explicit
    // scrollIntoView then moves only the list's own scroll container.
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
  };

  const moveTo = (index: number) => {
    setActiveIndex(index);
    focusOption(index);
  };

  /** Radix focuses the panel wrapper on open; take that over so the currently
   *  selected row is focused instead and ArrowDown works without a click. */
  const handleOpenAutoFocus = (event: Event) => {
    event.preventDefault();
    setActiveIndex(initialIndex);
    requestAnimationFrame(() => focusOption(initialIndex));
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (count === 0) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveTo(Math.min(activeIndex + 1, count - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        moveTo(Math.max(activeIndex - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        moveTo(0);
        break;
      case "End":
        event.preventDefault();
        moveTo(count - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        onSelect(activeIndex);
        break;
      default:
        break;
    }
  };

  const getOptionProps = (index: number) => ({
    ref: (el: HTMLButtonElement | null) => {
      optionRefs.current[index] = el;
    },
    tabIndex: index === activeIndex ? 0 : -1,
  });

  return { activeIndex, handleKeyDown, handleOpenAutoFocus, getOptionProps };
}

/** Trigger a11y wiring shared by every option-list popover. */
function triggerA11y(open: boolean) {
  return { "aria-haspopup": "listbox" as const, "aria-expanded": open };
}

function RatioIcon({ ratio, active }: { ratio: AspectRatioChoice; active?: boolean }) {
  if (ratio.value === "Auto") {
    return (
      <span
        className="shrink-0 rounded-[3px] border-[1.5px] border-dashed"
        style={{
          width: `${ratio.width}px`,
          height: `${ratio.height}px`,
          borderColor: active ? "#D97757" : "rgba(255,255,255,0.45)",
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
        borderColor: active ? "#D97757" : "rgba(255,255,255,0.45)",
      }}
    />
  );
}

function CinematicBadge() {
  return (
    <span
      className="ml-1.5 rounded-lg border px-1.5 py-0.5 text-[10px] font-semibold leading-none"
      style={{
        color: "#D97757",
        background: "rgba(217,119,87,0.1)",
        borderColor: "rgba(217,119,87,0.25)",
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
   *  reference (Seedream 4.0, GPT Image, Seedream 4.5, Nano Banana variants). */
  showElementButton?: boolean;
}) {
  return (
    <div className="group flex h-8 shrink-0 items-center rounded-lg border border-[rgba(217,119,87,0.45)] bg-[#101112] px-1 transition-all duration-200 hover:border-[#D97757] hover:bg-[#181a1d]">
      <button
        type="button"
        onClick={onOpenPicker}
        aria-label="Add media"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white transition-colors hover:bg-white/10 active:bg-white/20"
      >
        <Plus className="h-4 w-4" />
      </button>
      {showElementButton && (
        <>
          <span className="h-4 w-px shrink-0 bg-white/20" />
          <button
            type="button"
            onClick={onOpenElementsPicker ?? onOpenPicker}
            aria-label="Add element reference"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white transition-colors hover:bg-white/10 active:bg-white/20"
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
  label = "Select quality",
  id,
  openId,
  onOpenIdChange,
}: {
  value: string;
  onChange: (v: string) => void;
  options?: { value: string; description: string }[];
  /** Panel heading — Grok Imagine's tiers are modes, not quality levels. */
  label?: string;
} & PopoverCoordination) {
  const open = openId === id;
  const select = (index: number) => {
    const opt = options[index];
    if (!opt) return;
    onChange(opt.value);
    onOpenIdChange(null);
  };
  const { activeIndex, handleKeyDown, handleOpenAutoFocus, getOptionProps } = useListboxNav({
    count: options.length,
    selectedIndex: options.findIndex((o) => o.value === value),
    open,
    onSelect: select,
  });

  return (
    <Popover open={open} onOpenChange={(v) => onOpenIdChange(v ? id : null)}>
      <PopoverTrigger asChild>
        <button type="button" className={COMPACT_TRIGGER} {...triggerA11y(open)}>
          {value}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        onKeyDown={handleKeyDown}
        onOpenAutoFocus={handleOpenAutoFocus}
        className={`w-[300px] ${POPOVER_SURFACE}`}
      >
        <p className="px-2 py-1.5 text-xs font-semibold text-white/70">{label}</p>
        <div role="listbox" aria-label={label} className={`flex flex-col gap-0.5 ${LISTBOX_SCROLL}`}>
          {options.map((opt, index) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                {...getOptionProps(index)}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => select(index)}
                className={`flex items-center justify-between rounded-xl px-2.5 py-2 text-left outline-none transition-colors ${optionSurface(
                  selected,
                  open && index === activeIndex,
                )}`}
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-white">{opt.value}</span>
                  <span className="text-xs text-white/45">{opt.description}</span>
                </span>
                {selected && <Check className="h-4 w-4 shrink-0 text-[#D97757]" />}
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
  const open = openId === id;
  const select = (index: number) => {
    const opt = options[index];
    if (!opt) return;
    onChange(opt.value);
    onOpenIdChange(null);
  };
  const { activeIndex, handleKeyDown, handleOpenAutoFocus, getOptionProps } = useListboxNav({
    count: options.length,
    selectedIndex: options.findIndex((o) => o.value === value),
    open,
    onSelect: select,
  });

  return (
    <Popover open={open} onOpenChange={(v) => onOpenIdChange(v ? id : null)}>
      <PopoverTrigger asChild>
        <button type="button" className={COMPACT_TRIGGER} {...triggerA11y(open)}>
          {value}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        onKeyDown={handleKeyDown}
        onOpenAutoFocus={handleOpenAutoFocus}
        className={`${compactWidth ? "w-[160px]" : "w-[300px]"} ${POPOVER_SURFACE}`}
      >
        {detailed && (
          <p className="px-2 py-1.5 text-xs font-semibold text-white/70">{label}</p>
        )}
        <div role="listbox" aria-label={label} className={`flex flex-col gap-0.5 ${LISTBOX_SCROLL}`}>
          {options.map((opt, index) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                {...getOptionProps(index)}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => select(index)}
                className={`flex items-center justify-between rounded-xl px-2.5 py-2 text-left outline-none transition-colors ${optionSurface(
                  selected,
                  open && index === activeIndex,
                  lime ? "bg-[rgba(255,255,255,0.08)]" : "bg-white/10",
                )}`}
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
  plainRows,
  id,
  openId,
  onOpenIdChange,
}: {
  value: string;
  onChange: (v: string) => void;
  options: AspectRatioChoice[];
  /** GPT Image 2's large 40px trigger; otherwise the 28px compact trigger. */
  large?: boolean;
  /** Multi Reference's panel: value-only rows (no Portrait/Landscape/Custom
   *  subtitle) and a neutral keyboard ring instead of the orange one. */
  plainRows?: boolean;
} & PopoverCoordination) {
  const active = options.find((r) => r.value === value) ?? options[0];
  const open = openId === id;
  const select = (index: number) => {
    const ratio = options[index];
    if (!ratio) return;
    onChange(ratio.value);
    onOpenIdChange(null);
  };
  const { activeIndex, handleKeyDown, handleOpenAutoFocus, getOptionProps } = useListboxNav({
    count: options.length,
    selectedIndex: options.findIndex((r) => r.value === value),
    open,
    onSelect: select,
  });

  return (
    <Popover open={open} onOpenChange={(v) => onOpenIdChange(v ? id : null)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={COMPACT_TRIGGER}
          {...triggerA11y(open)}
        >
          <RatioIcon ratio={active} />
          {active.value}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        onKeyDown={handleKeyDown}
        onOpenAutoFocus={handleOpenAutoFocus}
        className="z-[100000] overflow-hidden rounded-2xl border border-white/10 bg-[#141618]/95 p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.65)] backdrop-blur-xl pointer-events-auto transition-all duration-200 ease-out origin-bottom animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 w-[220px]"
      >
        <p className="px-2 py-1.5 text-xs font-semibold text-white/70">Aspect ratio</p>
        <div role="listbox" aria-label="Select ratio" className={`flex flex-col gap-0.5 ${LISTBOX_SCROLL}`}>
          {options.map((ratio, index) => {
            const selected = ratio.value === value;
            return (
              <button
                key={ratio.value}
                {...getOptionProps(index)}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => select(index)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none transition-all duration-150 ${
                  selected
                    ? "bg-white/10 font-semibold text-white"
                    : open && index === activeIndex
                      ? "bg-white/5 text-white"
                      : "text-white/80 hover:bg-white/5 hover:text-white"
                }`}
              >
                <RatioIcon ratio={ratio} active={selected} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">
                    {ratio.value}
                  </span>
                  {!plainRows && (
                    <span className="block truncate text-xs text-white/50">
                      {ratio.description ?? getAspectRatioDescription(ratio.value)}
                    </span>
                  )}
                </span>
                {selected && <Check className="size-4 shrink-0 text-[#D97757]" />}
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
    <div className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-[rgba(217,119,87,0.45)] bg-[#101112] px-1.5 transition-all duration-200 hover:border-[#D97757] hover:bg-[#181a1d]">
      <button
        type="button"
        disabled={value <= 1}
        onClick={() => onChange(Math.max(1, value - 1))}
        aria-label="Decrease batch size"
        className="flex h-6 w-6 items-center justify-center rounded text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/25 disabled:hover:bg-transparent"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="w-8 shrink-0 text-center text-xs font-bold text-white">
        {value}
        <span className="text-white/40">/{max}</span>
      </span>
      <button
        type="button"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label="Increase batch size"
        className="flex h-6 w-6 items-center justify-center rounded text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/25 disabled:hover:bg-transparent"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Unlimited switch (Seedream 5.0 Pro)                                  */
/* ------------------------------------------------------------------ */

export function UnlimitedToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-[rgba(217,119,87,0.45)] bg-[#101112] px-2.5 text-xs font-bold text-white transition-all duration-200 hover:border-[#D97757] hover:bg-[#181a1d]">
      Unlimited
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Unlimited"
        onClick={onToggle}
        className="relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors"
        style={{ background: enabled ? "#22c55e" : "rgba(255,255,255,0.18)" }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute h-3 w-3 rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: enabled ? "translateX(13px)" : "translateX(2px)" }}
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Thinking selector (Nano Banana 2 Lite)                               */
/* ------------------------------------------------------------------ */

export function ThinkingPopover({
  value,
  onChange,
  options,
  id,
  openId,
  onOpenIdChange,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
} & PopoverCoordination) {
  const open = openId === id;
  const select = (index: number) => {
    const opt = options[index];
    if (opt === undefined) return;
    onChange(opt);
    onOpenIdChange(null);
  };
  const { activeIndex, handleKeyDown, handleOpenAutoFocus, getOptionProps } = useListboxNav({
    count: options.length,
    selectedIndex: options.indexOf(value),
    open,
    onSelect: select,
  });

  return (
    <Popover open={open} onOpenChange={(v) => onOpenIdChange(v ? id : null)}>
      <PopoverTrigger asChild>
        <button type="button" className={COMPACT_TRIGGER} {...triggerA11y(open)}>
          {value}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        onKeyDown={handleKeyDown}
        onOpenAutoFocus={handleOpenAutoFocus}
        className={`w-[200px] ${POPOVER_SURFACE}`}
      >
        <p className="px-2 py-1.5 text-xs font-semibold text-white/70">Thinking</p>
        <div role="listbox" aria-label="Thinking" className={`flex flex-col gap-0.5 ${LISTBOX_SCROLL}`}>
          {options.map((opt, index) => {
            const selected = opt === value;
            return (
              <button
                key={opt}
                {...getOptionProps(index)}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => select(index)}
                className={`flex items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm font-medium text-white outline-none transition-colors ${optionSurface(
                  selected,
                  open && index === activeIndex,
                )}`}
              >
                {opt}
                {selected && <Check className="h-4 w-4 shrink-0 text-[#D97757]" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Draw trigger (Nano Banana)                                           */
/* ------------------------------------------------------------------ */

export function DrawToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      className={`${COMPACT_TRIGGER} ${enabled ? "border-[#D97757] bg-[#181a1d]" : ""}`}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 opacity-75">
        <path
          d="M7.55929 15.125C6.80178 14.9323 5.23971 14.4539 3.55888 12.743C0.749296 9.88327 0.0300494 5.97875 1.95239 4.02207C3.53188 2.41436 6.59253 2.53853 9.125 4.25M11.75 6.875C13.9356 9.44282 14.5373 11.8324 12.8604 13.1979C11.6042 14.2208 10.0146 13.0379 9.08705 12.126M6.875 9.125H8.71079C8.976 9.125 9.23036 9.01964 9.41789 8.83211L14.4156 3.83439C14.807 3.44298 14.806 2.80805 14.4133 2.4179L13.5684 1.57841C13.1772 1.1897 12.5451 1.1911 12.1556 1.58154L7.16703 6.58225C6.98002 6.76972 6.875 7.02371 6.875 7.2885V9.125Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Draw
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Vector mode switch (Recraft V4.1)                                    */
/* ------------------------------------------------------------------ */

export function VectorModeToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[rgba(217,119,87,0.45)] bg-[#101112] px-2.5 text-xs font-bold text-white transition-all duration-200 hover:border-[#D97757] hover:bg-[#181a1d]">
      <Info className="h-3.5 w-3.5 opacity-60" />
      Vector mode
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Vector mode"
        onClick={onToggle}
        className="relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors"
        style={{ background: enabled ? "#22c55e" : "rgba(255,255,255,0.18)" }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute h-3 w-3 rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: enabled ? "translateX(13px)" : "translateX(2px)" }}
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Color transfer trigger (Recraft V4.1)                                */
/* ------------------------------------------------------------------ */

export function ColorTransferButton({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={`${COMPACT_TRIGGER} ${active ? "border-[#D97757] bg-[#181a1d]" : ""}`}
    >
      <Blend className="h-4 w-4 opacity-75" />
      Color transfer
    </button>
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
  const open = openId === id;
  const select = (index: number) => {
    const opt = GRID_GENERATION_OPTIONS[index];
    if (opt === undefined) return;
    onChange(opt);
    onOpenIdChange(null);
  };
  const { activeIndex, handleKeyDown, handleOpenAutoFocus, getOptionProps } = useListboxNav({
    count: GRID_GENERATION_OPTIONS.length,
    selectedIndex: GRID_GENERATION_OPTIONS.indexOf(value as (typeof GRID_GENERATION_OPTIONS)[number]),
    open,
    onSelect: select,
  });

  return (
    <Popover open={open} onOpenChange={(v) => onOpenIdChange(v ? id : null)}>
      <PopoverTrigger asChild>
        <button type="button" className={COMPACT_TRIGGER} {...triggerA11y(open)}>
          <Grid2x2 className="h-4 w-4" />
          {value}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        onKeyDown={handleKeyDown}
        onOpenAutoFocus={handleOpenAutoFocus}
        className={`w-[180px] ${POPOVER_SURFACE}`}
      >
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <p className="text-xs font-semibold text-white/70">Grid generation</p>
          <Info className="h-3.5 w-3.5 text-white/40" />
        </div>
        <div role="listbox" aria-label="Grid generation" className={`flex flex-col gap-0.5 ${LISTBOX_SCROLL}`}>
          {GRID_GENERATION_OPTIONS.map((opt, index) => {
            const selected = opt === value;
            return (
              <button
                key={opt}
                {...getOptionProps(index)}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => select(index)}
                className={`flex items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm font-medium text-white outline-none transition-colors ${optionSurface(
                  selected,
                  open && index === activeIndex,
                )}`}
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
