"use client";

import { useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import ModalShell from "./ModalShell";
import {
  CAMERA_MOVEMENTS,
  COLOR_PALETTES,
  LIGHTING,
  type CinemaStudioSettings,
} from "./cinemaStudioData";

type StyleValue = NonNullable<CinemaStudioSettings["style"]>;
type StyleKey = keyof StyleValue;

interface StyleModalProps {
  open: boolean;
  onClose: () => void;
  value: StyleValue;
  onChange: (next: StyleValue) => void;
  docked?: boolean;
}

/** Preset → image asset maps (image layered over a gradient fallback). */
const COLOR_IMAGES: Record<string, string> = {
  "Naturalistic Clean": "/cinema-studio/color-palette/naturalistic-clean.jpg",
  "Bleached Warm": "/cinema-studio/color-palette/bleached-warm.jpg",
  "Hyper Neon": "/cinema-studio/color-palette/hyper-neon.jpg",
  "Teal Orange Epic": "/cinema-studio/color-palette/teal-orange-epic.jpg",
  "Sodium Decay": "/cinema-studio/color-palette/sodium-decay.jpg",
  "Cold Steel": "/cinema-studio/color-palette/cold-steel.jpg",
  "Bleach Bypass": "/cinema-studio/color-palette/bleach-bypass.jpg",
  "Classic Bw": "/cinema-studio/color-palette/classic-bw.jpg",
};

const LIGHTING_IMAGES: Record<string, string> = {
  "Soft Cross": "/cinema-studio/lighting/soft-cross.jpg",
  "Contre Jour": "/cinema-studio/lighting/contre-jour.jpg",
  Window: "/cinema-studio/lighting/window.jpg",
  Practicals: "/cinema-studio/lighting/practicals.jpg",
  "Overhead Fall": "/cinema-studio/lighting/overhead-fall.jpg",
  Silhouette: "/cinema-studio/lighting/silhouette.jpg",
};

const CAMERA_IMAGES: Record<string, string> = {
  "Classic Static": "/cinema-studio/camera/classic-static.mp4",
  "Silent Machine": "/cinema-studio/camera/silent-machine.mp4",
  "One Take": "/cinema-studio/camera/one-take.mp4",
  "Epic Scale": "/cinema-studio/camera/epic-scale.mp4",
  "Intimate Observer": "/cinema-studio/camera/intimate-observer.mp4",
  "Impossible Camera": "/cinema-studio/camera/impossible-camera.mp4",
  "Documentary Snap": "/cinema-studio/camera/documentary-snap.mp4",
  "Raw Chaos": "/cinema-studio/camera/raw-chaos.mp4",
  "Dreamy Flow": "/cinema-studio/camera/dreamy-flow.mp4",
};

function thumbFor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 45% 30%), hsl(${(h + 40) % 360} 35% 12%))`;
}

function Chevron({ up }: { up?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={`size-3.5 text-white ${up ? "rotate-180" : ""}`}
    >
      <path
        d="M8 10L11.6464 13.6464C11.8417 13.8417 12.1583 13.8417 12.3536 13.6464L16 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const SCROLL_BTN =
  "absolute left-1/2 z-20 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full border border-[rgba(197,197,197,0.3)] bg-[rgba(255,255,255,0.04)] text-white backdrop-blur-[4px] transition-all duration-200 ease-out hover:bg-white/10 active:scale-95";

function Column({
  title,
  options,
  images,
  selected,
  onToggle,
  onAuto,
}: {
  title: string;
  options: string[];
  images?: Record<string, string>;
  selected: string[];
  onToggle: (name: string) => void;
  onAuto: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollUp = () => ref.current?.scrollBy({ top: -120, behavior: "smooth" });
  const scrollDown = () => ref.current?.scrollBy({ top: 120, behavior: "smooth" });

  const autoActive = selected.length === 0;

  return (
    <div className="relative flex h-full min-w-0 flex-col items-center border-l border-white/[0.06] first:border-l-0">
      {/* Header */}
      <div className="absolute left-0 right-0 top-2 z-10 text-center">
        <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">
          {title}
        </span>
      </div>

      {/* Scrollable content */}
      <div className="relative h-full w-full pt-14">
        <div className="relative w-full overflow-hidden" style={{ height: 288 }}>
          <div
            ref={ref}
            className="h-full cursor-grab select-none overflow-y-scroll [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ scrollbarWidth: "none" }}
          >
            <div style={{ height: 84 }} />

            {/* Auto */}
            <div className="flex items-center justify-center" style={{ height: 120 }}>
              <button
                type="button"
                onClick={onAuto}
                className={`relative flex h-[100px] w-[156px] flex-col items-center justify-center gap-1 overflow-hidden rounded-[56px] border-[1.5px] transition-all duration-200 ease-out active:scale-95 ${
                  autoActive ? "border-white/80" : "border-white/20"
                }`}
              >
                <div className="absolute inset-0 rounded-[inherit] bg-white/10 backdrop-blur-[12px]" />
                <Sparkles
                  className={`relative size-5 ${
                    autoActive ? "text-[#D97757]" : "text-white"
                  }`}
                />
                <span className="relative text-xs font-medium text-white">Auto</span>
              </button>
            </div>

            {/* Presets */}
            {options.map((name) => {
              const active = selected.includes(name);
              const media = images?.[name];
              const isVideo = media?.endsWith(".mp4");
              return (
                <div
                  key={name}
                  className="flex items-center justify-center"
                  style={{ height: 120 }}
                >
                  <button
                    type="button"
                    onClick={() => onToggle(name)}
                    className={`relative flex h-[100px] w-[156px] items-end justify-center overflow-hidden rounded-[56px] border-[1.5px] p-4 text-center transition-all duration-200 ease-out active:scale-95 ${
                      active ? "border-[#D97757]" : "border-white/10"
                    }`}
                    style={{
                      background: !isVideo && media
                        ? `url(${media}) center / cover no-repeat, ${thumbFor(name)}`
                        : thumbFor(name),
                    }}
                  >
                    {/* Video layer */}
                    {isVideo && media && (
                      <video
                        src={media}
                        autoPlay
                        muted
                        loop
                        playsInline
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    )}
                    <span className="relative z-10 text-xs font-medium text-white drop-shadow">
                      {name}
                    </span>
                  </button>
                </div>
              );
            })}

            <div style={{ height: 84 }} />
          </div>
        </div>
      </div>

      {/* Scroll buttons — visible in both modes */}
      <button
        type="button"
        aria-label={`Scroll ${title} up`}
        onClick={scrollUp}
        className={`${SCROLL_BTN} top-[32px]`}
      >
        <Chevron up />
      </button>
      <button
        type="button"
        aria-label={`Scroll ${title} down`}
        onClick={scrollDown}
        className={`${SCROLL_BTN} bottom-2`}
      >
        <Chevron />
      </button>
    </div>
  );
}

export default function StyleModal({
  open,
  onClose,
  value,
  onChange,
  docked = false,
}: StyleModalProps) {
  const [manual, setManual] = useState(false);

  const toggle = (key: StyleKey, name: string) => {
    const arr = value[key] ?? [];
    const next = arr.includes(name)
      ? arr.filter((x) => x !== name)
      : [...arr, name];
    onChange({ ...value, [key]: next });
  };
  const clear = (key: StyleKey) => onChange({ ...value, [key]: [] });

  const woAuto = (list: string[]) => list.filter((o) => o !== "Auto");

  if (!open) return null;

  const header = (
    <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
      <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-white">
        Style Settings
      </h2>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setManual((m) => !m)}
          className={`flex h-8 items-center gap-1.5 rounded-[18px] px-3 text-xs font-medium transition-all duration-200 ease-out active:scale-95 ${
            manual
              ? "bg-[#D97757]/10 text-[#D97757]"
              : "bg-white/5 text-neutral-300 hover:bg-white/10"
          }`}
        >
          ✏️ Manual Style · {manual ? "On" : "Off"}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition-all duration-200 ease-out hover:bg-white/10 hover:text-white active:scale-95"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const columnsGrid = (
    <div className="grid grid-cols-3" style={{ height: docked ? "auto" : "420px" }}>
      <Column
        title="Color Palette"
        options={woAuto(COLOR_PALETTES)}
        images={COLOR_IMAGES}
        selected={value.colorPalette ?? []}
        onToggle={(n) => toggle("colorPalette", n)}
        onAuto={() => clear("colorPalette")}
      />
      <Column
        title="Lighting"
        options={woAuto(LIGHTING)}
        images={LIGHTING_IMAGES}
        selected={value.lighting ?? []}
        onToggle={(n) => toggle("lighting", n)}
        onAuto={() => clear("lighting")}
      />
      <Column
        title="Camera Moveset Style"
        options={woAuto(CAMERA_MOVEMENTS)}
        images={CAMERA_IMAGES}
        selected={value.cameraMovement ?? []}
        onToggle={(n) => toggle("cameraMovement", n)}
        onAuto={() => clear("cameraMovement")}
      />
    </div>
  );

  if (docked) {
    return (
      <div className="flex h-[27rem] w-full flex-col gap-3 overflow-hidden rounded-[20px] p-1 backdrop-blur-[20px] shadow-[0_12px_8px_0_rgba(0,0,0,0.20),inset_0_0_0_1px_rgba(217,217,217,0.04)] bg-gradient-to-b from-[rgba(21,21,21,0.88)] to-[rgba(21,21,21,0.88)]">
        {header}
        <div className="min-h-0 flex-1" style={{ height: "auto" }}>
          {columnsGrid}
        </div>
      </div>
    );
  }

  return (
    <ModalShell open={open} onClose={onClose} className="w-[860px] max-w-[95vw]">
      {header}
      {columnsGrid}
    </ModalShell>
  );
}
