"use client";

interface GenerateButtonProps {
  creditCost: number;
  onGenerate: () => void;
  mode?: "image" | "video";
  isLoading?: boolean;
  /** Forces the yellow/lime accent regardless of mode — Cinema Studio 2.5 only,
   * matches its real reference (yellow Generate button even in Video mode).
   * Omitted for every other caller, preserving the existing mode-based behavior. */
  accent?: "cyan" | "yellow";
  height?: number;
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 21 21" className="size-3" fill="none" aria-hidden>
      <path
        d="M11.8525 4.21651L11.7221 3.2387C11.6906 3.00226 11.4889 2.82568 11.2504 2.82568C11.0118 2.82568 10.8102 3.00226 10.7786 3.23869L10.6483 4.21651C10.2658 7.0847 8.00939 9.34115 5.14119 9.72358L4.16338 9.85396C3.92694 9.88549 3.75037 10.0872 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 4.16338 10.7974L5.14119 10.9278C8.00938 11.3102 10.2658 13.5667 10.6483 16.4349L10.7786 17.4127C10.8102 17.6491 11.0118 17.8257 11.2504 17.8257C11.4889 17.8257 11.6906 17.6491 11.7221 17.4127L11.8525 16.4349C12.2349 13.5667 14.4913 11.3102 17.3595 10.9278L18.3374 10.7974C18.5738 10.7659 18.7504 10.5642 18.7504 10.3257C18.7504 10.0872 18.5738 9.88549 18.3374 9.85396L17.3595 9.72358C14.4913 9.34115 12.2349 7.0847 11.8525 4.21651Z"
        fill="currentColor"
      />
      <path
        d="M4.6519 14.7568L4.82063 14.2084C4.84491 14.1295 4.91781 14.0757 5.00037 14.0757C5.08292 14.0757 5.15582 14.1295 5.1801 14.2084L5.34883 14.7568C5.56525 15.4602 6.11587 16.0108 6.81925 16.2272L7.36762 16.3959C7.44652 16.4202 7.50037 16.4931 7.50037 16.5757C7.50037 16.6582 7.44652 16.7311 7.36762 16.7554L6.81926 16.9241C6.11587 17.1406 5.56525 17.6912 5.34883 18.3946L5.1801 18.9429C5.15582 19.0218 5.08292 19.0757 5.00037 19.0757C4.91781 19.0757 4.84491 19.0218 4.82063 18.9429L4.65191 18.3946C4.43548 17.6912 3.88486 17.1406 3.18147 16.9241L2.63311 16.7554C2.55421 16.7311 2.50037 16.6582 2.50037 16.5757C2.50037 16.4931 2.55421 16.4202 2.63311 16.3959L3.18148 16.2272C3.88486 16.0108 4.43548 15.4602 4.6519 14.7568Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Right zone of the prompt bar — 120×80 Generate button. */
export default function GenerateButton({
  creditCost,
  onGenerate,
  mode = "video",
  isLoading = false,
  accent,
  height,
}: GenerateButtonProps) {
  // Single brand accent everywhere — Generate is always #D97757 regardless
  // of mode (no more lime for Image, cyan for Video, yellow for Cinema 2.5).
  const background = "linear-gradient(135deg, #D97757 0%, #B85A3E 100%)";
  const boxShadow =
    "10px 34px 24px 0 rgba(0,0,0,0.15), 8px 21px 6px 0 rgba(0,0,0,0.01), 3px 7px 5px 0 rgba(0,0,0,0.25), 1px 3px 4px 0 rgba(0,0,0,0.43), 0 1px 2px 0 rgba(0,0,0,0.49), inset 0px -3px 0px 0px #8A4A32, inset 0px -2px 0px 0px #8A4A32, inset 0px 1px 0px 0px #F0A98C";
  const glow = "#D97757";

  return (
    <button
      type="button"
      onClick={onGenerate}
      disabled={isLoading}
      aria-label="Generate"
      className="relative flex shrink-0 flex-col items-center justify-center gap-1 self-center overflow-hidden rounded-xl border-0 font-bold uppercase text-black transition-all duration-200 ease-out hover:brightness-90 active:brightness-[0.8] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-black focus:ring-[#D97757] disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        width: 135,
        height: height ?? 96,
        background,
        boxShadow,
        textShadow: "rgba(255,255,255,0.45) 0px 0px 8px",
      }}
    >
      {/* Glow */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-[39px] top-[36px] h-[136px] w-[76px] rounded-[50%] mix-blend-plus-lighter blur-[41.5px]"
        style={{
          background: glow,
          transform: "rotate(102.79deg) skewX(0.89deg)",
        }}
      />
      <span className="relative z-10 text-xs font-bold leading-[18px]">
        Generate
      </span>
      <span className={`relative z-10 flex h-4 items-center justify-center gap-0.5 text-[11px] font-semibold normal-case ${isLoading ? 'animate-spin' : ''}`}>
        <SparkleIcon />
        {isLoading ? null : creditCost}
      </span>
    </button>
  );
}
