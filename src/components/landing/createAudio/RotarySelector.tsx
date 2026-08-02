"use client";

import { useRef, useState } from "react";

interface RotaryOption {
  label: string;
  cx: number;
  cy: number;
}

const KNOB_CENTER = { x: 0, y: 60 };

const OPTIONS: RotaryOption[] = [
  { label: "Voiceover", cx: 70.9467928693361, cy: 33.177479178912016 },
  { label: "Change Voice", cx: 75.5, cy: 59 },
  { label: "Translate", cx: 70.9467928693361, cy: 84.822520821088 },
];

function angleFor(option: RotaryOption): number {
  return (
    (Math.atan2(option.cy - KNOB_CENTER.y, option.cx - KNOB_CENTER.x) * 180) /
    Math.PI
  );
}

interface RotarySelectorProps {
  value?: number;
  onChange?: (index: number) => void;
}

export default function RotarySelector({ value, onChange }: RotarySelectorProps) {
  const [internal, setInternal] = useState(0);
  const selected = value ?? internal;
  const knobRef = useRef<HTMLDivElement>(null);

  const select = (index: number) => {
    if (value === undefined) setInternal(index);
    onChange?.(index);
  };

  const rotation = angleFor(OPTIONS[selected]);

  return (
    <div className="w-[162px] shrink-0 self-end" style={{ height: 120 }}>
      <div className="relative h-full w-full">
        {/* Outer illuminated glowing orange border shimmer */}
        <div className="pointer-events-none absolute -inset-[1px] rounded-[21px] border-2 border-[#D97757] opacity-85 shadow-[0_0_20px_rgba(217,119,87,0.75)] animate-pulse z-30" />

        {/* Outer card shell */}
        <div
          className="h-full w-full rounded-[20px] overflow-hidden"
          style={{
            background:
              "linear-gradient(180deg, rgba(217,119,87,0.28) 0%, rgba(217,119,87,0.16) 55%, rgba(217,119,87,0.10) 100%), #141414",
            border: "1px solid rgba(217, 119, 87, 0.45)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.15), inset 0 0 25px rgba(217,119,87,0.18), 0 10px 30px rgba(0,0,0,0.5)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          {/* Inner glass body */}
          <div className="h-full w-full overflow-hidden rounded-[19px] bg-transparent">
            <div className="relative h-full w-full cursor-pointer">
              {/* Curved connector + connection nodes */}
              <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                <path
                  d="M 64.36894452383473 35.579432682191694 L 53.09263307440383 39.68367440209972 A 56.5 56.5 0 0 1 56.5 59.0078125 L 68.5 59.0078125 M 68.5 59.0078125 L 56.5 59.0078125 A 56.5 56.5 0 0 1 53.09263307440383 78.33195059790029 L 64.36894452383473 82.43619231780832"
                  fill="none"
                  stroke="#737475"
                  strokeWidth="1.5"
                />
                <circle
                  cx={70.9467928693361}
                  cy={33.185291678912016}
                  r="2"
                  fill={selected === 0 ? "#D97757" : "#0F1113"}
                  style={{ transition: "fill 0.3s ease-out" }}
                />
                <circle
                  cx={75.5}
                  cy={59.0078125}
                  r="2"
                  fill={selected === 1 ? "#D97757" : "#0F1113"}
                  style={{ transition: "fill 0.3s ease-out" }}
                />
                <circle
                  cx={70.9467928693361}
                  cy={84.830333321088}
                  r="2"
                  fill={selected === 2 ? "#D97757" : "#0F1113"}
                  style={{ transition: "fill 0.3s ease-out" }}
                />
              </svg>

              {/* Text labels — kept white, never turn orange */}
              {OPTIONS.map((opt, i) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => select(i)}
                  className="group absolute flex items-center py-2 pr-2 pl-[7px]"
                  style={{
                    left: `${opt.cx}px`,
                    top: `${opt.cy}px`,
                    transform: "translateY(-50%)",
                  }}
                >
                  <span
                    className={`select-none whitespace-nowrap text-[11px] font-semibold transition-colors duration-300 ${
                      selected === i ? "text-white font-bold" : "text-[#B7B7B7] group-hover:text-white"
                    }`}
                  >
                    {opt.label}
                  </span>
                </button>
              ))}

              {/* Rotary Knob */}
              <div
                className="absolute top-1/2 z-1 touch-none select-none cursor-grab active:cursor-grabbing -translate-y-1/2"
                style={{ left: "-51.5px", width: "103px", height: "103px" }}
              >
                <div
                  className="flex h-full w-full items-center justify-center rounded-full"
                  style={{
                    background: "linear-gradient(rgb(59,60,62), rgb(32,33,35))",
                    border: "1px solid rgb(17,18,20)",
                    padding: "2.5px",
                    boxShadow:
                      "rgba(255,255,255,0.15) 0px -4px 8px 0px, rgba(0,0,0,0.5) 0px 4px 8px 0px",
                  }}
                >
                  <div
                    ref={knobRef}
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
                            backgroundColor: "#D97757",
                            boxShadow:
                              "rgba(217,119,87,0.95) 0px 0px 10px 0px inset",
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
