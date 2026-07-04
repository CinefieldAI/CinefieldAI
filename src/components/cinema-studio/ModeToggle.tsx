"use client";

type Mode = "image" | "video";

interface ModeToggleProps {
  mode: Mode;
  onChange: (mode: Mode) => void;
}

function ImageIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`size-6 ${className}`} aria-hidden>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M3 4.75C3 3.784 3.784 3 4.75 3h14.5c.966 0 1.75.784 1.75 1.75v14.5A1.75 1.75 0 0 1 19.25 21H4.75A1.75 1.75 0 0 1 3 19.25zm1.75-.25a.25.25 0 0 0-.25.25v9.69l2.263-2.263a1.75 1.75 0 0 1 2.474 0l7.324 7.323h2.689a.25.25 0 0 0 .25-.25V4.75a.25.25 0 0 0-.25-.25zm9.69 15-6.263-6.263a.25.25 0 0 0-.354 0L4.5 16.561v2.689c0 .138.112.25.25.25z"
        clipRule="evenodd"
      />
      <path
        fill="currentColor"
        d="M13.426 8.537a.25.25 0 0 0 .111-.112l.74-1.478a.25.25 0 0 1 .447 0l.739 1.478a.25.25 0 0 0 .112.112l1.478.74a.25.25 0 0 1 0 .447l-1.479.739a.25.25 0 0 0-.111.112l-.74 1.478a.25.25 0 0 1-.447 0l-.739-1.479a.25.25 0 0 0-.112-.111l-1.478-.74a.25.25 0 0 1 0-.447z"
      />
    </svg>
  );
}

function VideoIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`size-6 ${className}`} aria-hidden>
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="m17.25 9 3.094-1.375a1 1 0 0 1 1.406.914v6.922a1 1 0 0 1-1.406.914L17.25 15M2.75 6.25a1 1 0 0 1 1-1h12.5a1 1 0 0 1 1 1v11.5a1 1 0 0 1-1 1H3.75a1 1 0 0 1-1-1z"
      />
    </svg>
  );
}

function ToggleButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: (props: { className?: string }) => React.ReactElement;
  onClick: () => void;
}) {
  const Icon = icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} mode`}
      aria-pressed={active}
      className={`flex h-14 w-16 flex-col items-center justify-center gap-1 rounded-[20px] border-none px-3 py-1.5 text-[10px] font-bold leading-3 tracking-[0.2px] transition-all duration-200 ${
        active
          ? "bg-white/5 text-white"
          : "bg-transparent text-neutral-400 hover:text-white"
      }`}
    >
      <Icon className={active ? "text-[#00e5ff]" : ""} />
      {label}
    </button>
  );
}

/**
 * Standalone Image/Video mode toggle — a separate vertical container that sits
 * to the LEFT of the prompt bar (sibling, not nested).
 */
export default function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div
      className="z-50 flex h-[116px] w-[72px] min-w-[72px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-[24px] bg-[#1a1d1f] p-1 backdrop-blur-[20px]"
      style={{
        boxShadow:
          "0 4px 6px rgba(0,0,0,0.16), 0 4px 16px rgba(0,0,0,0.08)",
      }}
    >
      <ToggleButton
        active={mode === "image"}
        label="Image"
        icon={ImageIcon}
        onClick={() => onChange("image")}
      />
      <ToggleButton
        active={mode === "video"}
        label="Video"
        icon={VideoIcon}
        onClick={() => onChange("video")}
      />
    </div>
  );
}
