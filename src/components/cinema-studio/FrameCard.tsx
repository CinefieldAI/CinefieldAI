"use client";

import { Plus, X } from "lucide-react";

interface FrameCardProps {
  /** e.g. "Start Frame" or "End Frame" — shown as the empty-state label and used for aria-labels. */
  label: string;
  value: string | null;
  onOpenPicker: () => void;
  onRemove: () => void;
}

/** Generic 80x80 optional reference-image card (Kling 3.0 Turbo's Start Frame, Google Veo 3.1 Lite's Start/End Frame). */
export default function FrameCard({ label, value, onOpenPicker, onRemove }: FrameCardProps) {
  return (
    <div className="group relative h-[80px] w-[80px] shrink-0">
      <button
        type="button"
        onClick={onOpenPicker}
        aria-label={label}
        className="relative flex h-full w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-white/10 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_4px_10px_rgba(0,0,0,0.35)] transition-colors hover:border-white/20"
        style={{
          backgroundImage: value
            ? `url(${value})`
            : "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(0,0,0,0.2) 100%)",
          backgroundColor: "#131517",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {!value && (
          <>
            <span className="flex size-5 items-center justify-center rounded-full bg-white/10 text-white">
              <Plus className="size-3" />
            </span>
            <span className="text-[9px] font-medium leading-tight text-neutral-400">
              Optional
            </span>
            <span className="text-[9px] font-semibold uppercase leading-tight tracking-wide text-neutral-300">
              {label}
            </span>
          </>
        )}

        {value && (
          <span className="absolute inset-0 flex items-end justify-center bg-black/0 pb-1 opacity-0 transition-opacity group-hover:bg-black/40 group-hover:opacity-100">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-white">
              Change
            </span>
          </span>
        )}
      </button>

      {value && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${label}`}
          className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-[#0a0a0a] text-neutral-300 shadow ring-1 ring-white/10 transition-colors hover:text-white"
        >
          <X className="size-2.5" />
        </button>
      )}
    </div>
  );
}
