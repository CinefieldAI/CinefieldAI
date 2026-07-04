"use client";

import { useEffect, useRef, useState } from "react";
import {
  Aperture,
  Blend,
  Check,
  Gauge,
  Gem,
  ImagePlus,
  Loader2,
  Pencil,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import AttachmentPreview from "./AttachmentPreview";
import ModelSelector from "./ModelSelector";
import {
  ASPECT_RATIOS,
  OUTPUT_COUNTS,
  type ReferenceAttachment,
} from "./createImageData";

interface PromptComposerProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  selectedModel: string;
  onSelectModel: (name: string) => void;
  onGenerate: (payload: { prompt: string; model: string }) => Promise<void> | void;
}

let attachmentCounter = 0;

// Shared premium pill-chip styling for the bottom tool row
const CHIP =
  "inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-all duration-[160ms] ease-out hover:-translate-y-px active:scale-[0.98] active:duration-100 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:opacity-75";
const CHIP_IDLE =
  "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.055)] text-[rgba(255,255,255,0.78)] hover:border-[rgba(255,255,255,0.14)] hover:bg-[rgba(255,255,255,0.09)] hover:text-[rgba(255,255,255,0.95)]";
const CHIP_ACTIVE =
  "border-[rgba(0,229,255,0.55)] bg-[rgba(0,229,255,0.12)] text-white";
const CHIP_OPEN =
  "data-[state=open]:border-[rgba(0,229,255,0.55)] data-[state=open]:bg-[rgba(0,229,255,0.12)] data-[state=open]:text-white";

const GENERATION_MODES = ["Mid", "Fast", "Standard", "Pro"] as const;
const QUALITY_LEVELS = ["1K", "2K", "4K"] as const;

function ListPopover<T extends string>({
  title,
  options,
  value,
  onChange,
  trigger,
}: {
  title: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  trigger: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side="top" align="center" sideOffset={10} className="w-44">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          {title}
        </p>
        <div className="flex flex-col gap-1">
          {options.map((option) => {
            const isActive = value === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onChange(option)}
                className={`rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
                  isActive
                    ? "bg-magenta-500/15 text-magenta-400"
                    : "text-zinc-300 hover:bg-white/[0.05]"
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GenerationModeSelector({
  value,
  onChange,
}: {
  value: (typeof GENERATION_MODES)[number];
  onChange: (value: (typeof GENERATION_MODES)[number]) => void;
}) {
  return (
    <ListPopover
      title="Generation Mode"
      options={GENERATION_MODES}
      value={value}
      onChange={onChange}
      trigger={
        <button type="button" title="Generation mode" className={`${CHIP} ${CHIP_IDLE} ${CHIP_OPEN}`}>
          <Gauge />
          {value}
        </button>
      }
    />
  );
}

function QualitySelector({
  value,
  onChange,
}: {
  value: (typeof QUALITY_LEVELS)[number];
  onChange: (value: (typeof QUALITY_LEVELS)[number]) => void;
}) {
  return (
    <ListPopover
      title="Quality"
      options={QUALITY_LEVELS}
      value={value}
      onChange={onChange}
      trigger={
        <button type="button" title="Quality" className={`${CHIP} ${CHIP_IDLE} ${CHIP_OPEN}`}>
          <Aperture />
          {value}
        </button>
      }
    />
  );
}

function OutputCountSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (count: number) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Output count"
          className={`${CHIP} ${CHIP_IDLE} ${CHIP_OPEN}`}
        >
          <span className="grid grid-cols-2 gap-0.5">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-[1px] ${
                  i < value ? "bg-magenta-400" : "bg-zinc-600"
                }`}
              />
            ))}
          </span>
          {value}/4
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" sideOffset={10} className="w-40">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Output Count
        </p>
        <div className="flex gap-1.5">
          {OUTPUT_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => onChange(count)}
              className={`flex h-8 flex-1 items-center justify-center rounded-lg text-sm font-semibold transition-colors ${
                value === count
                  ? "bg-magenta-500/15 text-magenta-400 ring-1 ring-magenta-500/40"
                  : "bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]"
              }`}
            >
              {count}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AspectRatioMenu({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const active = ASPECT_RATIOS.find((r) => r.value === value) ?? ASPECT_RATIOS[0];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Aspect ratio"
          className={`${CHIP} ${CHIP_IDLE} ${CHIP_OPEN}`}
        >
          <span
            className="rounded-[2px] border-[1.5px] border-current opacity-80"
            style={{ width: `${active.width}px`, height: `${active.height}px` }}
          />
          {active.value}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={10}
        className="w-[200px] rounded-[18px] p-2"
        style={{
          background: "rgba(14,14,18,0.94)",
          backdropFilter: "blur(16px) saturate(130%)",
          WebkitBackdropFilter: "blur(16px) saturate(130%)",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.65)",
        }}
      >
        <div className="flex flex-col gap-1">
          {ASPECT_RATIOS.map((ratio) => {
            const isActive = value === ratio.value;
            return (
              <button
                key={ratio.value}
                type="button"
                onClick={() => onChange(ratio.value)}
                className={`flex h-9 items-center gap-2.5 rounded-[12px] border px-2 text-left text-sm transition-colors ${
                  isActive
                    ? "border-[rgba(0,229,255,0.45)] bg-[rgba(0,229,255,0.12)] text-white"
                    : "border-transparent text-zinc-300 hover:bg-[rgba(255,255,255,0.065)]"
                }`}
              >
                <span
                  className="shrink-0 rounded-[2px] border-[1.5px]"
                  style={{
                    width: `${ratio.width}px`,
                    height: `${ratio.height}px`,
                    borderColor: isActive ? "#00e5ff" : "rgba(255,255,255,0.35)",
                  }}
                />
                <span className="font-medium">{ratio.value}</span>
                {isActive && <Check className="ml-auto h-4 w-4 shrink-0 text-magenta-400" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function PromptComposer({
  prompt,
  onPromptChange,
  selectedModel,
  onSelectModel,
  onGenerate,
}: PromptComposerProps) {
  const [attachments, setAttachments] = useState<ReferenceAttachment[]>([]);
  const [aspectRatio, setAspectRatio] = useState("3:4");
  const [outputCount, setOutputCount] = useState(1);
  const [genMode, setGenMode] = useState<(typeof GENERATION_MODES)[number]>("Standard");
  const [quality, setQuality] = useState<(typeof QUALITY_LEVELS)[number]>("2K");
  const [drawMode, setDrawMode] = useState(false);
  const [colorTransfer, setColorTransfer] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // Keep the contenteditable in sync when the prompt is set externally (e.g. "reuse")
  useEffect(() => {
    const el = editorRef.current;
    if (el && el.textContent !== prompt) {
      el.textContent = prompt;
    }
  }, [prompt]);

  useEffect(() => {
    return () => {
      setAttachments((prev) => {
        for (const a of prev) {
          if (a.url) URL.revokeObjectURL(a.url);
        }
        return prev;
      });
    };
  }, []);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList).filter((f) => f.type.startsWith("image/"));

    const placeholders = incoming.map((file) => {
      attachmentCounter += 1;
      return { id: `att-${attachmentCounter}`, file };
    });

    setAttachments((prev) => [
      ...prev,
      ...placeholders.map(({ id, file }) => ({
        id,
        url: "",
        name: file.name,
        loading: true,
      })),
    ]);

    placeholders.forEach(({ id, file }) => {
      const url = URL.createObjectURL(file);
      setTimeout(() => {
        setAttachments((prev) =>
          prev.map((a) => (a.id === id ? { ...a, url, loading: false } : a)),
        );
      }, 700);
    });
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const found = prev.find((a) => a.id === id);
      if (found?.url) URL.revokeObjectURL(found.url);
      return prev.filter((a) => a.id !== id);
    });
  };

  const handleGenerate = async () => {
    if (isGenerating) return;
    if (!prompt.trim() && attachments.length === 0) return;
    setIsGenerating(true);
    try {
      await onGenerate({ prompt, model: selectedModel });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleGenerate();
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleGenerate();
      }}
      style={{
        position: "fixed",
        bottom: "18px",
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(1120px, calc(100vw - 40px))",
        minHeight: "148px",
        zIndex: 80,
        borderRadius: "30px",
        padding: "20px 22px",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.015)), rgba(15,15,18,0.86)",
        backdropFilter: "blur(14px) saturate(130%)",
        WebkitBackdropFilter: "blur(14px) saturate(130%)",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
      className="flex flex-col justify-center shadow-[0_24px_80px_rgba(0,0,0,0.65),0_0_0_1px_rgba(255,255,255,0.03),inset_0_1px_0_rgba(255,255,255,0.06)] transition-shadow duration-[180ms] ease-out focus-within:shadow-[0_28px_90px_rgba(0,0,0,0.7),0_0_0_1px_rgba(0,229,255,0.45),inset_0_1px_0_rgba(255,255,255,0.06)]"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Attachment preview (when present) */}
      {attachments.length > 0 && (
        <div className="mb-3">
          <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />
        </div>
      )}

      {/* Two-column layout: left = editor + controls, right = Generate */}
      <div className="grid grid-cols-[1fr_144px] items-stretch gap-4">
        {/* LEFT */}
        <div className="flex min-w-0 flex-col gap-3">
          {/* Top row: upload + prompt editor */}
          <div className="flex items-start gap-2.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Add reference image"
              className="group flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-zinc-300 transition-all duration-200 ease-out hover:bg-white/[0.06] hover:text-white hover:shadow-[0_0_12px_rgba(0,229,255,0.25)] active:scale-95"
            >
              <ImagePlus className="h-4 w-4 transition-transform duration-200 ease-out group-hover:rotate-[3deg]" />
            </button>

            <div className="relative min-w-0 flex-1">
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                aria-label="Prompt"
                onInput={(e) => onPromptChange(e.currentTarget.textContent ?? "")}
                onKeyDown={handleEditorKeyDown}
                style={{
                  minHeight: "42px",
                  maxHeight: "20dvh",
                  paddingTop: "7px",
                  paddingLeft: "2px",
                  fontSize: "15px",
                  lineHeight: 1.55,
                  letterSpacing: "-0.01em",
                  color: "rgba(255,255,255,0.92)",
                  caretColor: "#00e5ff",
                }}
                className="w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent outline-none"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute select-none transition-opacity duration-200 ease-out"
                style={{
                  left: "2px",
                  top: "7px",
                  fontSize: "15px",
                  fontWeight: 400,
                  lineHeight: 1.55,
                  letterSpacing: "-0.01em",
                  color: "rgba(255,255,255,0.42)",
                  opacity: prompt ? 0 : 1,
                }}
              >
                Describe the scene you imagine
              </span>
            </div>
          </div>

          {/* Bottom tools row — premium pill chips, aligned with the prompt text.
              ModelSelector is kept OUTSIDE the horizontal-scroll container so its
              upward absolute dropdown is not clipped by overflow-x/overflow-y. */}
          <div className="ml-[46px] flex min-w-0 items-center gap-2">
            <ModelSelector selected={selectedModel} onSelect={onSelectModel} />
            <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <GenerationModeSelector value={genMode} onChange={setGenMode} />
              <QualitySelector value={quality} onChange={setQuality} />
              <AspectRatioMenu value={aspectRatio} onChange={setAspectRatio} />
              <OutputCountSelector value={outputCount} onChange={setOutputCount} />
              <button
                type="button"
                onClick={() => setDrawMode((v) => !v)}
                aria-pressed={drawMode}
                className={`${CHIP} ${drawMode ? CHIP_ACTIVE : CHIP_IDLE}`}
              >
                <Pencil />
                Draw
              </button>
              <button
                type="button"
                onClick={() => setColorTransfer((v) => !v)}
                aria-pressed={colorTransfer}
                className={`${CHIP} ${colorTransfer ? CHIP_ACTIVE : CHIP_IDLE}`}
              >
                <Blend />
                Color Transfer
              </button>
              <button type="button" className={`${CHIP} ${CHIP_IDLE}`}>
                <Sparkles />
                Enhance Prompt
              </button>
              <button type="button" className={`${CHIP} ${CHIP_IDLE}`}>
                <Wand2 />
                Magic Prompt
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: Generate */}
        <button
          type="submit"
          disabled={isGenerating}
          className="flex h-full min-h-[104px] w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-[22px] bg-[#00e5ff] px-3 text-white shadow-[0_18px_44px_rgba(0,229,255,0.32),inset_0_1px_0_rgba(255,255,255,0.22)] transition-all duration-[180ms] ease-out hover:bg-[#33eaff] hover:brightness-105 hover:shadow-[0_22px_56px_rgba(0,229,255,0.45),inset_0_1px_0_rgba(255,255,255,0.22)] active:scale-[0.98] active:bg-[#00b8cc] active:duration-100 disabled:cursor-not-allowed disabled:opacity-80"
        >
          <span
            key={isGenerating ? "loading" : "idle"}
            className="flex animate-in flex-col items-center gap-1 fade-in-0 duration-200"
          >
            {isGenerating ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Sparkles className="h-5 w-5" />
            )}
            <span style={{ fontSize: "14px", fontWeight: 700 }}>
              {isGenerating ? "Generating…" : "Generate"}
            </span>
          </span>
          <span
            className="flex items-center gap-1 text-white/80"
            style={{ fontSize: "11px" }}
          >
            <Gem className="h-3 w-3" />
            {outputCount} credits
          </span>
        </button>
      </div>
    </form>
  );
}
