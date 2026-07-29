"use client";

import { Plus, X } from "lucide-react";

interface FrameCardProps {
  /** e.g. "Start Frame" or "End Frame" — shown as the empty-state label and used for aria-labels. */
  label: string;
  value: string | null;
  onOpenPicker: () => void;
  onRemove?: () => void;
  /**
   * "frame" (default) — existing Start/End Frame behavior, unchanged.
   * "reference" — Kling 3.0 Omni Edit's Video Reference tile: plus button
   * top-left and the label always visible (not swapped for a hover "Change"
   * state), no remove button (re-click reopens the picker to change it).
   * "general" — Kling 2.6 / Kling O1 Video's GENERAL preset tile: solid
   * background (no local preset video asset exists yet), edit-pencil icon
   * on hover, label always visible. Not wired to a real presets panel yet.
   * "cinema25" — Cinema Studio 2.5's Start/End Frame: plus circle top-left
   * (+ "Optional" badge when optional), label bottom-left, gradient surface,
   * value preview + remove. Matches the Higgsfield reference exactly.
   */
  variant?: "frame" | "reference" | "general" | "cinema25";
  /** "frame" variant only — hides the "Optional" label for mandatory slots (default true, matches existing behavior). */
  optional?: boolean;
  /** Opt-in a11y for callers whose onOpenPicker toggles a dialog/panel open state (e.g. Seedance Pro Fast). Omitted for every pre-existing caller — no attribute is rendered unless passed. */
  ariaHaspopup?: "dialog";
  ariaExpanded?: boolean;
}

/** Verbatim reference icon — diagonal pencil-with-tip stroke (GENERAL tile's hover edit affordance). */
function EditIcon() {
  return (
    <svg aria-hidden="true" width="24px" height="24px" viewBox="0 0 24 24" fill="none" className="size-3">
      <path
        d="M13.25 6.24997L16.2929 3.20708C16.6834 2.81655 17.3166 2.81655 17.7071 3.20708L20.7929 6.29286C21.1834 6.68339 21.1834 7.31655 20.7929 7.70708L17.75 10.75M13.25 6.24997L3.04289 16.4571C2.85536 16.6446 2.75 16.899 2.75 17.1642V21.25H6.83579C7.101 21.25 7.35536 21.1446 7.54289 20.9571L17.75 10.75M13.25 6.24997L17.75 10.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExactFrameSurface({
  label,
  value,
  onOpenPicker,
  onRemove,
  optional,
  ariaHaspopup,
  ariaExpanded,
}: Pick<FrameCardProps, "label" | "value" | "onOpenPicker" | "onRemove" | "optional" | "ariaHaspopup" | "ariaExpanded">) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-prompt-frame-card
      onClick={onOpenPicker}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpenPicker();
      }}
      aria-label={label}
      aria-haspopup={ariaHaspopup}
      aria-expanded={ariaExpanded}
      className="size-[80px] rounded-xl p-1.5 flex flex-col items-start justify-between overflow-clip relative cursor-pointer group shrink-0"
      style={{
        background: value
          ? `url(${value}) center / cover no-repeat`
          : "linear-gradient(rgb(32, 32, 32) 0%, rgb(80, 79, 79) 100%)",
        boxShadow:
          "rgba(0, 0, 0, 0.08) 10px 34px 24px 0px, rgba(0, 0, 0, 0.01) 8px 21px 6px 0px, rgba(0, 0, 0, 0.12) 3px 7px 5px 0px, rgba(0, 0, 0, 0.32) 1px 3px 4px 0px, rgba(0, 0, 0, 0.32) 0px 1px 2px 0px, rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset",
      }}
    >
      <div aria-hidden="true" className="absolute inset-0 rounded-xl pointer-events-none opacity-0 transition-opacity duration-200 group-hover:opacity-50" style={{ background: "linear-gradient(rgb(32, 32, 32) 34.513%, rgb(80, 79, 79) 157.89%)" }} />
      <div className="flex items-start w-full shrink-0 relative">
        <div className="bg-black/10 flex items-center rounded-full shrink-0">
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); onOpenPicker(); }}
            className="size-5 flex items-center justify-center rounded-full border border-[rgba(197,197,197,0.3)] bg-white/[0.04] text-white shadow-[inset_0_0_4px_rgba(185,185,185,0.35)] backdrop-blur-[3px]"
            aria-label={`Add ${label}`}
          >
            <Plus className="size-3" />
          </button>
          {optional && <span className="px-2 text-[8px] font-semibold leading-2 text-icon-secondary">Optional</span>}
        </div>
      </div>
      <p className="font-grotesk text-[12px] font-bold leading-[14px] uppercase tracking-[-0.1px] text-white relative shrink-0">{label}</p>
      {value && onRemove && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label={`Remove ${label}`} className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-[#0a0a0a] text-neutral-300 shadow ring-1 ring-white/10 hover:text-white">
          <X className="size-2.5" />
        </button>
      )}
    </div>
  );
}

/** Generic 80x80 optional reference card (Kling 3.0 Turbo's Start Frame, Google Veo 3.1 Lite's Start/End Frame, Kling 3.0 Omni Edit's Video Reference, Kling 2.6 / O1 Video's GENERAL preset tile). */
export default function FrameCard({
  label,
  value,
  onOpenPicker,
  onRemove,
  variant = "frame",
  optional = true,
  ariaHaspopup,
  ariaExpanded,
}: FrameCardProps) {
  if (variant === "general") {
    return (
      <button
        type="button"
        data-prompt-frame-card
        data-panel-toggle
        onClick={onOpenPicker}
        aria-label={label}
        aria-haspopup={ariaHaspopup}
        aria-expanded={ariaExpanded}
        className="group relative flex h-[80px] w-[80px] shrink-0 flex-col items-start justify-between overflow-hidden rounded-xl bg-[#202020] p-1.5"
        style={{
          boxShadow:
            "10px 34px 24px 0px rgba(0,0,0,0.08), 8px 21px 6px 0px rgba(0,0,0,0.01), 3px 7px 5px 0px rgba(0,0,0,0.12), 1px 3px 4px 0px rgba(0,0,0,0.32), 0px 1px 2px 0px rgba(0,0,0,0.32), 0px 0px 0px 1px rgba(255,255,255,0.04) inset",
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-b from-transparent to-[#202020]"
        />
        <span className="relative z-[2] flex w-full shrink-0 items-center justify-between opacity-0 transition-opacity group-hover:opacity-100">
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white backdrop-blur-[3px]"
            style={{ boxShadow: "0px 0px 4px 0px rgba(185,185,185,0.35) inset" }}
          >
            <EditIcon />
          </span>
        </span>
        <p className="relative z-[2] text-left text-[12px] font-bold uppercase leading-[14px] tracking-[-0.1px] text-white">
          {label}
        </p>
      </button>
    );
  }

  if (variant === "cinema25") {
    return <ExactFrameSurface label={label} value={value} onOpenPicker={onOpenPicker} onRemove={onRemove} optional={optional} ariaHaspopup={ariaHaspopup} ariaExpanded={ariaExpanded} />;
  }

  if (variant === "reference") {
    return (
      <div
        role="button"
        tabIndex={0}
        data-prompt-frame-card
        onClick={onOpenPicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onOpenPicker();
        }}
        aria-label={label}
        className="gen-panel-reference-element-button group relative flex h-[80px] w-[80px] shrink-0 cursor-pointer flex-col items-start justify-between overflow-hidden rounded-xl p-1.5"
        style={{
          backgroundImage: value
            ? `url(${value})`
            : "linear-gradient(rgb(32, 32, 32) 0%, rgb(80, 79, 79) 100%)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          boxShadow:
            "0 10px 34px 24px rgba(0,0,0,0.08), 0 8px 21px 6px rgba(0,0,0,0.01), 0 3px 7px 5px rgba(0,0,0,0.12), 0 1px 3px 4px rgba(0,0,0,0.32), 0 0 2px 0 rgba(0,0,0,0.32), 0 0 0 1px rgba(255,255,255,0.04) inset",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-200 group-hover:opacity-50"
          style={{ background: "linear-gradient(rgb(32,32,32) 34.513%, rgb(80,79,79) 157.89%)" }}
        />
        <span
          className="relative flex size-5 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/5 text-white backdrop-blur-[3px]"
          style={{ boxShadow: "rgba(185,185,185,0.35) 0px 0px 4px 0px inset" }}
        >
          <Plus className="size-3" />
        </span>
        <p className="relative shrink-0 text-[12px] font-bold uppercase leading-[14px] tracking-[-0.1px] text-white">
          {label}
        </p>
      </div>
    );
  }

  return (
    <ExactFrameSurface label={label} value={value} onOpenPicker={onOpenPicker} onRemove={onRemove} optional={optional} ariaHaspopup={ariaHaspopup} ariaExpanded={ariaExpanded} />
  );
}
