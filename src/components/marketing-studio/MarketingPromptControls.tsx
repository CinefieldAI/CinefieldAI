"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { AtSign, Check, ChevronDown, Clock, Minus, Monitor, Palette, Plus, X } from "lucide-react";
import { useListboxNav } from "@/hooks/useListboxNav";
import MarketingImageModelSelector from "./MarketingImageModelSelector";
import MarketingVideoModelSelector from "./MarketingVideoModelSelector";

const ASPECT_RATIO_OPTIONS = ["9:16", "3:4", "2:3", "1:1", "4:3", "16:9", "3:2", "5:4", "4:5", "21:9"];
const IMAGE_RESOLUTION_OPTIONS = ["1K", "2K", "4K"];
const VIDEO_RESOLUTION_OPTIONS = ["720p", "1080p", "2K"];
const DURATION_OPTIONS = ["5s", "10s", "15s", "30s"];
const COUNT_OPTIONS = ["1/1", "1/2", "1/3", "1/4"];
const VIDEO_BATCH_OPTIONS = ["1/4", "2/4", "3/4", "4/4"];
const VIDEO_STYLE_OPTIONS = [
  "2D product motion",
  "Hypermotion",
  "Typography",
  "Dark Minimalism",
  "Color pop",
  "Mixed media",
  "SaaS",
];

function AspectIcon({ className = "" }: { className?: string }) {
  return <span className={`block h-3 w-4 rounded-[3px] border border-current ${className}`} />;
}

function usePopoverWheelLock(
  open: boolean,
  contentRef: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;

    const handleWheel = (event: WheelEvent) => {
      const target = event.target;
      if (target instanceof Node && contentRef.current?.contains(target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", handleWheel, { capture: true });
  }, [contentRef, open]);
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
  const contentRef = useRef<HTMLDivElement | null>(null);
  const selectedIndex = Math.max(0, options.indexOf(value));
  usePopoverWheelLock(open, contentRef);

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
          ref={contentRef}
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
          <div
            className={`${gridClass} overscroll-contain`}
            role="listbox"
            aria-label={label}
            onWheel={(event) => event.stopPropagation()}
          >
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

function VideoStyleDialog({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Choose style"
          className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-white/[0.08] bg-[#101112] px-2.5 text-xs font-semibold text-white transition-colors hover:border-[#D97757] hover:bg-[#181a1d] focus:outline-none"
        >
          <Palette className="size-4 text-[#D97757]" />
          <span className="max-w-[138px] truncate">{value}</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[99998] bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[99999] flex h-[min(820px,calc(100dvh-48px))] w-[min(1080px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#17191b] p-2 shadow-[0_30px_90px_rgba(0,0,0,0.65)] outline-none">
          <header className="flex h-10 shrink-0 items-center rounded-lg">
            <Dialog.Title className="flex-1 px-3 text-sm font-semibold text-white">
              Choose style
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="flex size-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 transition-colors hover:bg-white/10"
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </header>
          <div className="grid min-h-0 flex-1 grid-cols-[184px_1fr] overflow-hidden rounded-[20px] bg-[#101112]">
            <nav aria-label="Marketing Studio categories" className="flex flex-col gap-3 border-r border-white/[0.06] bg-white/[0.03] p-3">
              <div>
                <p className="px-2 py-1 text-[11px] font-medium text-white/40">Image</p>
                {["Product shot", "Ads", "Marketplace"].map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="flex h-9 w-full items-center rounded-lg px-2 text-left text-xs font-medium text-white/50"
                  >
                    {item}
                  </button>
                ))}
              </div>
              <div>
                <p className="px-2 py-1 text-[11px] font-medium text-white/40">Video</p>
                <button
                  type="button"
                  aria-pressed="true"
                  className="flex h-9 w-full items-center rounded-lg bg-white/[0.08] px-2 text-left text-xs font-semibold text-white"
                >
                  Motion
                </button>
              </div>
            </nav>
            <section className="min-h-0 overflow-y-auto p-5">
              <p className="mb-3 text-sm font-semibold text-white">Motion</p>
              <label className="mb-5 flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-[#0d0e0f] px-3 text-xs text-white/45">
                <span>Search styles</span>
                <input
                  type="search"
                  aria-label="Search styles"
                  className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-white/35"
                  placeholder=""
                />
              </label>
              <div role="radiogroup" aria-label="Styles" className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {VIDEO_STYLE_OPTIONS.map((option) => {
                  const selected = option === value;
                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        onChange(option);
                        setOpen(false);
                      }}
                      className="group flex min-w-0 flex-col items-start gap-2 text-left outline-none"
                    >
                      <span className={`relative block aspect-[3/4] w-full overflow-hidden rounded-2xl border bg-[#202224] transition-colors ${
                        selected ? "border-[#D97757]" : "border-white/[0.08] group-hover:border-white/20"
                      }`}>
                        <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgba(217,119,87,0.35),transparent_42%),linear-gradient(145deg,#272a2d,#0f1011)]" />
                        <span className="absolute bottom-3 left-3 right-3 text-xs font-semibold text-white/75">{option}</span>
                      </span>
                      <span className="w-full truncate px-2 text-xs font-semibold text-white">{option}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function MarketingPromptControls({
  mode,
  selectedImageModel,
  selectedVideoModel,
  onImageModelChange,
  onVideoModelChange,
}: {
  mode: "image" | "video";
  selectedImageModel: string;
  selectedVideoModel: string;
  onImageModelChange: (name: string) => void;
  onVideoModelChange: (name: string) => void;
}) {
  const [imageAspectRatio, setImageAspectRatio] = useState("16:9");
  const [videoAspectRatio, setVideoAspectRatio] = useState("9:16");
  const [imageResolution, setImageResolution] = useState("2K");
  const [videoResolution, setVideoResolution] = useState("2K");
  const [duration, setDuration] = useState("5s");
  const [imageCount, setImageCount] = useState("1/1");
  const [videoBatch, setVideoBatch] = useState("1/4");
  const [videoStyle, setVideoStyle] = useState("2D product motion");
  const count = mode === "image" ? imageCount : videoBatch;
  const countOptions = mode === "image" ? COUNT_OPTIONS : VIDEO_BATCH_OPTIONS;
  const countIndex = useMemo(() => countOptions.indexOf(count), [count, countOptions]);
  const resolution = mode === "image" ? imageResolution : videoResolution;
  const aspectRatio = mode === "image" ? imageAspectRatio : videoAspectRatio;
  const setAspectRatio = mode === "image" ? setImageAspectRatio : setVideoAspectRatio;
  const setCount = mode === "image" ? setImageCount : setVideoBatch;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        aria-label="Add"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#101112] text-white/90 transition-colors hover:border-[#D97757] hover:bg-[#181a1d]"
      >
        <Plus className="size-4" />
      </button>
      {mode === "image" && (
        <button
          type="button"
          aria-label="Mention"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#101112] text-white/90 transition-colors hover:border-[#D97757] hover:bg-[#181a1d]"
        >
          <AtSign className="size-4" />
        </button>
      )}
      {mode === "image" ? (
        <MarketingImageModelSelector
          selected={selectedImageModel}
          onSelect={onImageModelChange}
        />
      ) : (
        <MarketingVideoModelSelector
          selected={selectedVideoModel}
          onSelect={onVideoModelChange}
        />
      )}
      {mode === "video" && (
        <VideoStyleDialog value={videoStyle} onChange={setVideoStyle} />
      )}
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
        options={mode === "image" ? IMAGE_RESOLUTION_OPTIONS : VIDEO_RESOLUTION_OPTIONS}
        onChange={mode === "image" ? setImageResolution : setVideoResolution}
        icon={<Monitor className="size-4" />}
      />
      {mode === "video" && (
        <OptionPopover
          label="Duration"
          value={duration}
          options={DURATION_OPTIONS}
          onChange={setDuration}
          icon={<Clock className="size-4" />}
        />
      )}
      <div className="flex h-8 shrink-0 items-center rounded-lg border border-white/[0.08] bg-[#101112] text-xs font-semibold text-white">
        <button
          type="button"
          aria-label={mode === "video" ? "Decrease batch size" : "Decrease count"}
          disabled={countIndex <= 0}
          onClick={() => setCount(countOptions[Math.max(0, countIndex - 1)])}
          className="flex h-full w-8 items-center justify-center text-white/65 transition-colors hover:text-white"
        >
          <Minus className="size-3.5" />
        </button>
        {mode === "image" ? (
          <OptionPopover
            label="Count"
            value={count}
            options={COUNT_OPTIONS}
            onChange={setCount}
            icon={null}
          />
        ) : (
          <span className="flex h-full min-w-12 items-center justify-center px-2">{count}</span>
        )}
        <button
          type="button"
          aria-label={mode === "video" ? "Increase batch size" : "Increase count"}
          disabled={countIndex >= countOptions.length - 1}
          onClick={() => setCount(countOptions[Math.min(countOptions.length - 1, countIndex + 1)])}
          className="flex h-full w-8 items-center justify-center text-white/65 transition-colors hover:text-white"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
