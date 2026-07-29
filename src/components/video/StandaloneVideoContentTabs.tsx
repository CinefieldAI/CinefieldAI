"use client";

import { useRef, type KeyboardEvent } from "react";

export type StandaloneVideoContentTab = "history" | "how-it-works";

const TABS: { value: StandaloneVideoContentTab; label: string }[] = [
  { value: "history", label: "History" },
  { value: "how-it-works", label: "How it works" },
];

interface StandaloneVideoContentTabsProps {
  value: StandaloneVideoContentTab;
  onChange: (value: StandaloneVideoContentTab) => void;
}

export default function StandaloneVideoContentTabs({
  value,
  onChange,
}: StandaloneVideoContentTabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex = index;

    if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = TABS.length - 1;
    else return;

    event.preventDefault();
    onChange(TABS[nextIndex].value);
    refs.current[nextIndex]?.focus({ preventScroll: true });
  };

  return (
    <div
      role="tablist"
      aria-label="Video page content"
      className="flex h-11 shrink-0 items-center gap-1 rounded-xl border border-white/[0.07] bg-[#181a1c] p-1"
    >
      {TABS.map((tab, index) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            id={`standalone-video-tab-${tab.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`standalone-video-panel-${tab.value}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`h-9 min-w-28 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D97757]/60 ${
              selected
                ? "bg-white/10 text-white"
                : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
