"use client";

interface VectorModeToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

export default function VectorModeToggle({
  value,
  onChange,
}: VectorModeToggleProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`h-9 px-3 rounded-lg border transition-colors text-xs font-medium flex items-center gap-2 ${
        value
          ? "border-[#E61E8F] bg-[#E61E8F]/10 text-[#E61E8F]"
          : "border-white/10 bg-white/5 text-white hover:bg-white/10"
      }`}
    >
      <div
        className={`h-3 w-3 rounded-full transition-colors ${
          value ? "bg-[#E61E8F]" : "bg-white/40"
        }`}
      />
      <span>Vector</span>
    </button>
  );
}
