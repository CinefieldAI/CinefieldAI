"use client";

interface KlingMediaCardProps {
  /** Shown bottom-left, uppercase — "MOTION" / "CHARACTER". */
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  ariaExpanded?: boolean;
}

/**
 * The Motion / Character tiles Kling Motion Control puts next to Generate.
 * Same 96px square and surface as FrameCard so the row reads as one set, but
 * it opens a dialog rather than an asset picker, so it carries no preview or
 * remove affordance.
 */
export default function KlingMediaCard({ label, icon, onClick, ariaExpanded }: KlingMediaCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={ariaExpanded}
      className="group relative flex h-[96px] w-[96px] shrink-0 cursor-pointer flex-col items-start justify-between overflow-clip rounded-xl p-2 text-left transition-colors"
      style={{
        background:
          "linear-gradient(180deg, rgba(38,40,43,0.95) 0%, rgba(24,26,29,0.95) 100%)",
        boxShadow: "inset 0 0 0 1px rgba(217,217,217,0.06)",
      }}
    >
      <span className="flex size-7 items-center justify-center rounded-full bg-white/[0.06] text-white/80 transition-colors group-hover:bg-white/10">
        {icon}
      </span>
      <span className="text-[12px] font-bold uppercase leading-[14px] text-white">{label}</span>
    </button>
  );
}
