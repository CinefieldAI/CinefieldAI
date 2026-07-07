"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, RectangleHorizontal } from "lucide-react";
import { ASPECT_RATIO_OPTIONS } from "./cinemaStudioData";

interface AspectRatioDropdownProps {
  value: string;
  onChange: (value: string) => void;
}

/** Small rectangle preview shaped to the option's aspect ratio. */
function ShapeIcon({ shape }: { shape: [number, number] }) {
  const [w, h] = shape;
  const scale = 22 / Math.max(w, h);
  return (
    <span className="flex h-6 w-8 shrink-0 items-center justify-center rounded-sm border border-white/20 bg-white/10">
      <span
        className="rounded-[1px] border border-white/30 bg-white/20"
        style={{ width: Math.round(w * scale), height: Math.round(h * scale) }}
      />
    </span>
  );
}

/**
 * Aspect-ratio selector — opens UPWARD, shows a shape preview + description
 * per option, checkmark on the selected row. Used in both Image and Video
 * prompt-bar panels.
 */
export default function AspectRatioDropdown({
  value,
  onChange,
}: AspectRatioDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Aspect ratio"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-8 items-center gap-1 rounded-lg bg-[rgba(255,255,255,0.05)] px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-[rgba(255,255,255,0.08)]"
      >
        <RectangleHorizontal className="size-4" />
        <span className="min-w-[40px] text-center">{value}</span>
        <ChevronDown className="size-3 text-neutral-400" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Aspect ratio options"
          className="absolute bottom-full left-0 z-[100000] mb-2 w-[200px] overflow-hidden rounded-xl border border-white/10 bg-[#1a1d1f] p-1 shadow-2xl"
        >
          {ASPECT_RATIO_OPTIONS.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                  selected ? "bg-white/5" : "hover:bg-white/5"
                }`}
              >
                <ShapeIcon shape={opt.shape} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">
                    {opt.value}
                  </span>
                  <span className="block truncate text-xs text-gray-400">
                    {opt.description}
                  </span>
                </span>
                {selected && <Check className="size-4 shrink-0 text-white" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
