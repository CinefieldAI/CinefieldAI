"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { AtSign, Check, ChevronDown, Minus, Monitor, Plus } from "lucide-react";
import { useListboxNav } from "@/hooks/useListboxNav";
import MarketingImageModelSelector from "./MarketingImageModelSelector";

const ASPECT_RATIO_OPTIONS = ["9:16", "3:4", "2:3", "1:1", "4:3", "16:9", "3:2", "5:4", "4:5", "21:9"];
const RESOLUTION_OPTIONS = ["1K", "2K", "4K"];
const COUNT_OPTIONS = ["1/1", "1/2", "1/3", "1/4"];

function AspectIcon({ className = "" }: { className?: string }) {
  return <span className={`block h-3 w-4 rounded-[3px] border border-current ${className}`} />;
}

function OptionPopover({
  label,
  value,
  options,
  onChange,
  icon,
  columns = 1,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  icon: ReactNode;
  columns?: 1 | 2;
}) {
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.indexOf(value));

  const nav = useListboxNav({
    count: options.length,
    selectedIndex,
    open,
    onSelect: (index) => {
      const next = options[index];
      if (!next) return;
      onChange(next);
      setOpen(false);
    },
    onActivate: (index) => {
      const next = options[index];
      if (next) onChange(next);
    },
  });

  const panelWidth = columns === 2 ? "w-[190px]" : "w-[116px]";
  const gridClass = columns === 2 ? "grid grid-cols-2 gap-1" : "space-y-1";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${label}: ${value}`}
          className={`flex h-8 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-semibold text-white transition-colors focus:outline-none ${
            open
              ? "border-[#D97757] bg-[#181a1d]"
              : "border-white/[0.08] bg-[#101112] hover:border-[#D97757] hover:bg-[#181a1d]"
          }`}
        >
          <span className="text-white/80">{icon}</span>
          <span>{value}</span>
          <ChevronDown className={`size-3.5 text-white/45 transition-transform ${open ? "rotate-180 text-[#D97757]" : ""}`} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          onKeyDown={nav.handleKeyDown}
          onOpenAutoFocus={nav.handleOpenAutoFocus}
          onEscapeKeyDown={nav.handleEscapeKeyDown}
          className={`z-[100000] rounded-2xl border border-white/[0.08] bg-[rgba(19,21,23,0.94)] p-3 shadow-[0_20px_55px_rgba(0,0,0,0.5)] outline-none backdrop-blur-[24px] ${panelWidth}`}
        >
          <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wide text-white/45">
            {label}
          </div>
          <div className={gridClass} role="listbox" aria-label={label}>
            {options.map((option, index) => {
              const optionProps = nav.getOptionProps(index);
              const marked = nav.activeIndex === index;
              const selected = value === option;
              return (
                <button
                  key={option}
                  ref={optionProps.ref}
                  tabIndex={optionProps.tabIndex}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  className={`flex h-9 items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold outline-none transition-colors ${
                    marked || selected
                      ? "bg-white/[0.08] text-white"
                      : "bg-transparent text-white/78 hover:bg-white/[0.05] focus:bg-white/[0.05]"
                  }`}
                >
                  <span className={`flex size-4 items-center justify-center rounded border ${selected ? "border-[#D97757] text-[#D97757]" : "border-white/40 text-transparent"}`}>
                    {selected && <Check className="size-3" />}
                  </span>
                  <span>{option}</span>
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export default function MarketingPromptControls({
  selectedImageModel,
  onImageModelChange,
}: {
  selectedImageModel: string;
  onImageModelChange: (name: string) => void;
}) {
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("2K");
  const [count, setCount] = useState("1/1");
  const countIndex = useMemo(() => COUNT_OPTIONS.indexOf(count), [count]);

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        aria-label="Add"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#101112] text-white/90 transition-colors hover:border-[#D97757] hover:bg-[#181a1d]"
      >
        <Plus className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Mention"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#101112] text-white/90 transition-colors hover:border-[#D97757] hover:bg-[#181a1d]"
      >
        <AtSign className="size-4" />
      </button>
      <MarketingImageModelSelector
        selected={selectedImageModel}
        onSelect={onImageModelChange}
      />
      <OptionPopover
        label="Aspect Ratio"
        value={aspectRatio}
        options={ASPECT_RATIO_OPTIONS}
        onChange={setAspectRatio}
        icon={<AspectIcon className="text-white/80" />}
        columns={2}
      />
      <OptionPopover
        label="Resolution"
        value={resolution}
        options={RESOLUTION_OPTIONS}
        onChange={setResolution}
        icon={<Monitor className="size-4" />}
      />
      <div className="flex h-8 shrink-0 items-center rounded-lg border border-white/[0.08] bg-[#101112] text-xs font-semibold text-white">
        <button
          type="button"
          aria-label="Decrease count"
          onClick={() => setCount(COUNT_OPTIONS[Math.max(0, countIndex - 1)])}
          className="flex h-full w-8 items-center justify-center text-white/65 transition-colors hover:text-white"
        >
          <Minus className="size-3.5" />
        </button>
        <OptionPopover
          label="Count"
          value={count}
          options={COUNT_OPTIONS}
          onChange={setCount}
          icon={null}
        />
        <button
          type="button"
          aria-label="Increase count"
          onClick={() => setCount(COUNT_OPTIONS[Math.min(COUNT_OPTIONS.length - 1, countIndex + 1)])}
          className="flex h-full w-8 items-center justify-center text-white/65 transition-colors hover:text-white"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
