"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { Clock, Volume2, VolumeX } from "lucide-react";
import { useListboxNav } from "@/hooks/useListboxNav";

/**
 * The prompt bar's own glass, reused by every panel that opens out of it so
 * the whole control surface reads as one material. Heavier blur than the bar
 * itself because these float over playing video — the bar only ever sits on
 * the page background.
 */
export const GLASS_PANEL =
  "border border-white/[0.06] bg-white/[0.05] backdrop-blur-[24px] backdrop-saturate-150";

/** Shared look for every pill in the prompt bar's control row. */
const CONTROL_CLASS =
  "flex h-8 shrink-0 items-center gap-1 rounded-lg border border-white/[0.04] bg-white/5 px-2 transition-colors hover:bg-white/10 focus:outline-none";
const CONTROL_LABEL = "px-1 text-xs font-semibold text-white";

/* ------------------------------------------------------------------ *
 * Aspect ratio
 * ------------------------------------------------------------------ */

/** Ratio glyphs. The reference draws `Auto` as crop marks rather than a
 *  rectangle, and reuses one rectangle across ratios of the same
 *  orientation — kept here so the row reads the same way. */
function RatioIcon({ ratio }: { ratio: string }) {
  if (ratio === "Auto") {
    return (
      <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      </svg>
    );
  }

  const [w, h] = ratio.split(":").map(Number);
  const wide = w >= h;
  // One box per orientation, scaled to fit a 16x16 viewport.
  const boxW = wide ? 14 : 14 * (w / h);
  const boxH = wide ? 14 * (h / w) : 14;

  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x={(16 - boxW) / 2} y={(16 - boxH) / 2} width={boxW} height={boxH} rx="1.6" />
    </svg>
  );
}

export function AspectRatioControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
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
        <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`Aspect ratio: ${value}`} className={CONTROL_CLASS}>
          <RatioIcon ratio={value} />
          <span className={CONTROL_LABEL}>{value}</span>
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
          className={`z-[100000] w-45 overflow-hidden rounded-[20px] outline-none ${GLASS_PANEL}`}
        >
          <div className="px-3 py-2 text-xs font-medium text-zinc-500">ASPECT RATIO</div>
          <div className="grid grid-cols-2" role="listbox" aria-label="Aspect ratio">
            {options.map((option, index) => {
              const optionProps = nav.getOptionProps(index);
              const selected = value === option;
              const marked = nav.activeIndex === index;
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
                  // No checkmark here — the reference marks the current ratio
                  // with a fill alone.
                  className={`flex items-center justify-start gap-1.5 border border-white/[0.02] px-3 py-2 text-xs font-medium text-white outline-none transition-colors ${
                    selected || marked ? "bg-white/5" : "hover:bg-white/5"
                  }`}
                >
                  <RatioIcon ratio={option} />
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

/* ------------------------------------------------------------------ *
 * Duration — a slider for range models, a list for fixed-step ones
 * ------------------------------------------------------------------ */

export function DurationSliderControl({
  value,
  min,
  max,
  onChange,
}: {
  value: string;
  min: number;
  max: number;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const seconds = Number.parseInt(value, 10) || min;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" aria-expanded={open} aria-label={`Duration: ${value}`} className={CONTROL_CLASS}>
          <Clock className="size-4 shrink-0 text-white/70" />
          <span className={CONTROL_LABEL}>{value}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          className={`z-[100000] w-[334px] rounded-2xl p-2 shadow-[0_4px_4px_rgba(0,0,0,0.12)] outline-none ${GLASS_PANEL}`}
        >
          <div className="px-1 pb-1 text-xs font-medium text-white/45">Duration</div>
          <div className="relative h-9 overflow-hidden rounded-md bg-white/5">
            <div
              className="absolute inset-y-0 left-0 bg-white/10"
              style={{ width: `${((seconds - min) / Math.max(1, max - min)) * 100}%` }}
            />
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-white">
              {value}
            </span>
            <input
              type="range"
              min={min}
              max={max}
              step={1}
              value={seconds}
              aria-label="Duration in seconds"
              onChange={(event) => onChange(`${event.target.value}s`)}
              className="absolute inset-0 h-full w-full cursor-grab appearance-none bg-transparent opacity-0 active:cursor-grabbing"
            />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function DurationListControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
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
        <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`Duration: ${value}`} className={CONTROL_CLASS}>
          <Clock className="size-4 shrink-0 text-white/70" />
          <span className={CONTROL_LABEL}>{value}</span>
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
          className={`z-[100000] w-45 overflow-hidden rounded-[20px] outline-none ${GLASS_PANEL}`}
        >
          <div className="px-3 py-2 text-xs font-medium text-zinc-500">DURATION</div>
          <div className="grid grid-cols-1" role="listbox" aria-label="Duration">
            {options.map((option, index) => {
              const optionProps = nav.getOptionProps(index);
              const selected = value === option;
              const marked = nav.activeIndex === index;
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
                  // Deliberately icon-less, matching the reference's own
                  // duration list.
                  className={`flex items-center justify-start px-3 py-2 text-xs font-medium text-white outline-none transition-colors ${
                    selected || marked ? "bg-white/5" : "hover:bg-white/5"
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ------------------------------------------------------------------ *
 * Audio — a toggle, not a menu: flipping it asks for confirmation first
 * ------------------------------------------------------------------ */

export function AudioToggleControl({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const [confirming, setConfirming] = useState(false);
  const turningOff = on;

  return (
    <Dialog.Root open={confirming} onOpenChange={setConfirming}>
      <Dialog.Trigger asChild>
        <button type="button" aria-label={`Sound ${on ? "on" : "off"}`} className={CONTROL_CLASS}>
          {on ? <Volume2 className="size-4 shrink-0 text-white/70" /> : <VolumeX className="size-4 shrink-0 text-white/70" />}
          <span className={CONTROL_LABEL}>{on ? "On" : "Off"}</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[121] w-[min(28rem,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#1c1e20] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.65)] outline-none">
          <Dialog.Title className="text-lg font-semibold text-white">
            {turningOff ? "Turn sound off?" : "Turn sound on?"}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-white/60">
            {turningOff
              ? "This generation will be created without generated audio."
              : "This generation will include generated audio."}
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-3">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-xl bg-white/10 px-7 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/15"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={() => {
                onChange(!on);
                setConfirming(false);
              }}
              className="rounded-xl bg-white px-7 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
            >
              {turningOff ? "Turn off" : "Turn on"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
