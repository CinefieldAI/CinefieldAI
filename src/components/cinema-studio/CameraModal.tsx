"use client";

import { X } from "lucide-react";
import ModalShell from "./ModalShell";
import Wheel from "./Wheel";
import {
  APERTURES,
  CAMERAS,
  LENSES,
  type CinemaStudioSettings,
} from "./cinemaStudioData";

type CameraValue = NonNullable<CinemaStudioSettings["camera"]>;

interface CameraModalProps {
  open: boolean;
  onClose: () => void;
  value: CameraValue;
  onChange: (next: CameraValue) => void;
}

function thumbFor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 45% 30%), hsl(${(h + 40) % 360} 35% 12%))`;
}

function cameraFade(d: number) {
  if (d === 0) return { opacity: 1, scale: 1 };
  if (d === 1) return { opacity: 0.4, scale: 0.9 };
  return { opacity: 0.15, scale: 0.6 };
}

function Capsule({ label, active }: { label: string; active: boolean }) {
  return (
    <div
      className="flex h-[100px] w-[156px] items-end justify-center rounded-[56px] border-2 p-4 text-center transition-all duration-200 ease-out"
      style={{
        background: thumbFor(label),
        borderColor: active ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.1)",
      }}
    >
      <span className="text-xs font-medium text-white drop-shadow">{label}</span>
    </div>
  );
}

function Column({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative flex min-w-0 flex-col border-l border-white/[0.06] first:border-l-0">
      <p className="px-4 pb-1 pt-4 text-center text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
        {title}
      </p>
      <Wheel
        options={options}
        value={value}
        onChange={onChange}
        fade={cameraFade}
        gapClass="gap-3"
        className="flex-1"
        renderItem={(opt, { active }) => <Capsule label={opt} active={active} />}
      />
    </div>
  );
}

export default function CameraModal({
  open,
  onClose,
  value,
  onChange,
}: CameraModalProps) {
  const focal = value.focalLength ?? 35;

  return (
    <ModalShell open={open} onClose={onClose} className="w-[860px] max-w-[95vw]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-white">
          Camera Settings
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition-all duration-200 ease-out hover:bg-white/10 hover:text-white active:scale-95"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Wheel columns */}
      <div className="grid h-[400px] grid-cols-3">
        <Column
          title="Camera"
          options={CAMERAS}
          value={value.camera ?? "Auto"}
          onChange={(v) => onChange({ ...value, camera: v })}
        />
        <Column
          title="Lens"
          options={LENSES}
          value={value.lens ?? "Auto"}
          onChange={(v) => onChange({ ...value, lens: v })}
        />
        <Column
          title="Aperture"
          options={APERTURES}
          value={value.aperture ?? "Auto"}
          onChange={(v) => onChange({ ...value, aperture: v })}
        />
      </div>

      {/* Focal length slider */}
      <div className="border-t border-white/10 px-6 py-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            Focal Length
          </p>
          <span className="text-sm font-semibold text-[#D97757]">{focal}mm</span>
        </div>
        <input
          type="range"
          min={8}
          max={75}
          value={focal}
          onChange={(e) =>
            onChange({ ...value, focalLength: Number(e.target.value) })
          }
          aria-label="Focal length"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-[#D97757] focus:outline-none focus:ring-2 focus:ring-[#D97757]"
        />
      </div>
    </ModalShell>
  );
}
