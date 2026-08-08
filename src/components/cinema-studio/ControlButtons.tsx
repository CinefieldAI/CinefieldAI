"use client";

import { Camera, Sparkles, Theater } from "lucide-react";

interface ControlButtonsProps {
  genre: string;
  styleLabel: string;
  cameraLabel: string;
  genreActive: boolean;
  styleActive: boolean;
  cameraActive: boolean;
  onOpenGenre: () => void;
  onOpenStyle: () => void;
  onOpenCamera: () => void;
}

function ControlButton({
  icon: Icon,
  label,
  value,
  preview,
  active,
  onClick,
}: {
  icon: typeof Camera;
  label: string;
  value: string;
  preview: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 rounded-[18px] px-2 py-1 text-sm font-medium transition-all duration-200 ease-out focus:outline-none ${
        active
          ? "bg-[#D97757]/10 text-[#D97757]"
          : "bg-[rgba(255,255,255,0.05)] text-neutral-300 hover:bg-[rgba(255,255,255,0.08)]"
      }`}
    >
      <span key={value} className="inline-flex items-center gap-1.5 animate-genre-jump">
        {/* Small circular preview */}
        <span
          className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
            active ? "border-[#D97757]/60" : "border-white/10"
          }`}
          style={{ background: preview }}
        >
          <Icon className="size-3 text-white/80" />
        </span>
        <span className="text-neutral-500">{label}</span>
        <span className="max-w-[160px] truncate">{value}</span>
      </span>
    </button>
  );
}

export default function ControlButtons({
  genre,
  styleLabel,
  cameraLabel,
  genreActive,
  styleActive,
  cameraActive,
  onOpenGenre,
  onOpenStyle,
  onOpenCamera,
}: ControlButtonsProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <ControlButton
        icon={Theater}
        label="Genre"
        value={genre}
        preview="linear-gradient(135deg,#4361ee,#1a1a4a)"
        active={genreActive}
        onClick={onOpenGenre}
      />
      <ControlButton
        icon={Sparkles}
        label="Style"
        value={styleLabel}
        preview="linear-gradient(135deg,#9b5de5,#2a1a4a)"
        active={styleActive}
        onClick={onOpenStyle}
      />
      <ControlButton
        icon={Camera}
        label="Camera"
        value={cameraLabel}
        preview="linear-gradient(135deg,#00e5ff,#005a66)"
        active={cameraActive}
        onClick={onOpenCamera}
      />
    </div>
  );
}
