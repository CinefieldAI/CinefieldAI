"use client";

import { Minus, Plus } from "lucide-react";

interface QuantityControlProps {
  value: number;
  max: number;
  onChange: (value: number) => void;
}

export default function QuantityControl({
  value,
  max,
  onChange,
}: QuantityControlProps) {
  const decrement = () => {
    if (value > 1) onChange(value - 1);
  };

  const increment = () => {
    if (value < max) onChange(value + 1);
  };

  return (
    <div className="flex items-center gap-1 h-9 px-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors">
      <button
        type="button"
        onClick={decrement}
        disabled={value <= 1}
        className="p-1 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
      >
        <Minus className="h-3 w-3 text-white" />
      </button>
      <span className="text-xs font-semibold text-white min-w-[20px] text-center">
        {value}
      </span>
      <button
        type="button"
        onClick={increment}
        disabled={value >= max}
        className="p-1 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
      >
        <Plus className="h-3 w-3 text-white" />
      </button>
    </div>
  );
}
