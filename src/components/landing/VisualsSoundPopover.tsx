"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Wand2 } from "lucide-react";

interface SliderRowProps {
  label: string;
  value: number;
  valueLabel: string;
  onChange: (value: number) => void;
}

function SliderRow({ label, value, valueLabel, onChange }: SliderRowProps) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span>{label}</span>
        <span className="font-mono text-zinc-300">{valueLabel}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-magenta-500"
      />
    </div>
  );
}

export default function VisualsSoundPopover() {
  const [style, setStyle] = useState(30);
  const [craziness, setCraziness] = useState(80);
  const [montage, setMontage] = useState(65);

  const styleLabel = style < 33 ? "Auto" : style < 66 ? "Balanced" : "Manual";
  const crazinessLabel = craziness < 33 ? "Low" : craziness < 66 ? "Medium" : "High";
  const montageLabel = montage < 33 ? "Slow" : montage < 66 ? "Steady" : "Fast Paced";

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3.5 py-2.5 text-left text-sm text-zinc-200 transition-colors hover:border-magenta-500/30 hover:bg-white/[0.06]"
        >
          <span className="flex items-center gap-2.5">
            <Wand2 className="h-4 w-4 text-zinc-500" />
            Visuals &amp; Sound
          </span>
          <span className="text-xs text-zinc-500">
            {styleLabel} · {crazinessLabel} · {montageLabel}
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={12}
          className="z-[60] w-72 rounded-2xl border border-white/10 bg-zinc-950/95 p-4 shadow-2xl shadow-black/60 backdrop-blur-xl"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Visuals &amp; Sound
          </p>
          <div className="mt-4 space-y-5">
            <SliderRow
              label="Style"
              value={style}
              valueLabel={styleLabel}
              onChange={setStyle}
            />
            <SliderRow
              label="Craziness"
              value={craziness}
              valueLabel={crazinessLabel}
              onChange={setCraziness}
            />
            <SliderRow
              label="Montage"
              value={montage}
              valueLabel={montageLabel}
              onChange={setMontage}
            />
          </div>
          <Popover.Arrow className="fill-zinc-950" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
