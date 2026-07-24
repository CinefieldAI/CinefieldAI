"use client";

import { ChevronDown, UserPlus } from "lucide-react";
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

/** Compact up/down triangle (verbatim from the Higgsfield reference). */
function Triangle({ down = false }: { down?: boolean }) {
  return (
    <svg
      width="8"
      height="5"
      viewBox="0 0 8 5"
      fill="none"
      className={`size-1.5 shrink-0 ${down ? "rotate-180" : ""}`}
    >
      <path
        d="M2.93989 0.284724L0.28568 2.93893C-0.326431 3.55104 0.107091 4.59766 0.972748 4.59766H6.28116C7.14681 4.59766 7.58034 3.55104 6.96822 2.93893L4.31402 0.284724C3.93456 -0.0947333 3.31934 -0.0947324 2.93989 0.284724Z"
        fill="#898A8B"
      />
    </svg>
  );
}

/** Vertical up/down stepper column with a divider between the two arrows. */
function ArrowStepper({ onUp, onDown }: { onUp: () => void; onDown: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center self-stretch border-l border-white/5 px-0.5">
      <button
        type="button"
        onClick={onUp}
        className="flex h-5 w-5 items-center justify-center text-white/50 transition-colors hover:text-white"
      >
        <Triangle />
      </button>
      <span className="my-0.5 h-px w-full bg-white/5" />
      <button
        type="button"
        onClick={onDown}
        className="flex h-5 w-5 items-center justify-center text-white/50 transition-colors hover:text-white"
      >
        <Triangle down />
      </button>
    </div>
  );
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
  const durationFill = ((duration - 3) / 9) * 100;

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
    <div
      className="flex w-full min-w-0 flex-col rounded-2xl px-3 py-2"
      style={{ backgroundColor: "#272a2b" }}
    >
      {/* Single shared header — collapsed & expanded respond via classes, no duplicate */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls="cinema25-director-content"
        className={`flex w-full items-center justify-between gap-1 ${isOpen ? "mb-1.5" : ""}`}
      >
        <div className="flex min-w-0 items-center gap-1">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            className={`size-4 shrink-0 transition-colors ${isOpen ? "text-[#078AB6]" : "text-white/40"}`}
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M1.3335 3.83317C1.3335 3.18884 1.85583 2.6665 2.50016 2.6665H13.5002C14.1445 2.6665 14.6668 3.18884 14.6668 3.83317V12.1665C14.6668 12.8108 14.1445 13.3332 13.5002 13.3332H2.50016C1.85583 13.3332 1.3335 12.8108 1.3335 12.1665V3.83317ZM2.3335 3.83317C2.3335 3.74112 2.40812 3.6665 2.50016 3.6665H4.72359L4.25693 5.99984H2.3335V3.83317ZM13.6668 5.99984V3.83317C13.6668 3.74112 13.5922 3.6665 13.5002 3.6665H11.8905L11.3072 5.99984H13.6668ZM10.2764 5.99984L10.8598 3.6665H8.7434L8.27673 5.99984H10.2764ZM7.25693 5.99984L7.72359 3.6665H5.7434L5.27673 5.99984H7.25693Z"
              fill="currentColor"
            />
          </svg>
          <span
            className={`text-xs font-medium leading-4 transition-colors ${isOpen ? "text-[#078AB6]" : "text-white/60"}`}
          >
            Director Panel
          </span>
          <span
            className={`truncate text-xs leading-4 text-white/40 transition-opacity duration-200 ${isOpen ? "opacity-100" : "opacity-0"}`}
          >
            Control characters, speed, genres, and scene flow
          </span>
        </div>
        <ChevronDown
          className={`size-3.5 shrink-0 text-white/40 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* Collapsible content — grid-rows animation (0fr collapsed → 1fr expanded) */}
      <div
        id="cinema25-director-content"
        className="grid w-full transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className="flex w-full items-center gap-3"
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* Reference / character slots */}
            <div className="flex shrink-0 items-center gap-1.5">
              {[0, 1, 2].map((idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onAssignReference(idx, "")}
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-white/10"
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
                    <UserPlus className="size-4 text-white/50" />
                  )}
                </button>
              ))}
            </div>

            {/* Movement — compact pill (video + label/value + stepper) */}
            <div
              className="flex shrink-0 items-center rounded-xl pl-1"
              style={{ background: "rgba(255,255,255,0.06)" }}
            >
              <div
                className="relative mr-2 size-9 shrink-0 overflow-hidden rounded-lg"
                style={{
                  border: "1px solid rgba(255,255,255,0.32)",
                  boxShadow: "rgba(0,0,0,0.24) 2px -2px 4px -2px",
                }}
              >
                <video
                  key={movement.video}
                  src={movement.video}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="absolute inset-0 size-full object-cover"
                />
              </div>
              <div className="flex w-max flex-col gap-0.5 py-1.5">
                <span className="text-[10px] font-semibold leading-3 text-white/50">Movement</span>
                <div className="relative h-5 min-w-[40px] overflow-hidden">
                  <span className="block max-w-[92px] truncate text-sm font-medium leading-5 text-white">
                    {movement.name}
                  </span>
                </div>
              </div>
              <ArrowStepper
                onUp={() =>
                  onMovementIndexChange(
                    (movementIndex - 1 + MOVEMENT_OPTIONS.length) % MOVEMENT_OPTIONS.length,
                  )
                }
                onDown={() =>
                  onMovementIndexChange((movementIndex + 1) % MOVEMENT_OPTIONS.length)
                }
              />
            </div>

            {/* Divider */}
            <div className="h-8 w-px shrink-0 bg-white/10" />

            {/* Speed graph (flex-1) + Speed ramp pill */}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="min-w-[80px] flex-1">
                <div
                  className="relative w-full overflow-hidden rounded-xl border border-white/5"
                  style={{ height: 48, background: "rgba(255,255,255,0.03)" }}
                >
                  <span
                    className="absolute h-px bg-white/20"
                    style={{ left: 10, right: 10, top: 23 }}
                  />
                  <svg
                    ref={svgRef}
                    width="100%"
                    height="100%"
                    viewBox="0 0 132 48"
                    preserveAspectRatio="none"
                    className="h-full w-full p-1"
                    style={{ cursor: draggedPointIndex !== null ? "grabbing" : "grab" }}
                  >
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
                    {speedRampPoints.map((val, i) => {
                      const x = (i / (speedRampPoints.length - 1)) * 130 + 1;
                      const y = 48 - (val / 100) * 46 - 1;
                      return (
                        <circle
                          key={i}
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
                      );
                    })}
                  </svg>
                </div>
              </div>

              {/* Speed ramp — compact pill */}
              <div
                className="flex shrink-0 items-center rounded-xl pl-2.5"
                style={{ background: "rgba(255,255,255,0.06)" }}
              >
                <div className="flex w-max flex-col gap-0.5 py-1.5">
                  <span className="text-[10px] font-semibold leading-3 text-white/50">Speed ramp</span>
                  <div className="relative h-5 min-w-[40px] overflow-hidden">
                    <span className="block max-w-[80px] truncate text-sm font-medium leading-5 text-white">
                      {SPEED_RAMP_OPTIONS[speedRampIndex]}
                    </span>
                  </div>
                </div>
                <ArrowStepper
                  onUp={() =>
                    onSpeedRampIndexChange(
                      (speedRampIndex - 1 + SPEED_RAMP_OPTIONS.length) % SPEED_RAMP_OPTIONS.length,
                    )
                  }
                  onDown={() =>
                    onSpeedRampIndexChange((speedRampIndex + 1) % SPEED_RAMP_OPTIONS.length)
                  }
                />
              </div>
            </div>

            {/* Divider */}
            <div className="h-8 w-px shrink-0 bg-white/10" />

            {/* Duration — compact pill with inner label + fill (range overlaid) */}
            <label
              className="relative flex h-11 w-[132px] shrink-0 cursor-pointer items-center overflow-hidden rounded-xl"
              style={{ background: "rgba(255,255,255,0.06)" }}
            >
              <div
                className="pointer-events-none absolute left-0 top-0 h-full"
                style={{ width: `${durationFill}%`, background: "rgba(255,255,255,0.05)" }}
              />
              <input
                type="range"
                min={3}
                max={12}
                value={duration}
                onChange={(e) => onDurationChange(Number(e.target.value))}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
                aria-label="Duration"
                aria-valuemin={3}
                aria-valuemax={12}
                aria-valuenow={duration}
              />
              <div className="pointer-events-none absolute left-0 top-0 flex h-full items-center pl-2.5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-semibold leading-3 text-white/50">Duration</span>
                  <span className="text-sm font-medium leading-5 text-white">{duration}s</span>
                </div>
              </div>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
