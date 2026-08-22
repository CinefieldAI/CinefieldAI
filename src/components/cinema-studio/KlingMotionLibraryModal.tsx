"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MOTION_LIBRARY_PRESETS } from "./motionLibraryPresets";

interface KlingMotionLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Rendered as two lines, uppercase. */
  titleLines: [string, string];
  subtitle: string;
  /** Left drop zone caption (the clip to copy). */
  primaryLabel: string;
  primaryHint: string;
  /** Right drop zone caption (the character image). */
  secondaryLabel: string;
  secondaryHint: string;
}

type Tab = "upload" | "library";

/** Video glyph on the left drop zone. */
function VideoIcon() {
  return (
    <svg className="size-4" aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2 5.75C2 4.7835 2.7835 4 3.75 4H14.25C15.2165 4 16 4.7835 16 5.75V8.78669L20.191 6.6912C21.0221 6.27563 22 6.88 22 7.80923V16.1912C22 17.1204 21.0221 17.7248 20.191 17.3092L16 15.2137V18.25C16 19.2165 15.2165 20 14.25 20H3.75C2.7835 20 2 19.2165 2 18.25V5.75ZM16 13.5367L20.5 15.7867V8.21374L16 10.4637V13.5367Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Plus glyph on the right drop zone. */
function PlusIcon() {
  return (
    <svg className="size-4" aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 3C12.4142 3 12.75 3.33579 12.75 3.75V11.25H20.25C20.6642 11.25 21 11.5858 21 12C21 12.4142 20.6642 12.75 20.25 12.75H12.75V20.25C12.75 20.6642 12.4142 21 12 21C11.5858 21 11.25 20.6642 11.25 20.25V12.75H3.75C3.33579 12.75 3 12.4142 3 12C3 11.5858 3.33579 11.25 3.75 11.25H11.25V3.75C11.25 3.33579 11.5858 3 12 3Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Muted / unmuted speaker, bottom-right of each library tile. */
function MuteIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M11.3333 3.95956V2.81723C11.3333 2.13798 10.5643 1.74407 10.0131 2.14095L6.72353 4.50943C6.5817 4.61155 6.41136 4.66649 6.2366 4.66649H5.16666C4.15415 4.66649 3.33333 5.4873 3.33333 6.49982V9.4998C3.33333 10.1667 3.68936 10.7503 4.22171 11.0712L6.72437 11.4902L11.3342 6.78674V3.95956H11.3333Z"
        fill="currentColor"
      />
      <path
        d="M6.72437 11.4902C6.70604 11.477 6.68717 11.4646 6.66797 11.4529L11.3342 6.78674V13.1824C11.3342 13.8617 10.5652 14.2556 10.0139 13.8587L6.72437 11.4902Z"
        fill="currentColor"
      />
      {muted && (
        <path
          d="M13.8535 2.14645C13.6583 1.95119 13.3417 1.95119 13.1465 2.14645L2.14644 13.1465C1.95118 13.3417 1.95118 13.6583 2.14644 13.8535C2.3417 14.0488 2.65829 14.0488 2.85355 13.8535L13.8535 2.85355C14.0488 2.65829 14.0488 2.34171 13.8535 2.14645Z"
          fill="currentColor"
        />
      )}
    </svg>
  );
}

/** One library tile. The clip is optional — a tile whose file is missing keeps
 *  its slot and shows the placeholder, so the grid never has holes. */
function PresetTile({
  id,
  label,
  ratio,
  selected,
  onSelect,
}: {
  id: string;
  label: string;
  ratio: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const [muted, setMuted] = useState(true);
  const [hasClip, setHasClip] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  return (
    <aside
      className={`relative mb-2 cursor-pointer overflow-hidden rounded-xl border transition-colors ${
        selected ? "border-[#D97757]" : "border-transparent hover:border-white/20"
      }`}
      onClick={onSelect}
    >
      <figure className="group relative size-full" style={{ aspectRatio: `${ratio} / 1` }}>
        {hasClip ? (
          <video
            ref={videoRef}
            loop
            playsInline
            muted={muted}
            preload="none"
            poster={`/motion-library/${id}.webp`}
            src={`/motion-library/${id}.mp4`}
            onError={() => setHasClip(false)}
            onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
            onMouseLeave={(e) => e.currentTarget.pause()}
            className="size-full object-cover"
            aria-label={label}
          />
        ) : (
          <div
            className="flex size-full items-center justify-center bg-[linear-gradient(150deg,rgba(217,119,87,0.18)_0%,rgba(28,30,32,1)_60%)]"
            aria-label={label}
          >
            <span className="text-[11px] font-semibold text-white/35">{label}</span>
          </div>
        )}
      </figure>

      <button
        type="button"
        aria-label={muted ? `Unmute ${label}` : `Mute ${label}`}
        onClick={(e) => {
          e.stopPropagation();
          setMuted((m) => !m);
        }}
        className="absolute bottom-2 right-2 z-[1] flex size-8 items-center justify-center rounded-full border-0 bg-black/20 text-white transition-colors duration-200 hover:bg-black/40 focus:outline-none md:size-10"
      >
        <MuteIcon muted={muted} />
      </button>
    </aside>
  );
}

export default function KlingMotionLibraryModal({
  isOpen,
  onClose,
  titleLines,
  subtitle,
  primaryLabel,
  primaryHint,
  secondaryLabel,
  secondaryHint,
}: KlingMotionLibraryModalProps) {
  const [tab, setTab] = useState<Tab>("upload");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === "undefined") return null;

  const tabClass = (active: boolean) =>
    `h-8 shrink-0 whitespace-nowrap rounded-[10px] border px-3 text-xs font-semibold transition-colors ${
      active
        ? "border-[rgba(217,217,217,0.08)] bg-white/5 text-white"
        : "border-transparent bg-transparent text-[#898A8B] hover:text-white/70"
    }`;

  return createPortal(
    <>
      {/* Click-outside layer. The dialog itself is centred on top of it. */}
      <div
        className="fixed inset-0 z-[999998] bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${titleLines[0]} ${titleLines[1]}`}
        className="fixed bottom-0 left-1/2 z-[999999] flex w-full max-w-full -translate-x-1/2 justify-center md:bottom-auto md:top-1/2 md:w-auto md:max-w-[calc(100vw-32px)] md:-translate-y-1/2"
      >
        <div className="w-[min(960px,calc(100vw-32px))]">
          <div className="relative flex h-[min(35rem,calc(100vh-32px))] w-full flex-col gap-2 overflow-hidden rounded-[20px] p-1 shadow-[0_12px_8px_0_rgba(0,0,0,0.20),inset_0_0_0_1px_rgba(217,217,217,0.08)] backdrop-blur-[20px] bg-[linear-gradient(0deg,rgba(21,21,21,0.88)_0%,rgba(21,21,21,0.88)_100%),linear-gradient(41deg,rgba(217,119,87,0.24)_25.53%,rgba(217,119,87,0.00)_63.06%)]">
            {/* Close. Sits above the panel body so it stays clickable. */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3 top-3 z-[100] flex size-8 cursor-pointer items-center justify-center rounded-full border border-[rgba(217,217,217,0.08)] bg-white/5 hover:bg-white/10"
            >
              <svg className="size-4 text-[#898A8B]" aria-hidden="true" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4.75 4.75L19.25 19.25M19.25 4.75L4.75 19.25"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            {/* Header */}
            <div className="relative flex shrink-0 items-center overflow-hidden rounded-2xl px-6">
              <div className="z-10 flex flex-1 flex-col gap-2 py-6">
                <h2 className="text-[28px] font-bold uppercase leading-9 tracking-tight text-white">
                  {titleLines[0]}
                  <br />
                  {titleLines[1]}
                </h2>
                <p className="max-w-[324px] text-sm text-[#898A8B]">{subtitle}</p>
              </div>
              <div className="relative z-10 hidden h-[168px] w-[340px] shrink-0 overflow-hidden rounded-xl bg-[linear-gradient(120deg,rgba(217,119,87,0.35)_0%,rgba(28,30,32,1)_70%)] sm:block" />
            </div>

            {/* Body */}
            <div className="flex h-full flex-col gap-1 justify-start overflow-hidden">
              <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-[#2E3132] p-2">
                <div className="mb-4 flex flex-none items-center justify-between pr-10">
                  <nav className="hide-scrollbar mr-2 flex items-center gap-1 overflow-x-auto">
                    <button type="button" onClick={() => setTab("upload")} className={tabClass(tab === "upload")}>
                      Upload
                    </button>
                    <button type="button" onClick={() => setTab("library")} className={tabClass(tab === "library")}>
                      Motion library
                    </button>
                  </nav>
                </div>

                <div className="hide-scrollbar h-full overflow-y-auto">
                  {tab === "upload" ? (
                    <div className="flex h-full min-h-0 w-full flex-1 gap-2">
                      <DropZone accept="video/*" icon={<VideoIcon />} label={primaryLabel} hint={primaryHint} />
                      <DropZone accept="image/*" icon={<PlusIcon />} label={secondaryLabel} hint={secondaryHint} />
                    </div>
                  ) : (
                    <div className="size-full">
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                        {MOTION_LIBRARY_PRESETS.map((p) => (
                          <PresetTile
                            key={p.id}
                            id={p.id}
                            label={p.label}
                            ratio={p.ratio}
                            selected={selected === p.id}
                            onSelect={() => setSelected(p.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

function DropZone({
  accept,
  icon,
  label,
  hint,
}: {
  accept: string;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <label className="h-[320px] flex-1 cursor-pointer rounded-[20px] border border-[rgba(217,217,217,0.08)] bg-[#111214] p-1 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
      <div className="flex size-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 bg-[#1C1E20] p-3">
        <input accept={accept} className="sr-only" type="file" />
        <div
          aria-hidden="true"
          className="grid size-9 aspect-square items-center justify-center rounded-full bg-white/[0.04] p-2.5 text-[#898A8B] backdrop-blur-[2px]"
          style={{
            boxShadow:
              "rgba(0,0,0,0.09) 0px 20.533px 20.533px 0px, rgba(0,0,0,0.1) 0px 5.059px 11.308px 0px, rgba(185,185,185,0.35) 0px -0.298px 5.356px 0px inset",
          }}
        >
          {icon}
        </div>
        <div className="flex w-full min-w-0 flex-col items-center gap-1 text-center">
          <p className="max-w-full text-balance text-[11px] font-semibold text-white">{label}</p>
          <p className="max-w-full text-balance text-[11px] font-medium text-[#898A8B]">{hint}</p>
        </div>
      </div>
    </label>
  );
}
