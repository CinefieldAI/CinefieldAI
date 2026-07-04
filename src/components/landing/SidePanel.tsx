"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  Film,
  ImageIcon,
  Loader2,
  Mic,
  Music2,
  Sparkles,
  Upload,
  User,
  Wand2,
  X,
} from "lucide-react";
import {
  IMAGE_MODELS,
  VIDEO_DURATIONS,
  VIDEO_MODELS,
  VIDEO_QUALITIES,
  type PanelKey,
  type VideoView,
} from "./panelData";
import VisualsSoundPopover from "./VisualsSoundPopover";

interface SidePanelProps {
  activePanel: PanelKey | null;
  onClose: () => void;
}

function PanelShell({
  icon: Icon,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  icon: typeof ImageIcon;
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-magenta-500/15 text-magenta-500">
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="text-xs text-zinc-500">{subtitle}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>

      {footer && <div className="border-t border-white/10 px-5 py-4">{footer}</div>}
    </div>
  );
}

function PillGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`flex-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
            value === option
              ? "bg-magenta-500/15 text-magenta-400 ring-1 ring-magenta-500/40"
              : "bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function ModelSelect({
  models,
  selected,
  onSelect,
}: {
  models: { name: string; description: string }[];
  selected: number;
  onSelect: (idx: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = models[selected];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
      >
        <span>
          <span className="block text-sm font-medium text-white">
            {current.name}
          </span>
          <span className="block text-xs text-zinc-500">
            {current.description}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1.5 space-y-1 rounded-xl border border-white/10 bg-zinc-950/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl">
          {models.map((model, idx) => (
            <button
              key={model.name}
              type="button"
              onClick={() => {
                onSelect(idx);
                setOpen(false);
              }}
              className={`block w-full rounded-lg px-3 py-2 text-left transition-colors ${
                idx === selected
                  ? "bg-magenta-500/10 text-magenta-400"
                  : "text-zinc-300 hover:bg-white/5"
              }`}
            >
              <span className="block text-sm font-medium">{model.name}</span>
              <span className="block text-xs text-zinc-500">
                {model.description}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UploadDropzone({ label, hint }: { label: string; hint: string }) {
  return (
    <button
      type="button"
      className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-6 text-center transition-colors hover:border-magenta-500/40 hover:bg-white/[0.04]"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-zinc-400">
        <Upload className="h-4 w-4" />
      </span>
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      <span className="text-xs text-zinc-500">{hint}</span>
    </button>
  );
}

function CreateVideoSuite({ onOpenMotion }: { onOpenMotion: () => void }) {
  const [model, setModel] = useState(0);
  const [duration, setDuration] = useState<typeof VIDEO_DURATIONS[number]>("8s");
  const [quality, setQuality] = useState<typeof VIDEO_QUALITIES[number]>("1080p");
  const [tier, setTier] = useState<"Standard" | "Pro Max">("Standard");

  return (
    <>
      <p className="text-sm leading-relaxed text-zinc-400">
        Direct full-motion cinematic sequences from a single prompt.
      </p>

      <div className="mt-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Prompt
        </h3>
        <textarea
          rows={4}
          placeholder="A slow dolly-in on a neon-lit street at night..."
          className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-magenta-500/40 focus:outline-none"
        />
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Model
        </h3>
        <ModelSelect models={VIDEO_MODELS} selected={model} onSelect={setModel} />
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Duration
        </h3>
        <PillGroup options={VIDEO_DURATIONS} value={duration} onChange={setDuration} />
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Quality
        </h3>
        <PillGroup options={VIDEO_QUALITIES} value={quality} onChange={setQuality} />
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Render Tier
        </h3>
        <PillGroup
          options={["Standard", "Pro Max"] as const}
          value={tier}
          onChange={setTier}
        />
      </div>

      <div className="mt-6 space-y-1.5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Features
        </h3>
        <VisualsSoundPopover />
        <button
          type="button"
          onClick={onOpenMotion}
          className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3.5 py-2.5 text-left text-sm text-zinc-200 transition-colors hover:border-magenta-500/30 hover:bg-white/[0.06]"
        >
          <span className="flex items-center gap-2.5">
            <Film className="h-4 w-4 text-zinc-500" />
            Motion Control
          </span>
          <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-zinc-600" />
        </button>
      </div>
    </>
  );
}

function MotionControlSuite({ onBack }: { onBack: () => void }) {
  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-white"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back to Create Video
      </button>

      <p className="mt-4 text-sm leading-relaxed text-zinc-400">
        Drive motion with reference clips and lock a consistent character.
      </p>

      <div className="mt-6 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Motion Source
        </h3>
        <UploadDropzone
          label="Add motion to copy"
          hint="MP4, MOV up to 30s"
        />
        <UploadDropzone label="Add your character" hint="PNG, JPG portrait" />
      </div>

      <div className="mt-6">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Output Preview
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="flex aspect-square items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br from-zinc-800 to-zinc-950"
            >
              <User className="h-4 w-4 text-white/20" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function LipsyncStudioSuite() {
  const [script, setScript] = useState("");

  return (
    <>
      <p className="text-sm leading-relaxed text-zinc-400">
        Sync any portrait to a script with studio-grade voice rendering.
      </p>

      <div className="mt-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Portrait
        </h3>
        <UploadDropzone label="Drop a portrait image" hint="PNG, JPG up to 10MB" />
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Script
        </h3>
        <textarea
          rows={5}
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder="Type or paste the line you want spoken..."
          className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-magenta-500/40 focus:outline-none"
        />
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Voice Engine
        </h3>
        <div className="flex items-center justify-between rounded-xl border border-magenta-500/30 bg-magenta-500/10 px-3.5 py-2.5">
          <span className="flex items-center gap-2.5 text-sm font-medium text-magenta-400">
            <Mic className="h-4 w-4" />
            Wan 2 Fast
          </span>
          <span className="text-xs text-zinc-500">Default</span>
        </div>
      </div>

      <div className="mt-6">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Generation Queue
        </h3>
        <div className="space-y-2">
          {[
            { label: "take_03.mp4", status: "Rendering", progress: true },
            { label: "take_02.mp4", status: "Queued", progress: false },
            { label: "take_01.mp4", status: "Complete", progress: false },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2"
            >
              <span className="text-sm text-zinc-300">{item.label}</span>
              <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                {item.progress && (
                  <Loader2 className="h-3 w-3 animate-spin text-magenta-400" />
                )}
                {item.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function ImageSuite() {
  const [model, setModel] = useState(0);

  return (
    <>
      <p className="text-sm leading-relaxed text-zinc-400">
        Generate, restyle, and upscale images with studio-grade control.
      </p>

      <div className="mt-6">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Features
        </h3>
        <div className="space-y-1.5">
          {[
            { name: "Text to Image", icon: Wand2 },
            { name: "Image to Image", icon: ImageIcon },
            { name: "Upscale & Enhance", icon: Sparkles },
          ].map((feature) => {
            const FIcon = feature.icon;
            return (
              <button
                key={feature.name}
                type="button"
                className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3.5 py-2.5 text-left text-sm text-zinc-200 transition-colors hover:border-magenta-500/30 hover:bg-white/[0.06]"
              >
                <span className="flex items-center gap-2.5">
                  <FIcon className="h-4 w-4 text-zinc-500" />
                  {feature.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Model
        </h3>
        <ModelSelect models={IMAGE_MODELS} selected={model} onSelect={setModel} />
      </div>
    </>
  );
}

export default function SidePanel({ activePanel, onClose }: SidePanelProps) {
  const [videoView, setVideoView] = useState<VideoView>("create");

  const handleClose = () => {
    onClose();
    setVideoView("create");
  };

  return (
    <>
      <div
        onClick={handleClose}
        aria-hidden
        className={`fixed inset-0 z-40 bg-black/70 backdrop-blur-sm transition-opacity duration-300 ${
          activePanel ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[340px] max-w-[88vw] border-r border-white/10 bg-zinc-950 shadow-2xl shadow-black transition-transform duration-300 ease-out ${
          activePanel ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {activePanel === "image" && (
          <PanelShell
            icon={ImageIcon}
            title="Image Studio"
            subtitle="Configuration"
            onClose={handleClose}
            footer={
              <button
                type="button"
                className="w-full rounded-full bg-gradient-to-r from-magenta-500 to-magenta-600 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02]"
              >
                Generate Image
              </button>
            }
          >
            <ImageSuite />
          </PanelShell>
        )}

        {activePanel === "video" && (
          <PanelShell
            icon={Film}
            title={videoView === "create" ? "Create Video Suite" : "Motion Control Suite"}
            subtitle="Configuration"
            onClose={handleClose}
            footer={
              <div className="space-y-3">
                <button
                  type="button"
                  className="w-full rounded-full bg-gradient-to-r from-magenta-500 to-magenta-600 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02]"
                >
                  Generate Video
                </button>
                <p className="text-center text-xs text-zinc-500">
                  1,240 credits remaining in this workspace
                </p>
              </div>
            }
          >
            {videoView === "create" ? (
              <CreateVideoSuite onOpenMotion={() => setVideoView("motion")} />
            ) : (
              <MotionControlSuite onBack={() => setVideoView("create")} />
            )}
          </PanelShell>
        )}

        {activePanel === "audio" && (
          <PanelShell
            icon={Music2}
            title="Lipsync Studio"
            subtitle="Configuration"
            onClose={handleClose}
            footer={
              <button
                type="button"
                className="w-full rounded-full bg-gradient-to-r from-magenta-500 to-magenta-600 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02]"
              >
                Generate Lipsync
              </button>
            }
          >
            <LipsyncStudioSuite />
          </PanelShell>
        )}
      </aside>
    </>
  );
}
