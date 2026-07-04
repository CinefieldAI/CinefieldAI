"use client";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import ModalShell from "./ModalShell";
import Wheel from "./Wheel";
import ControlButtons from "./ControlButtons";
import { GENRES } from "./cinemaStudioData";

interface GenreModalProps {
  open: boolean;
  onClose: () => void;
  selected?: string;
  onSelect: (genre: string) => void;
  // Header tab switching
  styleLabel: string;
  cameraLabel: string;
  styleActive: boolean;
  cameraActive: boolean;
  onOpenStyle: () => void;
  onOpenCamera: () => void;
}

const NAMES = GENRES.map((g) => g.name);

function genreFor(name: string) {
  return GENRES.find((g) => g.name === name) ?? GENRES[0];
}

/** Genre circle — plays its preview clip if one exists, else a gradient. */
function GenreVisual({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const genre = genreFor(name);
  if (genre.video) {
    return (
      <video
        key={genre.video}
        className={`${className} object-cover object-center`}
        src={genre.video}
        autoPlay
        loop
        muted
        playsInline
      />
    );
  }
  return <div className={className} style={{ background: genre.gradient }} />;
}

/** Genre list opacity by distance from the centered selection. */
function genreFade(d: number) {
  const opacity = [1, 0.716667, 0.433333, 0.15][Math.min(d, 3)];
  return { opacity, scale: 1 };
}

export default function GenreModal({
  open,
  onClose,
  selected,
  onSelect,
  styleLabel,
  cameraLabel,
  styleActive,
  cameraActive,
  onOpenStyle,
  onOpenCamera,
}: GenreModalProps) {
  const current = selected ?? "General";
  const index = Math.max(0, NAMES.indexOf(current));

  const step = (delta: number) => {
    const next = NAMES[(index + delta + NAMES.length) % NAMES.length];
    onSelect(next);
  };

  const pick = (name: string) => {
    onSelect(name);
    onClose();
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      bare
      className="flex w-[min(876px,calc(100vw-32px))] flex-col gap-2"
    >
      {/* Top panel — selected settings (Genre / Style / Camera) */}
      <div className="h-14 overflow-x-auto rounded-[20px] bg-gradient-to-r from-[#141619] to-[#27292b] p-[3px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ControlButtons
          genre={current}
          styleLabel={styleLabel}
          cameraLabel={cameraLabel}
          genreActive
          styleActive={styleActive}
          cameraActive={cameraActive}
          onOpenGenre={() => {}}
          onOpenStyle={onOpenStyle}
          onOpenCamera={onOpenCamera}
        />
      </div>

      {/* Main panel */}
      <div
        className="flex h-[27rem] max-h-[calc(100vh-8rem)] flex-col rounded-[20px] p-1 backdrop-blur-[20px]"
        style={{
          boxShadow:
            "0 12px 8px 0 rgba(0,0,0,0.20), inset 0 0 0 1px rgba(217,217,217,0.04)",
          backgroundImage:
            "linear-gradient(0deg, rgba(21,21,21,0.88) 0%, rgba(21,21,21,0.88) 100%), linear-gradient(20deg, rgba(101,189,235,0.24) 25.53%, rgba(101,189,235,0) 63.06%)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1">
          <h2 className="text-sm font-semibold text-white">Genre</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-full text-neutral-400 transition-all duration-200 ease-out hover:bg-white/10 hover:text-white active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-white/5">
          {/* Decorative ambient glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              left: -100,
              top: -150,
              width: 600,
              height: 600,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 60%, transparent 100%)",
            }}
          />

          <div className="relative flex h-full items-center justify-center gap-10 px-10">
            {/* Central preview circle */}
            <div
              className="shrink-0 overflow-hidden rounded-full bg-black"
              style={{
                width: 260,
                height: 260,
                minWidth: 260,
                minHeight: 260,
                flexShrink: 0,
                aspectRatio: "1 / 1",
                boxShadow:
                  "0 0 0 1px rgba(255,255,255,0.08), inset 0 -2px 8px 0 rgba(0,0,0,0.12)",
              }}
            >
              <GenreVisual key={current} name={current} className="h-full w-full" />
            </div>

            {/* Genre list */}
            <div className="flex h-full flex-1 items-stretch gap-3">
              <Wheel
                options={NAMES}
                value={current}
                onChange={pick}
                fade={genreFade}
                className="h-full w-[220px] flex-none"
                gapClass="gap-2"
                renderItem={(name, { active }) => (
                  <div className="flex w-[220px] items-center gap-4">
                    <span
                      className={`block size-11 shrink-0 overflow-hidden rounded-full bg-black aspect-square ${
                        active ? "ring-1 ring-white/5" : ""
                      }`}
                      style={{ minWidth: "2.75rem", minHeight: "2.75rem", flexShrink: 0 }}
                    >
                      <GenreVisual name={name} className="h-full w-full" />
                    </span>
                    <span
                      className={`truncate text-lg tracking-[-0.18px] ${
                        active ? "font-medium text-white" : "font-medium text-neutral-400"
                      }`}
                    >
                      {name}
                    </span>
                  </div>
                )}
              />

              {/* Up / Down navigation */}
              <div className="flex flex-col items-center justify-center gap-2">
                <button
                  type="button"
                  aria-label="Previous genre"
                  onClick={() => step(-1)}
                  className="flex size-10 items-center justify-center rounded-full border border-[rgba(197,197,197,0.3)] bg-white/[0.04] text-white backdrop-blur-[4px] transition-all duration-200 ease-out hover:bg-white/[0.08] active:scale-95"
                  style={{ boxShadow: "inset 0 -0.3px 5.4px 0 rgba(185,185,185,0.35)" }}
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next genre"
                  onClick={() => step(1)}
                  className="flex size-10 items-center justify-center rounded-full border border-[rgba(197,197,197,0.3)] bg-white/[0.04] text-white backdrop-blur-[4px] transition-all duration-200 ease-out hover:bg-white/[0.08] active:scale-95"
                  style={{ boxShadow: "inset 0 -0.3px 5.4px 0 rgba(185,185,185,0.35)" }}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
