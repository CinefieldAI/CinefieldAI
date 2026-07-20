"use client";

import { ChevronDown } from "lucide-react";
import { useState, useRef } from "react";

const MOVEMENT_OPTIONS = [
  { name: "Tilt down", video: "/assets/higgsfield/generate/cinema-3/camera-movement/static.mp4" },
  { name: "Pan left", video: "/assets/higgsfield/generate/cinema-3/camera-movement/pan-left.mp4" },
  { name: "Pan right", video: "/assets/higgsfield/generate/cinema-3/camera-movement/pan-right.mp4" },
  { name: "Zoom in", video: "/assets/higgsfield/generate/cinema-3/camera-movement/zoom-in.mp4" },
  { name: "Zoom out", video: "/assets/higgsfield/generate/cinema-3/camera-movement/zoom-out.mp4" },
  { name: "Static", video: "/assets/higgsfield/generate/cinema-3/camera-movement/static.mp4" },
];

const SPEED_RAMP_OPTIONS = ["Auto", "Slow-mo", "Ramp Up", "Hero Moment", "Custom"];

interface CinemaStudio25DirectorPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  references: (string | null)[];
  onAssignReference: (slotIndex: number, url: string) => void;
  movementIndex: number;
  onMovementIndexChange: (index: number) => void;
  speedRampIndex: number;
  onSpeedRampIndexChange: (index: number) => void;
  speedRampPoints: number[];
  onSpeedRampPointsChange: (points: number[]) => void;
  duration: number;
  onDurationChange: (value: number) => void;
}

export default function CinemaStudio25DirectorPanel({
  isOpen,
  onToggle,
  references,
  onAssignReference,
  movementIndex,
  onMovementIndexChange,
  speedRampIndex,
  onSpeedRampIndexChange,
  speedRampPoints,
  onSpeedRampPointsChange,
  duration,
  onDurationChange,
}: CinemaStudio25DirectorPanelProps) {
  const [draggedPointIndex, setDraggedPointIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const movement = MOVEMENT_OPTIONS[movementIndex];

  const handleSpeedPointDown = (index: number) => {
    setDraggedPointIndex(index);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggedPointIndex === null || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const percentage = Math.max(0, Math.min(100, 100 - (relativeY / rect.height) * 100));

    const newPoints = [...speedRampPoints];
    newPoints[draggedPointIndex] = Math.round(percentage);
    onSpeedRampPointsChange(newPoints);
  };

  const handleMouseUp = () => {
    setDraggedPointIndex(null);
  };

  return (
    <div className="w-full mb-2">
      {/* Collapsed header */}
      {!isOpen && (
        <button
          onClick={onToggle}
          className="flex items-center justify-between w-full h-7 px-3 py-1 rounded-2xl cursor-pointer transition-colors"
          style={{ backgroundColor: "#272a2b" }}
        >
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="size-5 flex-shrink-0 text-white/40" fill="none">
              <path d="M4 6.75A2.75 2.75 0 0 1 6.75 4h10.5A2.75 2.75 0 0 1 20 6.75v10.5A2.75 2.75 0 0 1 17.25 20H6.75A2.75 2.75 0 0 1 4 17.25z" stroke="currentColor" strokeWidth="1.5" />
              <path d="M9 4v16M4 9h5" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <span className="text-sm font-semibold text-white/40">Director Panel</span>
          </div>
          <ChevronDown className="size-4 text-white/40 flex-shrink-0" />
        </button>
      )}

      {/* Expanded panel */}
      {isOpen && (
        <div
          className="w-full rounded-2xl border flex flex-col p-3 gap-2"
          style={{
            backgroundColor: "#272a2b",
            borderColor: "rgba(217,217,217,0.04)",
          }}
        >
          {/* Header row */}
          <button
            onClick={onToggle}
            className="flex items-center justify-between w-full cursor-pointer"
          >
            <div className="flex items-center gap-2 min-w-0">
              <svg viewBox="0 0 24 24" className="size-5 flex-shrink-0 text-[#078AB6]" fill="none">
                <path d="M4 6.75A2.75 2.75 0 0 1 6.75 4h10.5A2.75 2.75 0 0 1 20 6.75v10.5A2.75 2.75 0 0 1 17.25 20H6.75A2.75 2.75 0 0 1 4 17.25z" stroke="currentColor" strokeWidth="1.5" />
                <path d="M9 4v16M4 9h5" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <div className="flex flex-col items-start min-w-0">
                <span className="text-sm font-semibold text-[#078AB6]">Director Panel</span>
                <span className="text-xs text-white/60">Control characters, speed, genres, and scene flow</span>
              </div>
            </div>
            <ChevronDown className="size-4 text-[#078AB6] flex-shrink-0 rotate-180 transition-transform" />
          </button>

          {/* Controls row (horizontal) */}
          <div
            className="flex items-end gap-3 overflow-x-auto pb-2 px-1"
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* Reference slots */}
            <div className="flex gap-1.5 flex-shrink-0">
              {[0, 1, 2].map((idx) => (
                <button
                  key={idx}
                  onClick={() => onAssignReference(idx, "")}
                  className="w-11 h-11 rounded-3xl flex-shrink-0 flex items-center justify-center transition-all hover:bg-white/10"
                  style={{
                    backgroundColor: references[idx] ? "transparent" : "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(217,217,217,0.04)",
                    backgroundImage: references[idx] ? `url(${references[idx]})` : undefined,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                  aria-label={idx === 0 ? "Add reference from assets" : `Add reference ${idx}`}
                  data-slot-index={idx}
                >
                  {!references[idx] && idx === 0 && (
                    <svg viewBox="0 0 24 24" className="size-4 text-white/60" fill="none">
                      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor" />
                    </svg>
                  )}
                </button>
              ))}
            </div>

            {/* Movement control */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <video
                key={movement.video}
                src={movement.video}
                autoPlay
                loop
                muted
                playsInline
                className="w-9 h-9 rounded-2xl object-cover flex-shrink-0"
                style={{ backgroundColor: "rgba(0,0,0,0.3)" }}
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-white/60">Movement</span>
                <span className="text-sm font-semibold text-white whitespace-nowrap">{movement.name}</span>
              </div>
              <div className="flex flex-col gap-1 flex-shrink-0">
                <button
                  onClick={() => onMovementIndexChange((movementIndex - 1 + MOVEMENT_OPTIONS.length) % MOVEMENT_OPTIONS.length)}
                  className="w-5 h-5 text-white/60 hover:text-white transition-colors flex items-center justify-center"
                >
                  <ChevronDown className="size-4 rotate-180" />
                </button>
                <button
                  onClick={() => onMovementIndexChange((movementIndex + 1) % MOVEMENT_OPTIONS.length)}
                  className="w-5 h-5 text-white/60 hover:text-white transition-colors flex items-center justify-center"
                >
                  <ChevronDown className="size-4" />
                </button>
              </div>
            </div>

            {/* Speed graph */}
            <div
              className="w-[132px] h-12 rounded-2xl flex-shrink-0 relative flex items-center justify-center"
              style={{
                backgroundColor: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(217,217,217,0.04)",
              }}
            >
              <svg
                ref={svgRef}
                width="100%"
                height="100%"
                viewBox="0 0 132 48"
                preserveAspectRatio="none"
                className="w-full h-full p-1"
                style={{ cursor: draggedPointIndex !== null ? "grabbing" : "grab" }}
              >
                {/* Polyline */}
                <polyline
                  points={speedRampPoints
                    .map((val, i) => {
                      const x = (i / (speedRampPoints.length - 1)) * 130 + 1;
                      const y = 48 - (val / 100) * 46 - 1;
                      return `${x},${y}`;
                    })
                    .join(" ")}
                  stroke="#1CA5E2"
                  strokeWidth="1.5"
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                />
                {/* Points */}
                {speedRampPoints.map((val, i) => {
                  const x = (i / (speedRampPoints.length - 1)) * 130 + 1;
                  const y = 48 - (val / 100) * 46 - 1;
                  return (
                    <g key={i}>
                      <circle
                        cx={x}
                        cy={y}
                        r="4"
                        fill="#1CA5E2"
                        style={{
                          filter: "drop-shadow(0 0 4px rgba(28,165,226,0.4))",
                          cursor: "ns-resize",
                        }}
                        onMouseDown={() => handleSpeedPointDown(i)}
                      />
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Speed Ramp control */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-white/60">Speed ramp</span>
                <span className="text-sm font-semibold text-white whitespace-nowrap">{SPEED_RAMP_OPTIONS[speedRampIndex]}</span>
              </div>
              <div className="flex flex-col gap-1 flex-shrink-0">
                <button
                  onClick={() => onSpeedRampIndexChange((speedRampIndex - 1 + SPEED_RAMP_OPTIONS.length) % SPEED_RAMP_OPTIONS.length)}
                  className="w-5 h-5 text-white/60 hover:text-white transition-colors flex items-center justify-center"
                >
                  <ChevronDown className="size-4 rotate-180" />
                </button>
                <button
                  onClick={() => onSpeedRampIndexChange((speedRampIndex + 1) % SPEED_RAMP_OPTIONS.length)}
                  className="w-5 h-5 text-white/60 hover:text-white transition-colors flex items-center justify-center"
                >
                  <ChevronDown className="size-4" />
                </button>
              </div>
            </div>

            {/* Duration slider */}
            <div className="flex flex-col gap-1 flex-shrink-0">
              <span className="text-xs text-white/60">Duration</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="3"
                  max="12"
                  value={duration}
                  onChange={(e) => onDurationChange(Number(e.target.value))}
                  className="w-[132px] h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #1CA5E2 0%, #1CA5E2 ${((duration - 3) / 9) * 100}%, rgba(255,255,255,0.1) ${((duration - 3) / 9) * 100}%, rgba(255,255,255,0.1) 100%)`,
                  }}
                  aria-label="Duration"
                  aria-valuemin={3}
                  aria-valuemax={12}
                />
              </div>
              <span className="text-sm font-semibold text-white text-center">{duration}s</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
