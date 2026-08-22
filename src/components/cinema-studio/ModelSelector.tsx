"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as Popover from "@radix-ui/react-popover";
import {
  isOrchestrationModel,
  isProductionReadyModel,
} from "@/lib/orchestration/orchestration-models";
import {
  availabilityLabel,
  canOfferForGeneration,
  resolveRuntimeAvailability,
  type RuntimeAvailability,
} from "@/lib/orchestration/model-availability-client";
import { useModelAvailability } from "@/hooks/useModelAvailability";

/**
 * PHASE 8: may this model be offered as normally generatable?
 *
 * Reads RUNTIME availability, not the build artifact. The build catalog knows
 * whether a provider is durable — a deploy-time fact — but it cannot know that
 * an operator disabled the last safe route five minutes ago. Gating on it
 * alone was the defect this replaces: a model could read "ready" in the picker
 * while the server had already stopped accepting it.
 *
 * The decision itself lives in model-availability-client so the picker and the
 * Generate guard cannot drift apart. This component only asks.
 */
/**
 * Ids the picker lists as ordinary rows whatever the server currently says
 * about running them, so the catalog reads the way the reference's does.
 *
 * Display only, and only here. The generation boundary is untouched: press
 * Generate on one of these and useGeneration still refuses before any request
 * leaves the browser, and the server re-derives eligibility on its own. So
 * the row is selectable and looks normal, and nothing can actually run.
 */
const CATALOG_LISTED_IDS: ReadonlySet<string> = new Set([
  "nano-banana-pro",
  "nano-banana-2",
  "nano-banana-2-lite",
]);

function selectorAvailability(
  modelId: string,
  runtime: Map<string, boolean> | null
): RuntimeAvailability {
  if (CATALOG_LISTED_IDS.has(modelId)) return "available";
  return resolveRuntimeAvailability(modelId, {
    isServerModel: isOrchestrationModel(modelId),
    staticProductionReady: isProductionReadyModel(modelId),
    runtime,
  });
}

/*
 * History, because this has moved twice.
 *
 * A picker-only override for the three ids above used to live here and was
 * removed: it made the rows read as runnable, and the server refused them, so
 * the click failed after the fact instead of the row reading honestly.
 *
 * It is back, deliberately and narrowly, on an explicit request to have the
 * catalog list them as ordinary cards. What is different this time is that it
 * stops at display: the Generate path keeps its own resolution and refuses
 * these before any request is made, so no click can reach a provider that
 * would reject it. Making them genuinely runnable is still a change to the
 * execution path, not to this component.
 */
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Clock,
  Diamond,
  Film,
  Grid3x3,
  Search,
  Sparkles,
  Volume2,
} from "lucide-react";
import {
  IMAGE_MODEL_CATEGORIES,
  MODEL_CATEGORIES,
  getModel,
  type ModelBadge,
  type ModelInfo,
} from "./cinemaStudioData";

/** Seedance now renders via its real SVG component (not an `<img>` PNG), so
 * no per-icon zoom compensation is needed here anymore — kept as a no-op
 * passthrough since callers still pass a (path, base-className) pair. */
import { getSharedModelIcon } from "@/lib/modelIconRegistry";

function iconImgClassName(_iconPath: string, base: string) {
  return base;
}

/** Compact NEW/PREMIUM/EXCLUSIVE pill using the shared orange accent. */
function VersionBadge({ badge }: { badge: ModelBadge }) {
  return (
    <span
      className="shrink-0 rounded px-1 py-px text-sm font-bold uppercase leading-none tracking-wide text-black"
      style={{ backgroundColor: "#D97757" }}
    >
      {badge}
    </span>
  );
}

interface ModelSelectorProps {
  value: string;
  onChange: (id: string) => void;
  mode?: "image" | "video";
  portalContainer?: HTMLElement | null;
}

/** Location-pin icon (exact spec paths) for the image-mode model selector. */
function LocationPin({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <path
        d="M14.75 10C14.75 11.5188 13.5188 12.75 12 12.75C10.4812 12.75 9.25 11.5188 9.25 10C9.25 8.48122 10.4812 7.25 12 7.25C13.5188 7.25 14.75 8.48122 14.75 10Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M19.25 10C19.25 15.0279 14.2846 19.5366 12.5723 20.942C12.2349 21.2189 11.7651 21.2189 11.4277 20.942C9.7154 19.5366 4.75 15.0279 4.75 10C4.75 5.99594 7.99594 2.75 12 2.75C16.0041 2.75 19.25 5.99594 19.25 10Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const FROSTED =
  "rounded-2xl border border-[rgba(217,217,217,0.04)] bg-[rgba(35,38,42,0.75)] shadow-[0_4px_4px_rgba(0,0,0,0.12)] backdrop-blur [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0";

/** Alternate panel skin shown ONLY while Kling 3.0 Turbo is selected */
const KLING_TURBO_PANEL =
  "rounded-2xl border border-white/[0.06] bg-[rgba(20,20,20,0.95)] shadow-[0_24px_48px_rgba(0,0,0,0.4)] backdrop-blur-xl [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0";

type RowSkin = "default" | "klingTurbo";

/* ---------------------- Image-mode row ---------------------- */

function ImageRow({
  model,
  unavailableLabel,
  value,
  onSelect,
  focused,
  buttonRef,
  isContinuation,
}: {
  model: ModelInfo;
  /** Product-level label when the model may not be offered; null when it may. */
  unavailableLabel?: string | null;
  value: string;
  onSelect: (id: string) => void;
  focused?: boolean;
  buttonRef?: (el: HTMLButtonElement | null) => void;
  isContinuation?: boolean;
}) {
  const sharedIcon = getSharedModelIcon(model.name);
  const IconComponent = sharedIcon ?? (typeof model.icon === "function" ? model.icon : null);
  const iconPath = typeof model.icon === "string" ? model.icon : null;
  const active = model.id === value;
  // The orange bar, orange card and checkmark ride the keyboard focus; the
  // model itself still only changes on Enter/click.
  const marked = !!focused;

  return (
    <button
      ref={buttonRef}
      type="button"
      role="option"
      aria-selected={active}
      tabIndex={focused ? 0 : -1}
      onClick={() => onSelect(model.id)}
      aria-disabled={unavailableLabel ? true : undefined}
      className={`group/model-row relative w-full h-[56px] min-h-[56px] flex items-center px-2.5 py-2 rounded-[12px] text-start transition-all duration-200 ease-out cursor-pointer hover:translate-x-[2px] outline-none focus-visible:outline-none ${
        unavailableLabel ? "opacity-40" : ""
      } ${
        marked
          ? "bg-[rgba(217,119,87,0.08)] border border-[rgba(217,119,87,0.25)] shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
          : // Keyboard focus shows the same grey card as hover, so arrowing
            // through the list makes the current row visible.
            "bg-[rgba(255,255,255,0.025)] hover:bg-[rgba(255,255,255,0.055)] focus:bg-[rgba(255,255,255,0.055)] border border-white/[0.03] hover:border-white/[0.08] focus:border-white/[0.08]"
      }`}
    >
      {marked ? (
        <span
          aria-hidden
          className="w-[3px] h-7 rounded-full bg-[#D97757] shrink-0 mr-2"
        />
      ) : null}
      <div
        className={`relative size-10 rounded-[12px] p-[1.5px] shrink-0 transition-all duration-180 ease-out ${
          active || isContinuation
            ? "mr-2.5"
            : "group-hover/model-row:scale-[1.02] mr-3"
        }`}
        style={{
          background: "linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 50%, #D97757 50%, #D97757 100%)",
        }}
      >
        <div className="w-full h-full rounded-[10.5px] bg-[radial-gradient(ellipse_at_center,rgba(18,18,18,0.95)_0%,rgba(28,28,28,0.90)_100%)] flex items-center justify-center">
          {IconComponent ? (
            <IconComponent className="size-4.5 text-white" />
          ) : iconPath ? (
            <img src={iconPath} alt="" className="size-4.5 object-contain" />
          ) : (
            <Clapperboard className="size-4.5 text-white" />
          )}
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5 items-start">
        <span className={`truncate text-xs font-semibold ${active ? "text-white font-bold" : "text-white/90 group-hover/model-row:text-white"}`}>
          {model.name}
        </span>
        <p className="truncate text-[10px] font-normal text-white/45 group-hover/model-row:text-white/60">
          {/* Product language only. "Unavailable" is a product fact; which
              provider it would have used, and why that provider is not
              trusted, are not the browser's business. */}
          {unavailableLabel ?? model.description}
        </p>
      </div>
      <div className="size-5 shrink-0 flex items-center justify-center ml-1">
        {marked && <Check className="size-4 text-[#D97757]" />}
      </div>
    </button>
  );
}

/** Flat (directly-selectable) video row — Cinematic & Featured sections. */
function VideoFlatRow({
  model,
  unavailableLabel,
  value,
  onSelect,
  focused,
  buttonRef,
  isContinuation,
}: {
  model: ModelInfo;
  /** Product-level label when the model may not be offered; null when it may. */
  unavailableLabel?: string | null;
  value: string;
  onSelect: (id: string) => void;
  focused?: boolean;
  buttonRef?: (el: HTMLButtonElement | null) => void;
  skin?: RowSkin;
  isContinuation?: boolean;
}) {
  const Icon = typeof model.icon === "string" ? null : (model.icon ?? Clapperboard);
  const iconPath = typeof model.icon === "string" ? model.icon : null;
  const active = model.id === value;
  // The orange bar, orange card and checkmark ride the keyboard focus; the
  // model itself still only changes on Enter/click.
  const marked = !!focused;

  return (
    <button
      ref={buttonRef}
      type="button"
      role="option"
      aria-selected={active}
      tabIndex={focused ? 0 : -1}
      onClick={() => onSelect(model.id)}
      aria-disabled={unavailableLabel ? true : undefined}
      className={`group/model-row relative w-full h-[56px] min-h-[56px] flex items-center px-2.5 py-2 rounded-[12px] text-start transition-all duration-200 ease-out cursor-pointer hover:translate-x-[2px] outline-none focus-visible:outline-none ${
        unavailableLabel ? "opacity-40" : ""
      } ${
        marked
          ? "bg-[rgba(217,119,87,0.08)] border border-[rgba(217,119,87,0.25)] shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
          : // Keyboard focus shows the same grey card as hover, so arrowing
            // through the list makes the current row visible.
            "bg-[rgba(255,255,255,0.025)] hover:bg-[rgba(255,255,255,0.055)] focus:bg-[rgba(255,255,255,0.055)] border border-white/[0.03] hover:border-white/[0.08] focus:border-white/[0.08]"
      }`}
    >
      {marked ? (
        <span
          aria-hidden
          className="w-[3px] h-7 rounded-full bg-[#D97757] shrink-0 mr-2"
        />
      ) : null}
      <div
        className={`relative size-10 rounded-[12px] p-[1.5px] shrink-0 transition-all duration-180 ease-out ${
          active || isContinuation
            ? "mr-2.5"
            : "group-hover/model-row:scale-[1.02] mr-3"
        }`}
        style={{
          background: "linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 50%, #D97757 50%, #D97757 100%)",
        }}
      >
        <div className="w-full h-full rounded-[10.5px] bg-[radial-gradient(ellipse_at_center,rgba(18,18,18,0.95)_0%,rgba(28,28,28,0.90)_100%)] flex items-center justify-center">
          {iconPath ? (
            <img src={iconPath} alt="" className="size-4.5 object-contain" />
          ) : Icon ? (
            <Icon className="size-4.5 text-white" aria-hidden="true" />
          ) : (
            <Clapperboard className="size-4.5 text-white" />
          )}
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5 items-start">
        <div className="flex items-center gap-1.5">
          <span className={`truncate text-xs font-semibold ${active ? "text-white font-bold" : "text-white/90 group-hover/model-row:text-white"}`}>
            {model.name}
          </span>
          {model.sound && <Volume2 className="size-3 shrink-0 text-gray-400" />}
          {model.badges?.map((b) => <VersionBadge key={b} badge={b} />)}
        </div>
        {model.durationLabel ? (
          <span className="flex items-center gap-2 text-[10px] font-normal text-white/45 group-hover/model-row:text-white/60">
            {!model.hideResolution && (
              <span className="flex items-center gap-1">
                <Diamond className="size-3" />
                {model.resolutionLabel ?? model.resolution}
              </span>
            )}
            {!model.hideDuration && (
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {model.durationLabel}
              </span>
            )}
            {model.extraChips?.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </span>
        ) : model.description ? (
          <span className="block truncate text-[10px] font-normal text-white/45 group-hover/model-row:text-white/60">
            {model.description}
          </span>
        ) : null}
      </div>
      <div className="size-5 shrink-0 flex items-center justify-center ml-1">
        {marked && <Check className="size-4 text-[#D97757]" />}
      </div>
    </button>
  );
}

/* ---------------------- Video parent + flyout ---------------------- */

function VideoParentRow({
  model,
  value,
  onSelect,
  focused,
  buttonRef,
  keyboardOpen,
  activeSubIndex,
  onSubRefsChange,
  isContinuation,
}: {
  model: ModelInfo;
  value: string;
  onSelect: (id: string) => void;
  focused?: boolean;
  buttonRef?: (el: HTMLButtonElement | null) => void;
  keyboardOpen?: boolean;
  activeSubIndex?: number;
  onSubRefsChange?: (refs: (HTMLButtonElement | null)[]) => void;
  skin?: RowSkin;
  isContinuation?: boolean;
}) {
  const subs = model.submodels ?? [];
  const Icon = typeof model.icon === "string" ? null : (model.icon ?? Clapperboard);
  const iconPath = typeof model.icon === "string" ? model.icon : null;
  const active = model.id === value || subs.some((s) => s.id === value);
  const marked = !!focused;
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const openFlyout = () => {
    if (timer.current) clearTimeout(timer.current);
    const r = rowRef.current?.getBoundingClientRect();
    if (!r) return;
    const W = 280;
    let left = r.right + 4;
    if (left + W > window.innerWidth) left = r.left - W - 4;
    const estH = Math.min(500, subs.length * 52 + 8);
    const top = Math.max(8, Math.min(r.top, window.innerHeight - 8 - estH));
    setPos({ top, left });
  };
  const scheduleClose = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPos(null), 140);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Keyboard-driven open/close (ArrowRight/Enter to open, ArrowLeft/Escape to close).
  useEffect(() => {
    if (keyboardOpen) {
      openFlyout();
    } else if (timer.current || pos !== null) {
      if (timer.current) clearTimeout(timer.current);
      setPos(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyboardOpen]);

  const isOpen = pos !== null;

  useEffect(() => {
    if (isOpen) onSubRefsChange?.(subRefs.current);
  }, [isOpen, subs.length, onSubRefsChange]);

  return (
    <div
      onMouseEnter={openFlyout}
      onMouseLeave={() => {
        if (!keyboardOpen) scheduleClose();
      }}
    >
      <button
        ref={(el) => {
          rowRef.current = el;
          buttonRef?.(el);
        }}
        type="button"
        role="option"
        aria-selected={active}
        tabIndex={focused ? 0 : -1}
        onClick={openFlyout}
        className={`group/model-row relative w-full h-[56px] min-h-[56px] flex items-center px-2.5 py-2 rounded-[12px] text-start transition-all duration-180 ease-out cursor-pointer hover:translate-x-[2px] focus-visible:outline-none ${
          active
            ? "bg-[rgba(217,119,87,0.08)] border border-[rgba(217,119,87,0.25)] shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
            : "bg-[rgba(255,255,255,0.025)] hover:bg-[rgba(255,255,255,0.055)] border border-white/[0.03] hover:border-white/[0.08]"
        }`}
      >
        {active ? (
          <span
            aria-hidden
            className="w-[3px] h-7 rounded-full bg-[#D97757] shrink-0 mr-2"
          />
        ) : null}
        <div
          className={`relative size-10 rounded-[12px] p-[1.5px] shrink-0 transition-all duration-180 ease-out ${
            active || isContinuation
              ? "mr-2.5"
              : "group-hover/model-row:scale-[1.02] mr-3"
          }`}
          style={{
            background: "linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 50%, #D97757 50%, #D97757 100%)",
          }}
        >
          <div className="w-full h-full rounded-[10.5px] bg-[radial-gradient(ellipse_at_center,rgba(18,18,18,0.95)_0%,rgba(28,28,28,0.90)_100%)] flex items-center justify-center">
            {iconPath ? (
              <img src={iconPath} alt="" className="size-4.5 object-contain" />
            ) : Icon ? (
              <Icon className="size-4.5 text-white" aria-hidden="true" />
            ) : (
              <Clapperboard className="size-4.5 text-white" />
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-0.5 items-start">
          <span className={`truncate text-xs font-semibold ${active ? "text-white font-bold" : "text-white/90 group-hover/model-row:text-white"}`}>
            {model.name}
          </span>
          {model.description && (
            <span className="block truncate text-[10px] font-normal text-white/45 group-hover/model-row:text-white/60">
              {model.description}
            </span>
          )}
        </div>
        <ChevronRight className="size-4 shrink-0 text-white/50 group-hover/model-row:text-white ml-1" />
      </button>

      {isOpen &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            data-model-flyout
            role="listbox"
            aria-label={`${model.name} versions`}
            onMouseEnter={openFlyout}
            onMouseLeave={() => {
              if (!keyboardOpen) scheduleClose();
            }}
            className="fixed z-[100000] max-h-[500px] w-[280px] overflow-y-auto p-1 rounded-2xl border border-[rgba(217,217,217,0.04)] bg-[rgba(35,38,42,0.75)] shadow-[0_4px_4px_rgba(0,0,0,0.12)] backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ top: pos.top, left: pos.left }}
          >
            {subs.map((s, i) => {
              const sel = s.id === value;
              const subFocused = !!keyboardOpen && activeSubIndex === i;
              return (
                <button
                  key={s.id}
                  ref={(el) => {
                    subRefs.current[i] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  tabIndex={subFocused ? 0 : -1}
                  onClick={() => onSelect(s.id)}
                  className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/5 focus-visible:bg-white/5 focus:outline-none ${
                    sel ? "bg-white/5" : ""
                  }`}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`truncate text-xs font-medium ${
                          "text-white"
                        }`}
                      >
                        {s.name}
                      </span>
                      {s.sound && <Volume2 className="size-3 shrink-0 text-gray-400" />}
                      {s.badges?.map((b) => <VersionBadge key={b} badge={b} />)}
                    </span>
                    {s.description ? (
                      <span className="mt-0.5 block truncate text-[10px] font-normal text-gray-400">
                        {s.description}
                      </span>
                    ) : (
                      <span className="mt-0.5 flex items-center gap-2 text-[10px] font-normal text-gray-400">
                        {!s.hideResolution && (
                          <span className="flex items-center gap-1">
                            <Diamond className="size-3" />
                            {s.resolutionLabel ?? s.resolution}
                          </span>
                        )}
                        {!s.hideDuration && (
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />
                            {s.durationLabel ?? `${s.durations[0]}s`}
                          </span>
                        )}
                        {s.extraChips?.map((c) => (
                          <span key={c}>{c}</span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {sel && <Check className="size-4 text-[#D97757]" />}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ---------------------- Selector ---------------------- */

/** One flattened, keyboard-navigable top-level entry (mirrors render order). */
type FlatEntry = { model: ModelInfo; isParent: boolean };

export default function ModelSelector({
  value,
  onChange,
  mode = "video",
  portalContainer,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = getModel(value);
  const isImage = mode === "image";
  const source = isImage ? IMAGE_MODEL_CATEGORIES : MODEL_CATEGORIES;
  const FallbackTriggerIcon = isImage ? LocationPin : Clapperboard;
  const sharedTriggerIcon = getSharedModelIcon(selected.name);
  const SelectedIcon =
    sharedTriggerIcon ??
    (typeof selected.icon === "function" ? selected.icon : FallbackTriggerIcon);
  const triggerIconPath = typeof selected.icon === "string" ? selected.icon : null;

  // Alternate skin shown ONLY while Kling 3.0 Turbo is the selected model —
  // every other model keeps the standard look above.
  const isKlingTurboSkin = !isImage && value === "kling-3.0-turbo";
  const rowSkin: RowSkin = isKlingTurboSkin ? "klingTurbo" : "default";

  // Roving keyboard focus state.
  const [activeIndex, setActiveIndex] = useState(0);
  const [openParentIndex, setOpenParentIndex] = useState<number | null>(null);
  const [activeSubIndex, setActiveSubIndex] = useState(0);
  const [subRowRefs, setSubRowRefs] = useState<(HTMLButtonElement | null)[]>([]);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Runtime production availability, fetched once and shared with the Generate
  // guard through the module cache. Null until it resolves, which reads as
  // "checking" — never as available.
  const runtimeAvailability = useModelAvailability();

  const select = (id: string) => {
    // A model the server will refuse must not become the active selection —
    // otherwise Generate looks normal and fails at the boundary. "checking"
    // is not permission: unresolved runtime data means we have not heard yes.
    if (!canOfferForGeneration(selectorAvailability(id, runtimeAvailability))) return;
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  useEffect(() => {
    if (open && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [open]);

  const categories = useMemo(() => {
    const q = query.trim().toLowerCase();
    // The list keeps its canonical order whatever is selected — the selected
    // row is marked with a checkmark and the orange card, it does not move.
    if (!q) return source;

    const match = (m: ModelInfo) =>
      m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q);

    return source
      .map((c) => ({
        ...c,
        models: c.models.filter((m) => match(m) || m.submodels?.some(match)),
      }))
      .filter((c) => c.models.length > 0);
  }, [query, source, value]);

  /** Flat, top-to-bottom list of every rendered row — used for Up/Down/Right/Enter. */
  const flatEntries = useMemo<FlatEntry[]>(() => {
    const entries: FlatEntry[] = [];
    categories.forEach((cat) => {
      cat.models.forEach((m) => {
        entries.push({ model: m, isParent: !isImage && !!m.submodels?.length });
      });
    });
    return entries;
  }, [categories, isImage]);

  /** model.id -> position in flatEntries, mirroring the render order below. */
  const flatIndexById = useMemo(() => {
    const map = new Map<string, number>();
    flatEntries.forEach((entry, i) => map.set(entry.model.id, i));
    return map;
  }, [flatEntries]);

  // Reset roving focus whenever the popover opens or the filtered list changes.
  // (Adjusting state during render, per React's guidance, instead of in an effect —
  // avoids an extra commit-then-re-render cascade.)
  const [prevResetKey, setPrevResetKey] = useState({ query, open });
  if (prevResetKey.query !== query || prevResetKey.open !== open) {
    setPrevResetKey({ query, open });
    // Start the marker on the model that is actually selected, so opening the
    // panel doesn't jump the orange bar to the first row.
    setActiveIndex(open && !query ? (flatIndexById.get(value) ?? 0) : 0);
    setOpenParentIndex(null);
    setActiveSubIndex(0);
  }

  // Keep real DOM focus in sync with the roving top-level index.
  useEffect(() => {
    if (open && openParentIndex === null) {
      rowRefs.current[activeIndex]?.focus();
    }
  }, [activeIndex, openParentIndex, open]);

  // Keep real DOM focus in sync with the roving submenu index.
  useEffect(() => {
    if (openParentIndex !== null) {
      subRowRefs[activeSubIndex]?.focus();
    }
  }, [activeSubIndex, subRowRefs, openParentIndex]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const inSearchInput = e.target === searchInputRef.current;

    if (e.key === "Escape") {
      if (openParentIndex !== null) {
        e.preventDefault();
        e.stopPropagation();
        const returnTo = openParentIndex;
        setOpenParentIndex(null);
        requestAnimationFrame(() => rowRefs.current[returnTo]?.focus());
      }
      // Otherwise let Radix's own Escape-closes-popover behavior run.
      return;
    }

    // Typing while a row (or submenu row) holds focus hands the keystroke
    // back to the search box, so arrowing into the list to peek at results
    // never costs a click to resume the query.
    if (!inSearchInput) {
      const printable =
        e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (printable || e.key === "Backspace") {
        e.preventDefault();
        searchInputRef.current?.focus();
        setQuery((q) => (printable ? q + e.key : q.slice(0, -1)));
        return;
      }
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (openParentIndex !== null) {
        const len = flatEntries[openParentIndex]?.model.submodels?.length ?? 0;
        setActiveSubIndex((i) => Math.min(len - 1, i + 1));
      } else if (inSearchInput) {
        // Handing off from the search box targets row 0, which is usually
        // already activeIndex — setState would bail out and the focus effect
        // would never re-run, so move focus directly instead.
        rowRefs.current[activeIndex]?.focus();
      } else {
        setActiveIndex((i) => Math.min(flatEntries.length - 1, i + 1));
      }
      return;
    }

    if (e.key === "ArrowUp") {
      if (inSearchInput) return;
      e.preventDefault();
      if (openParentIndex !== null) {
        setActiveSubIndex((i) => Math.max(0, i - 1));
      } else {
        setActiveIndex((i) => Math.max(0, i - 1));
      }
      return;
    }

    if (e.key === "ArrowRight") {
      if (inSearchInput || openParentIndex !== null) return;
      const entry = flatEntries[activeIndex];
      if (entry?.isParent) {
        e.preventDefault();
        setOpenParentIndex(activeIndex);
        setActiveSubIndex(0);
      }
      return;
    }

    if (e.key === "ArrowLeft") {
      if (inSearchInput) return;
      if (openParentIndex !== null) {
        e.preventDefault();
        const returnTo = openParentIndex;
        setOpenParentIndex(null);
        requestAnimationFrame(() => rowRefs.current[returnTo]?.focus());
      }
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      if (inSearchInput) return;
      e.preventDefault();
      if (openParentIndex !== null) {
        const sub = flatEntries[openParentIndex]?.model.submodels?.[activeSubIndex];
        if (sub) select(sub.id);
      } else {
        const entry = flatEntries[activeIndex];
        if (!entry) return;
        if (entry.isParent) {
          setOpenParentIndex(activeIndex);
          setActiveSubIndex(0);
        } else {
          select(entry.model.id);
        }
      }
    }
  };

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          {isKlingTurboSkin ? (
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-label={`Model: ${selected.name}`}
              className="flex h-7 items-center gap-1.5 rounded-full bg-[rgba(4,4,5,0.98)] px-2 py-1 transition-all duration-150 hover:brightness-150 focus:outline-none"
            >
              {triggerIconPath ? (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded bg-[rgba(4,4,5,0.98)]">
                  <img
                    src={triggerIconPath}
                    alt=""
                    className={iconImgClassName(triggerIconPath, "h-5 w-5 object-cover")}
                  />
                </span>
              ) : (
                <SelectedIcon className="h-5 w-5 shrink-0" style={{ color: "#D97757" }} aria-hidden="true" />
              )}
              <span
                className={`max-w-[140px] truncate text-xs font-semibold ${
                  "text-white"
                }`}
              >
                {selected.name}
              </span>
            </button>
          ) : (
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-label={`Model: ${selected.name}`}
              className={`flex h-8 items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out focus:outline-none ${
                open
                  ? "border-[#D97757] bg-[rgba(17,17,18,0.98)]"
                  : "border-white/15 bg-[rgba(18,19,21,0.95)] hover:border-white/30 hover:bg-[rgba(26,28,31,0.98)]"
              }`}
            >
              {triggerIconPath ? (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded bg-[rgba(4,4,5,0.98)]">
                  <img
                    src={triggerIconPath}
                    alt=""
                    className={iconImgClassName(triggerIconPath, "h-5 w-5 object-cover")}
                  />
                </span>
              ) : (
                <SelectedIcon className="h-5 w-5 shrink-0" style={{ color: "#D97757" }} aria-hidden="true" />
              )}
              <span
                className={`max-w-[140px] truncate ${
                  "text-white"
                }`}
              >
                {selected.name}
              </span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ease-out ${open ? "rotate-180 text-[#D97757]" : "text-neutral-400"}`} />
            </button>
          )}
        </Popover.Trigger>
        <Popover.Portal container={portalContainer}>
          <Popover.Content
            side="top"
            align="start"
            sideOffset={8}
            collisionPadding={16}
            onKeyDown={handleKeyDown}
            className="outline-none z-[100000] rounded-2xl border border-white/10 bg-[#141618]/95 shadow-[0_16px_48px_rgba(0,0,0,0.65)] backdrop-blur-xl flex flex-col pointer-events-auto transition-all duration-200 ease-out origin-bottom data-[state=open]:animate-popover-smooth-in data-[state=closed]:animate-popover-smooth-out"
          >
            <div className="relative rounded-2xl flex flex-col overflow-hidden w-96 max-w-[calc(100vw-32px)] h-[520px] max-h-[var(--radix-popover-content-available-height,520px)]">
              {/* Search Header Container (Glass Field matching screenshot) */}
              <div className="relative z-10 p-2.5 pb-1">
                <div className="group/search flex h-[38px] items-center gap-2.5 rounded-xl border border-[rgba(217,119,87,0.40)] bg-white/[0.035] px-3 transition-all duration-200 focus-within:border-[#D97757] focus-within:bg-white/[0.06]">
                  <Search className="size-4 shrink-0 text-[#D97757]" />
                  <input
                    ref={searchInputRef}
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search models..."
                    aria-label="Search models"
                    className="w-full bg-transparent text-xs font-medium text-white placeholder:text-white/35 outline-none"
                  />
                </div>
              </div>

              {/* Internal scroll area */}
              <div
                ref={scrollContainerRef}
                className="relative z-10 flex-1 min-h-0 overflow-y-auto p-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0"
                role="listbox"
                aria-label="AI models"
                onWheel={(e) => e.stopPropagation()}
              >
                {categories.length === 0 && (
                  <p className="px-2 py-6 text-center text-xs text-neutral-500">
                    No models match &quot;{query}&quot;.
                  </p>
                )}
                {categories.map((cat, catIdx) => {
                  const isAll = cat.label.toLowerCase().includes("all");
                  return (
                    <div key={`${cat.label}-${catIdx}`} className="mb-2">
                      <p className="flex items-center gap-1.5 px-3 pt-2 pb-2 text-xs font-medium text-gray-400">
                        {isAll ? (
                          <svg
                            aria-hidden="true"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            className="size-3.5 text-white/40 shrink-0"
                          >
                            <path
                              d="M14.25 6.75C13.0074 6.75 12 7.75736 12 9C12 10.2426 13.0074 11.25 14.25 11.25C15.4926 11.25 16.5 10.2426 16.5 9C16.5 7.75736 15.4926 6.75 14.25 6.75Z"
                              fill="currentColor"
                            />
                            <path
                              fillRule="evenodd"
                              clipRule="evenodd"
                              d="M3 4.75C3 3.7835 3.7835 3 4.75 3H19.25C20.2165 3 21 3.7835 21 4.75V19.25C21 20.2165 20.2165 21 19.25 21H4.75C3.7835 21 3 20.2165 3 19.25V4.75ZM19.5 18.4394L14.8839 13.8232C14.3957 13.3351 13.6043 13.3351 13.1161 13.8232L12.1768 14.7626C12.0791 14.8602 11.9209 14.8602 11.8232 14.7626L8.87333 11.8127C8.3956 11.3349 7.62472 11.3233 7.13274 11.7863L4.5 14.2642V4.75C4.5 4.61193 4.61193 4.5 4.75 4.5H19.25C19.3881 4.5 19.5 4.61193 19.5 4.75V18.4394Z"
                              fill="currentColor"
                            />
                          </svg>
                        ) : (
                          <svg
                            aria-hidden="true"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            className="size-3.5 text-white/40 shrink-0"
                          >
                            <path
                              d="M12.7368 2.60967C12.6694 2.25593 12.3601 2 12 2C11.6399 2 11.3306 2.25593 11.2632 2.60967C10.7844 5.12353 9.83969 7.03715 8.43842 8.43842C7.03715 9.83969 5.12353 10.7844 2.60967 11.2632C2.25593 11.3306 2 11.6399 2 12C2 12.3601 2.25593 12.6694 2.60967 12.7368C5.12353 13.2156 7.03715 14.1603 8.43842 15.5616C9.83969 16.9629 10.7844 18.8765 11.2632 21.3903C11.3306 21.7441 11.6399 22 12 22C12.3601 22 12.6694 21.7441 12.7368 21.3903C13.2156 18.8765 14.1603 16.9629 15.5616 15.5616C16.9629 14.1603 18.8765 13.2156 21.3903 12.7368C21.7441 12.6694 22 12.3601 22 12C22 11.6399 21.7441 11.3306 21.3903 11.2632C18.8765 10.7844 16.9629 9.83969 15.5616 8.43842C14.1603 7.03715 13.2156 5.12353 12.7368 2.60967Z"
                              fill="currentColor"
                            />
                          </svg>
                        )}
                        {cat.label}
                      </p>
                    <div className="space-y-1">
                      {cat.models.map((m, i) => {
                        const key = `${m.id}-${i}`;
                        const entryIndex = flatIndexById.get(m.id) ?? 0;
                        const focused = open && openParentIndex === null && activeIndex === entryIndex;
                        const isContinuation = !query.trim() && entryIndex === 1;
                        const registerRef = (el: HTMLButtonElement | null) => {
                          rowRefs.current[entryIndex] = el;
                        };

                        if (isImage)
                          return (
                            <ImageRow
                              key={key}
                              model={m}
                              unavailableLabel={availabilityLabel(
                                selectorAvailability(m.id, runtimeAvailability)
                              )}
                              value={value}
                              onSelect={select}
                              focused={focused}
                              buttonRef={registerRef}
                              isContinuation={isContinuation}
                            />
                          );
                        return m.submodels?.length ? (
                          <VideoParentRow
                            key={key}
                            model={m}
                            value={value}
                            onSelect={select}
                            focused={focused}
                            buttonRef={registerRef}
                            keyboardOpen={openParentIndex === entryIndex}
                            activeSubIndex={activeSubIndex}
                            onSubRefsChange={setSubRowRefs}
                            skin={rowSkin}
                            isContinuation={isContinuation}
                          />
                        ) : (
                          <VideoFlatRow
                            key={key}
                            model={m}
                            unavailableLabel={availabilityLabel(
                              selectorAvailability(m.id, runtimeAvailability)
                            )}
                            value={value}
                            onSelect={select}
                            focused={focused}
                            buttonRef={registerRef}
                            skin={rowSkin}
                            isContinuation={isContinuation}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
