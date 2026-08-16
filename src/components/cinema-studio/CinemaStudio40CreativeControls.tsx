"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Plus, RotateCcw, X } from "lucide-react";
import Cinema40AssetsPicker from "./Cinema40AssetsPicker";
import {
  CINEMA40_APERTURE,
  CINEMA40_CAMERA_BODY,
  CINEMA40_COLOR_PALETTES,
  CINEMA40_ERAS,
  CINEMA40_GENRES,
  CINEMA40_LENS,
  CINEMA40_LIGHTING,
  CINEMA40_MOVEMENT_TAGS,
  CINEMA40_TEMPO,
} from "./cinemaStudioData";

/**
 * Cinema Studio 4.0 Creative Controls — the chip row above the composer
 * (References/Film setup/Camera/Color palette/Lighting) and the four
 * dialogs it opens.
 *
 * Structure, spacing, and interaction geometry (arc/ruler/carousel/wheel
 * formulas, dialog dimensions, grid layouts) are transcribed from the
 * reference implementation's real DOM. Colour tokens and the accent colour
 * are NOT copied verbatim — the reference's own design-system class names
 * (bg-neutral-primary-reverted-5, text-font-primary, bg-surface-brand's
 * lime green, …) don't exist in this codebase's Tailwind config and would
 * render as unstyled if copied literally, so they're mapped onto
 * Cinefield's own tokens: white-opacity surfaces already used throughout
 * cinema-studio, and the #D97757 orange accent every other /generate
 * control already uses instead of the reference's lime.
 *
 * The reference's actual photography/video for each option (genre stills,
 * lens samples, palette photos, movement clips) is deliberately not
 * reproduced — embedding another product's real media into this one would
 * be copying its creative assets, not its UI pattern. Gradient/colour
 * swatches derived from the same real palette data stand in for it.
 *
 * Not implemented in this pass: pointer-drag scrolling for the genre arc /
 * era ruler / tempo carousel / setup wheels. Each already exposes the
 * reference's own Prev/Next click affordance plus arrow-key stepping;
 * grabbing and dragging the wheel itself is a follow-up.
 */

export type Cinema40PanelId = "references" | "filmSetup" | "camera" | "colorPalette" | "lighting";

export interface Cinema40FilmSetup {
  genre: string;
  era: string;
  tempo: string;
}

export interface Cinema40Camera {
  body: string;
  lens: string;
  aperture: string;
}

export interface CinemaStudio40Settings {
  references: string[];
  filmSetup: Cinema40FilmSetup;
  camera: Cinema40Camera;
  colorPalette: string;
  lighting: string;
}

interface CinemaStudio40CreativeControlsProps {
  settings: CinemaStudio40Settings;
  onFilmSetupChange: (next: Partial<Cinema40FilmSetup>) => void;
  onCameraChange: (next: Partial<Cinema40Camera>) => void;
  onColorPaletteChange: (value: string) => void;
  onLightingChange: (value: string) => void;
  onAddReference: (url: string) => void;
  onResetAll: () => void;
  onAppendMovementTag: (tag: string) => void;

  openPanel: Cinema40PanelId | null;
  onOpenPanelChange: (panel: Cinema40PanelId | null) => void;
  cameraTab: "setup" | "movement";
  onCameraTabChange: (tab: "setup" | "movement") => void;
  filmSetupTab: "genre" | "era" | "tempo";
  onFilmSetupTabChange: (tab: "genre" | "era" | "tempo") => void;

  assetsPickerOpen: boolean;
  onAssetsPickerOpenChange: (open: boolean) => void;
  assetsPickerTab: "references" | "elements" | "generations" | "liked";
  onAssetsPickerTabChange: (tab: "references" | "elements" | "generations" | "liked") => void;
}

const MAX_REFERENCES = 50;
const ACCENT = "#D97757";

/* ------------------------------------------------------------------ */
/* Chip row                                                            */
/* ------------------------------------------------------------------ */

const CHIP =
  "relative flex min-h-12 h-12 min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-2xl py-2 pl-2 pr-3 bg-white/5 transition-[background-color,scale] duration-150 ease-out hover:bg-white/8 active:scale-[0.96] disabled:cursor-default disabled:opacity-50 outline-none";
const CHIP_OPEN = "bg-white/10 ring-1 ring-[#D97757]/50";

/** 32x32 "LCD capsule" icon shell — dark inset chip with a soft top gradient, matching the reference's icon treatment without copying its photography. */
function LcdCapsule({
  size = 32,
  children,
}: {
  size?: number;
  children: React.ReactNode;
}) {
  return (
    <span
      className="relative block shrink-0 rounded-lg shadow-[0px_-4px_8px_0px_rgba(0,0,0,0.08)]"
      style={{
        width: size,
        height: 32,
        background:
          "linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.05) 15%,rgba(255,255,255,0.03) 65%,rgba(255,255,255,0.14)),#0f0f10",
      }}
    >
      <span className="pointer-events-none absolute inset-px rounded-[7px] bg-[#0f0f10]" />
      <span className="absolute inset-[3px] flex items-center justify-center overflow-hidden rounded-[5px] bg-black shadow-[0px_2.6px_2.6px_0px_rgba(0,0,0,0.08)]">
        {children}
        <span className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-t from-transparent to-white/[0.24] mix-blend-overlay" />
        <span className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] shadow-[inset_0_1px_2px_rgba(255,255,255,0.12)]" />
      </span>
      <span className="pointer-events-none absolute inset-0 rounded-lg shadow-[inset_0px_2px_4px_0px_rgba(0,0,0,0.04)]" />
    </span>
  );
}

function ChipTrigger({
  label,
  value,
  icon,
  open,
  wide,
  onClick,
  ariaLabel,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  open: boolean;
  wide?: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      data-panel-toggle=""
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={ariaLabel}
      className={`${CHIP} ${open ? CHIP_OPEN : ""} ${wide ? "w-32 shrink-0" : "flex-1"}`}
    >
      {icon}
      <span className="flex min-w-0 flex-col items-start">
        <span
          className="whitespace-nowrap font-mono text-[10px] font-medium leading-[14px] tracking-normal bg-gradient-to-t from-white/40 to-white/10 bg-clip-text text-transparent"
        >
          {label}
        </span>
        <span
          title={value}
          className="max-w-full truncate text-[13px] font-medium leading-4 text-white transition-colors"
        >
          {value}
        </span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Dialog chassis shared by Film setup / Camera / Color palette / Lighting */
/* ------------------------------------------------------------------ */

function Cinema40Dialog({
  open,
  onOpenChange,
  title,
  onReset,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onReset: () => void;
  children: React.ReactNode;
}) {
  // No open/close CSS animation classes here — Radix's Dialog keeps the
  // Content mounted (in "closed" state) until it observes the exit
  // animation finish. tw-animate-css's animate-in/animate-out utilities
  // didn't get picked up on this Content in testing, which left every
  // closed dialog permanently stuck in the DOM as an invisible-but-present
  // fixed inset-0 layer. Cinema25AssetsPicker (this codebase's other Radix
  // dialog) never used animation classes either — matching that proven,
  // animation-free pattern is what keeps mount/unmount instant and correct.
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[999] bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[1000] flex items-end justify-center outline-none md:items-center"
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <div
            className="flex max-h-[calc(100vh-32px)] min-h-0 w-full max-w-[calc(100vw-32px)] flex-col rounded-t-[24px] bg-[#141517] p-1 md:w-[800px] md:rounded-[24px]"
          >
            <header className="flex w-full shrink-0 items-center gap-1 pb-1">
              <span className="min-w-0 flex-1 truncate px-3 py-2 text-base font-semibold leading-6 text-white">
                {title}
              </span>
              <div className="flex shrink-0 items-center gap-2 p-1">
                <button
                  type="button"
                  onClick={onReset}
                  className="flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-full bg-white/10 px-3.5 backdrop-blur-[40px] transition-[background-color,scale] duration-150 ease-out hover:bg-white/15 active:scale-[0.96]"
                >
                  <span className="whitespace-nowrap text-[13px] font-medium text-white">Reset all</span>
                </button>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label="Close"
                    className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/5 transition-[background-color,scale] duration-150 ease-out hover:bg-white/10 active:scale-[0.96]"
                  >
                    <X className="size-5 text-white" strokeWidth={1.5} />
                  </button>
                </Dialog.Close>
              </div>
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-px overflow-clip rounded-[20px] md:h-[452px] md:flex-none">
              {children}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SidebarTab({
  label,
  icon,
  active,
  showDot,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  showDot: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg py-2 pl-2 pr-3 transition-colors duration-150 ease-out ${
        active ? "bg-white/10 text-white" : "text-white/50 hover:bg-white/5 hover:text-white"
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left text-[13px] font-medium">{label}</span>
      {showDot && <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: ACCENT }} />}
    </button>
  );
}

function DialogSectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex shrink-0 items-start gap-2 px-4 pt-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[13px] font-medium text-white">{title}</span>
        <span className="text-xs text-white/50">{description}</span>
      </div>
    </div>
  );
}

/** Circular Prev / value-pill / Next control shared by Genre, Era, Tempo. */
function StepperNav({
  label,
  value,
  onPrev,
  onNext,
}: {
  label: string;
  value: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  const pill =
    "flex items-center justify-center rounded-full border border-white/15 bg-white/5 shadow-[inset_0_-0.3px_5.4px_0_rgba(185,185,185,0.2),0_20.5px_10.3px_rgba(0,0,0,0.09)] transition-[background-color,scale] duration-150 ease-out hover:bg-white/10 active:scale-[0.96]";
  return (
    <div className="isolate flex shrink-0 items-center justify-center gap-1.5 pb-4 pt-3">
      <button type="button" aria-label={`Previous ${label}`} onClick={onPrev} className={`${pill} size-8 cursor-pointer`}>
        <ChevronLeft className="size-5 text-white" strokeWidth={1.5} />
      </button>
      <div className={`${pill} h-8 min-w-24 px-4`}>
        <span className="truncate text-[13px] font-medium text-white">{value}</span>
      </div>
      <button type="button" aria-label={`Next ${label}`} onClick={onNext} className={`${pill} size-8 cursor-pointer`}>
        <ChevronRight className="size-5 text-white" strokeWidth={1.5} />
      </button>
    </div>
  );
}

/** Deterministic gradient swatch standing in for the reference's photography — derived from the item's own name, not fabricated per-model imagery. */
function PlaceholderArt({ seed, className }: { seed: string; className?: string }) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hue1 = hash % 360;
  const hue2 = (hue1 + 40 + (hash % 60)) % 360;
  return (
    <div
      className={`absolute inset-0 ${className ?? ""}`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue1} 35% 16%), hsl(${hue2} 30% 8%))`,
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Film setup: Genre (arc), Era (ruler), Tempo (carousel)               */
/* ------------------------------------------------------------------ */

function GenreArc({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const count = CINEMA40_GENRES.length;
  const selectedIndex = Math.max(0, CINEMA40_GENRES.indexOf(value));
  const step = (delta: number) => onChange(CINEMA40_GENRES[(selectedIndex + delta + count * 100) % count]);

  return (
    <div className="relative min-h-0 flex-1 select-none">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 rounded-full border-[0.86px] border-white/20"
        style={{
          width: 1080,
          height: 1080,
          top: "min(579.5px, 45% + 457px)",
          transform: "translate(-50%, -50%)",
          background: "linear-gradient(rgba(255,255,255,0.04) 0%, transparent 100%)",
          boxShadow: "inset 0 16px 48px rgba(255,255,255,0.04)",
        }}
      />
      <div className="absolute left-1/2 size-0" style={{ top: "min(619.5px, 45% + 497px)" }}>
        {CINEMA40_GENRES.map((name, itemIndex) => {
          // Offset by shortest path from the selected index (wrapping through
          // whichever side is closer), NOT by fixed slot position. Keying each
          // card by its own genre identity (below) means React keeps the same
          // DOM node across renders and only its transform/opacity change —
          // that's what lets the CSS transition animate the whole arc as one
          // spinning wheel instead of an instant content swap.
          let offset = itemIndex - selectedIndex;
          if (offset > count / 2) offset -= count;
          if (offset < -count / 2) offset += count;
          const isSelected = offset === 0;
          const isNeighbor = Math.abs(offset) === 1;
          const opacity = isSelected ? 1 : isNeighbor ? 0.55 : 0;
          return (
            <div
              key={name}
              className="absolute transition-[transform,opacity] duration-[400ms] ease-out"
              style={{
                width: 230,
                height: 129,
                left: -115,
                top: -64.5,
                transform: `rotate(${offset * 45}deg) translateY(-425px)`,
                opacity,
                pointerEvents: isSelected || isNeighbor ? "auto" : "none",
              }}
            >
              <button
                type="button"
                onClick={() => (isSelected ? undefined : step(offset))}
                aria-label={name}
                className="relative size-full cursor-pointer rounded-[24px] bg-[#0f0f10] p-1 shadow-[0_-2.6px_5.2px_0_rgba(0,0,0,0.08),inset_0_-1.3px_1.3px_0_rgba(255,255,255,0.12),inset_0_1.3px_2.6px_0_rgba(0,0,0,0.04)]"
                style={{ transform: isSelected ? "scale(1.4)" : undefined }}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-[inherit]"
                  style={{
                    padding: 1,
                    background:
                      "conic-gradient(rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.12) 25%, rgba(255,255,255,0.32) 50%, rgba(255,255,255,0.12) 75%, rgba(255,255,255,0.4) 100%)",
                    WebkitMask: "linear-gradient(#fff 0 0) content-box exclude, linear-gradient(#fff 0 0)",
                  }}
                />
                <div className="relative size-full overflow-hidden rounded-[20px] bg-[#090a0c]">
                  <PlaceholderArt seed={name} />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-[20px] shadow-[inset_4px_6px_16px_0_rgba(255,255,255,0.16)]"
                  />
                </div>
              </button>
            </div>
          );
        })}
      </div>
      <StepperNav label="genre" value={value} onPrev={() => step(-1)} onNext={() => step(1)} />
    </div>
  );
}

function EraRuler({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const count = CINEMA40_ERAS.length;
  const selectedIndex = Math.max(0, CINEMA40_ERAS.indexOf(value));
  const step = (delta: number) => onChange(CINEMA40_ERAS[(selectedIndex + delta + count * 100) % count]);
  const offsetPx = -selectedIndex * 168;

  return (
    <>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div
          className="relative h-full max-w-full overflow-hidden rounded-[21px] bg-[#0f0f10] p-1 shadow-[0_-2.2px_4.5px_0_rgba(0,0,0,0.08),inset_0_-1.1px_1.1px_0_rgba(255,255,255,0.12),inset_0_1.1px_2.2px_0_rgba(0,0,0,0.04)]"
          style={{ aspectRatio: "330 / 190", maxHeight: 190 }}
        >
          <div className="relative size-full overflow-hidden rounded-[17px] bg-[#090a0c]">
            <PlaceholderArt seed={value} />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-[17px] shadow-[inset_3.5px_5.2px_13.9px_0_rgba(255,255,255,0.16)]"
            />
          </div>
        </div>
      </div>

      {/* Tick ruler — 8 minor ticks per era gap, matching the reference's 16.8px spacing / larger tick every 10th. */}
      <div className="shrink-0 pb-1">
        <div
          className="relative h-8 w-full overflow-hidden"
          style={{ maskImage: "linear-gradient(90deg,transparent 0%,black 18%,black 82%,transparent 100%)" }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ width: 4, height: 32, background: ACCENT }}
          />
          <div className="absolute left-1/2 top-0 h-full" style={{ transform: `translateX(${offsetPx}px)` }}>
            {Array.from({ length: 81 }, (_, i) => {
              const left = (i - 40) * 16.8 - 1;
              const big = i % 10 === 0;
              return (
                <span
                  key={i}
                  className="absolute top-1/2 w-[2px] -translate-y-1/2 rounded-full bg-white/10"
                  style={{ left, height: big ? 24 : 16 }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Era label ticker — synced to the same offset as the ruler above. */}
      <div className="relative mt-3 h-10 w-full">
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ maskImage: "linear-gradient(90deg,transparent 0%,black 18%,black 82%,transparent 100%)" }}
        >
          <div className="absolute left-1/2 top-0 h-full" style={{ transform: `translateX(${offsetPx}px)` }}>
            {CINEMA40_ERAS.map((era, i) => {
              const isSelected = i === selectedIndex;
              return (
                <button
                  key={era}
                  type="button"
                  onClick={() => onChange(era)}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer whitespace-nowrap border-none bg-transparent p-0 text-lg font-semibold leading-6 transition-transform"
                  style={{
                    left: i * 168,
                    opacity: isSelected ? 1 : 0.7,
                    color: isSelected ? ACCENT : "rgb(130,130,130)",
                    transform: isSelected ? "scale(1.55556)" : undefined,
                  }}
                >
                  {era}
                </button>
              );
            })}
          </div>
        </div>
        <div className="absolute left-[calc(50%-76px)] top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
          <button
            type="button"
            aria-label="Previous era"
            onClick={() => step(-1)}
            className="flex size-7 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-white/5 shadow-[inset_0_-0.3px_5.4px_0_rgba(185,185,185,0.2)] transition-[background-color,scale] duration-150 hover:bg-white/10 active:scale-[0.96]"
          >
            <ChevronLeft className="size-3.5 text-white" strokeWidth={1.5} />
          </button>
        </div>
        <div className="absolute left-[calc(50%+76px)] top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
          <button
            type="button"
            aria-label="Next era"
            onClick={() => step(1)}
            className="flex size-7 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-white/5 shadow-[inset_0_-0.3px_5.4px_0_rgba(185,185,185,0.2)] transition-[background-color,scale] duration-150 hover:bg-white/10 active:scale-[0.96]"
          >
            <ChevronRight className="size-3.5 text-white" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </>
  );
}

function TempoCarousel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const count = CINEMA40_TEMPO.length;
  const selectedIndex = Math.max(0, CINEMA40_TEMPO.findIndex((t) => t.name === value));
  const step = (delta: number) => onChange(CINEMA40_TEMPO[(selectedIndex + delta + count * 100) % count].name);
  const STEP_PX = 362; // 330px card + 16px margin on each side

  return (
    <div className="flex min-h-0 flex-1 flex-col select-none">
      <div className="relative -mx-3 min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative" style={{ width: 330, height: 190 }}>
            {CINEMA40_TEMPO.map((tempo, itemIndex) => {
              // Same identity-keyed, shortest-path-offset approach as
              // GenreArc — the card for each tempo keeps its own DOM node
              // across renders, so the CSS transition below slides the
              // whole strip sideways instead of swapping content in place.
              let offset = itemIndex - selectedIndex;
              if (offset > count / 2) offset -= count;
              if (offset < -count / 2) offset += count;
              const isSelected = offset === 0;
              const absDistance = Math.min(Math.abs(offset), 1);
              const scale = 1 - 0.32 * absDistance;
              const opacity = Math.abs(offset) > 1 ? 0 : 1 - 0.25 * absDistance;
              return (
                <button
                  key={tempo.name}
                  type="button"
                  onClick={() => (isSelected ? undefined : step(offset))}
                  aria-label={tempo.name}
                  className="absolute left-0 top-0 cursor-pointer rounded-[24px] bg-[#0f0f10] p-1 shadow-[0_-2.6px_5.2px_0_rgba(0,0,0,0.08),inset_0_-1.3px_1.3px_0_rgba(255,255,255,0.12),inset_0_1.3px_2.6px_0_rgba(0,0,0,0.04)] transition-[transform,opacity] duration-[400ms] ease-out"
                  style={{
                    width: 330,
                    height: 190,
                    transform: `translateX(${offset * STEP_PX}px) scale(${scale})`,
                    opacity,
                    pointerEvents: Math.abs(offset) <= 1 ? "auto" : "none",
                  }}
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-[inherit]"
                    style={{
                      padding: 1,
                      background:
                        "conic-gradient(rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.12) 25%, rgba(255,255,255,0.32) 50%, rgba(255,255,255,0.12) 75%, rgba(255,255,255,0.4) 100%)",
                      WebkitMask: "linear-gradient(#fff 0 0) content-box exclude, linear-gradient(#fff 0 0)",
                    }}
                  />
                  <div className="relative size-full overflow-hidden rounded-[20px] bg-[#090a0c]">
                    <PlaceholderArt seed={tempo.name} />
                    {tempo.bars.length > 0 && (
                      <div aria-hidden className="pointer-events-none absolute inset-x-4 bottom-3 z-10 flex gap-[3px]">
                        {tempo.bars.map((grow, i) => (
                          <span
                            key={i}
                            className="relative h-[3px] min-w-0 basis-0 overflow-hidden rounded-full bg-white/30"
                            style={{ flexGrow: grow }}
                          >
                            <span
                              className="absolute inset-y-0 left-0 w-full origin-left will-change-transform"
                              style={{
                                background: ACCENT,
                                transform: isSelected ? "scaleX(1)" : "scaleX(0)",
                                transition: "transform 600ms ease-out",
                              }}
                            />
                          </span>
                        ))}
                      </div>
                    )}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-[20px] shadow-[inset_4px_6px_16px_0_rgba(255,255,255,0.16)]"
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <StepperNav label="tempo" value={value} onPrev={() => step(-1)} onNext={() => step(1)} />
    </div>
  );
}

function FilmSetupPanel({
  settings,
  tab,
  onTabChange,
  onChange,
}: {
  settings: Cinema40FilmSetup;
  tab: "genre" | "era" | "tempo";
  onTabChange: (t: "genre" | "era" | "tempo") => void;
  onChange: (next: Partial<Cinema40FilmSetup>) => void;
}) {
  return (
    <>
      <div className="flex h-full w-[184px] shrink-0 flex-col gap-0.5 bg-white/5 p-3" role="tablist">
        <SidebarTab label="Genre" active={tab === "genre"} showDot icon={<FilmIcon />} onClick={() => onTabChange("genre")} />
        <SidebarTab label="Era" active={tab === "era"} showDot icon={<EraIcon />} onClick={() => onTabChange("era")} />
        <SidebarTab label="Tempo" active={tab === "tempo"} showDot icon={<TempoIcon />} onClick={() => onTabChange("tempo")} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white/5 p-3">
        {tab === "genre" && (
          <>
            <DialogSectionHeader title="Select genre" description="Story conventions the model should follow" />
            <GenreArc value={settings.genre} onChange={(genre) => onChange({ genre })} />
          </>
        )}
        {tab === "era" && (
          <>
            <DialogSectionHeader title="Select era" description="The period the film belongs to" />
            <EraRuler value={settings.era} onChange={(era) => onChange({ era })} />
          </>
        )}
        {tab === "tempo" && (
          <>
            <DialogSectionHeader title="Select tempo" description="Pacing of the montage" />
            <TempoCarousel value={settings.tempo} onChange={(tempo) => onChange({ tempo })} />
          </>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Camera: Setup (3 wheels), Movement (grid)                           */
/* ------------------------------------------------------------------ */

function SetupWheel({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const count = options.length;
  const selectedIndex = Math.max(0, options.indexOf(value));
  const step = (delta: number) => onChange(options[(selectedIndex + delta + count * 100) % count]);

  return (
    <div className="group/wheel relative flex min-w-0 flex-col items-center pt-2">
      <span className="relative z-10 text-[10px] font-bold uppercase tracking-wide text-white/50">{label}</span>
      <div className="relative min-h-0 w-full flex-1">
        <div className="relative size-full overflow-hidden">
          {options.map((name, itemIndex) => {
            // Identity-keyed with a shortest-path offset (same pattern as
            // GenreArc/TempoCarousel) so the CSS transition slides the
            // whole column instead of swapping content at a fixed slot.
            let offset = itemIndex - selectedIndex;
            if (offset > count / 2) offset -= count;
            if (offset < -count / 2) offset += count;
            const isSelected = offset === 0;
            const isAuto = name === "Auto";
            const visible = Math.abs(offset) <= 2;
            return (
              <button
                key={name}
                type="button"
                onClick={() => (isSelected ? undefined : step(offset))}
                className={`absolute left-1/2 top-1/2 flex h-[100px] w-[156px] max-w-full shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-full transition-[transform,opacity] duration-[400ms] ease-out ${
                  isSelected ? "opacity-100 ring-2 ring-white" : "opacity-60 ring-[1.5px] ring-white/30"
                }`}
                style={{
                  transform: `translate(-50%, calc(-50% + ${offset * 120}px))`,
                  opacity: visible ? undefined : 0,
                  pointerEvents: visible ? "auto" : "none",
                }}
              >
                {isAuto ? (
                  <>
                    <span aria-hidden className="absolute inset-1.5 rounded-[inherit] bg-white/10" />
                    <Plus className="relative size-8 text-white" strokeWidth={1.5} />
                    <span className="relative max-w-full truncate px-3 text-xs font-medium text-white">Auto</span>
                  </>
                ) : (
                  <>
                    <span className="absolute inset-1.5 overflow-hidden rounded-[inherit]">
                      <PlaceholderArt seed={name} />
                      <span aria-hidden className="absolute inset-0 bg-black/25" />
                    </span>
                    <span className="absolute inset-x-0 bottom-3 truncate px-3 text-center text-xs font-medium text-white">
                      {name}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-1 z-20 flex justify-center opacity-0 transition-opacity duration-150 group-hover/wheel:opacity-100">
          <button
            type="button"
            aria-label={`Previous ${label}`}
            onClick={() => step(-1)}
            className="pointer-events-auto flex h-6 w-10 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-white/5 backdrop-blur-[4px] transition-colors hover:bg-white/10"
          >
            <ChevronLeft className="size-3.5 rotate-90 text-white" strokeWidth={1.5} />
          </button>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-1 z-20 flex justify-center opacity-0 transition-opacity duration-150 group-hover/wheel:opacity-100">
          <button
            type="button"
            aria-label={`Next ${label}`}
            onClick={() => step(1)}
            className="pointer-events-auto flex h-6 w-10 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-white/5 backdrop-blur-[4px] transition-colors hover:bg-white/10"
          >
            <ChevronRight className="size-3.5 rotate-90 text-white" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

function CameraSetupTab({
  camera,
  onChange,
}: {
  camera: Cinema40Camera;
  onChange: (next: Partial<Cinema40Camera>) => void;
}) {
  return (
    <div className="relative grid min-w-0 flex-1 overflow-hidden bg-white/5" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
      <SetupWheel label="CAMERA" options={CINEMA40_CAMERA_BODY} value={camera.body} onChange={(body) => onChange({ body })} />
      <SetupWheel label="LENS" options={CINEMA40_LENS} value={camera.lens} onChange={(lens) => onChange({ lens })} />
      <SetupWheel label="APERTURE" options={CINEMA40_APERTURE} value={camera.aperture} onChange={(aperture) => onChange({ aperture })} />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent" style={{ left: "33.3333%" }} />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent" style={{ left: "66.6667%" }} />
    </div>
  );
}

function MovementGrid({ onAppendMovementTag }: { onAppendMovementTag: (tag: string) => void }) {
  return (
    <>
      <div className="flex shrink-0 items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[13px] font-medium text-white">Direct a camera move</span>
          <span className="max-w-[360px] text-xs text-white/50">
            Adds to the prompt box, or type <span style={{ color: ACCENT }}>#</span> there.
            <br />
            Several per shot; order matters.
          </span>
        </div>
      </div>
      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto p-1">
        <div className="grid grid-cols-4 gap-x-2 gap-y-3 pb-1">
          {CINEMA40_MOVEMENT_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onAppendMovementTag(tag)}
              className="group flex cursor-pointer flex-col items-center gap-2"
            >
              <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-white/[0.04] bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-colors duration-150 group-hover:border-white/15">
                <PlaceholderArt seed={tag} />
                <span className="pointer-events-none absolute inset-x-2 bottom-2 z-10 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  <span
                    className="block w-full rounded-full px-2 py-1.5 text-center text-[11px] font-semibold text-white shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
                    style={{ background: ACCENT }}
                  >
                    Put on prompt
                  </span>
                </span>
              </div>
              <span className="w-full truncate text-center text-xs font-medium text-white">{tag}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function CameraPanel({
  camera,
  tab,
  onTabChange,
  onCameraChange,
  onAppendMovementTag,
}: {
  camera: Cinema40Camera;
  tab: "setup" | "movement";
  onTabChange: (t: "setup" | "movement") => void;
  onCameraChange: (next: Partial<Cinema40Camera>) => void;
  onAppendMovementTag: (tag: string) => void;
}) {
  return (
    <>
      <div className="flex h-full w-[184px] shrink-0 flex-col gap-0.5 bg-white/5 p-3" role="tablist">
        <SidebarTab label="Setup" active={tab === "setup"} showDot icon={<CameraIcon />} onClick={() => onTabChange("setup")} />
        <SidebarTab label="Movement" active={tab === "movement"} showDot={false} icon={<MovementIcon />} onClick={() => onTabChange("movement")} />
      </div>
      {tab === "setup" ? (
        <CameraSetupTab camera={camera} onChange={onCameraChange} />
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 bg-white/5 p-4">
          <MovementGrid onAppendMovementTag={onAppendMovementTag} />
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Color palette                                                       */
/* ------------------------------------------------------------------ */

function ColorPalettePanel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white/5 p-3">
      <DialogSectionHeader title="Set up color palette" description="Palette the color grade should follow" />
      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto p-1">
        <div className="grid gap-3 pb-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
          <button type="button" className="group flex cursor-pointer flex-col items-center gap-2">
            <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-colors duration-150 group-hover:bg-white/8">
              <span className="flex size-7 items-center justify-center rounded-full border border-white/15 bg-white/5">
                <Plus className="size-4 text-white" strokeWidth={1.5} />
              </span>
            </div>
            <span className="w-full truncate text-center text-xs font-medium text-white">New palette</span>
          </button>
          {CINEMA40_COLOR_PALETTES.map((palette) => {
            const isSelected = palette.name === value;
            return (
              <button
                key={palette.name}
                type="button"
                onClick={() => onChange(palette.name)}
                className="group flex cursor-pointer flex-col items-center gap-2"
              >
                <div
                  className={`relative flex aspect-video w-full flex-col overflow-hidden rounded-xl ${
                    isSelected ? "ring-2 ring-[#D97757]" : ""
                  }`}
                >
                  <div
                    className="relative min-h-0 w-full flex-1"
                    style={{ background: `linear-gradient(90deg, ${palette.colors.join(",")})` }}
                  />
                  <div className="flex w-full" style={{ height: 20 }}>
                    {palette.colors.map((c, i) => (
                      <span key={i} className="min-w-0 flex-1" style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
                <span
                  className={`w-full truncate text-center text-xs transition-colors duration-150 ${
                    isSelected ? "text-white" : "text-white/50 group-hover:text-white"
                  }`}
                >
                  {palette.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lighting                                                             */
/* ------------------------------------------------------------------ */

function LightingPanel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden rounded-[20px] bg-white/5 p-4">
      <DialogSectionHeader title="Set up lighting" description="Pick a scheme or place your own lights" />
      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto p-1">
        <div className="grid grid-cols-3 gap-x-5 gap-y-3">
          <button type="button" className="group flex cursor-pointer flex-col items-center gap-2">
            <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-colors duration-150 group-hover:bg-white/10">
              <span className="flex size-8 items-center justify-center rounded-full border border-white/15 bg-white/5">
                <Plus className="size-4 text-white" strokeWidth={1.5} />
              </span>
            </div>
            <span className="w-full truncate text-center text-xs font-medium text-white">New lighting preset</span>
          </button>
          {CINEMA40_LIGHTING.map((preset) => {
            const isSelected = preset === value;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => onChange(preset)}
                className="group flex cursor-pointer flex-col items-center gap-2"
              >
                <div
                  className={`relative aspect-video w-full overflow-hidden rounded-xl bg-[#090a0c] transition-[filter] duration-150 ease-out group-hover:brightness-125 ${
                    isSelected ? "ring-2 ring-[#D97757]" : ""
                  }`}
                >
                  <PlaceholderArt seed={preset} />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-xl shadow-[inset_4px_6px_16px_0_rgba(255,255,255,0.3)]"
                  />
                </div>
                <span className="w-full truncate text-center text-xs font-medium text-white">{preset}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small inline icons — recreated line-art matching the reference's own
   generic tab icons (film reel / hourglass / camera / arrows), not
   copied imagery.                                                    */
/* ------------------------------------------------------------------ */

function FilmIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="size-5 shrink-0 text-current">
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        d="M2.75 4.75C2.75 4.198 3.198 3.75 3.75 3.75H20.25C20.802 3.75 21.25 4.198 21.25 4.75V19.25C21.25 19.802 20.802 20.25 20.25 20.25H3.75C3.198 20.25 2.75 19.802 2.75 19.25V4.75Z"
      />
      <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M7.25 3.75v16.5M16.75 3.75v16.5" />
    </svg>
  );
}
function EraIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="size-5 shrink-0 text-current">
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        d="M4.75 2.75h14.5M4.75 21.25h14.5M5.75 3v3.75c0 2.645 1.956 4.886 4.5 5.25M5.75 21v-3.75c0-2.644 1.955-4.885 4.498-5.25M18.25 3v3.75c0 2.645-1.956 4.886-4.5 5.25M18.248 21v-3.75c0-2.644-1.955-4.885-4.498-5.25"
      />
    </svg>
  );
}
function TempoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="size-5 shrink-0 text-current">
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.5" />
      <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M12 7.5V12l3 2" />
    </svg>
  );
}
function CameraIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="size-5 shrink-0 text-current">
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        d="M2.75 4.75C2.75 4.198 3.198 3.75 3.75 3.75H20.25C20.802 3.75 21.25 4.198 21.25 4.75V19.25C21.25 19.802 20.802 20.25 20.25 20.25H3.75C3.198 20.25 2.75 19.802 2.75 19.25V4.75Z"
      />
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        d="M15.25 12C15.25 13.7949 13.7949 15.25 12 15.25C10.2051 15.25 8.75 13.7949 8.75 12C8.75 10.2051 10.2051 8.75 12 8.75C13.7949 8.75 15.25 10.2051 15.25 12Z"
      />
    </svg>
  );
}
function MovementIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="size-5 shrink-0 text-current">
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m9 5.5 2.47-2.47a.75.75 0 0 1 1.06 0L15 5.5M5.5 9l-2.47 2.47a.75.75 0 0 0 0 1.06L5.5 15m13-6 2.47 2.47a.75.75 0 0 1 0 1.06L18.5 15M15 18.5l-2.47 2.47a.75.75 0 0 1-1.06 0L9 18.5M12 4v8m0 0v8m0-8H4m8 0h8"
      />
    </svg>
  );
}
function ReferencesIcon() {
  return (
    <LcdCapsule>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="relative size-[18px] text-white/50">
        <path fill="currentColor" d="M11.25 18.75v-6h-6a.75.75 0 0 1 0-1.5h6v-6a.75.75 0 0 1 1.5 0v6h6a.75.75 0 0 1 0 1.5h-6v6a.75.75 0 0 1-1.5 0" />
      </svg>
    </LcdCapsule>
  );
}
function FilmSetupIcon() {
  return (
    <LcdCapsule>
      <FilmIcon />
    </LcdCapsule>
  );
}
function CameraChipIcon() {
  return (
    <LcdCapsule>
      <CameraIcon />
    </LcdCapsule>
  );
}
function ColorPaletteChipIcon({ paletteName }: { paletteName: string }) {
  const swatch = CINEMA40_COLOR_PALETTES.find((p) => p.name === paletteName)?.colors ?? [];
  return (
    <LcdCapsule size={40}>
      <PlaceholderArt seed={paletteName || "auto"} />
      {swatch.length > 0 && (
        <span className="absolute inset-y-0 right-0 flex w-2 flex-col overflow-hidden">
          {swatch.slice(0, 6).map((c, i) => (
            <span key={i} className="min-h-0 flex-1" style={{ backgroundColor: c }} />
          ))}
        </span>
      )}
    </LcdCapsule>
  );
}
function LightingChipIcon() {
  return (
    <LcdCapsule size={40}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="size-4 text-white/70">
        <path
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.25 4.75C21.1 6.6 22.25 9.17 22.25 12s-1.15 5.4-3 7.25M15.9 8.1c1 1 1.6 2.37 1.6 3.9s-.6 2.9-1.6 3.9M2.75 7.75h2.96c.19 0 .38-.06.54-.16L12.25 3.75v16.5l-6-3.84a1.25 1.25 0 0 0-.54-.16H2.75a1 1 0 0 1-1-1v-6.5a1 1 0 0 1 1-1Z"
        />
      </svg>
    </LcdCapsule>
  );
}

export default function CinemaStudio40CreativeControls({
  settings,
  onFilmSetupChange,
  onCameraChange,
  onColorPaletteChange,
  onLightingChange,
  onAddReference,
  onResetAll,
  onAppendMovementTag,
  openPanel,
  onOpenPanelChange,
  cameraTab,
  onCameraTabChange,
  filmSetupTab,
  onFilmSetupTabChange,
  assetsPickerOpen,
  onAssetsPickerOpenChange,
  assetsPickerTab,
  onAssetsPickerTabChange,
}: CinemaStudio40CreativeControlsProps) {
  const filmSetupSummary =
    settings.filmSetup.genre === "General" && settings.filmSetup.era === "Auto" && settings.filmSetup.tempo === "Auto"
      ? "Auto"
      : [settings.filmSetup.genre, settings.filmSetup.era, settings.filmSetup.tempo]
          .filter((v) => v && v !== "Auto")
          .join(", ") || "Auto";

  const cameraSummary =
    settings.camera.body === "Auto" && settings.camera.lens === "Auto" && settings.camera.aperture === "Auto"
      ? "Auto"
      : [settings.camera.body, settings.camera.lens, settings.camera.aperture]
          .filter((v) => v !== "Auto")
          .join(" ") || "Auto";

  return (
    <section
      aria-label="Cinema Studio 4.0 video generation"
      className="flex w-full min-w-0 flex-col gap-1 rounded-[24px] bg-[#141517] p-1"
    >
      <div className="flex w-full min-w-0 items-center gap-1 p-1">
        <ChipTrigger
          label="References"
          value={`${settings.references.length}/${MAX_REFERENCES}`}
          icon={<ReferencesIcon />}
          open={assetsPickerOpen}
          wide
          ariaLabel={`References, ${settings.references.length} of ${MAX_REFERENCES}`}
          onClick={() => {
            onAssetsPickerTabChange("references");
            onAssetsPickerOpenChange(!assetsPickerOpen);
          }}
        />
        <ChipTrigger
          label="Film setup"
          value={filmSetupSummary}
          icon={<FilmSetupIcon />}
          open={openPanel === "filmSetup"}
          ariaLabel={`Film setup, ${filmSetupSummary}`}
          onClick={() => onOpenPanelChange(openPanel === "filmSetup" ? null : "filmSetup")}
        />
        <ChipTrigger
          label="Camera"
          value={cameraSummary}
          icon={<CameraChipIcon />}
          open={openPanel === "camera"}
          ariaLabel={`Camera, ${cameraSummary}`}
          onClick={() => onOpenPanelChange(openPanel === "camera" ? null : "camera")}
        />
        <ChipTrigger
          label="Color palette"
          value={settings.colorPalette}
          icon={<ColorPaletteChipIcon paletteName={settings.colorPalette} />}
          open={openPanel === "colorPalette"}
          ariaLabel={`Color palette, ${settings.colorPalette}`}
          onClick={() => onOpenPanelChange(openPanel === "colorPalette" ? null : "colorPalette")}
        />
        <ChipTrigger
          label="Lighting"
          value={settings.lighting}
          icon={<LightingChipIcon />}
          open={openPanel === "lighting"}
          ariaLabel={`Lighting, ${settings.lighting}`}
          onClick={() => onOpenPanelChange(openPanel === "lighting" ? null : "lighting")}
        />
      </div>

      <Cinema40Dialog
        open={openPanel === "filmSetup"}
        onOpenChange={(open) => onOpenPanelChange(open ? "filmSetup" : null)}
        title="Film setup"
        onReset={onResetAll}
      >
        <FilmSetupPanel settings={settings.filmSetup} tab={filmSetupTab} onTabChange={onFilmSetupTabChange} onChange={onFilmSetupChange} />
      </Cinema40Dialog>

      <Cinema40Dialog
        open={openPanel === "camera"}
        onOpenChange={(open) => onOpenPanelChange(open ? "camera" : null)}
        title="Camera"
        onReset={onResetAll}
      >
        <CameraPanel
          camera={settings.camera}
          tab={cameraTab}
          onTabChange={onCameraTabChange}
          onCameraChange={onCameraChange}
          onAppendMovementTag={onAppendMovementTag}
        />
      </Cinema40Dialog>

      <Cinema40Dialog
        open={openPanel === "colorPalette"}
        onOpenChange={(open) => onOpenPanelChange(open ? "colorPalette" : null)}
        title="Color palette"
        onReset={onResetAll}
      >
        <ColorPalettePanel value={settings.colorPalette} onChange={onColorPaletteChange} />
      </Cinema40Dialog>

      <Cinema40Dialog
        open={openPanel === "lighting"}
        onOpenChange={(open) => onOpenPanelChange(open ? "lighting" : null)}
        title="Lighting"
        onReset={onResetAll}
      >
        <LightingPanel value={settings.lighting} onChange={onLightingChange} />
      </Cinema40Dialog>

      <Cinema40AssetsPicker
        isOpen={assetsPickerOpen}
        onClose={() => onAssetsPickerOpenChange(false)}
        initialTab={assetsPickerTab}
        onSelectAsset={(url) => {
          if (settings.references.length < MAX_REFERENCES) onAddReference(url);
        }}
      />
    </section>
  );
}
