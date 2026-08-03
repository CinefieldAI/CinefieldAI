"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, ChevronUp, ChevronDown } from "lucide-react";
import { genrePresets, DEFAULT_GENRE } from "./genrePresetsData";

interface GenrePanelProps {
  open: boolean;
  onClose: () => void;
  selected?: string;
  onSelect?: (genre: string) => void;
  docked?: boolean;
}

// Symmetric Parabolic Circular Arc positioning constants
const ARC_CONFIG = {
  centerY: 172,
  stepY: 60,
};

const ARC_X_POSITIONS = [57.6, 54.6764, 46.2023, 33.038];

const calculateArcPosition = (
  distFromSelected: number,
  isAbove: boolean
): { x: number; y: number; opacity: number } => {
  const offset = isAbove ? -distFromSelected : distFromSelected;
  const y = ARC_CONFIG.centerY + offset * ARC_CONFIG.stepY;

  const absOffset = Math.abs(offset);
  const lowerDistance = Math.min(
    Math.floor(absOffset),
    ARC_X_POSITIONS.length - 1
  );
  const upperDistance = Math.min(
    lowerDistance + 1,
    ARC_X_POSITIONS.length - 1
  );
  const interpolation = absOffset - Math.floor(absOffset);
  const easedInterpolation = interpolation * interpolation * (3 - 2 * interpolation);
  const x =
    ARC_X_POSITIONS[lowerDistance] +
    (ARC_X_POSITIONS[upperDistance] - ARC_X_POSITIONS[lowerDistance]) *
      easedInterpolation;

  let opacity = 1;
  if (distFromSelected === 0) opacity = 1;
  else if (distFromSelected === 1) opacity = 0.716667;
  else if (distFromSelected === 2) opacity = 0.433333;
  else opacity = 0.15;

  return { x, y, opacity };
};

const wrapIndex = (i: number, len: number) => ((i % len) + len) % len;

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const STEP_MS = 450;
const CLICK_STEP_MS = 360;
const CLICK_MAX_MS = 520;

const opacityForDistance = (distance: number) => {
  if (distance <= 1) return 1 - (1 - 0.716667) * distance;
  if (distance <= 2) {
    return 0.716667 - (0.716667 - 0.433333) * (distance - 1);
  }
  if (distance <= 3) {
    return 0.433333 - (0.433333 - 0.15) * (distance - 2);
  }
  return 0.15;
};

export default function GenrePanel({
  open,
  onClose,
  selected = DEFAULT_GENRE,
  onSelect,
  docked = false,
}: GenrePanelProps) {
  const selectedIndex = Math.max(
    0,
    genrePresets.findIndex((g) => g.label === selected)
  );
  // Kinetic position state (supports fractional values during requestAnimationFrame)
  const [pos, setPos] = useState<number>(selectedIndex);
  const posRef = useRef<number>(selectedIndex);
  const animRef = useRef<number | null>(null);
  const targetRef = useRef<number>(selectedIndex);

  const activeIndex = wrapIndex(Math.round(pos), genrePresets.length);
  const [cardIndex, setCardIndex] = useState(selectedIndex);
  const cardIndexRef = useRef(selectedIndex);
  const [previousCardIndex, setPreviousCardIndex] = useState<number | null>(null);

  useEffect(() => {
    if (activeIndex === cardIndexRef.current) return;

    setPreviousCardIndex(cardIndexRef.current);
    cardIndexRef.current = activeIndex;
    setCardIndex(activeIndex);
    const timeout = window.setTimeout(() => setPreviousCardIndex(null), 400);
    return () => window.clearTimeout(timeout);
  }, [activeIndex]);

  // Smooth requestAnimationFrame Interpolation
  const animateTo = useCallback((
    target: number,
    stepDuration = STEP_MS,
    maxDuration?: number
  ) => {
    targetRef.current = target;
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const from = posRef.current;
    const dist = target - from;
    const calculatedDuration =
      Math.min(Math.max(Math.abs(dist), 1), 3) * stepDuration;
    const dur = maxDuration
      ? Math.min(calculatedDuration, maxDuration)
      : calculatedDuration;
    const t0 = performance.now();

    const tick = (now: number) => {
      const t = Math.min((now - t0) / dur, 1);
      const v = from + dist * easeInOutCubic(t);
      posRef.current = v;
      setPos(v);
      if (t < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        posRef.current = target;
        setPos(target);
        animRef.current = null;
        const committedIndex = wrapIndex(Math.round(target), genrePresets.length);
        onSelect?.(genrePresets[committedIndex].label);
      }
    };
    animRef.current = requestAnimationFrame(tick);
  }, [onSelect]);

  // External selection changes use the shortest circular route without
  // collapsing the unbounded kinetic position back to 0..N-1.
  useEffect(() => {
    if (animRef.current !== null) return;

    const base = Math.round(posRef.current);
    const currentIndex = wrapIndex(base, genrePresets.length);
    if (currentIndex === selectedIndex) return;

    let offset = selectedIndex - currentIndex;
    if (offset > genrePresets.length / 2) offset -= genrePresets.length;
    if (offset < -genrePresets.length / 2) offset += genrePresets.length;
    animateTo(base + offset);
  }, [animateTo, selectedIndex]);

  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  const [isDragging, setIsDragging] = useState(false);
  const carouselBodyRef = useRef<HTMLDivElement>(null);
  const genreMenuRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragStartPos = useRef(selectedIndex);

  const step = useCallback((direction: 1 | -1) => {
    animateTo(Math.round(targetRef.current) + direction);
  }, [animateTo]);

  const handlePrev = () => step(-1);
  const handleNext = () => step(1);

  const handleGenreClick = (index: number) => {
    const base = Math.round(targetRef.current);
    const currentIndex = wrapIndex(base, genrePresets.length);
    let offset = index - currentIndex;
    if (offset > genrePresets.length / 2) offset -= genrePresets.length;
    if (offset < -genrePresets.length / 2) offset += genrePresets.length;
    animateTo(base + offset, CLICK_STEP_MS, CLICK_MAX_MS);
  };

  // Pointer drag logic with kinetic tracking
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;

    const target = e.target as HTMLElement;
    if (
      target.closest("button.genre-arrow-btn") ||
      target.closest("button.genre-close-btn") ||
      target.closest("button[role='option']")
    ) {
      return;
    }

    if (animRef.current) cancelAnimationFrame(animRef.current);
    dragStartY.current = e.clientY;
    dragStartPos.current = posRef.current;

    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;

    const dy = e.clientY - dragStartY.current;
    const DRAG_STEP_PX = 45;
    const targetPos = dragStartPos.current - dy / DRAG_STEP_PX;
    posRef.current = targetPos;
    setPos(targetPos);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsDragging(false);
    // Snap to nearest integer row
    const snapTarget = Math.round(posRef.current);
    animateTo(snapTarget);
  };

  // Wheel input is scoped to the genre arc. Rapid wheel steps accumulate so
  // the unbounded target can complete full rotations without losing motion.
  useEffect(() => {
    const el = genreMenuRef.current;
    if (!el || !open) return;

    let wheelAccumulator = 0;
    let wheelGestureSteps = 0;
    let wheelGestureDirection = 0;
    let resetTimer: ReturnType<typeof setTimeout> | null = null;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (isDragging) return;

      let delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (e.deltaMode === 1) delta *= 20;
      else if (e.deltaMode === 2) delta *= 300;

      wheelAccumulator += delta;
      const wheelSteps = Math.trunc(wheelAccumulator / 80);

      if (wheelSteps !== 0) {
        const direction = Math.sign(wheelSteps);
        if (wheelGestureDirection !== 0 && direction !== wheelGestureDirection) {
          wheelGestureSteps = 0;
        }
        wheelGestureDirection = direction;

        const remainingSteps = Math.max(0, 5 - wheelGestureSteps);
        const boundedSteps = direction * Math.min(Math.abs(wheelSteps), remainingSteps);

        if (boundedSteps !== 0) {
          animateTo(Math.round(targetRef.current) + boundedSteps);
          wheelGestureSteps += Math.abs(boundedSteps);
          wheelAccumulator -= boundedSteps * 80;
        }
      }

      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        wheelAccumulator = 0;
        wheelGestureSteps = 0;
        wheelGestureDirection = 0;
      }, 180);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleWheel);
      if (resetTimer) clearTimeout(resetTimer);
    };
  }, [animateTo, open, isDragging]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      step(1);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      step(-1);
    }
  };

  if (!open) return null;

  const panelContent = (
    <div
      className="relative flex h-[27rem] w-full flex-col gap-1 overflow-hidden rounded-[20px] p-1 backdrop-blur-[20px] shadow-[0_12px_8px_0_rgba(0,0,0,0.20),inset_0_0_0_1px_rgba(217,217,217,0.04)]"
      style={{
        background:
          "linear-gradient(0deg, rgba(21,21,21,0.88) 0%, rgba(21,21,21,0.88) 100%), linear-gradient(20deg, rgba(101,189,235,0.24) 25.53%, rgba(101,189,235,0) 63.06%)",
        backgroundBlendMode: "normal, lighten",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1">
        <span className="flex-1 text-sm font-semibold text-white">
          Genre
        </span>
        <button
          type="button"
          onClick={onClose}
          className="genre-close-btn flex size-8 items-center justify-center rounded-full bg-surface-primary border border-separator-card/4 hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X className="size-3 text-icon-secondary" />
        </button>
      </div>

      {/* Content / Carousel Body */}
      <div
        ref={carouselBodyRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={() => setIsDragging(false)}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="listbox"
        aria-label="Cinematic Genre"
        className={`genre-drag-surface relative overflow-hidden rounded-2xl bg-white/5 min-h-0 flex-1 select-none touch-none outline-none ${
          isDragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{
          touchAction: "none",
          userSelect: "none",
          overscrollBehavior: "contain",
        }}
      >
        {/* Radial background glow */}
        <div
          className="absolute pointer-events-none rounded-full"
          style={{
            width: 600,
            height: 600,
            left: -100,
            top: -150,
            background:
              "radial-gradient(circle, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 60%, transparent 100%)",
          }}
        />

        {/* Large circular preview */}
        <div
          className={`absolute rounded-full overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.08)] transition-transform duration-200 ${
            isDragging ? "scale-105" : ""
          }`}
          style={{
            width: 260,
            height: 260,
            left: 128,
            top: 62,
          }}
        >
          {previousCardIndex !== null && (
            <video
              key={`previous-${genrePresets[previousCardIndex].src}`}
              src={genrePresets[previousCardIndex].src}
              muted
              loop
              autoPlay
              playsInline
              disablePictureInPicture
              preload="auto"
              className="genre-preview-out object-cover size-full absolute inset-0 pointer-events-none select-none"
            />
          )}
          <video
            key={`current-${genrePresets[cardIndex].src}`}
            src={genrePresets[cardIndex].src}
            muted
            loop
            autoPlay
            playsInline
            disablePictureInPicture
            preload="auto"
            className={`object-cover size-full absolute inset-0 pointer-events-none select-none ${
              previousCardIndex !== null ? "genre-preview-in" : ""
            }`}
          />
          <div className="absolute inset-0 rounded-full shadow-[inset_0_-2px_8px_0_rgba(0,0,0,0.12)] z-[2] pointer-events-none" />
        </div>

        {/* Genre arc selector on right */}
        <div
          ref={genreMenuRef}
          className="genre-radial-menu absolute top-0 bottom-0 select-none cursor-pointer"
          style={{
            left: 556,
            width: 220,
          }}
        >
          {genrePresets.map((genre, idx) => {
            const len = genrePresets.length;

            // Fractional offset from animated kinetic position
            let rawDist = idx - wrapIndex(pos, len);
            if (rawDist > len / 2) rawDist -= len;
            if (rawDist < -len / 2) rawDist += len;

            const distFromSelected = Math.abs(rawDist);
            const isAbove = rawDist < 0;
            const { x: arcX, y: arcY } = calculateArcPosition(distFromSelected, isAbove);
            const opacity = opacityForDistance(distFromSelected);
            const isSelected = distFromSelected < 0.5;

            const textColor = isSelected ? "text-white" : "text-font-secondary";

            return (
              <div
                key={genre.label}
                className="genre-radial-option absolute flex items-center gap-4 will-change-transform pointer-events-auto cursor-pointer"
                style={{
                  left: 0,
                  top: 0,
                  transform: `translate(${arcX}px, ${arcY}px)`,
                  opacity,
                  zIndex: 100 - Math.round(distFromSelected),
                }}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleGenreClick(idx)}
                  className="flex items-center gap-4 bg-transparent border-none p-0 cursor-pointer group"
                >
                  <div
                    className={`relative h-10 w-14 rounded-full overflow-hidden shrink-0 transition-[box-shadow] duration-200 ${
                      isSelected
                        ? "ring-1 ring-white/5"
                        : "group-hover:ring-1 group-hover:ring-white/20"
                    }`}
                    style={{
                      width: "56px",
                      height: "40px",
                      flexShrink: 0,
                    }}
                  >
                    <video
                      src={genre.src}
                      muted
                      loop
                      autoPlay
                      playsInline
                      disablePictureInPicture
                      preload="metadata"
                      className="object-cover size-full pointer-events-none select-none rounded-full"
                    />
                    <div
                      className="absolute inset-0 rounded-full pointer-events-none"
                      style={{
                        background:
                          "linear-gradient(101deg, rgba(255,255,255,0.12) 0.85%, transparent 8%, rgba(10,14,15,0.06) 12.4%, rgba(7,10,13,0.06) 93.8%, rgba(215,215,215,0.12) 98.5%)",
                      }}
                    />
                  </div>
                  <span
                    className={`text-lg font-medium whitespace-nowrap transition-colors duration-200 group-hover:text-white ${textColor}`}
                  >
                    {genre.label}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Up/Down buttons */}
        <div
          className="genre-arrow-control absolute top-1/2 -translate-y-1/2 flex flex-col gap-4 z-[200]"
          style={{ right: 20 }}
        >
          <button
            type="button"
            onClick={handlePrev}
            className="genre-arrow-btn flex size-10 items-center justify-center rounded-full cursor-pointer border border-[rgba(197,197,197,0.3)] backdrop-blur-[4px] bg-white/4 shadow-[inset_0_-0.3px_5.4px_0_rgba(185,185,185,0.35)] mix-blend-luminosity hover:bg-white/8 transition-colors"
          >
            <ChevronUp className="size-4 text-white" />
          </button>
          <button
            type="button"
            onClick={handleNext}
            className="genre-arrow-btn flex size-10 items-center justify-center rounded-full cursor-pointer border border-[rgba(197,197,197,0.3)] backdrop-blur-[4px] bg-white/4 shadow-[inset_0_-0.3px_5.4px_0_rgba(185,185,185,0.35)] mix-blend-luminosity hover:bg-white/8 transition-colors"
          >
            <ChevronDown className="size-4 text-white" />
          </button>
        </div>

        <style jsx global>{`
          @keyframes genrePreviewIn {
            from { opacity: 0; transform: scale(1.04); }
            to { opacity: 1; transform: scale(1); }
          }
          @keyframes genrePreviewOut {
            from { opacity: 1; }
            to { opacity: 0; }
          }
          .genre-preview-in {
            animation: genrePreviewIn 400ms ease forwards;
          }
          .genre-preview-out {
            animation: genrePreviewOut 400ms ease forwards;
          }
        `}</style>
      </div>
    </div>
  );

  // Docked mode: return content directly
  if (docked) {
    return panelContent;
  }

  // Modal mode: wrap in backdrop
  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center pointer-events-auto">
      {/* Backdrop */}
      <div
        className="absolute inset-0 backdrop-blur-[40px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-[min(876px,calc(100vw-32px))]">
        {panelContent}
      </div>
    </div>
  );
}
