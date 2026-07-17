"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import * as Popover from "@radix-ui/react-popover";
import {
  ChevronDown,
  Minus,
  Plus,
  Volume2,
  VolumeX,
} from "lucide-react";
import GenerateButton from "./GenerateButton";
import ModelSelector from "./ModelSelector";
import AspectRatioDropdown from "./AspectRatioDropdown";
import GeminiAspectRatioControl from "./GeminiAspectRatioControl";
import Kling3AspectRatioControl from "./Kling3AspectRatioControl";
import ReferencesControl from "./ReferencesControl";
import Kling3MultiShotControl from "./Kling3MultiShotControl";
import KlingModeControl from "./KlingModeControl";
import Veo31AspectRatioControl from "./Veo31AspectRatioControl";
import FrameCard from "./FrameCard";
import SoundOffConfirmDialog from "./SoundOffConfirmDialog";
import ResolutionPopover from "./ResolutionPopover";
import DurationPopover from "./DurationPopover";
import AssetsPickerModal from "./AssetsPickerModal";
import KlingPromptDisabled from "./KlingPromptDisabled";
import KlingAdvancedSettingsPanel from "./KlingAdvancedSettingsPanel";
import KlingMotionModal from "./KlingMotionModal";
import KlingCharacterPanel from "./KlingCharacterPanel";
import KlingSceneControl from "./KlingSceneControl";
import KlingMotionCard from "./KlingMotionCard";
import KlingCharacterCard from "./KlingCharacterCard";
import { getModel } from "./cinemaStudioData";

export interface PromptBarProps {
  prompt: string;
  onPromptChange: (value: string) => void;

  model: string;
  onModelChange: (id: string) => void;

  /** Read-only here — the toggle lives in the left sidebar now. */
  mode: "image" | "video";

  aspectRatio: string;
  onAspectRatioChange: (value: string) => void;
  resolution: string;
  onResolutionChange: (value: string) => void;
  duration: number;
  durations: number[];
  onDurationChange: (value: number) => void;
  batch: string;
  onBatchChange: (value: string) => void;
  sound: boolean;
  onSoundChange: (value: boolean) => void;

  creditCost: number;
  onGenerate: () => void;

  // Kling 3.0 Motion Control advanced prompt
  klingAdvancedPrompt: string;
  onKlingAdvancedPromptChange: (value: string) => void;

  // Kling 3.0 Turbo — isolated per-model settings (not shared with any other model)
  kling3TurboSettings: {
    aspectRatio: string;
    resolution: string;
    startFrame: string | null;
  };
  onKling3TurboSettingsChange: Dispatch<
    SetStateAction<{
      aspectRatio: string;
      resolution: string;
      startFrame: string | null;
    }>
  >;
}

/** Verbatim reference icon — three sparkle stars + a pencil stroke (Kling 2.6's Enhance chip). */
function EnhanceIcon() {
  return (
    <svg aria-hidden="true" width="24px" height="24px" viewBox="0 0 24 24" fill="none" className="size-3.5">
      <path
        d="M4.75518 5.15769C4.65005 4.94744 4.35001 4.94744 4.24488 5.15769L3.59168 6.4641C3.56407 6.51931 3.51931 6.56407 3.4641 6.59168L2.15769 7.24488C1.94744 7.35001 1.94744 7.65005 2.15769 7.75518L3.4641 8.40839C3.51931 8.43599 3.56407 8.48075 3.59168 8.53596L4.24488 9.84237C4.35001 10.0526 4.65005 10.0526 4.75518 9.84237L5.40839 8.53596C5.43599 8.48075 5.48075 8.43599 5.53596 8.40839L6.84237 7.75518C7.05262 7.65005 7.05262 7.35001 6.84237 7.24488L5.53596 6.59168C5.48075 6.56407 5.43599 6.51931 5.40839 6.4641L4.75518 5.15769Z"
        fill="currentColor"
      />
      <path
        d="M9.26447 2.16345C9.1555 1.94552 8.8445 1.94552 8.73553 2.16345L8.25558 3.12335C8.22697 3.18057 8.18057 3.22697 8.12335 3.25558L7.16345 3.73553C6.94552 3.8445 6.94552 4.1555 7.16345 4.26447L8.12335 4.74442C8.18057 4.77303 8.22697 4.81943 8.25558 4.87665L8.73553 5.83655C8.8445 6.05448 9.1555 6.05448 9.26447 5.83655L9.74442 4.87665C9.77303 4.81943 9.81943 4.77303 9.87665 4.74442L10.8365 4.26447C11.0545 4.1555 11.0545 3.8445 10.8365 3.73553L9.87665 3.25558C9.81943 3.22697 9.77303 3.18057 9.74442 3.12335L9.26447 2.16345Z"
        fill="currentColor"
      />
      <path
        d="M18.7551 15.1577C18.65 14.9474 18.35 14.9474 18.2449 15.1577L17.5917 16.4641C17.5641 16.5193 17.5193 16.5641 17.4641 16.5917L16.1577 17.2449C15.9474 17.35 15.9474 17.65 16.1577 17.7551L17.4641 18.4083C17.5193 18.4359 17.5641 18.4807 17.5917 18.5359L18.2449 19.8423C18.35 20.0526 18.65 20.0526 18.7551 19.8423L19.4083 18.5359C19.4359 18.4807 19.4807 18.4359 19.5359 18.4083L20.8423 17.7551C21.0526 17.65 21.0526 17.35 20.8423 17.2449L19.5359 16.5917C19.4807 16.5641 19.4359 16.5193 19.4083 16.4641L18.7551 15.1577Z"
        fill="currentColor"
      />
      <path
        d="M17.2071 4.2072L19.7929 6.79299C20.1834 7.18351 20.1834 7.81667 19.7929 8.2072L8.04289 19.9572C7.85536 20.1447 7.601 20.2501 7.33579 20.2501H3.75V16.6643C3.75 16.3991 3.85536 16.1447 4.04289 15.9572L15.7929 4.2072C16.1834 3.81668 16.8166 3.81668 17.2071 4.2072Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Shared h-7 control-pill style. */
const PILL =
  "flex h-7 items-center gap-1.5 rounded-lg bg-card px-2 py-1 text-xs font-medium text-white transition-all duration-200 ease-out hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#00e5ff]";

/** Batch size stepper (n/4 with +/- controls). */
function BatchStepper({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [nRaw, dRaw] = value.split("/");
  const n = Number(nRaw) || 1;
  const d = Number(dRaw) || 4;
  const set = (next: number) =>
    onChange(`${Math.max(1, Math.min(d, next))}/${d}`);
  return (
    <div className={`${PILL} gap-1`}>
      <button
        type="button"
        aria-label="Decrease batch"
        onClick={() => set(n - 1)}
        disabled={n <= 1}
        className="flex size-4 items-center justify-center rounded text-neutral-400 hover:text-white disabled:opacity-40"
      >
        <Minus className="size-3" />
      </button>
      <span aria-live="polite" className="w-8 text-center font-semibold tabular-nums text-white">
        {value}
      </span>
      <button
        type="button"
        aria-label="Increase batch"
        onClick={() => set(n + 1)}
        disabled={n >= d}
        className="flex size-4 items-center justify-center rounded text-neutral-400 hover:text-white disabled:opacity-40"
      >
        <Plus className="size-3" />
      </button>
    </div>
  );
}

/** Contenteditable prompt input with CSS placeholder. */
function PromptInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Keep DOM in sync only when the external value diverges (avoids caret jumps).
  useEffect(() => {
    if (ref.current && ref.current.textContent !== value) {
      ref.current.textContent = value;
    }
  }, [value]);

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Prompt"
      data-placeholder={placeholder}
      onInput={(e) => onChange(e.currentTarget.textContent ?? "")}
      className="max-h-[80px] min-h-[24px] overflow-y-auto px-1 text-sm leading-5 text-white focus:outline-none empty:before:pointer-events-none empty:before:text-neutral-500 empty:before:content-[attr(data-placeholder)]"
    />
  );
}

export default function PromptBar(props: PromptBarProps) {
  const [assetsPickerOpen, setAssetsPickerOpen] = useState(false);
  const [assetsPickerTab, setAssetsPickerTab] = useState<"uploads" | "elements">("uploads");
  const [shotControl, setShotControl] = useState<"smart" | "customMultishot">("smart");
  const [isCustomMultishotOpen, setIsCustomMultishotOpen] = useState(false);
  const [composerRect, setComposerRect] = useState<DOMRect | null>(null);
  const [activePromptPopover, setActivePromptPopover] = useState<
    | "shotControl"
    | "aspectRatio"
    | "resolution"
    | "duration"
    | "model"
    | "references"
    | "multiShot"
    | "mode"
    | null
  >(null);

  // Kling 3.0 (plain) — new prompt-control-row extras. aspectRatio/resolution/
  // duration reuse the existing shared top-level state (see effect below)
  // rather than duplicating them here.
  const [kling3Extras, setKling3Extras] = useState<{
    multiShot: string;
    startFrame: string | null;
    endFrame: string | null;
  }>({ multiShot: "custom", startFrame: null, endFrame: null });
  const [kling3ReferenceMode, setKling3ReferenceMode] = useState<
    "startFrame" | "endFrame" | null
  >(null);

  // Google Veo 3.1 Lite — Start/End Frame reference images + the "Turn sound
  // off?" confirmation. aspectRatio/resolution/duration/sound reuse the
  // shared top-level state (not isolated, unlike Kling 3.0 Turbo).
  const [veo31Frames, setVeo31Frames] = useState<{
    startFrame: string | null;
    endFrame: string | null;
  }>({ startFrame: null, endFrame: null });
  const [veo31FrameMode, setVeo31FrameMode] = useState<
    "startFrame" | "endFrame" | null
  >(null);
  const [soundConfirmOpen, setSoundConfirmOpen] = useState(false);

  // Minimax Hailuo family — Start/End Frame reference images. aspectRatio/
  // resolution/duration/sound reuse the shared top-level state (not isolated),
  // with a default-forcing effect below (mirrors the existing per-model pattern).
  const [minimaxFrames, setMinimaxFrames] = useState<{
    startFrame: string | null;
    endFrame: string | null;
  }>({ startFrame: null, endFrame: null });
  const [minimaxFrameMode, setMinimaxFrameMode] = useState<
    "startFrame" | "endFrame" | null
  >(null);

  // Kling 3.0 Omni Edit — Auto settings toggle + single Video Reference slot.
  // aspectRatio/resolution/duration reuse the shared top-level state.
  const [omniEditAutoSettings, setOmniEditAutoSettings] = useState(true);
  const [omniEditVideoReference, setOmniEditVideoReference] = useState<string | null>(null);

  // Kling 3.0 Omni (both Premium "kling-3.0-omni" and Exclusive "kling-3.0-mini"
  // variants) — Mode (Frames/Elements) + Start/End Frame, shown only in Frames mode.
  const [klingOmniMode, setKlingOmniMode] = useState<"frames" | "elements">("frames");
  const [klingOmniFrames, setKlingOmniFrames] = useState<{
    startFrame: string | null;
    endFrame: string | null;
  }>({ startFrame: null, endFrame: null });
  const [klingOmniFrameMode, setKlingOmniFrameMode] = useState<
    "startFrame" | "endFrame" | null
  >(null);

  // Kling 2.6 — Enhance toggle + Start Frame (General preset tile is visual-only for now).
  const [kling26Enhance, setKling26Enhance] = useState(true);
  const [kling26StartFrame, setKling26StartFrame] = useState<string | null>(null);

  // Kling O1 Video (both "kling-2.6-max" and "kling-01-video" ids) — Start/End Frame.
  const [klingO1Frames, setKlingO1Frames] = useState<{
    startFrame: string | null;
    endFrame: string | null;
  }>({ startFrame: null, endFrame: null });
  const [klingO1FrameMode, setKlingO1FrameMode] = useState<
    "startFrame" | "endFrame" | null
  >(null);

  // Kling 3.0 Motion Control state
  const [klingMotionControlSettings, setKlingMotionControlSettings] = useState({
    advancedPrompt: "",
    orientation: "video" as "video" | "image",
    sceneControl: "Off",
  });
  const [motionModalOpen, setMotionModalOpen] = useState(false);
  const [characterPanelOpen, setCharacterPanelOpen] = useState(false);
  const [klingAdvancedSettingsOpen, setKlingAdvancedSettingsOpen] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);

  const {
    prompt,
    onPromptChange,
    model,
    onModelChange,
    mode,
    aspectRatio,
    onAspectRatioChange,
    resolution,
    onResolutionChange,
    duration,
    durations,
    onDurationChange,
    batch,
    onBatchChange,
    sound,
    onSoundChange,
    creditCost,
    onGenerate,
    klingAdvancedPrompt,
    onKlingAdvancedPromptChange,
    kling3TurboSettings,
    onKling3TurboSettingsChange,
  } = props;

  const isVideo = mode === "video";
  const placeholder = isVideo
    ? "Describe your scene - use @ to add characters & locations"
    : "Describe your location";

  // Determine Cinema Studio version
  const isCinema35 = model === "cinema-3.5";
  const isCinema30 = model === "cinema-3.0";
  const isCinema25 = model === "cinema-2.5";

  // Seedance 2.0 family detection
  const isSeedance2Family =
    model === "seedance-2.0" ||
    model === "seedance-2.0-mini" ||
    model === "seedance-2.0-fast";

  // Gemini Omni Flash detection
  const isGeminiOmniFlash = model === "gemini-omni-flash";

  // Kling 3.0 Motion Control detection
  const isKling3MotionControl = model === "kling-3.0-motion-control";

  // Kling 3.0 (plain) detection
  const isKling3 = model === "kling-3.0";

  // Kling 3.0 Turbo detection
  const isKling3Turbo = model === "kling-3.0-turbo";

  // Google Veo 3.1 Lite detection
  const isVeo31Lite = model === "veo-3.1-lite";

  // Kling 3.0 Omni Edit detection
  const isKling3OmniEdit = model === "kling-3.0-omni-edit";

  // Kling 3.0 Omni detection (Premium "kling-3.0-omni" + Exclusive "kling-3.0-mini")
  const isKling3Omni = model === "kling-3.0-omni" || model === "kling-3.0-mini";

  // Kling 2.6 detection
  const isKling2_6 = model === "kling-2.6";

  // Kling O1 Video detection (two ids sharing the same composer)
  const isKlingO1Video = model === "kling-2.6-max" || model === "kling-01-video";

  // Minimax Hailuo family detection (2.3 Fast / 2.3 / 02 Fast / 02)
  const isMinimaxHailuo =
    model === "minimax-2.3-fast" ||
    model === "minimax-2.3" ||
    model === "minimax-02-fast" ||
    model === "minimax-02";

  // Set Gemini Omni Flash defaults
  useEffect(() => {
    if (isGeminiOmniFlash) {
      onAspectRatioChange("9:16");
      onResolutionChange("720p");
      onDurationChange(8);
      onBatchChange("1/4");
    }
  }, [isGeminiOmniFlash, onAspectRatioChange, onResolutionChange, onDurationChange, onBatchChange]);

  // Set Kling 3.0 Motion Control defaults
  useEffect(() => {
    if (isKling3MotionControl) {
      onResolutionChange("1080p");
      // Reset modals when model changes away from Kling
    }
  }, [isKling3MotionControl, onResolutionChange]);

  // Set Kling 3.0 (plain) defaults
  useEffect(() => {
    if (isKling3) {
      onAspectRatioChange("16:9");
      onResolutionChange("1080p");
      onDurationChange(9);
    }
  }, [isKling3, onAspectRatioChange, onResolutionChange, onDurationChange]);

  // Set Kling 3.0 Omni Edit defaults
  useEffect(() => {
    if (isKling3OmniEdit) {
      onAspectRatioChange("1:1");
      onResolutionChange("1080p");
      onDurationChange(4);
    }
  }, [isKling3OmniEdit, onAspectRatioChange, onResolutionChange, onDurationChange]);

  // Set Kling 3.0 Omni defaults
  useEffect(() => {
    if (isKling3Omni) {
      onAspectRatioChange("1:1");
      onResolutionChange("4K");
      onDurationChange(5);
    }
  }, [isKling3Omni, onAspectRatioChange, onResolutionChange, onDurationChange]);

  // Mode defaults to Frames for the Premium id ("kling-3.0-omni"), Elements
  // for the Exclusive id ("kling-3.0-mini") — adjusted during render (not in
  // an effect) each time the selected model changes, per the project's
  // established reset-on-model-change pattern.
  const [prevModelForOmniMode, setPrevModelForOmniMode] = useState(model);
  if (model !== prevModelForOmniMode) {
    setPrevModelForOmniMode(model);
    if (isKling3Omni) setKlingOmniMode(model === "kling-3.0-mini" ? "elements" : "frames");
  }

  // Set Kling 2.6 defaults
  useEffect(() => {
    if (isKling2_6) {
      onAspectRatioChange("16:9");
      onDurationChange(5);
    }
  }, [isKling2_6, onAspectRatioChange, onDurationChange]);

  // Set Kling O1 Video defaults
  useEffect(() => {
    if (isKlingO1Video) {
      onAspectRatioChange("1:1");
      onResolutionChange("1080p");
      onDurationChange(5);
    }
  }, [isKlingO1Video, onAspectRatioChange, onResolutionChange, onDurationChange]);

  // Set Minimax Hailuo defaults — Quality/Resolution follows the selected
  // submodel's catalog value (1080p vs 512p), Sound defaults Off.
  useEffect(() => {
    if (isMinimaxHailuo) {
      onResolutionChange(getModel(model).resolution);
      onSoundChange(false);
    }
  }, [isMinimaxHailuo, model, onResolutionChange, onSoundChange]);

  // Close Custom Multishot panel on outside click
  useEffect(() => {
    if (!isCustomMultishotOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsCustomMultishotOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isCustomMultishotOpen]);

  // Track composer position for portal rendering
  useEffect(() => {
    if (!isCustomMultishotOpen || !composerRef.current) return;

    const updateRect = () => {
      if (composerRef.current) {
        setComposerRect(composerRef.current.getBoundingClientRect());
      }
    };

    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect);
    };
  }, [isCustomMultishotOpen]);

  return (
    <>
      <div
        id="prompt-popover-root"
        ref={setPortalRoot}
        className="pointer-events-none fixed left-0 top-0 z-[100000]"
      />
      <div
        ref={composerRef}
        className="flex min-w-0 flex-1 items-stretch gap-1 rounded-[24px] bg-[#1a1d1f] p-3 opacity-100"
        style={{
          minHeight: 116,
          maxHeight: 400,
          boxShadow:
            "0 4px 6px rgba(0,0,0,0.16), 0 4px 16px rgba(0,0,0,0.08)",
        }}
      >
        {/* Prompt input + controls */}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
          {isKling3MotionControl ? (
            <KlingPromptDisabled />
          ) : (
            <PromptInput
              value={prompt}
              onChange={onPromptChange}
              placeholder={placeholder}
            />
          )}

          <div className="flex flex-wrap items-center gap-1">
            {/* Assets Picker Buttons - Cinema Studio 3.5, 3.0, and 2.5 */}
            {(isCinema35 || isCinema30 || isCinema25) && (
              <>
                <div className="flex items-center gap-0 rounded-lg bg-card">
                  <button
                    type="button"
                    onClick={() => {
                      setAssetsPickerTab("uploads");
                      setAssetsPickerOpen(true);
                    }}
                    aria-label="Add assets"
                    title="Add assets"
                    className="flex h-7 w-7 items-center justify-center rounded-none text-neutral-400 hover:bg-white/10 transition-colors"
                  >
                    <Plus className="size-4" />
                  </button>

                  <div className="h-4 w-px bg-white/20" />

                  <button
                    type="button"
                    onClick={() => {
                      setAssetsPickerTab("elements");
                      setAssetsPickerOpen(true);
                    }}
                    aria-label="My elements"
                    title="My elements"
                    className="flex h-7 min-h-7 min-w-7 w-7 shrink-0 items-center justify-center rounded-none bg-transparent p-0 text-font-primary shadow-none transition-colors hover:bg-neutral-primary-reverted-10 active:bg-neutral-primary-reverted-20"
                  >
                    <svg
                      className="size-4 text-icon-primary"
                      aria-hidden="true"
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M16.8684 19.8667C15.4543 20.7437 13.7863 21.25 12 21.25C6.89137 21.25 2.75 17.1086 2.75 12C2.75 6.89137 6.89137 2.75 12 2.75C17.1086 2.75 21.25 6.89137 21.25 12C21.25 13.9797 20.2662 16.0242 17.9715 15.8156C16.0837 15.644 14.7249 13.9258 14.993 12.0492L15.5226 8.40278M14.9375 12.4805C14.63 14.6681 12.8291 16.2235 10.9149 15.9544C9.00068 15.6854 7.69817 13.6939 8.00562 11.5063C8.31308 9.31862 10.1141 7.76327 12.0283 8.03229C13.9424 8.30131 15.245 10.2928 14.9375 12.4805Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
              </>
            )}

            {/* Shot Control Button - Cinema Studio 3.0 only */}
            {isCinema30 && (
              <Popover.Root
                open={activePromptPopover === "shotControl"}
                onOpenChange={(open) => {
                  if (open) setActivePromptPopover("shotControl");
                  else setActivePromptPopover(null);
                }}
              >
                <Popover.Trigger asChild>
                  <button
                    type="button"
                    aria-label="Shot Control"
                    className={PILL}
                  >
                    <ChevronDown className="size-3.5 text-neutral-400" />
                    {shotControl === "smart" ? "Smart" : "Custom Multishot"}
                    <ChevronDown className="size-3 text-neutral-500" />
                  </button>
                </Popover.Trigger>
                <Popover.Portal container={portalRoot}>
                  <Popover.Content
                    side="top"
                    align="start"
                    sideOffset={8}
                    className="outline-none z-[100000] rounded-2xl shadow-[0_4px_4px_rgba(0,0,0,0.12)] border border-[rgba(217,217,217,0.04)] bg-[rgba(35,38,42,0.75)] backdrop-blur data-[state=closed]:animate-fade-out data-[side=bottom]:data-[state=open]:animate-popover-in-down data-[side=top]:data-[state=open]:animate-popover-in-up data-[side=right]:data-[state=open]:animate-popover-in-right data-[side=left]:data-[state=open]:animate-popover-in-left flex flex-col gap-1 p-2 w-[210px] pointer-events-auto"
                  >
                    <span className="px-3 pt-1 pb-0.5 text-xs font-medium text-font-secondary">
                      Shot Control
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setShotControl("smart");
                        setIsCustomMultishotOpen(false);
                        setActivePromptPopover(null);
                      }}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl w-full cursor-pointer hover:bg-[#131517] transition-colors ${
                        shotControl === "smart" ? "bg-[#131517]" : ""
                      }`}
                    >
                      <span className="font-medium text-sm text-white">Smart</span>
                      {shotControl === "smart" && (
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 20 20"
                          className="size-5 text-[#00e5ff]"
                        >
                          <path
                            fillRule="evenodd"
                            clipRule="evenodd"
                            d="M14.7838 5.98556C15.0449 6.21134 15.0735 6.60602 14.8477 6.86712L8.72275 13.9505C8.60875 14.0823 8.44491 14.1605 8.27078 14.1663C8.09661 14.1721 7.92794 14.1049 7.80545 13.981L5.18045 11.3247C4.93782 11.0792 4.94016 10.6835 5.18568 10.4409C5.4312 10.1982 5.82691 10.2006 6.06955 10.4461L8.21939 12.6215L13.9022 6.04952C14.128 5.78842 14.5227 5.75979 14.7838 5.98556Z"
                            fill="currentColor"
                          />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShotControl("customMultishot");
                        setIsCustomMultishotOpen(true);
                        setActivePromptPopover(null);
                      }}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl w-full cursor-pointer hover:bg-[#131517] transition-colors ${
                        shotControl === "customMultishot" ? "bg-[#131517]" : ""
                      }`}
                    >
                      <span className="font-medium text-sm text-white">Custom Multishot</span>
                      {shotControl === "customMultishot" && (
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 20 20"
                          className="size-5 text-[#00e5ff]"
                        >
                          <path
                            fillRule="evenodd"
                            clipRule="evenodd"
                            d="M14.7838 5.98556C15.0449 6.21134 15.0735 6.60602 14.8477 6.86712L8.72275 13.9505C8.60875 14.0823 8.44491 14.1605 8.27078 14.1663C8.09661 14.1721 7.92794 14.1049 7.80545 13.981L5.18045 11.3247C4.93782 11.0792 4.94016 10.6835 5.18568 10.4409C5.4312 10.1982 5.82691 10.2006 6.06955 10.4461L8.21939 12.6215L13.9022 6.04952C14.128 5.78842 14.5227 5.75979 14.7838 5.98556Z"
                            fill="currentColor"
                          />
                        </svg>
                      )}
                    </button>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            )}

            {/* Seedance 2.0 Family Controls - Plus and Mention Buttons */}
            {isSeedance2Family && (
              <div className="flex items-center gap-0 rounded-lg bg-card">
                <button
                  type="button"
                  onClick={() => {
                    setAssetsPickerTab("uploads");
                    setAssetsPickerOpen(true);
                  }}
                  aria-label="Add assets"
                  title="Add assets"
                  className="flex h-7 w-7 items-center justify-center rounded-none text-neutral-400 hover:bg-white/10 transition-colors"
                >
                  <Plus className="size-4" />
                </button>

                <div className="h-4 w-px bg-white/20" />

                <button
                  type="button"
                  onClick={() => {
                    setAssetsPickerTab("elements");
                    setAssetsPickerOpen(true);
                  }}
                  aria-label="My elements"
                  title="My elements"
                  className="flex h-7 min-h-7 min-w-7 w-7 shrink-0 items-center justify-center rounded-none bg-transparent p-0 text-font-primary shadow-none transition-colors hover:bg-neutral-primary-reverted-10 active:bg-neutral-primary-reverted-20"
                >
                  <svg
                    className="size-4 text-icon-primary"
                    aria-hidden="true"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M16.8684 19.8667C15.4543 20.7437 13.7863 21.25 12 21.25C6.89137 21.25 2.75 17.1086 2.75 12C2.75 6.89137 6.89137 2.75 12 2.75C17.1086 2.75 21.25 6.89137 21.25 12C21.25 13.9797 20.2662 16.0242 17.9715 15.8156C16.0837 15.644 14.7249 13.9258 14.993 12.0492L15.5226 8.40278M14.9375 12.4805C14.63 14.6681 12.8291 16.2235 10.9149 15.9544C9.00068 15.6854 7.69817 13.6939 8.00562 11.5063C8.31308 9.31862 10.1141 7.76327 12.0283 8.03229C13.9424 8.30131 15.245 10.2928 14.9375 12.4805Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            )}

            {/* Gemini Omni Flash Controls - Plus Button Only */}
            {isGeminiOmniFlash && (
              <button
                type="button"
                onClick={() => {
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                aria-label="Add assets"
                title="Add assets"
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-card text-neutral-400 hover:bg-white/10 transition-colors"
              >
                <Plus className="size-4" />
              </button>
            )}

            {/* Kling 3.0 (plain) References Button - opens Start/End Frame choice, then Assets picker */}
            {isKling3 && (
              <ReferencesControl
                isOpen={activePromptPopover === "references"}
                onOpenChange={(open) => {
                  if (open) setActivePromptPopover("references");
                  else if (activePromptPopover === "references") setActivePromptPopover(null);
                }}
                onSelectReferenceMode={(refMode) => {
                  setKling3ReferenceMode(refMode);
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                portalContainer={portalRoot}
              />
            )}

            {/* Google Veo 3.1 Lite References Button - opens Start/End Frame choice, then Assets picker */}
            {isVeo31Lite && (
              <ReferencesControl
                isOpen={activePromptPopover === "references"}
                onOpenChange={(open) => {
                  if (open) setActivePromptPopover("references");
                  else if (activePromptPopover === "references") setActivePromptPopover(null);
                }}
                onSelectReferenceMode={(refMode) => {
                  setVeo31FrameMode(refMode);
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                portalContainer={portalRoot}
              />
            )}

            <ModelSelector value={model} onChange={onModelChange} mode={mode} portalContainer={portalRoot} />

            {/* Aspect Ratio - Hidden for Kling 3.0 Motion Control */}
            {!isKling3MotionControl && (
              isGeminiOmniFlash ? (
                <GeminiAspectRatioControl
                  value={aspectRatio}
                  onChange={onAspectRatioChange}
                  isOpen={activePromptPopover === "aspectRatio"}
                  portalContainer={portalRoot}
                  onOpenChange={(open) => {
                    if (open) setActivePromptPopover("aspectRatio");
                    else if (activePromptPopover === "aspectRatio") setActivePromptPopover(null);
                  }}
                />
              ) : isKling3Turbo ? (
                <Kling3AspectRatioControl
                  value={kling3TurboSettings.aspectRatio}
                  onChange={(value) =>
                    onKling3TurboSettingsChange((s) => ({ ...s, aspectRatio: value }))
                  }
                  isOpen={activePromptPopover === "aspectRatio"}
                  portalContainer={portalRoot}
                  onOpenChange={(open) => {
                    if (open) setActivePromptPopover("aspectRatio");
                    else if (activePromptPopover === "aspectRatio") setActivePromptPopover(null);
                  }}
                />
              ) : isKling3 || isKling3OmniEdit || isKling3Omni || isKling2_6 || isKlingO1Video ? (
                <Kling3AspectRatioControl
                  value={aspectRatio}
                  onChange={onAspectRatioChange}
                  isOpen={activePromptPopover === "aspectRatio"}
                  portalContainer={portalRoot}
                  onOpenChange={(open) => {
                    if (open) setActivePromptPopover("aspectRatio");
                    else if (activePromptPopover === "aspectRatio") setActivePromptPopover(null);
                  }}
                />
              ) : isVeo31Lite ? (
                <Veo31AspectRatioControl
                  value={aspectRatio}
                  onChange={onAspectRatioChange}
                  isOpen={activePromptPopover === "aspectRatio"}
                  portalContainer={portalRoot}
                  onOpenChange={(open) => {
                    if (open) setActivePromptPopover("aspectRatio");
                    else if (activePromptPopover === "aspectRatio") setActivePromptPopover(null);
                  }}
                />
              ) : (
                <AspectRatioDropdown
                  value={aspectRatio}
                  onChange={onAspectRatioChange}
                  isOpen={activePromptPopover === "aspectRatio"}
                  portalContainer={portalRoot}
                  onOpenChange={(open) => {
                    if (open) setActivePromptPopover("aspectRatio");
                    else if (activePromptPopover === "aspectRatio") setActivePromptPopover(null);
                  }}
                />
              )
            )}

            {/* Resolution - For all models except Gemini and Kling 2.6 (not in its chip row) */}
            {!isGeminiOmniFlash && !isKling2_6 && (
              <ResolutionPopover
                value={isKling3Turbo ? kling3TurboSettings.resolution : resolution}
                onChange={
                  isKling3Turbo
                    ? (value) => onKling3TurboSettingsChange((s) => ({ ...s, resolution: value }))
                    : onResolutionChange
                }
                isOpen={activePromptPopover === "resolution"}
                portalContainer={portalRoot}
                onOpenChange={(open) => {
                  if (open) setActivePromptPopover("resolution");
                  else if (activePromptPopover === "resolution") setActivePromptPopover(null);
                }}
                options={
                  isKling3 || isKling3Turbo
                    ? ["720p", "1080p", "4K"]
                    : isVeo31Lite
                      ? ["720p", "1080p"]
                      : isMinimaxHailuo
                        ? ["512p", "1080p"]
                        : isKling3OmniEdit || isKlingO1Video
                          ? ["1080p"]
                          : isKling3Omni
                            ? ["4K"]
                            : undefined
                }
              />
            )}

            {/* Start Frame - Kling 3.0 Turbo only, placed after Resolution per spec */}
            {isKling3Turbo && (
              <FrameCard
                label="Start Frame"
                value={kling3TurboSettings.startFrame}
                onOpenPicker={() => {
                  setActivePromptPopover(null);
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                onRemove={() =>
                  onKling3TurboSettingsChange((s) => ({ ...s, startFrame: null }))
                }
              />
            )}

            {/* Kling 3.0 Motion Control Specific Controls */}
            {isKling3MotionControl && (
              <>
                <KlingAdvancedSettingsPanel
                  isOpen={klingAdvancedSettingsOpen}
                  onOpenChange={setKlingAdvancedSettingsOpen}
                  advancedPrompt={klingAdvancedPrompt}
                  onPromptChange={onKlingAdvancedPromptChange}
                  orientation={klingMotionControlSettings.orientation}
                  onOrientationChange={(orientation) =>
                    setKlingMotionControlSettings((s) => ({ ...s, orientation }))
                  }
                  portalContainer={portalRoot}
                />

                <KlingSceneControl
                  value={klingMotionControlSettings.sceneControl}
                  onChange={(value) =>
                    setKlingMotionControlSettings((s) => ({ ...s, sceneControl: value }))
                  }
                  portalContainer={portalRoot}
                />

                <KlingMotionCard onClick={() => setMotionModalOpen(true)} />

                <KlingCharacterCard onClick={() => setCharacterPanelOpen(true)} />
              </>
            )}

            {/* Duration - Hidden for Kling 3.0 Motion Control and Kling 3.0 Turbo */}
            {isVideo && !isKling3MotionControl && !isKling3Turbo && (
              <DurationPopover
                value={duration}
                durations={durations}
                onChange={onDurationChange}
                portalContainer={portalRoot}
                isOpen={
                  isKling3 || isKling3OmniEdit || isKling3Omni || isKling2_6 || isKlingO1Video
                    ? activePromptPopover === "duration"
                    : undefined
                }
                onOpenChange={
                  isKling3 || isKling3OmniEdit || isKling3Omni || isKling2_6 || isKlingO1Video
                    ? (open) => {
                        if (open) setActivePromptPopover("duration");
                        else if (activePromptPopover === "duration") setActivePromptPopover(null);
                      }
                    : undefined
                }
              />
            )}

            {/* Multi-shot - Kling 3.0 (plain) only, placed after Duration per spec */}
            {isKling3 && (
              <Kling3MultiShotControl
                value={kling3Extras.multiShot}
                onChange={(value) => setKling3Extras((s) => ({ ...s, multiShot: value }))}
                isOpen={activePromptPopover === "multiShot"}
                onOpenChange={(open) => {
                  if (open) setActivePromptPopover("multiShot");
                  else if (activePromptPopover === "multiShot") setActivePromptPopover(null);
                }}
                portalContainer={portalRoot}
              />
            )}

            {/* Multi-shot (Off-only) - Kling 3.0 Omni, placed after Duration per spec */}
            {isKling3Omni && (
              <Kling3MultiShotControl
                value="off"
                onChange={() => {}}
                options={[{ value: "off", label: "Off" }]}
                isOpen={activePromptPopover === "multiShot"}
                onOpenChange={(open) => {
                  if (open) setActivePromptPopover("multiShot");
                  else if (activePromptPopover === "multiShot") setActivePromptPopover(null);
                }}
                portalContainer={portalRoot}
              />
            )}

            {/* Mode chip - Kling 3.0 Omni (Frames/Elements) */}
            {isKling3Omni && (
              <KlingModeControl
                value={klingOmniMode}
                onChange={(value) => setKlingOmniMode(value as "frames" | "elements")}
                options={[
                  { value: "frames", label: "Frames" },
                  { value: "elements", label: "Elements" },
                ]}
                isOpen={activePromptPopover === "mode"}
                onOpenChange={(open) => {
                  if (open) setActivePromptPopover("mode");
                  else if (activePromptPopover === "mode") setActivePromptPopover(null);
                }}
                portalContainer={portalRoot}
              />
            )}

            {/* Mode chip - Kling O1 Video (Frames only — no other mode confirmed) */}
            {isKlingO1Video && (
              <KlingModeControl
                value="frames"
                onChange={() => {}}
                options={[{ value: "frames", label: "Frames" }]}
                isOpen={activePromptPopover === "mode"}
                onOpenChange={(open) => {
                  if (open) setActivePromptPopover("mode");
                  else if (activePromptPopover === "mode") setActivePromptPopover(null);
                }}
                portalContainer={portalRoot}
              />
            )}

            {/* Enhance chip - Kling 2.6 only */}
            {isKling2_6 && (
              <button
                type="button"
                onClick={() => setKling26Enhance((v) => !v)}
                aria-label="Toggle enhance"
                aria-pressed={kling26Enhance}
                className={`${PILL} ${kling26Enhance ? "text-[#00e5ff]" : "text-neutral-400"}`}
              >
                <EnhanceIcon />
                {kling26Enhance ? "On" : "Off"}
              </button>
            )}

            {/* Auto settings toggle - Kling 3.0 Omni Edit only, placed after Duration per spec */}
            {isKling3OmniEdit && (
              <div className="flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg bg-white/[0.04] px-2 py-1">
                <span className="whitespace-nowrap px-1 text-xs font-semibold text-white">
                  Auto settings
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={omniEditAutoSettings}
                  aria-label="Auto settings"
                  onClick={() => setOmniEditAutoSettings((v) => !v)}
                  className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full outline-none ring-0 transition focus-visible:ring-2 focus-visible:ring-[#00e5ff] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ${
                    omniEditAutoSettings ? "bg-emerald-500" : "bg-white/20"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`pointer-events-none absolute left-0.5 top-1/2 size-3 -translate-y-1/2 transform rounded-full bg-white shadow-lg transition-transform duration-300 ease-in-out ${
                      omniEditAutoSettings ? "translate-x-3" : ""
                    }`}
                  />
                </button>
              </div>
            )}

            {/* Video Reference tile - Kling 3.0 Omni Edit only, placed after Auto settings */}
            {isKling3OmniEdit && (
              <FrameCard
                variant="reference"
                label="Video Reference"
                value={omniEditVideoReference}
                onOpenPicker={() => {
                  setActivePromptPopover(null);
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                onRemove={() => setOmniEditVideoReference(null)}
              />
            )}

            {/* Start/End Frame - Kling 3.0 Omni, Frames mode only (hidden in Elements mode) */}
            {isKling3Omni && klingOmniMode === "frames" && (
              <>
                <FrameCard
                  label="Start Frame"
                  value={klingOmniFrames.startFrame}
                  onOpenPicker={() => {
                    setActivePromptPopover(null);
                    setKlingOmniFrameMode("startFrame");
                    setAssetsPickerTab("uploads");
                    setAssetsPickerOpen(true);
                  }}
                  onRemove={() => setKlingOmniFrames((s) => ({ ...s, startFrame: null }))}
                />
                <FrameCard
                  label="End Frame"
                  value={klingOmniFrames.endFrame}
                  onOpenPicker={() => {
                    setActivePromptPopover(null);
                    setKlingOmniFrameMode("endFrame");
                    setAssetsPickerTab("uploads");
                    setAssetsPickerOpen(true);
                  }}
                  onRemove={() => setKlingOmniFrames((s) => ({ ...s, endFrame: null }))}
                />
              </>
            )}

            {/* Start Frame + General preset tile - Kling 2.6 */}
            {isKling2_6 && (
              <>
                <FrameCard
                  label="Start Frame"
                  value={kling26StartFrame}
                  onOpenPicker={() => {
                    setActivePromptPopover(null);
                    setAssetsPickerTab("uploads");
                    setAssetsPickerOpen(true);
                  }}
                  onRemove={() => setKling26StartFrame(null)}
                />
                <FrameCard
                  variant="general"
                  label="General"
                  value={null}
                  onOpenPicker={() => {}}
                />
              </>
            )}

            {/* Start/End Frame - Kling O1 Video */}
            {isKlingO1Video && (
              <>
                <FrameCard
                  label="Start Frame"
                  value={klingO1Frames.startFrame}
                  onOpenPicker={() => {
                    setActivePromptPopover(null);
                    setKlingO1FrameMode("startFrame");
                    setAssetsPickerTab("uploads");
                    setAssetsPickerOpen(true);
                  }}
                  onRemove={() => setKlingO1Frames((s) => ({ ...s, startFrame: null }))}
                />
                <FrameCard
                  label="End Frame"
                  value={klingO1Frames.endFrame}
                  onOpenPicker={() => {
                    setActivePromptPopover(null);
                    setKlingO1FrameMode("endFrame");
                    setAssetsPickerTab("uploads");
                    setAssetsPickerOpen(true);
                  }}
                  onRemove={() => setKlingO1Frames((s) => ({ ...s, endFrame: null }))}
                />
              </>
            )}

            {/* Batch - Hidden for Kling 3.0 Motion Control, Kling 3.0 (plain), Kling 3.0 Turbo, Google Veo 3.1 Lite, Kling 3.0 Omni Edit, Kling 3.0 Omni, Kling 2.6, and Kling O1 Video */}
            {!isKling3MotionControl &&
              !isKling3 &&
              !isKling3Turbo &&
              !isVeo31Lite &&
              !isKling3OmniEdit &&
              !isKling3Omni &&
              !isKling2_6 &&
              !isKlingO1Video && <BatchStepper value={batch} onChange={onBatchChange} />}

            {isVideo &&
              !isGeminiOmniFlash &&
              !isKling3MotionControl &&
              !isKling3 &&
              !isKling3Turbo &&
              !isKling3OmniEdit &&
              !isKlingO1Video && (
              <button
                type="button"
                onClick={() => {
                  // Google Veo 3.1 Lite confirms before turning sound Off; every
                  // other model (and Off -> On for Veo) toggles directly.
                  if (isVeo31Lite && sound) {
                    setSoundConfirmOpen(true);
                  } else {
                    onSoundChange(!sound);
                  }
                }}
                aria-label="Toggle sound"
                aria-pressed={sound}
                className={`${PILL} ${
                  sound ? "text-[#00e5ff]" : "text-neutral-400"
                }`}
              >
                {sound ? (
                  <Volume2 className="size-3.5" />
                ) : (
                  <VolumeX className="size-3.5" />
                )}
                {sound ? "On" : "Off"}
              </button>
            )}

            {/* Start/End Frame - Google Veo 3.1 Lite only, placed after Sound */}
            {isVeo31Lite && (
              <>
                <FrameCard
                  label="Start Frame"
                  value={veo31Frames.startFrame}
                  onOpenPicker={() => {
                    setActivePromptPopover(null);
                    setVeo31FrameMode("startFrame");
                    setAssetsPickerTab("uploads");
                    setAssetsPickerOpen(true);
                  }}
                  onRemove={() => setVeo31Frames((s) => ({ ...s, startFrame: null }))}
                />
                <FrameCard
                  label="End Frame"
                  value={veo31Frames.endFrame}
                  onOpenPicker={() => {
                    setActivePromptPopover(null);
                    setVeo31FrameMode("endFrame");
                    setAssetsPickerTab("uploads");
                    setAssetsPickerOpen(true);
                  }}
                  onRemove={() => setVeo31Frames((s) => ({ ...s, endFrame: null }))}
                />
              </>
            )}

            {/* Start/End Frame - Minimax Hailuo family only, placed after Sound */}
            {isMinimaxHailuo && (
              <>
                <FrameCard
                  label="Start Frame"
                  value={minimaxFrames.startFrame}
                  onOpenPicker={() => {
                    setActivePromptPopover(null);
                    setMinimaxFrameMode("startFrame");
                    setAssetsPickerTab("uploads");
                    setAssetsPickerOpen(true);
                  }}
                  onRemove={() => setMinimaxFrames((s) => ({ ...s, startFrame: null }))}
                />
                <FrameCard
                  label="End Frame"
                  value={minimaxFrames.endFrame}
                  onOpenPicker={() => {
                    setActivePromptPopover(null);
                    setMinimaxFrameMode("endFrame");
                    setAssetsPickerTab("uploads");
                    setAssetsPickerOpen(true);
                  }}
                  onRemove={() => setMinimaxFrames((s) => ({ ...s, endFrame: null }))}
                />
              </>
            )}
          </div>
        </div>

        {/* C — Generate */}
        <GenerateButton creditCost={creditCost} onGenerate={onGenerate} mode={mode} />
      </div>

      <AssetsPickerModal
        isOpen={assetsPickerOpen}
        onClose={() => {
          setAssetsPickerOpen(false);
          // Clear only the transient "which frame are we picking" marker —
          // an already-assigned Start/End Frame in kling3Extras/veo31Frames is untouched.
          setKling3ReferenceMode(null);
          setVeo31FrameMode(null);
          setMinimaxFrameMode(null);
          setKlingOmniFrameMode(null);
          setKlingO1FrameMode(null);
        }}
        defaultTab={assetsPickerTab}
        mode={
          isKling3 && kling3ReferenceMode
            ? kling3ReferenceMode
            : isKling3Turbo
              ? "startFrame"
              : isVeo31Lite && veo31FrameMode
                ? veo31FrameMode
                : isMinimaxHailuo && minimaxFrameMode
                  ? minimaxFrameMode
                  : isKling3OmniEdit
                    ? "videoReference"
                    : isKling3Omni && klingOmniFrameMode
                      ? klingOmniFrameMode
                      : isKling2_6
                        ? "startFrame"
                        : isKlingO1Video && klingO1FrameMode
                          ? klingO1FrameMode
                          : "default"
        }
        accept={
          isKling3Turbo || isVeo31Lite || isMinimaxHailuo
            ? "image/*"
            : isKling3OmniEdit
              ? "video/*"
              : undefined
        }
        onSelectAsset={
          isKling3 && kling3ReferenceMode
            ? (url) => {
                setKling3Extras((s) =>
                  kling3ReferenceMode === "startFrame"
                    ? { ...s, startFrame: url }
                    : { ...s, endFrame: url },
                );
              }
            : isKling3Turbo
              ? (url) => onKling3TurboSettingsChange((s) => ({ ...s, startFrame: url }))
              : isVeo31Lite && veo31FrameMode
                ? (url) =>
                    setVeo31Frames((s) =>
                      veo31FrameMode === "startFrame"
                        ? { ...s, startFrame: url }
                        : { ...s, endFrame: url },
                    )
                : isMinimaxHailuo && minimaxFrameMode
                  ? (url) =>
                      setMinimaxFrames((s) =>
                        minimaxFrameMode === "startFrame"
                          ? { ...s, startFrame: url }
                          : { ...s, endFrame: url },
                      )
                  : isKling3OmniEdit
                    ? (url) => setOmniEditVideoReference(url)
                    : isKling3Omni && klingOmniFrameMode
                      ? (url) =>
                          setKlingOmniFrames((s) =>
                            klingOmniFrameMode === "startFrame"
                              ? { ...s, startFrame: url }
                              : { ...s, endFrame: url },
                          )
                      : isKling2_6
                        ? (url) => setKling26StartFrame(url)
                        : isKlingO1Video && klingO1FrameMode
                          ? (url) =>
                              setKlingO1Frames((s) =>
                                klingO1FrameMode === "startFrame"
                                  ? { ...s, startFrame: url }
                                  : { ...s, endFrame: url },
                              )
                          : undefined
        }
      />

      {/* "Turn sound off?" confirm — Google Veo 3.1 Lite only */}
      {isVeo31Lite && (
        <SoundOffConfirmDialog
          isOpen={soundConfirmOpen}
          onCancel={() => setSoundConfirmOpen(false)}
          onConfirm={() => {
            onSoundChange(false);
            setSoundConfirmOpen(false);
          }}
        />
      )}

      {/* Kling 3.0 Motion Control Modals and Panels */}
      {isKling3MotionControl && (
        <>
          <KlingMotionModal isOpen={motionModalOpen} onClose={() => setMotionModalOpen(false)} />
          <KlingCharacterPanel isOpen={characterPanelOpen} onClose={() => setCharacterPanelOpen(false)} />
        </>
      )}

      {/* Custom Multishot Scene Strip - Cinema Studio 3.0 only - Rendered via Portal */}
      {isCinema30 && isCustomMultishotOpen && shotControl === "customMultishot" && composerRect &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[999999]"
            style={{
              filter: "drop-shadow(rgba(0, 0, 0, 0.4) 0px 8px 24px)",
              left: composerRect.left + 76,
              top: composerRect.top - 120,
              width: composerRect.width - 76,
              pointerEvents: "auto",
            }}
          >
          <div className="relative w-full">
            <div
              className="flex items-center gap-1 h-full w-[calc(100%-68px)]"
              style={{ overflowAnchor: "none" }}
            >
              {/* Scene 1 */}
              <div
                className="touch-none shrink-0"
                style={{ width: "33.3333%", zIndex: "unset", transform: "none" }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  className="group relative flex items-center h-[100px] rounded-[20px] select-none cursor-pointer transition-all duration-200 border border-transparent"
                  style={{
                    backgroundColor: "rgb(7, 31, 45)",
                    boxShadow: "rgba(0, 0, 0, 0.25) 0px 4px 4px 0px",
                  }}
                >
                  <div className="group/trim flex items-center h-full pl-1.5 pr-0.5 py-3 rounded-l-xl cursor-col-resize shrink-0">
                    <div className="w-1 h-6 rounded-full bg-white/[0.06] group-hover/trim:bg-white/20 transition-colors" />
                  </div>
                  <div className="flex-1 h-full min-w-0 p-1 pl-0">
                    <div className="relative flex flex-col justify-between h-full bg-white/[0.04] rounded-xl p-1.5">
                      <div className="flex items-start justify-between w-full">
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span
                            className="text-xxs font-semibold leading-3.5 truncate"
                            style={{ color: "rgb(28, 165, 226)" }}
                          >
                            Scene 1
                          </span>
                          <span className="text-md font-semibold truncate leading-6" style={{ color: "white" }}>
                            Auto
                          </span>
                        </div>
                      </div>
                      <div>
                        <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{ height: "36px" }}>
                          <svg
                            viewBox="0 0 100 36"
                            className="absolute inset-0 w-full h-full"
                            preserveAspectRatio="none"
                          >
                            <path
                              className="scene-1-fill"
                              d="M 0 25.505711384209455 C 3.75 23.814127998860297, 17.5 16.48020223047796, 25 14.228488815215055 C 32.5 11.97677539995215, 42.5 9.362835260354736, 50 10.49428861579008 C 57.5 11.625741971225423, 67.5 19.519797769521222, 75 21.77151118478401 C 82.5 24.0232246000468, 96.25 24.945581354294976, 100 25.505711384208677 L 100 36 L 0 36 Z"
                              fill="#1ca5e21A"
                              stroke="none"
                            />
                            <path
                              className="scene-1-stroke"
                              d="M 0 25.505711384209455 C 3.75 23.814127998860297, 17.5 16.48020223047796, 25 14.228488815215055 C 32.5 11.97677539995215, 42.5 9.362835260354736, 50 10.49428861579008 C 57.5 11.625741971225423, 67.5 19.519797769521222, 75 21.77151118478401 C 82.5 24.0232246000468, 96.25 24.945581354294976, 100 25.505711384208677"
                              fill="none"
                              stroke="#1ca5e2"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              vectorEffect="non-scaling-stroke"
                            />
                          </svg>
                        </div>
                      </div>
                      <div
                        className="flex items-center justify-center px-1 py-0.5 rounded-md shrink-0 w-fit z-10"
                        style={{ border: "1px solid rgba(28, 165, 226, 0.2)" }}
                      >
                        <span className="text-xxs font-semibold leading-3.5" style={{ color: "rgb(28, 165, 226)" }}>
                          4s
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="group/trim flex items-center h-full pl-0.5 pr-1.5 py-3 rounded-r-xl cursor-col-resize shrink-0 opacity-80">
                    <div className="w-1 h-6 rounded-full bg-white/[0.06] group-hover/trim:bg-white/20 transition-colors" />
                  </div>
                </div>
              </div>

              {/* Scene 2 */}
              <div
                className="touch-none shrink-0"
                style={{ width: "25%", zIndex: "unset", transform: "none" }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  className="group relative flex items-center h-[100px] rounded-[20px] select-none cursor-pointer transition-all duration-200 border border-transparent"
                  style={{
                    backgroundColor: "rgb(19, 2, 30)",
                    boxShadow: "rgba(0, 0, 0, 0.25) 0px 4px 4px 0px",
                  }}
                >
                  <div className="group/trim flex items-center h-full pl-1.5 pr-0.5 py-3 rounded-l-xl cursor-col-resize shrink-0">
                    <div className="w-1 h-6 rounded-full bg-white/[0.06] group-hover/trim:bg-white/20 transition-colors" />
                  </div>
                  <div className="flex-1 h-full min-w-0 p-1 pl-0">
                    <div className="relative flex flex-col justify-between h-full bg-white/[0.04] rounded-xl p-1.5">
                      <div className="flex items-start justify-between w-full">
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span
                            className="text-xxs font-semibold leading-3.5 truncate"
                            style={{ color: "rgb(168, 85, 247)" }}
                          >
                            Scene 2
                          </span>
                          <span className="text-md font-semibold truncate leading-6" style={{ color: "white" }}>
                            Auto
                          </span>
                        </div>
                      </div>
                      <div>
                        <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{ height: "36px" }}>
                          <svg
                            viewBox="0 0 100 36"
                            className="absolute inset-0 w-full h-full"
                            preserveAspectRatio="none"
                          >
                            <path
                              className="scene-2-fill"
                              d="M 0 25.505711384209455 C 3.75 23.814127998860297, 17.5 16.48020223047796, 25 14.228488815215055 C 32.5 11.97677539995215, 42.5 9.362835260354736, 50 10.49428861579008 C 57.5 11.625741971225423, 67.5 19.519797769521222, 75 21.77151118478401 C 82.5 24.0232246000468, 96.25 24.945581354294976, 100 25.505711384208677 L 100 36 L 0 36 Z"
                              fill="#a855f71A"
                              stroke="none"
                            />
                            <path
                              className="scene-2-stroke"
                              d="M 0 25.505711384209455 C 3.75 23.814127998860297, 17.5 16.48020223047796, 25 14.228488815215055 C 32.5 11.97677539995215, 42.5 9.362835260354736, 50 10.49428861579008 C 57.5 11.625741971225423, 67.5 19.519797769521222, 75 21.77151118478401 C 82.5 24.0232246000468, 96.25 24.945581354294976, 100 25.505711384208677"
                              fill="none"
                              stroke="#a855f7"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              vectorEffect="non-scaling-stroke"
                            />
                          </svg>
                        </div>
                      </div>
                      <div
                        className="flex items-center justify-center px-1 py-0.5 rounded-md shrink-0 w-fit z-10"
                        style={{ border: "1px solid rgba(168, 85, 247, 0.2)" }}
                      >
                        <span className="text-xxs font-semibold leading-3.5" style={{ color: "rgb(168, 85, 247)" }}>
                          3s
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="group/trim flex items-center h-full pl-0.5 pr-1.5 py-3 rounded-r-xl cursor-col-resize shrink-0 opacity-80">
                    <div className="w-1 h-6 rounded-full bg-white/[0.06] group-hover/trim:bg-white/20 transition-colors" />
                  </div>
                </div>
              </div>

              {/* Add Scene Button */}
              <button
                type="button"
                className="w-12 h-[98px] flex items-center justify-center shrink-0 rounded-2xl border border-separator-card"
                style={{
                  background: "linear-gradient(162deg, rgba(36, 43, 50, 0.12) 27.93%, rgba(219, 219, 219, 0.12) 106.42%), rgb(15, 17, 19)",
                }}
              >
                <svg
                  className="size-4 text-font-secondary"
                  aria-hidden="true"
                  width="24px"
                  height="24px"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M12 3.75V12M12 12V20.25M12 12H3.75M12 12H20.25"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
          <style>{`
            @keyframes waveShift1 {
              0%, 100% {
                d: path('M 0 25.505711384209455 C 3.75 23.814127998860297, 17.5 16.48020223047796, 25 14.228488815215055 C 32.5 11.97677539995215, 42.5 9.362835260354736, 50 10.49428861579008 C 57.5 11.625741971225423, 67.5 19.519797769521222, 75 21.77151118478401 C 82.5 24.0232246000468, 96.25 24.945581354294976, 100 25.505711384208677 L 100 36 L 0 36 Z');
              }
              50% {
                d: path('M 0 23.505711384209455 C 3.75 21.814127998860297, 17.5 14.48020223047796, 25 12.228488815215055 C 32.5 9.97677539995215, 42.5 8.362835260354736, 50 12.49428861579008 C 57.5 13.625741971225423, 67.5 21.519797769521222, 75 23.77151118478401 C 82.5 26.0232246000468, 96.25 26.945581354294976, 100 27.505711384208677 L 100 36 L 0 36 Z');
              }
            }
            @keyframes waveShift2 {
              0%, 100% {
                d: path('M 0 25.505711384209455 C 3.75 23.814127998860297, 17.5 16.48020223047796, 25 14.228488815215055 C 32.5 11.97677539995215, 42.5 9.362835260354736, 50 10.49428861579008 C 57.5 11.625741971225423, 67.5 19.519797769521222, 75 21.77151118478401 C 82.5 24.0232246000468, 96.25 24.945581354294976, 100 25.505711384208677 L 100 36 L 0 36 Z');
              }
              50% {
                d: path('M 0 27.505711384209455 C 3.75 25.814127998860297, 17.5 18.48020223047796, 25 16.228488815215055 C 32.5 13.97677539995215, 42.5 11.362835260354736, 50 8.49428861579008 C 57.5 9.625741971225423, 67.5 17.519797769521222, 75 19.77151118478401 C 82.5 22.0232246000468, 96.25 22.945581354294976, 100 23.505711384208677 L 100 36 L 0 36 Z');
              }
            }
            @media (prefers-reduced-motion: reduce) {
              .scene-1-fill, .scene-1-stroke, .scene-2-fill, .scene-2-stroke {
                animation: none !important;
              }
            }
            .scene-1-fill {
              animation: waveShift1 5s ease-in-out infinite;
            }
            .scene-1-stroke {
              animation: waveShift1 5s ease-in-out infinite;
            }
            .scene-2-fill {
              animation: waveShift2 5.5s ease-in-out infinite 0.3s;
            }
            .scene-2-stroke {
              animation: waveShift2 5.5s ease-in-out infinite 0.3s;
            }
          `}</style>
        </div>,
        document.body
      )}
    </>
  );
}
