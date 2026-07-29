"use client";

import { Pencil } from "lucide-react";

/** Higgsfield Soul 2.0's 80px "General" style card — no existing preset
 *  backend to reuse, so selection is kept as plain local state (never a
 *  fake completed integration). The hover pencil is a decorative affordance,
 *  not a second interactive control nested inside the card button. */
const SOUL_GENERAL_IMAGE =
  "https://cdn.higgsfield.ai/soul-v2-style/f33d85f2-6521-4fa8-8e8f-894cfbdee578.webp";

export default function SoulGeneralCard({
  selected,
  onToggle,
}: {
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      aria-label="Select General style"
      className="relative flex h-20 w-20 shrink-0 cursor-pointer overflow-hidden rounded-xl transition-transform hover:scale-[1.02]"
      style={{
        boxShadow: selected
          ? "0 0 0 2px rgb(209,254,23), inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 12px rgba(0,0,0,0.32)"
          : "inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 0 1px rgba(255,255,255,0.04), 0 4px 12px rgba(0,0,0,0.32)",
      }}
    >
      <img
        src={SOUL_GENERAL_IMAGE}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-9"
        style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.75) 100%)" }}
      />
      <span className="absolute bottom-1.5 left-1.5 text-[12px] font-bold uppercase leading-none tracking-wide text-white">
        General
      </span>
      <span
        aria-hidden
        className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white opacity-0 transition-opacity hover:opacity-100"
      >
        <Pencil className="h-3 w-3" />
      </span>
    </button>
  );
}
