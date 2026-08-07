"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import * as Popover from "@radix-ui/react-popover";
import {
  AtSign,
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
import Cinema25ReferencesPopover from "./Cinema25ReferencesPopover";
import Cinema25AssetsPicker, { type Cinema25PickerContext } from "./Cinema25AssetsPicker";
import Kling3MultiShotControl from "./Kling3MultiShotControl";
import KlingModeControl from "./KlingModeControl";
import Veo31AspectRatioControl from "./Veo31AspectRatioControl";
import FrameCard from "./FrameCard";
import { usePromptSurfaceResize } from "@/hooks/usePromptSurfaceResize";
import PromptResizeHandles from "@/components/shared/PromptResizeHandles";
import SoundOffConfirmDialog from "./SoundOffConfirmDialog";
import ResolutionPopover from "./ResolutionPopover";
import DurationPopover from "./DurationPopover";
import AssetsPickerModal from "./AssetsPickerModal";
import KlingAdvancedSettingsPanel from "./KlingAdvancedSettingsPanel";
import KlingMotionModal from "./KlingMotionModal";
import KlingCharacterPanel from "./KlingCharacterPanel";
import KlingSceneControl from "./KlingSceneControl";
import KlingMotionCard from "./KlingMotionCard";
import KlingCharacterCard from "./KlingCharacterCard";
import MotionPresetsPanel from "./MotionPresetsPanel";
import BitrateControl from "./BitrateControl";
import SeedControl from "./SeedControl";
import { PROMPT_BAR_SURFACE } from "@/lib/promptBarChassis";

const DEFAULT_GENERATE_PROMPT_WIDTH = 880;
const MAX_GENERATE_PROMPT_WIDTH = 1240;
const DEFAULT_GENERATE_PROMPT_HEIGHT = 128;
const MAX_GENERATE_PROMPT_HEIGHT = 360;
const GENERATE_VIEWPORT_GUTTER = 16;

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
  isGenerating?: boolean;

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

  // Cinema Studio 2.5 — 3 reference slots (0=Reference, 1=Start Frame, 2=End
  // Frame) shared between the composer's "+" button, the bottom-row Start/End
  // Frame cards, and the Director Panel (state lives in the workspace, which
  // renders the panel as a sibling of PromptBar).
  cinema25References: (string | null)[];
  onCinema25AssignReference: (slotIndex: number, url: string | null) => void;
  cinema25ReferencesPopoverOpen: boolean;
  onCinema25ReferencesPopoverOpenChange: (open: boolean) => void;

  // Nano Banana 2 Lite — "Thinking" control value. Lifted to the workspace
  // so its current selection can be captured into generation metadata.
  nanoBanana2LiteThinking: "High" | "Minimal";
  onNanoBanana2LiteThinkingChange: (value: "High" | "Minimal") => void;
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

/**
 * Generic "+" (add assets) and "@" (mention) input-action button pair, per live reference.
 * The "@" button is inert unless a caller passes onMentionClick (only Kling O1 Video's
 * Elements mode currently does — see its isolated handleKlingO1ReferenceElementClick).
 */
function PlusAtButtons({
  onOpenPicker,
  onMentionClick,
  mentionOpen = false,
  mentionClassName,
  mentionAriaLabel = "Mention",
}: {
  onOpenPicker: () => void;
  onMentionClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  mentionOpen?: boolean;
  mentionClassName?: string;
  mentionAriaLabel?: string;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onOpenPicker}
        aria-label="Add assets"
        title="Add assets"
        className="flex h-7 w-7 items-center justify-center rounded-lg bg-[rgba(4,4,5,0.98)] text-neutral-400 hover:bg-[rgba(16,16,17,0.98)] transition-colors"
      >
        <Plus className="size-4" />
      </button>
      <button
        type="button"
        onClick={onMentionClick}
        aria-label={mentionAriaLabel}
        title={mentionAriaLabel}
        aria-haspopup={onMentionClick ? "dialog" : undefined}
        aria-expanded={onMentionClick ? mentionOpen : undefined}
        className={`flex h-7 w-7 items-center justify-center rounded-lg bg-[rgba(4,4,5,0.98)] text-neutral-400 hover:bg-[rgba(16,16,17,0.98)] transition-colors${
          mentionClassName ? ` ${mentionClassName}` : ""
        }`}
      >
        <AtSign className="size-4" />
      </button>
    </>
  );
}

/**
 * Label + Radix-style switch toggle. Shared by Kling 3.0 Omni Edit / Kling O1
 * Video Edit's "Auto settings" (default label, click-target unchanged) and
 * Seedance 1.5 Pro's "Fixed Lens" (custom label, whole-row clickable).
 */
function AutoSettingsToggle({
  checked,
  onToggle,
  label = "Auto settings",
  wholeRowClickable = false,
}: {
  checked: boolean;
  onToggle: () => void;
  label?: string;
  wholeRowClickable?: boolean;
}) {
  return (
    <div
      className="flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg bg-[rgba(4,4,5,0.98)] px-2 py-1"
      onClick={wholeRowClickable ? onToggle : undefined}
    >
      <span className="whitespace-nowrap px-1 text-xs font-semibold text-white">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        data-state={checked ? "on" : "off"}
        aria-label={label}
        onClick={(e) => {
          if (wholeRowClickable) e.stopPropagation();
          onToggle();
        }}
        className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full outline-none ring-0 transition focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ${
          checked ? "bg-emerald-500" : "bg-white/20"
        }`}
      >
        <span
          aria-hidden
          className={`pointer-events-none absolute left-0.5 top-1/2 size-3 -translate-y-1/2 transform rounded-full bg-white shadow-lg transition-transform duration-300 ease-in-out ${
            checked ? "translate-x-3" : ""
          }`}
        />
      </button>
    </div>
  );
}

/** Shared h-8 control-pill style with solid black background and thin orange border. */
const PILL =
  "flex h-8 items-center gap-1.5 rounded-lg border border-[rgba(217,119,87,0.45)] bg-[rgba(4,4,5,0.98)] px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out hover:border-[#D97757] hover:bg-[rgba(16,16,17,0.98)] focus:outline-none";

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
      className="min-h-[24px] flex-1 overflow-y-auto px-1 text-sm leading-5 text-white focus:outline-none empty:before:pointer-events-none empty:before:text-neutral-500 empty:before:content-[attr(data-placeholder)]"
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
    | "bitrate"
    | "thinking"
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

  // Minimax Hailuo 2.3 Fast + Minimax Hailuo 02 + Minimax Hailuo 2.3 — "+"
  // References popover (reuses the existing minimaxFrames/minimaxFrameMode
  // state above) and an Enhance toggle (replaces Sound for these models).
  // Isolated per exact model id so switching between them never leaks a state.
  const [minimaxReferencesOpen, setMinimaxReferencesOpen] = useState(false);
  const [minimaxEnhance, setMinimaxEnhance] = useState<
    Record<"minimax-2.3-fast" | "minimax-02" | "minimax-2.3", boolean>
  >({ "minimax-2.3-fast": true, "minimax-02": true, "minimax-2.3": true });

  // Cinema Studio 2.5 — Reference asset picker mode
  const [cinema25ReferenceMode, setCinema25ReferenceMode] = useState<
    "startFrame" | "endFrame" | "reference" | null
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
  const [klingOmniReferencesOpen, setKlingOmniReferencesOpen] = useState(false);
  // Multi-shot only shown/interactive in Elements mode (per live click-audit).
  const [klingOmniMultiShot, setKlingOmniMultiShot] = useState("off");

  // Kling O1 Video — Mode (Frames/Elements), interactive (per live click-audit).
  const [klingO1Mode, setKlingO1Mode] = useState<"frames" | "elements">("frames");
  const [klingO1ReferencesOpen, setKlingO1ReferencesOpen] = useState(false);
  // Kling O1 Video's "@" reference-element button — isolated open-state, does not
  // reuse the Start/End Frame click path. Opens the shared Assets Picker on its
  // Elements tab; toggles closed on a second click of the same button.
  const [klingO1ReferenceElementOpen, setKlingO1ReferenceElementOpen] = useState(false);

  // Kling O1 Video Edit — Auto settings toggle + single Video Reference slot.
  const [o1VideoEditAutoSettings, setO1VideoEditAutoSettings] = useState(true);
  const [o1VideoEditVideoReference, setO1VideoEditVideoReference] = useState<string | null>(null);

  // Kling Motion Control (non-3.0) — isolated from the LOCKED Kling 3.0 Motion
  // Control's state entirely; reuses the same generic sub-components.
  const [klingMcSettings, setKlingMcSettings] = useState({
    advancedPrompt: "",
    orientation: "video" as "video" | "image",
    sceneControl: "Image",
  });
  const [klingMcMotionModalOpen, setKlingMcMotionModalOpen] = useState(false);
  const [klingMcCharacterPanelOpen, setKlingMcCharacterPanelOpen] = useState(false);
  const [klingMcAdvancedSettingsOpen, setKlingMcAdvancedSettingsOpen] = useState(false);

  // GENERAL tile's presets panel — shared by Minimax Hailuo and every Kling
  // model with a GENERAL tile (2.6, 2.5 Turbo, 2.1, 2.1 Master); the live
  // click-audit showed byte-identical GENERAL tile markup across families.
  const [motionPresetsPanelOpen, setMotionPresetsPanelOpen] = useState(false);

  // Kling 2.5 Turbo / Kling 2.1 — identical composer (shared state is safe since only one
  // model is selected at a time). The "On" toggle is the shared Sound toggle (not duplicated).
  const [klingLegacyStartFrame, setKlingLegacyStartFrame] = useState<string | null>(null);
  const [klingLegacyReferencesOpen, setKlingLegacyReferencesOpen] = useState(false);

  // Kling 2.1 Master — Start/End Frame + General tile ("On" toggle is the shared Sound toggle).
  const [kling21MasterFrames, setKling21MasterFrames] = useState<{
    startFrame: string | null;
    endFrame: string | null;
  }>({ startFrame: null, endFrame: null });
  const [kling21MasterFrameMode, setKling21MasterFrameMode] = useState<
    "startFrame" | "endFrame" | null
  >(null);
  const [kling21MasterReferencesOpen, setKling21MasterReferencesOpen] = useState(false);

  // OpenAI Sora 2 family — single optional Start Frame slot.
  const [soraStartFrame, setSoraStartFrame] = useState<string | null>(null);
  const [soraReferencesOpen, setSoraReferencesOpen] = useState(false);

  // HappyHorse — single optional Start Frame slot.
  const [happyHorseStartFrame, setHappyHorseStartFrame] = useState<string | null>(null);
  const [happyHorseReferencesOpen, setHappyHorseReferencesOpen] = useState(false);

  // Grok Imagine family — single mandatory Start Frame slot.
  const [grokStartFrame, setGrokStartFrame] = useState<string | null>(null);

  // Seedance 2.0 family — Bitrate chip (High default / Standard).
  const [seedanceBitrate, setSeedanceBitrate] = useState("High");

  // Seedance Pro Fast — Start Frame + General preset card. Isolated from the
  // "Seedance 2.0" family above (different model, "seedance-pro-fast").
  const [seedanceProFastStartFrame, setSeedanceProFastStartFrame] = useState<string | null>(null);
  const [seedanceProFastPreset, setSeedanceProFastPreset] = useState("General");

  // Seedance Pro ("seedance-pro") + Seedance 1.5 Pro ("seedance-1.5-pro") — Start
  // Frame + General preset card. Keyed by exact model id so the two models never
  // share a selection (switching models never overwrites the other's state).
  const [seedanceProPanels, setSeedanceProPanels] = useState<
    Record<"seedance-pro" | "seedance-1.5-pro", { startFrame: string | null; preset: string }>
  >({
    "seedance-pro": { startFrame: null, preset: "General" },
    "seedance-1.5-pro": { startFrame: null, preset: "General" },
  });

  // Seedance 1.5 Pro only — Fixed Lens toggle (default On). Isolated from
  // Seedance Pro, which keeps Batch + Sound and has no Fixed Lens control.
  const [seedance15FixedLens, setSeedance15FixedLens] = useState(true);

  // Higgsfield family — Start/End Frame + Seed chip (Random by default).
  const [higgsfieldFrames, setHiggsfieldFrames] = useState<{
    startFrame: string | null;
    endFrame: string | null;
  }>({ startFrame: null, endFrame: null });
  const [higgsfieldFrameMode, setHiggsfieldFrameMode] = useState<
    "startFrame" | "endFrame" | null
  >(null);
  const [higgsfieldReferencesOpen, setHiggsfieldReferencesOpen] = useState(false);
  const [higgsfieldSeedLocked, setHiggsfieldSeedLocked] = useState(false);
  const [higgsfieldSeed, setHiggsfieldSeed] = useState<number | null>(null);
  const [higgsfieldSeedOpen, setHiggsfieldSeedOpen] = useState(false);

  // Wan family — Start/End Frame (both Optional).
  const [wanFrames, setWanFrames] = useState<{
    startFrame: string | null;
    endFrame: string | null;
  }>({ startFrame: null, endFrame: null });
  const [wanFrameMode, setWanFrameMode] = useState<"startFrame" | "endFrame" | null>(null);
  const [wanReferencesOpen, setWanReferencesOpen] = useState(false);

  // Kling 2.6 — Enhance toggle + Start Frame (General preset tile is visual-only for now).
  const [kling26Enhance, setKling26Enhance] = useState(true);
  const [kling26AudioVoice, setKling26AudioVoice] = useState(true);
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
  const [promptWidth, setPromptWidth] = useState(DEFAULT_GENERATE_PROMPT_WIDTH);
  const [promptHeight, setPromptHeight] = useState(DEFAULT_GENERATE_PROMPT_HEIGHT);
  const [maxPromptWidth, setMaxPromptWidth] = useState(MAX_GENERATE_PROMPT_WIDTH);
  const [maxPromptHeight, setMaxPromptHeight] = useState(MAX_GENERATE_PROMPT_HEIGHT);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  // Cinema Studio 2.5 — all five reference/frame entry points (As Reference /
  // As Start Frame / As End Frame from the "+" popover, plus the Start Frame
  // and End Frame cards) open ONE shared Cinema25AssetsPicker with a context
  // that decides which slot the picked asset lands in (reference=0,
  // startFrame=1, endFrame=2). Replaces the old per-slot hidden file input.
  const [cinema25PickerOpen, setCinema25PickerOpen] = useState(false);
  const [cinema25PickerContext, setCinema25PickerContext] =
    useState<Cinema25PickerContext | null>(null);
  const openCinema25Picker = (ctx: Cinema25PickerContext) => {
    setActivePromptPopover(null);
    setCinema25PickerContext(ctx);
    setCinema25PickerOpen(true);
  };
  // Cinema Studio 2.5 — General preset card (bottom composer row), separate
  // from the Director Panel's 3 reference slots.
  const [cinema25GeneralPreset, setCinema25GeneralPreset] = useState("General");

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
    cinema25References,
    onCinema25AssignReference,
    cinema25ReferencesPopoverOpen,
    onCinema25ReferencesPopoverOpenChange,
    nanoBanana2LiteThinking,
    onNanoBanana2LiteThinkingChange,
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

  // Seedance Pro Fast detection — a distinct model ("seedance-pro-fast") from
  // the "Seedance 2.0" family above; do not conflate the two.
  const isSeedanceProFast = model === "seedance-pro-fast";

  // Seedance Pro / Seedance 1.5 Pro detection — exact model-id equality only
  // (no substring matching), explicitly excludes "seedance-pro-fast" above.
  const isSeedanceProOrPro15 = model === "seedance-pro" || model === "seedance-1.5-pro";
  const seedanceProModelKey = model as "seedance-pro" | "seedance-1.5-pro";

  // Seedance 1.5 Pro only (not Seedance Pro) — drops Batch/Sound, adds Fixed Lens.
  const isSeedance15Pro = model === "seedance-1.5-pro";

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
  const isKlingO1VideoElementsMode = isKlingO1Video && klingO1Mode === "elements";

  // Kling O1 Video's "@" reference-element button — isolated click handler, does not
  // reuse the Start/End Frame path or the "+" button. Opens the shared Assets Picker
  // on its Elements tab; a second click while it's open (via this same button) closes it.
  const handleKlingO1ReferenceElementClick = (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (klingO1ReferenceElementOpen) {
      setAssetsPickerOpen(false);
      setKlingO1ReferenceElementOpen(false);
    } else {
      setAssetsPickerTab("elements");
      setKlingO1ReferenceElementOpen(true);
      setAssetsPickerOpen(true);
    }
  };

  // Kling O1 Video Edit detection
  const isKlingO1VideoEdit = model === "kling-o1-video-edit";

  // Kling Motion Control (non-3.0) detection — separate from the LOCKED "kling-3.0-motion-control"
  const isKlingMotionControlNon3 = model === "kling-motion-control";

  // Kling 2.5 Turbo / Kling 2.1 — identical composer
  const isKling25TurboOr21 = model === "kling-2.5-turbo" || model === "kling-2.1";

  // Kling 2.1 Master detection
  const isKling21Master = model === "kling-2.1-master";

  // OpenAI Sora 2 family (4 confirmed ids — "sora-3.1-lite" and "sora-2-3.1-fast"
  // aren't in the live click-audit's "All models" list, so they're left on the
  // existing generic composer rather than guessed at here)
  const isOpenAISora =
    model === "sora-2" ||
    model === "sora-2-pro" ||
    model === "sora-2-max" ||
    model === "sora-2-pro-max";

  // HappyHorse detection
  const isHappyHorse = model === "happyhorse";

  // Grok Imagine — "grok-1.5" and "grok-edit" were removed from the catalog per
  // explicit request; only the base "Grok Imagine" model remains.
  const isGrokImagine = model === "grok-base";

  // Higgsfield family (Lite/Standard/Turbo) — only "Lite" is confirmed via
  // live click-audit; the other two share identical catalog metadata (720p,
  // 3s-5s, PREMIUM) so the same composer is assumed for all three.
  const isHiggsfield =
    model === "higgsfield-lite" || model === "higgsfield-standard" || model === "higgsfield-turbo";

  // Wan family — only "Wan 2.7" is confirmed via live click-audit; the other
  // 5 variants are assumed to share the same composer.
  const isWan =
    model === "wan-2.7" ||
    model === "wan-2.6" ||
    model === "wan-2.5" ||
    model === "wan-2.5-fast" ||
    model === "wan-2.2" ||
    model === "wan-2.2-fast";

  // Nano Banana family (Image mode) — exact model-id gating only, applies
  // to Nano Banana Pro, Nano Banana 2, and Nano Banana 2 Lite exclusively.
  const isNanoBananaPro = model === "nano-banana-pro";
  const isNanoBanana2 = model === "nano-banana-2";
  const isNanoBanana2Lite = model === "nano-banana-2-lite";
  const isNanoBananaGroup = isNanoBananaPro || isNanoBanana2 || isNanoBanana2Lite;

  // Minimax Hailuo family detection (2.3 Fast / 2.3 / 02 Fast / 02)
  const isMinimaxHailuo =
    model === "minimax-2.3-fast" ||
    model === "minimax-2.3" ||
    model === "minimax-02-fast" ||
    model === "minimax-02";

  // Minimax "2.3" family has no Duration chip (per live reference capture);
  // the "02" family shows one, defaulting to 6s.
  const isMinimax23Family = model === "minimax-2.3-fast" || model === "minimax-2.3";
  const isMinimax02Family = model === "minimax-02-fast" || model === "minimax-02";

  // Minimax Hailuo 2.3 Fast + Minimax Hailuo 02 only — exact model-id equality,
  // explicitly excludes "minimax-2.3" (plain) and "minimax-02-fast".
  const isMinimax23FastOnly = model === "minimax-2.3-fast";
  const isMinimax02Only = model === "minimax-02";
  const isMinimaxSimplified = isMinimax23FastOnly || isMinimax02Only;
  const minimaxEnhanceModelKey = model as "minimax-2.3-fast" | "minimax-02" | "minimax-2.3";

  // Minimax Hailuo 2.3 (plain) — same Aspect/Batch/Sound removal as above, per
  // explicit follow-up request, but WITHOUT the "+" References popover or
  // Enhance chip (not asked for on this model).
  const isMinimax23PlainOnly = model === "minimax-2.3";

  // Set Gemini Omni Flash defaults
  useEffect(() => {
    if (isGeminiOmniFlash) {
      onAspectRatioChange("9:16");
      onResolutionChange("720p");
      onDurationChange(10);
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

  // Set Kling 3.0 Omni Edit defaults (no Aspect Ratio or Duration chip — confirmed absent from the real reference)
  useEffect(() => {
    if (isKling3OmniEdit) {
      onResolutionChange("1080p");
    }
  }, [isKling3OmniEdit, onResolutionChange]);

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

  // Set Kling 3.0 Turbo's Duration default (3s) — the isolated kling3TurboSettings
  // doesn't cover duration, so this reuses the shared top-level duration state.
  useEffect(() => {
    if (isKling3Turbo) {
      onDurationChange(3);
    }
  }, [isKling3Turbo, onDurationChange]);

  // Set Kling O1 Video Edit defaults
  useEffect(() => {
    if (isKlingO1VideoEdit) {
      onAspectRatioChange("1:1");
      onResolutionChange("1080p");
    }
  }, [isKlingO1VideoEdit, onAspectRatioChange, onResolutionChange]);

  // Set Google Veo 3.1 Lite's Aspect default to "Auto" (confirmed via live click-audit)
  useEffect(() => {
    if (isVeo31Lite) {
      onAspectRatioChange("auto");
    }
  }, [isVeo31Lite, onAspectRatioChange]);

  // Set OpenAI Sora 2 family defaults
  useEffect(() => {
    if (isOpenAISora) {
      onAspectRatioChange("16:9");
      onDurationChange(12);
    }
  }, [isOpenAISora, onAspectRatioChange, onDurationChange]);

  // Set HappyHorse defaults
  useEffect(() => {
    if (isHappyHorse) {
      onAspectRatioChange("16:9");
      onResolutionChange("720p");
      onDurationChange(6);
    }
  }, [isHappyHorse, onAspectRatioChange, onResolutionChange, onDurationChange]);

  // Set Grok Imagine defaults
  useEffect(() => {
    if (isGrokImagine) {
      onDurationChange(5);
    }
  }, [isGrokImagine, onDurationChange]);

  // Set Seedance 2.0 family defaults
  useEffect(() => {
    if (isSeedance2Family) {
      onResolutionChange("1080p");
      onDurationChange(7);
      onSoundChange(false);
    }
  }, [isSeedance2Family, onResolutionChange, onDurationChange, onSoundChange]);

  // Set Higgsfield family defaults
  useEffect(() => {
    if (isHiggsfield) {
      onDurationChange(5);
    }
  }, [isHiggsfield, onDurationChange]);

  // Set Wan family defaults
  useEffect(() => {
    if (isWan) {
      onAspectRatioChange("16:9");
      onResolutionChange("720p");
      onDurationChange(5);
    }
  }, [isWan, onAspectRatioChange, onResolutionChange, onDurationChange]);

  // Set Kling Motion Control (non-3.0) defaults
  useEffect(() => {
    if (isKlingMotionControlNon3) {
      onResolutionChange("1080p");
    }
  }, [isKlingMotionControlNon3, onResolutionChange]);

  // Set Kling 2.5 Turbo / Kling 2.1 defaults
  useEffect(() => {
    if (isKling25TurboOr21) {
      onResolutionChange("720p");
      onDurationChange(5);
    }
  }, [isKling25TurboOr21, onResolutionChange, onDurationChange]);

  // Set Kling 2.1 Master defaults
  useEffect(() => {
    if (isKling21Master) {
      onDurationChange(5);
    }
  }, [isKling21Master, onDurationChange]);

  // Set Minimax Hailuo defaults — Quality defaults to 1080p for all 4
  // submodels (confirmed via live click-audit — even "512p"-native 02 Fast
  // defaults its Quality chip to 1080p), Sound defaults Off.
  useEffect(() => {
    if (isMinimaxHailuo) {
      onResolutionChange("1080p");
      onSoundChange(false);
    }
  }, [isMinimaxHailuo, onResolutionChange, onSoundChange]);

  // "02" family shows a Duration chip defaulting to 6s (the "2.3" family has none).
  useEffect(() => {
    if (isMinimax02Family) {
      onDurationChange(6);
    }
  }, [isMinimax02Family, onDurationChange]);

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

  useEffect(() => {
    const updateResizeBounds = () => {
      const left = composerRef.current?.getBoundingClientRect().left ?? GENERATE_VIEWPORT_GUTTER;
      const nextMaxWidth = Math.max(
        320,
        Math.min(
          MAX_GENERATE_PROMPT_WIDTH,
          window.innerWidth - left - GENERATE_VIEWPORT_GUTTER,
        ),
      );
      const nextMaxHeight = Math.max(
        DEFAULT_GENERATE_PROMPT_HEIGHT,
        Math.min(MAX_GENERATE_PROMPT_HEIGHT, window.innerHeight - 160),
      );
      setMaxPromptWidth(nextMaxWidth);
      setMaxPromptHeight(nextMaxHeight);
    };

    const frame = requestAnimationFrame(updateResizeBounds);
    window.addEventListener("resize", updateResizeBounds);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateResizeBounds);
    };
  }, []);

  const promptResize = usePromptSurfaceResize({
    width: promptWidth,
    height: promptHeight,
    minWidth: Math.min(DEFAULT_GENERATE_PROMPT_WIDTH, maxPromptWidth),
    maxWidth: maxPromptWidth,
    minHeight: DEFAULT_GENERATE_PROMPT_HEIGHT,
    maxHeight: maxPromptHeight,
    defaultWidth: DEFAULT_GENERATE_PROMPT_WIDTH,
    defaultHeight: DEFAULT_GENERATE_PROMPT_HEIGHT,
    setWidth: setPromptWidth,
    setHeight: setPromptHeight,
    storageKey: "generatePromptDimensionsCompactV3",
  });

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
        className={`relative min-w-0 flex-none ${
          promptResize.isResizing ? "" : "transition-[width,height] duration-150 ease-out"
        }`}
        style={{
          width: promptWidth,
          height: promptHeight,
        }}
      >
      {/* Full frame glowing pulsing 20s multi-color rainbow spectrum border shimmer overlay */}
      <div className="pointer-events-none absolute -inset-[1px] rounded-[25px] border-2 animate-pulse-rainbow-20s z-30" />
      <div
        ref={composerRef}
        className={`absolute inset-x-0 bottom-0 flex min-w-0 items-stretch rounded-[24px] p-1 opacity-100 ${
          promptResize.isResizing ? "" : "transition-[height] duration-150 ease-out"
        }`}
        style={{
          minHeight: DEFAULT_GENERATE_PROMPT_HEIGHT,
          width: "100%",
          height: promptHeight,
          background:
            "linear-gradient(180deg, rgba(217,119,87,0.28) 0%, rgba(217,119,87,0.16) 55%, rgba(217,119,87,0.10) 100%), #141414",
          border: "1px solid rgba(217, 119, 87, 0.45)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.15), inset 0 0 25px rgba(217,119,87,0.18), 0 10px 30px rgba(0,0,0,0.5)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <div
          className="prompt-main-surface relative flex min-w-0 flex-1 items-stretch gap-1 rounded-[20px] p-3 overflow-hidden bg-transparent"
        >
        <PromptResizeHandles
          verticalHandleProps={promptResize.verticalHandleProps}
          cornerHandleProps={promptResize.cornerHandleProps}
          isResizing={promptResize.isResizing}
          verticalLabel="Resize generate prompt height"
          cornerLabel="Resize generate prompt width and height"
        />
        {/* Prompt input + controls. The prompt input itself is flex-1 (grows
            to match the Generate button's height, per Higgsfield's real
            markup); the control row below it is mt-auto so it always stays
            pinned to the bottom regardless of how tall the input grows. */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {!isKling3MotionControl && !isKlingMotionControlNon3 && (
            <PromptInput
              value={prompt}
              onChange={onPromptChange}
              placeholder={placeholder}
            />
          )}

          <div className="prompt-control-row mt-auto flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
            {/* Cinema Studio 2.5 References Button - exactly 3 options (As
                Reference / As Start Frame / As End Frame). Each option opens
                the one shared Cinema25AssetsPicker with the matching context;
                the Director Panel (rendered above the prompt bar) displays the
                3 slots. */}
            {isCinema25 && (
              <Cinema25ReferencesPopover
                isOpen={cinema25ReferencesPopoverOpen}
                onOpenChange={onCinema25ReferencesPopoverOpenChange}
                onSelect={(refMode) => openCinema25Picker(refMode)}
                portalContainer={portalRoot}
              />
            )}

            {/* Assets Picker Buttons - Cinema Studio 3.5 and 3.0 only */}
            {(isCinema35 || isCinema30) && (
              <>
                <div className="flex h-8 items-center rounded-lg border border-white/15 bg-[rgba(18,19,21,0.95)] hover:border-white/30 transition-colors">
                  <button
                    type="button"
                    onClick={() => {
                      setAssetsPickerTab("uploads");
                      setAssetsPickerOpen(true);
                    }}
                    aria-label="Add assets"
                    title="Add assets"
                    className="flex h-8 w-8 items-center justify-center rounded-l-lg text-neutral-400 hover:bg-white/10 transition-colors"
                  >
                    <Plus className="size-4 text-white/80" />
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
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-r-lg bg-transparent p-0 text-white/80 transition-colors hover:bg-white/10"
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
                    className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out focus:outline-none ${
                      activePromptPopover === "shotControl"
                        ? "border-[#D97757] bg-[rgba(17,17,18,0.98)]"
                        : "border-white/15 bg-[rgba(18,19,21,0.95)] hover:border-white/30 hover:bg-[rgba(26,28,31,0.98)]"
                    }`}
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
                          className="size-5 text-[#D97757]"
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
                          className="size-5 text-[#D97757]"
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
              <div className="flex items-center gap-0 rounded-lg bg-[rgba(4,4,5,0.98)]">
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
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-[rgba(4,4,5,0.98)] text-neutral-400 hover:bg-[rgba(16,16,17,0.98)] transition-colors"
              >
                <Plus className="size-4" />
              </button>
            )}

            {/* Kling 3.0 (plain) References Button - opens Start Frame choice, then Assets picker */}
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
                showEndFrame={false}
              />
            )}

            {/* Kling 3.0 Omni References Button - Frames mode only (Elements mode uses +/@ instead) */}
            {isKling3Omni && klingOmniMode === "frames" && (
              <ReferencesControl
                isOpen={klingOmniReferencesOpen}
                onOpenChange={setKlingOmniReferencesOpen}
                onSelectReferenceMode={(refMode) => {
                  setKlingOmniFrameMode(refMode);
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                portalContainer={portalRoot}
              />
            )}

            {/* Kling 2.6 References Button - Start Frame only */}
            {isKling2_6 && (
              <ReferencesControl
                isOpen={activePromptPopover === "references"}
                onOpenChange={(open) => {
                  if (open) setActivePromptPopover("references");
                  else if (activePromptPopover === "references") setActivePromptPopover(null);
                }}
                onSelectReferenceMode={() => {
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                portalContainer={portalRoot}
                showEndFrame={false}
              />
            )}

            {/* Kling O1 Video References Button - Frames mode only (Elements mode uses +/@ instead) */}
            {isKlingO1Video && klingO1Mode === "frames" && (
              <ReferencesControl
                isOpen={klingO1ReferencesOpen}
                onOpenChange={setKlingO1ReferencesOpen}
                onSelectReferenceMode={(refMode) => {
                  setKlingO1FrameMode(refMode);
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                portalContainer={portalRoot}
              />
            )}

            {/* Kling 2.5 Turbo / Kling 2.1 References Button - Start Frame only */}
            {isKling25TurboOr21 && (
              <ReferencesControl
                isOpen={klingLegacyReferencesOpen}
                onOpenChange={setKlingLegacyReferencesOpen}
                onSelectReferenceMode={() => {
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                portalContainer={portalRoot}
                showEndFrame={false}
              />
            )}

            {/* Kling 2.1 Master References Button - Start + End Frame */}
            {isKling21Master && (
              <ReferencesControl
                isOpen={kling21MasterReferencesOpen}
                onOpenChange={setKling21MasterReferencesOpen}
                onSelectReferenceMode={(refMode) => {
                  setKling21MasterFrameMode(refMode);
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                portalContainer={portalRoot}
              />
            )}

            {/* OpenAI Sora 2 References Button - Start Frame only */}
            {isOpenAISora && (
              <ReferencesControl
                isOpen={soraReferencesOpen}
                onOpenChange={setSoraReferencesOpen}
                onSelectReferenceMode={() => {
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                portalContainer={portalRoot}
                showEndFrame={false}
              />
            )}

            {/* HappyHorse References Button - Start Frame only */}
            {isHappyHorse && (
              <ReferencesControl
                isOpen={happyHorseReferencesOpen}
                onOpenChange={setHappyHorseReferencesOpen}
                onSelectReferenceMode={() => {
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                portalContainer={portalRoot}
                showEndFrame={false}
              />
            )}

            {/* Grok Imagine Plus Button - plain "Add assets", no References submenu confirmed */}
            {isGrokImagine && (
              <button
                type="button"
                onClick={() => {
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                aria-label="Add assets"
                title="Add assets"
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-[rgba(4,4,5,0.98)] text-neutral-400 hover:bg-[rgba(16,16,17,0.98)] transition-colors"
              >
                <Plus className="size-4" />
              </button>
            )}

            {/* Higgsfield References Button - Start + End Frame */}
            {isHiggsfield && (
              <ReferencesControl
                isOpen={higgsfieldReferencesOpen}
                onOpenChange={setHiggsfieldReferencesOpen}
                onSelectReferenceMode={(refMode) => {
                  setHiggsfieldFrameMode(refMode);
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                portalContainer={portalRoot}
              />
            )}

            {/* Wan References Button - Start + End Frame (both Optional) */}
            {isWan && (
              <ReferencesControl
                isOpen={wanReferencesOpen}
                onOpenChange={setWanReferencesOpen}
                onSelectReferenceMode={(refMode) => {
                  setWanFrameMode(refMode);
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

            {/* Minimax Hailuo 2.3 Fast / 02 / 2.3 References Button - reuses
                the existing minimaxFrames/minimaxFrameMode state (shared with
                the Start/End Frame FrameCard tiles below). 2.3 Fast and plain
                2.3 have only "As Start Frame"; 02 has both. */}
            {(isMinimaxSimplified || isMinimax23PlainOnly) && (
              <ReferencesControl
                isOpen={minimaxReferencesOpen}
                onOpenChange={setMinimaxReferencesOpen}
                onSelectReferenceMode={(refMode) => {
                  setActivePromptPopover(null);
                  setMinimaxFrameMode(refMode);
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                portalContainer={portalRoot}
                showEndFrame={!isMinimax23FastOnly && !isMinimax23PlainOnly}
              />
            )}

            {/* + / @ input actions - Kling 3.0 Omni Edit, Kling O1 Video Edit, and
                Omni/O1 Video's Elements mode, per live reference. Kling O1 Video's "@"
                is the only wired mention button (see handleKlingO1ReferenceElementClick);
                the others keep the prior inert "@" behavior untouched. */}
            {(isKling3OmniEdit ||
              isKlingO1VideoEdit ||
              (isKling3Omni && klingOmniMode === "elements") ||
              isKlingO1VideoElementsMode) && (
              <PlusAtButtons
                onOpenPicker={() => {
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                {...(isKlingO1VideoElementsMode
                  ? {
                      onMentionClick: handleKlingO1ReferenceElementClick,
                      mentionOpen: klingO1ReferenceElementOpen,
                      mentionClassName: "gen-panel-reference-element-button",
                      mentionAriaLabel: "Add reference element",
                    }
                  : {})}
              />
            )}

            {/* + / @ asset buttons — Nano Banana Pro, Nano Banana 2, and Nano
                Banana 2 Lite only. Reuses the existing bordered +/@ pill
                pattern (Cinema Studio 3.5/3.0's Assets Picker buttons above)
                and opens the same shared AssetsPickerModal on its Uploads /
                Elements tab. */}
            {isNanoBananaGroup && (
              <div className="flex h-8 items-center rounded-lg border border-white/15 bg-[rgba(18,19,21,0.95)] hover:border-white/30 transition-colors">
                <button
                  type="button"
                  onClick={() => {
                    setAssetsPickerTab("uploads");
                    setAssetsPickerOpen(true);
                  }}
                  aria-label="Add assets"
                  title="Add assets"
                  className="flex h-8 w-8 items-center justify-center rounded-l-lg text-neutral-400 hover:bg-white/10 transition-colors"
                >
                  <Plus className="size-4 text-white/80" />
                </button>

                <div className="h-4 w-px bg-white/20" />

                <button
                  type="button"
                  onClick={() => {
                    setAssetsPickerTab("elements");
                    setAssetsPickerOpen(true);
                  }}
                  aria-label="Elements"
                  title="Elements"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-r-lg bg-transparent p-0 text-white/80 transition-colors hover:bg-white/10"
                >
                  <AtSign className="size-4" />
                </button>
              </div>
            )}

            <ModelSelector value={model} onChange={onModelChange} mode={mode} portalContainer={portalRoot} />

            {/* Aspect Ratio - Hidden for Kling 3.0 Motion Control, Kling 3.0 Omni Edit,
                Kling Motion Control (non-3.0), Kling 2.5 Turbo/2.1, Kling 2.1 Master, Grok Imagine,
                Higgsfield, and Minimax Hailuo 2.3 Fast/02/2.3 (none of these show it in their chip row) */}
            {!isKling3MotionControl &&
              !isKling3OmniEdit &&
              !isKlingMotionControlNon3 &&
              !isKling25TurboOr21 &&
              !isKling21Master &&
              !isGrokImagine &&
              !isHiggsfield &&
              !isMinimaxSimplified &&
              !isMinimax23PlainOnly && (
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
              ) : isKling3 || isKling3Omni || isKling2_6 || isKlingO1Video || isKlingO1VideoEdit ? (
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
              ) : isOpenAISora ? (
                <Veo31AspectRatioControl
                  value={aspectRatio}
                  onChange={onAspectRatioChange}
                  isOpen={activePromptPopover === "aspectRatio"}
                  portalContainer={portalRoot}
                  onOpenChange={(open) => {
                    if (open) setActivePromptPopover("aspectRatio");
                    else if (activePromptPopover === "aspectRatio") setActivePromptPopover(null);
                  }}
                  includeAuto={false}
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
                  options={
                    isHappyHorse
                      ? ["16:9", "9:16", "1:1", "4:3", "3:4"]
                      : isWan
                        ? ["16:9", "9:16", "4:3", "3:4", "1:1"]
                        : undefined
                  }
                />
              )
            )}

            {/* Resolution - Hidden for Gemini, Kling 2.6, Kling 2.1 Master, OpenAI Sora 2, Higgsfield,
                Nano Banana Pro (fixed 2K control below), and Nano Banana 2 Lite (Thinking control below) */}
            {!isGeminiOmniFlash &&
              !isKling2_6 &&
              !isKling21Master &&
              !isOpenAISora &&
              !isHiggsfield &&
              !isNanoBananaPro &&
              !isNanoBanana2Lite && (
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
                width={isCinema35 ? 120 : undefined}
                collisionPadding={isCinema35 ? 12 : undefined}
                options={
                  isCinema25
                    ? ["720p", "1080p"]
                    : isKling3 || isKling3Turbo || isKling3Omni
                    ? ["720p", "1080p", "4K"]
                    : isVeo31Lite ||
                        isKlingO1Video ||
                        isKling3OmniEdit ||
                        isKlingO1VideoEdit ||
                        isKlingMotionControlNon3 ||
                        isKling25TurboOr21 ||
                        isHappyHorse
                      ? ["720p", "1080p"]
                      : isMinimax23Family
                        ? ["768p", "1080p"]
                        : isMinimax02Family
                          ? ["512p", "768p", "1080p"]
                          : isSeedance2Family
                            ? ["480p", "720p", "1080p", "4K"]
                            : isWan
                              ? ["720p", "1080p"]
                              : undefined
                }
              />
            )}

            {/* Nano Banana Pro — single fixed 2K resolution control. Reuses the
                existing ResolutionPopover dropdown architecture (locked to one
                option) rather than introducing a second resolution component. */}
            {isNanoBananaPro && (
              <ResolutionPopover
                value="2K"
                onChange={onResolutionChange}
                isOpen={activePromptPopover === "resolution"}
                portalContainer={portalRoot}
                onOpenChange={(open) => {
                  if (open) setActivePromptPopover("resolution");
                  else if (activePromptPopover === "resolution") setActivePromptPopover(null);
                }}
                options={["2K"]}
              />
            )}

            {/* Nano Banana Pro — image count stepper. Reuses the existing
                BatchStepper component (already defined in this file, same
                PILL styling as other prompt-bar controls). */}
            {isNanoBananaPro && (
              <BatchStepper value={batch} onChange={onBatchChange} />
            )}

            {/* Nano Banana 2 Lite — "Thinking" control, replaces resolution
                for this model only. Follows the same Radix Popover pattern
                already used by Shot Control above (single-open-at-a-time via
                activePromptPopover, native click-outside/Escape handling). */}
            {isNanoBanana2Lite && (
              <Popover.Root
                open={activePromptPopover === "thinking"}
                onOpenChange={(open) => {
                  if (open) setActivePromptPopover("thinking");
                  else if (activePromptPopover === "thinking") setActivePromptPopover(null);
                }}
              >
                <Popover.Trigger asChild>
                  <button
                    type="button"
                    aria-label="Thinking"
                    aria-haspopup="dialog"
                    aria-expanded={activePromptPopover === "thinking"}
                    className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out focus:outline-none ${
                      activePromptPopover === "thinking"
                        ? "border-[#D97757] bg-[rgba(17,17,18,0.98)]"
                        : "border-white/15 bg-[rgba(18,19,21,0.95)] hover:border-white/30 hover:bg-[rgba(26,28,31,0.98)]"
                    }`}
                  >
                    {nanoBanana2LiteThinking}
                    <ChevronDown className="size-3 text-neutral-500" />
                  </button>
                </Popover.Trigger>
                <Popover.Portal container={portalRoot}>
                  <Popover.Content
                    side="top"
                    align="start"
                    sideOffset={8}
                    className="outline-none z-[100000] rounded-2xl shadow-[0_4px_4px_rgba(0,0,0,0.12)] border border-[rgba(217,217,217,0.04)] bg-[rgba(35,38,42,0.75)] backdrop-blur data-[state=closed]:animate-fade-out data-[side=bottom]:data-[state=open]:animate-popover-in-down data-[side=top]:data-[state=open]:animate-popover-in-up data-[side=right]:data-[state=open]:animate-popover-in-right data-[side=left]:data-[state=open]:animate-popover-in-left flex flex-col gap-1 p-2 w-[160px] pointer-events-auto"
                  >
                    <span className="px-3 pt-1 pb-0.5 text-xs font-medium text-font-secondary">
                      THINKING
                    </span>
                    {(["High", "Minimal"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          onNanoBanana2LiteThinkingChange(option);
                          setActivePromptPopover(null);
                        }}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl w-full cursor-pointer hover:bg-[#131517] transition-colors ${
                          nanoBanana2LiteThinking === option ? "bg-[#131517]" : ""
                        }`}
                      >
                        <span className="font-medium text-sm text-white">{option}</span>
                        {nanoBanana2LiteThinking === option && (
                          <svg width="20" height="20" viewBox="0 0 20 20" className="size-5 text-[#D97757]">
                            <path
                              fillRule="evenodd"
                              clipRule="evenodd"
                              d="M14.7838 5.98556C15.0449 6.21134 15.0735 6.60602 14.8477 6.86712L8.72275 13.9505C8.60875 14.0823 8.44491 14.1605 8.27078 14.1663C8.09661 14.1721 7.92794 14.1049 7.80545 13.981L5.18045 11.3247C4.93782 11.0792 4.94016 10.6835 5.18568 10.4409C5.4312 10.1982 5.82691 10.2006 6.06955 10.4461L8.21939 12.6215L13.9022 6.04952C14.128 5.78842 14.5227 5.75979 14.7838 5.98556Z"
                              fill="currentColor"
                            />
                          </svg>
                        )}
                      </button>
                    ))}
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
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

            {/* Duration - Hidden for Kling 3.0 Motion Control, Kling 3.0 (plain, confirmed
                absent from the live click-audit — Multi-shot is its only time control),
                Kling 3.0 Omni Edit, Kling Motion Control (non-3.0), and Minimax Hailuo "2.3" family */}
            {isVideo &&
              !isKling3MotionControl &&
              !isKling3 &&
              !isKling3OmniEdit &&
              !isKlingMotionControlNon3 &&
              !isMinimax23Family &&
              !isCinema25 && (
              <DurationPopover
                value={duration}
                durations={durations}
                onChange={onDurationChange}
                portalContainer={portalRoot}
                isOpen={activePromptPopover === "duration"}
                onOpenChange={(open) => {
                  if (open) setActivePromptPopover("duration");
                  else if (activePromptPopover === "duration") setActivePromptPopover(null);
                }}
                mode={isHiggsfield ? "buttons" : undefined}
                align={isCinema35 ? "center" : undefined}
                width={isCinema35 ? 200 : undefined}
                collisionPadding={isCinema35 ? 12 : undefined}
              />
            )}

            {/* Bitrate chip - Seedance 2.0 family, placed after Duration. Excluded
                for "seedance-2.0-mini" specifically per explicit request. */}
            {isSeedance2Family && model !== "seedance-2.0-mini" && (
              <BitrateControl
                value={seedanceBitrate}
                onChange={setSeedanceBitrate}
                isOpen={activePromptPopover === "bitrate"}
                onOpenChange={(open) => {
                  if (open) setActivePromptPopover("bitrate");
                  else if (activePromptPopover === "bitrate") setActivePromptPopover(null);
                }}
                portalContainer={portalRoot}
              />
            )}

            {/* Seed chip - Higgsfield family only, placed after Duration (before Sound) */}
            {isHiggsfield && (
              <SeedControl
                locked={higgsfieldSeedLocked}
                onLockedChange={setHiggsfieldSeedLocked}
                seed={higgsfieldSeed}
                onSeedChange={setHiggsfieldSeed}
                isOpen={higgsfieldSeedOpen}
                onOpenChange={setHiggsfieldSeedOpen}
                portalContainer={portalRoot}
              />
            )}

            {/* Multi-shot - Kling 3.0 (plain) only, placed after Duration per spec.
                Live click-audit confirms 3 options: Off, Auto, Custom (default Custom). */}
            {isKling3 && (
              <Kling3MultiShotControl
                value={kling3Extras.multiShot}
                onChange={(value) => setKling3Extras((s) => ({ ...s, multiShot: value }))}
                options={[
                  { value: "off", label: "Off" },
                  { value: "auto", label: "Auto" },
                  { value: "custom", label: "Custom" },
                ]}
                isOpen={activePromptPopover === "multiShot"}
                onOpenChange={(open) => {
                  if (open) setActivePromptPopover("multiShot");
                  else if (activePromptPopover === "multiShot") setActivePromptPopover(null);
                }}
                portalContainer={portalRoot}
              />
            )}

            {/* Multi-shot - Kling 3.0 Omni, Elements mode only (hidden in Frames mode per live click-audit) */}
            {isKling3Omni && klingOmniMode === "elements" && (
              <Kling3MultiShotControl
                value={klingOmniMultiShot}
                onChange={setKlingOmniMultiShot}
                options={[
                  { value: "off", label: "Off" },
                  { value: "auto", label: "Auto" },
                  { value: "custom", label: "Custom" },
                ]}
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

            {/* Mode chip - Kling O1 Video (Frames/Elements, interactive per live click-audit) */}
            {isKlingO1Video && (
              <KlingModeControl
                value={klingO1Mode}
                onChange={(value) => setKlingO1Mode(value as "frames" | "elements")}
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

            {/* Enhance chip - Kling 2.6 only */}
            {isKling2_6 && (
              <button
                type="button"
                onClick={() => setKling26Enhance((v) => !v)}
                aria-label="Toggle enhance"
                aria-pressed={kling26Enhance}
                className={`${PILL} ${kling26Enhance ? "text-[#D97757]" : "text-neutral-400"}`}
              >
                <EnhanceIcon />
                {kling26Enhance ? "On" : "Off"}
              </button>
            )}

            {/* Auto settings toggle - Kling 3.0 Omni Edit + Kling O1 Video Edit */}
            {isKling3OmniEdit && (
              <AutoSettingsToggle
                checked={omniEditAutoSettings}
                onToggle={() => setOmniEditAutoSettings((v) => !v)}
              />
            )}
            {isKlingO1VideoEdit && (
              <AutoSettingsToggle
                checked={o1VideoEditAutoSettings}
                onToggle={() => setO1VideoEditAutoSettings((v) => !v)}
              />
            )}



            {/* Kling Motion Control (non-3.0) Specific Controls — isolated state from the LOCKED Kling 3.0 Motion Control */}
            {isKlingMotionControlNon3 && (
              <>
                <KlingAdvancedSettingsPanel
                  isOpen={klingMcAdvancedSettingsOpen}
                  onOpenChange={setKlingMcAdvancedSettingsOpen}
                  advancedPrompt={klingMcSettings.advancedPrompt}
                  onPromptChange={(advancedPrompt) =>
                    setKlingMcSettings((s) => ({ ...s, advancedPrompt }))
                  }
                  orientation={klingMcSettings.orientation}
                  onOrientationChange={(orientation) =>
                    setKlingMcSettings((s) => ({ ...s, orientation }))
                  }
                  portalContainer={portalRoot}
                />

                <KlingSceneControl
                  value={klingMcSettings.sceneControl}
                  onChange={(sceneControl) => setKlingMcSettings((s) => ({ ...s, sceneControl }))}
                  options={["Off", "Video", "Image"]}
                  label="Scene control"
                  showValue
                  portalContainer={portalRoot}
                />

                <KlingMotionCard onClick={() => setKlingMcMotionModalOpen(true)} />

                <KlingCharacterCard onClick={() => setKlingMcCharacterPanelOpen(true)} />
              </>
            )}

          </div>
        </div>

        {/* C — Right action group.
            All frame cards across all models live here, immediately to the
            left of GenerateButton. The group is shrink-0 and self-end so Generate
            and FrameCards stay pinned to the far-right edge without overlapping. */}
        <div className="flex h-[96px] shrink-0 items-stretch gap-2 self-end">
          {/* Cinema Studio 2.5 */}
          {isCinema25 && (
            <>
              <FrameCard
                variant="cinema25"
                label="Start Frame"
                value={cinema25References[1] ?? null}
                optional={false}
                onOpenPicker={() => openCinema25Picker("startFrame")}
                onRemove={() => onCinema25AssignReference(1, null)}
              />
              <FrameCard
                variant="cinema25"
                label="End Frame"
                value={cinema25References[2] ?? null}
                optional={false}
                onOpenPicker={() => openCinema25Picker("endFrame")}
                onRemove={() => onCinema25AssignReference(2, null)}
              />
            </>
          )}

          {/* Kling 3.0 */}
          {isKling3 && (
            <>
              <FrameCard
                variant="cinema25"
                label="Start Frame"
                value={kling3Extras.startFrame}
                onOpenPicker={() => {
                  setActivePromptPopover(null);
                  setKling3ReferenceMode("startFrame");
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                onRemove={() => setKling3Extras((s) => ({ ...s, startFrame: null }))}
              />
              <FrameCard
                variant="cinema25"
                label="End Frame"
                value={kling3Extras.endFrame}
                onOpenPicker={() => {
                  setActivePromptPopover(null);
                  setKling3ReferenceMode("endFrame");
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                onRemove={() => setKling3Extras((s) => ({ ...s, endFrame: null }))}
              />
            </>
          )}

          {/* Minimax Hailuo */}
          {isMinimaxHailuo && (
            <>
              <FrameCard
                label="Start Frame"
                value={minimaxFrames.startFrame}
                optional={model === "minimax-2.3" || isMinimax23FastOnly}
                onOpenPicker={() => {
                  setActivePromptPopover(null);
                  setMinimaxFrameMode("startFrame");
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                onRemove={() => setMinimaxFrames((s) => ({ ...s, startFrame: null }))}
              />
              {isMinimax02Family && (
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
              )}
              <FrameCard
                variant="general"
                label="General"
                value={null}
                onOpenPicker={() => setMotionPresetsPanelOpen(true)}
              />
            </>
          )}

          {/* OpenAI Sora 2 */}
          {isOpenAISora && (
            <FrameCard
              label="Start Frame"
              value={soraStartFrame}
              onOpenPicker={() => {
                setActivePromptPopover(null);
                setAssetsPickerTab("uploads");
                setAssetsPickerOpen(true);
              }}
              onRemove={() => setSoraStartFrame(null)}
            />
          )}

          {/* Kling 2.5 Turbo / Kling 2.1 */}
          {isKling25TurboOr21 && (
            <>
              <FrameCard
                label="Start Frame"
                value={klingLegacyStartFrame}
                onOpenPicker={() => {
                  setActivePromptPopover(null);
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                onRemove={() => setKlingLegacyStartFrame(null)}
              />
              <FrameCard
                variant="general"
                label="General"
                value={null}
                onOpenPicker={() => setMotionPresetsPanelOpen(true)}
              />
            </>
          )}

          {/* Kling 2.1 Master */}
          {isKling21Master && (
            <>
              <FrameCard
                label="Start Frame"
                value={kling21MasterFrames.startFrame}
                onOpenPicker={() => {
                  setActivePromptPopover(null);
                  setKling21MasterFrameMode("startFrame");
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                onRemove={() => setKling21MasterFrames((s) => ({ ...s, startFrame: null }))}
              />
              <FrameCard
                label="End Frame"
                value={kling21MasterFrames.endFrame}
                onOpenPicker={() => {
                  setActivePromptPopover(null);
                  setKling21MasterFrameMode("endFrame");
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                onRemove={() => setKling21MasterFrames((s) => ({ ...s, endFrame: null }))}
              />
              <FrameCard
                variant="general"
                label="General"
                value={null}
                onOpenPicker={() => setMotionPresetsPanelOpen(true)}
              />
            </>
          )}

          {/* Kling 3.0 Omni (Frames mode) */}
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

          {/* Kling 3.0 Omni Edit / Kling O1 Video Edit */}
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
          {isKlingO1VideoEdit && (
            <FrameCard
              variant="reference"
              label="Video Reference"
              value={o1VideoEditVideoReference}
              onOpenPicker={() => {
                setActivePromptPopover(null);
                setAssetsPickerTab("uploads");
                setAssetsPickerOpen(true);
              }}
              onRemove={() => setO1VideoEditVideoReference(null)}
            />
          )}

          {/* Kling O1 Video */}
          {isKlingO1Video && klingO1Mode === "frames" && (
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
              <FrameCard
                variant="general"
                label="General"
                value={null}
                onOpenPicker={() => setMotionPresetsPanelOpen(true)}
              />
            </>
          )}

          {/* Google Veo 3.1 Lite */}
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

          {/* HappyHorse */}
          {isHappyHorse && (
            <FrameCard
              label="Start Frame"
              value={happyHorseStartFrame}
              onOpenPicker={() => {
                setActivePromptPopover(null);
                setAssetsPickerTab("uploads");
                setAssetsPickerOpen(true);
              }}
              onRemove={() => setHappyHorseStartFrame(null)}
            />
          )}

          {/* Grok Imagine */}
          {isGrokImagine && (
            <FrameCard
              label="Start Frame"
              value={grokStartFrame}
              optional={false}
              onOpenPicker={() => {
                setActivePromptPopover(null);
                setAssetsPickerTab("uploads");
                setAssetsPickerOpen(true);
              }}
              onRemove={() => setGrokStartFrame(null)}
            />
          )}

          {/* Higgsfield */}
          {isHiggsfield && (
            <>
              <FrameCard
                label="Start Frame"
                value={higgsfieldFrames.startFrame}
                optional={false}
                onOpenPicker={() => {
                  setActivePromptPopover(null);
                  setHiggsfieldFrameMode("startFrame");
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                onRemove={() => setHiggsfieldFrames((s) => ({ ...s, startFrame: null }))}
              />
              <FrameCard
                label="End Frame"
                value={higgsfieldFrames.endFrame}
                onOpenPicker={() => {
                  setActivePromptPopover(null);
                  setHiggsfieldFrameMode("endFrame");
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                onRemove={() => setHiggsfieldFrames((s) => ({ ...s, endFrame: null }))}
              />
              <FrameCard
                variant="general"
                label="General"
                value={null}
                onOpenPicker={() => setMotionPresetsPanelOpen(true)}
              />
            </>
          )}

          {/* Wan */}
          {isWan && (
            <>
              <FrameCard
                label="Start Frame"
                value={wanFrames.startFrame}
                onOpenPicker={() => {
                  setActivePromptPopover(null);
                  setWanFrameMode("startFrame");
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                onRemove={() => setWanFrames((s) => ({ ...s, startFrame: null }))}
              />
              <FrameCard
                label="End Frame"
                value={wanFrames.endFrame}
                onOpenPicker={() => {
                  setActivePromptPopover(null);
                  setWanFrameMode("endFrame");
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                onRemove={() => setWanFrames((s) => ({ ...s, endFrame: null }))}
              />
            </>
          )}

          {/* Kling 3.0 Turbo */}
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

          {/* Seedance Pro Fast */}
          {isSeedanceProFast && (
            <>
              <FrameCard
                label="Start Frame"
                value={seedanceProFastStartFrame}
                optional={false}
                ariaHaspopup="dialog"
                ariaExpanded={assetsPickerOpen && assetsPickerTab === "uploads"}
                onOpenPicker={() => {
                  setActivePromptPopover(null);
                  setMotionPresetsPanelOpen(false);
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                onRemove={() => setSeedanceProFastStartFrame(null)}
              />
              <FrameCard
                variant="general"
                label={seedanceProFastPreset}
                value={null}
                ariaHaspopup="dialog"
                ariaExpanded={motionPresetsPanelOpen}
                onOpenPicker={() => {
                  setAssetsPickerOpen(false);
                  setMotionPresetsPanelOpen(true);
                }}
              />
            </>
          )}

          {/* Seedance Pro / Pro 1.5 */}
          {isSeedanceProOrPro15 && (
            <>
              <FrameCard
                label="Start Frame"
                value={seedanceProPanels[seedanceProModelKey].startFrame}
                optional={false}
                ariaHaspopup="dialog"
                ariaExpanded={assetsPickerOpen && assetsPickerTab === "uploads"}
                onOpenPicker={() => {
                  setActivePromptPopover(null);
                  setMotionPresetsPanelOpen(false);
                  setAssetsPickerTab("uploads");
                  setAssetsPickerOpen(true);
                }}
                onRemove={() =>
                  setSeedanceProPanels((s) => ({
                    ...s,
                    [seedanceProModelKey]: { ...s[seedanceProModelKey], startFrame: null },
                  }))
                }
              />
              <FrameCard
                variant="general"
                label={seedanceProPanels[seedanceProModelKey].preset}
                value={null}
                ariaHaspopup="dialog"
                ariaExpanded={motionPresetsPanelOpen}
                onOpenPicker={() => {
                  setAssetsPickerOpen(false);
                  setMotionPresetsPanelOpen(true);
                }}
              />
            </>
          )}

          <GenerateButton
            creditCost={creditCost}
            onGenerate={onGenerate}
            mode={mode}
            isLoading={props.isGenerating}
            accent={isCinema25 ? "yellow" : undefined}
          />
        </div>
        </div>
      </div>
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
          setKling21MasterFrameMode(null);
          setHiggsfieldFrameMode(null);
          setWanFrameMode(null);
          setKlingO1ReferenceElementOpen(false);
          setCinema25ReferenceMode(null);
        }}
        defaultTab={assetsPickerTab}
        mode={
          isCinema25 && cinema25ReferenceMode
            ? cinema25ReferenceMode === "reference" ? "startFrame" : cinema25ReferenceMode
            : isKling3 && kling3ReferenceMode
            ? kling3ReferenceMode
            : isKling3Turbo
              ? "startFrame"
              : isVeo31Lite && veo31FrameMode
                ? veo31FrameMode
                : isMinimaxHailuo && minimaxFrameMode
                  ? minimaxFrameMode
                  : isKling3OmniEdit || isKlingO1VideoEdit
                    ? "videoReference"
                    : isKling3Omni && klingOmniFrameMode
                      ? klingOmniFrameMode
                      : isKling2_6 || isKling25TurboOr21 || isOpenAISora || isHappyHorse || isGrokImagine
                        ? "startFrame"
                        : isKlingO1Video && klingO1FrameMode
                          ? klingO1FrameMode
                          : isKling21Master && kling21MasterFrameMode
                            ? kling21MasterFrameMode
                            : isHiggsfield && higgsfieldFrameMode
                              ? higgsfieldFrameMode
                              : isWan && wanFrameMode
                                ? wanFrameMode
                                : isSeedanceProFast || isSeedanceProOrPro15
                                  ? "startFrame"
                                  : "default"
        }
        accept={
          isKling3Turbo || isVeo31Lite || isMinimaxHailuo
            ? "image/*"
            : isKling3OmniEdit || isKlingO1VideoEdit
              ? "video/*"
              : isSeedanceProFast || isSeedanceProOrPro15
                ? "image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif"
                : undefined
        }
        onSelectAsset={
          isCinema25 && cinema25ReferenceMode
            ? (url) => {
                const slotIndex = cinema25ReferenceMode === "reference" ? 0 : cinema25ReferenceMode === "startFrame" ? 1 : 2;
                props.onCinema25AssignReference(slotIndex, url);
              }
            : isKling3 && kling3ReferenceMode
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
                    : isKlingO1VideoEdit
                      ? (url) => setO1VideoEditVideoReference(url)
                      : isKling3Omni && klingOmniFrameMode
                        ? (url) =>
                            setKlingOmniFrames((s) =>
                              klingOmniFrameMode === "startFrame"
                                ? { ...s, startFrame: url }
                                : { ...s, endFrame: url },
                            )
                        : isKling2_6
                          ? (url) => setKling26StartFrame(url)
                          : isKling25TurboOr21
                            ? (url) => setKlingLegacyStartFrame(url)
                            : isOpenAISora
                              ? (url) => setSoraStartFrame(url)
                              : isHappyHorse
                                ? (url) => setHappyHorseStartFrame(url)
                                : isGrokImagine
                                  ? (url) => setGrokStartFrame(url)
                                  : isKlingO1Video && klingO1FrameMode
                              ? (url) =>
                                  setKlingO1Frames((s) =>
                                    klingO1FrameMode === "startFrame"
                                      ? { ...s, startFrame: url }
                                      : { ...s, endFrame: url },
                                  )
                              : isKling21Master && kling21MasterFrameMode
                                ? (url) =>
                                    setKling21MasterFrames((s) =>
                                      kling21MasterFrameMode === "startFrame"
                                        ? { ...s, startFrame: url }
                                        : { ...s, endFrame: url },
                                    )
                                : isHiggsfield && higgsfieldFrameMode
                                  ? (url) =>
                                      setHiggsfieldFrames((s) =>
                                        higgsfieldFrameMode === "startFrame"
                                          ? { ...s, startFrame: url }
                                          : { ...s, endFrame: url },
                                      )
                                  : isWan && wanFrameMode
                                    ? (url) =>
                                        setWanFrames((s) =>
                                          wanFrameMode === "startFrame"
                                            ? { ...s, startFrame: url }
                                            : { ...s, endFrame: url },
                                        )
                                    : isSeedanceProFast
                                      ? (url) => setSeedanceProFastStartFrame(url)
                                      : isSeedanceProOrPro15
                                        ? (url) =>
                                            setSeedanceProPanels((s) => ({
                                              ...s,
                                              [seedanceProModelKey]: {
                                                ...s[seedanceProModelKey],
                                                startFrame: url,
                                              },
                                            }))
                                        : undefined
        }
      />

      {/* Cinema Studio 2.5 — one shared Assets Picker for all five entry points
          (As Reference / As Start Frame / As End Frame + the Start/End Frame
          cards). The context decides the target slot: reference=0,
          startFrame=1, endFrame=2. */}
      <Cinema25AssetsPicker
        isOpen={cinema25PickerOpen}
        context={cinema25PickerContext}
        onClose={() => setCinema25PickerOpen(false)}
        onSelectAsset={(url) => {
          const slotIndex =
            cinema25PickerContext === "reference"
              ? 0
              : cinema25PickerContext === "startFrame"
                ? 1
                : 2;
          onCinema25AssignReference(slotIndex, url);
        }}
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

      <MotionPresetsPanel
        isOpen={motionPresetsPanelOpen}
        onClose={() => setMotionPresetsPanelOpen(false)}
        onSelectPreset={
          isSeedanceProFast
            ? (preset) => setSeedanceProFastPreset(preset)
            : isSeedanceProOrPro15
              ? (preset) =>
                  setSeedanceProPanels((s) => ({
                    ...s,
                    [seedanceProModelKey]: { ...s[seedanceProModelKey], preset },
                  }))
              : isCinema25
                ? (preset) => setCinema25GeneralPreset(preset)
                : () => {}
        }
        {...(isSeedanceProFast
          ? {
              categories: ["All", "UGC", "Viral", "Commercial", "Effects"],
              selectedPreset: seedanceProFastPreset,
            }
          : isSeedanceProOrPro15
            ? {
                categories: ["All", "UGC", "Viral", "Commercial", "Effects"],
                selectedPreset: seedanceProPanels[seedanceProModelKey].preset,
              }
            : {})}
      />

      {/* Kling 3.0 Motion Control Modals and Panels (LOCKED) */}
      {isKling3MotionControl && (
        <>
          <KlingMotionModal isOpen={motionModalOpen} onClose={() => setMotionModalOpen(false)} />
          <KlingCharacterPanel isOpen={characterPanelOpen} onClose={() => setCharacterPanelOpen(false)} />
        </>
      )}

      {/* Kling Motion Control (non-3.0) Modals and Panels — isolated instances */}
      {isKlingMotionControlNon3 && (
        <>
          <KlingMotionModal
            isOpen={klingMcMotionModalOpen}
            onClose={() => setKlingMcMotionModalOpen(false)}
          />
          <KlingCharacterPanel
            isOpen={klingMcCharacterPanelOpen}
            onClose={() => setKlingMcCharacterPanelOpen(false)}
          />
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
