"use client";

import { useRef, useState } from "react";

interface RotaryOption {
  label: string;
  /** SVG/card-space coordinates of the connection node (matches the reference). */
  cx: number;
  cy: number;
}

/** Knob center in card-space: left edge (x=0), vertically centered (y=60). */
const KNOB_CENTER = { x: 0, y: 60 };

const OPTIONS: RotaryOption[] = [
  { label: "Voiceover", cx: 70.9467928693361, cy: 33.177479178912016 },
  { label: "Change Voice", cx: 75.5, cy: 59 },
  { label: "Translate", cx: 70.9467928693361, cy: 84.822520821088 },
];

/** Angle (deg) from the knob center to a node — drives the indicator rotation. */
function angleFor(option: RotaryOption): number {
  return (
    (Math.atan2(option.cy - KNOB_CENTER.y, option.cx - KNOB_CENTER.x) * 180) /
    Math.PI
  );
}

interface RotarySelectorProps {
  /** Controlled selected index. If omitted, the component manages its own state. */
  value?: number;
  onChange?: (index: number) => void;
}

export default function RotarySelector({ value, onChange }: RotarySelectorProps) {
  // "Voiceover" (index 0) is the active option by default (matches reference).
  const [internal, setInternal] = useState(0);
  const selected = value ?? internal;
  const dragging = useRef(false);
  const knobRef = useRef<HTMLDivElement>(null);

  const select = (index: number) => {
    if (value === undefined) setInternal(index);
    onChange?.(index);
  };

  const rotation = angleFor(OPTIONS[selected]);

  // Map a pointer position to the nearest option angle (rotary drag behaviour).
  const pickFromPointer = (clientX: number, clientY: number) => {
    const el = knobRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const pointerAngle =
      (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI;
    let best = 0;
    let bestDelta = Infinity;
    OPTIONS.forEach((option, i) => {
      const delta = Math.abs(angleFor(option) - pointerAngle);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = i;
      }
    });
    select(best);
  };

  return (
    <div className="w-[162px] shrink-0" style={{ height: 120 }}>
      <div className="relative h-full w-full">
        {/* Outer conic-gradient border */}
        <div
          className="h-full w-full rounded-[20px]"
          style={{
            background:
              "conic-gradient(from 135deg, rgba(255,255,255,0), rgba(255,255,255,0.32), rgba(255,255,255,0), rgba(255,255,255,0.4), rgba(0,0,0,0.3), rgba(255,255,255,0))",
            padding: 1,
          }}
        >
          {/* Inner dark glass body */}
          <div
            className="h-full w-full overflow-hidden rounded-[19px]"
            style={{
              background:
                "linear-gradient(to left, rgb(39,41,43), rgb(31,33,35), rgb(23,25,28))",
              backdropFilter: "blur(20.9px)",
              WebkitBackdropFilter: "blur(20.9px)",
              boxShadow: "rgba(0,0,0,0.4) 0px 4px 20px 0px",
            }}
          >
            <div className="relative h-full w-full cursor-pointer">
              {/* Curved connector + connection nodes */}
              <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                <path
                  d="M 64.36894452383473 35.571620182191694 L 53.09263307440383 39.67586190209972 A 56.5 56.5 0 0 1 56.5 59 L 68.5 59 M 68.5 59 L 56.5 59 A 56.5 56.5 0 0 1 53.09263307440383 78.32413809790029 L 64.36894452383473 82.42837981780832"
                  fill="none"
                  stroke="#737475"
                  strokeWidth="1.5"
                />
                {OPTIONS.map((option, i) => (
                  <circle
                    key={option.label}
                    cx={option.cx}
                    cy={option.cy}
                    r={2}
                    fill={i === selected ? "#D1FE17" : "#0F1113"}
                    style={{ transition: "fill 0.3s ease-out" }}
                  />
                ))}
              </svg>

              {/* Labels (absolutely positioned, do not move on rotation) */}
              {OPTIONS.map((option, i) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => select(i)}
                  className="group absolute flex items-center py-2 pl-[7px] pr-2"
                  style={{
                    left: option.cx,
                    top: option.cy,
                    transform: "translateY(-50%)",
                  }}
                >
                  <span className="select-none text-[10px] font-medium leading-none text-[#B7B7B7] transition-colors duration-300 group-hover:text-white">
                    {option.label}
                  </span>
                </button>
              ))}

              {/* Rotary knob — extends ~half outside the left edge */}
              <div
                ref={knobRef}
                onPointerDown={(e) => {
                  dragging.current = true;
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  pickFromPointer(e.clientX, e.clientY);
                }}
                onPointerMove={(e) => {
                  if (dragging.current) pickFromPointer(e.clientX, e.clientY);
                }}
                onPointerUp={() => {
                  dragging.current = false;
                }}
                onPointerCancel={() => {
                  dragging.current = false;
                }}
                className="absolute top-1/2 z-[1] -translate-y-1/2 cursor-grab touch-none select-none active:cursor-grabbing"
                style={{ left: -51.5, width: 103, height: 103 }}
              >
                <div
                  className="flex h-full w-full items-center justify-center rounded-full"
                  style={{
                    background: "linear-gradient(rgb(59,60,62), rgb(32,33,35))",
                    border: "1px solid rgb(17,18,20)",
                    padding: 2.5,
                    boxShadow:
                      "rgba(255,255,255,0.15) 0px -4px 8px 0px, rgba(0,0,0,0.5) 0px 4px 8px 0px",
                  }}
                >
                  <div
                    className="relative flex h-full w-full items-center justify-center rounded-full"
                    style={{
                      background: "linear-gradient(rgb(82,82,82), rgb(31,31,31))",
                      boxShadow:
                        "rgba(0,0,0,0.37) 0.76px 0.76px 0.76px 0px, rgba(255,255,255,0.7) -0.38px -0.38px 0.76px 0px, rgba(255,255,255,0.5) 0px 0px 0.76px 0px inset",
                    }}
                  >
                    <div
                      className="absolute inset-0"
                      style={{
                        transform: `rotate(${rotation}deg)`,
                        transition: "transform 0.4s ease-out",
                      }}
                    >
                      <div className="absolute right-0 top-1/2 -translate-y-1/2">
                        <div
                          className="h-[5.5px] w-[22px]"
                          style={{
                            backgroundColor: "#D1FE17",
                            boxShadow: "rgba(255,255,255,0.95) 0px 0px 10px 0px inset",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
