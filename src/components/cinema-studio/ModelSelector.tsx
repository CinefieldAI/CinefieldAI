"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as Popover from "@radix-ui/react-popover";
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
  value,
  onSelect,
  focused,
  buttonRef,
}: {
  model: ModelInfo;
  value: string;
  onSelect: (id: string) => void;
  focused?: boolean;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}) {
  const sharedIcon = getSharedModelIcon(model.name);
  const IconComponent = sharedIcon ?? (typeof model.icon === "function" ? model.icon : null);
  const iconPath = typeof model.icon === "string" ? model.icon : null;
  const active = model.id === value;

  return (
    <button
      ref={buttonRef}
      type="button"
      role="option"
      aria-selected={active}
      tabIndex={focused ? 0 : -1}
      onClick={() => onSelect(model.id)}
      className={`group/model-row relative w-full h-[56px] min-h-[56px] flex items-center px-2.5 py-2 rounded-[12px] text-start transition-all duration-180 ease-out cursor-pointer hover:translate-x-[2px] focus-visible:outline-none ${
        active
          ? "bg-[rgba(217,119,87,0.08)] border border-[rgba(217,119,87,0.25)] shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
          : "bg-[rgba(255,255,255,0.025)] hover:bg-[rgba(255,255,255,0.055)] border border-white/[0.03] hover:border-white/[0.08]"
      }`}
    >
      {active && (
        <span
          aria-hidden
          className="w-[3px] h-7 rounded-full bg-[#D97757] shrink-0 mr-2 shadow-[0_0_8px_rgba(217,119,87,0.8)]"
        />
      )}
      <div
        className={`relative size-10 rounded-[12px] p-[1.5px] shrink-0 transition-all duration-180 ease-out ${
          active
            ? "shadow-[0_-4px_14px_rgba(255,255,255,0.70),0_5px_18px_rgba(217,119,87,0.90)] mr-2.5"
            : "shadow-[0_-2px_6px_rgba(255,255,255,0.30),0_3px_8px_rgba(217,119,87,0.40)] group-hover/model-row:shadow-[0_-3px_10px_rgba(255,255,255,0.50),0_4px_14px_rgba(217,119,87,0.65)] group-hover/model-row:scale-[1.02] mr-3"
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
          {model.description}
        </p>
      </div>
      <div className="size-5 shrink-0 flex items-center justify-center ml-1">
        {active && <Check className="size-4 text-[#D97757] drop-shadow-[0_0_6px_rgba(217,119,87,0.6)]" />}
      </div>
    </button>
  );
}

/** Flat (directly-selectable) video row — Cinematic & Featured sections. */
function VideoFlatRow({
  model,
  value,
  onSelect,
  focused,
  buttonRef,
}: {
  model: ModelInfo;
  value: string;
  onSelect: (id: string) => void;
  focused?: boolean;
  buttonRef?: (el: HTMLButtonElement | null) => void;
  skin?: RowSkin;
}) {
  const Icon = typeof model.icon === "string" ? null : (model.icon ?? Clapperboard);
  const iconPath = typeof model.icon === "string" ? model.icon : null;
  const active = model.id === value;

  return (
    <button
      ref={buttonRef}
      type="button"
      role="option"
      aria-selected={active}
      tabIndex={focused ? 0 : -1}
      onClick={() => onSelect(model.id)}
      className={`group/model-row relative w-full h-[56px] min-h-[56px] flex items-center px-2.5 py-2 rounded-[12px] text-start transition-all duration-180 ease-out cursor-pointer hover:translate-x-[2px] focus-visible:outline-none ${
        active
          ? "bg-[rgba(217,119,87,0.08)] border border-[rgba(217,119,87,0.25)] shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
          : "bg-[rgba(255,255,255,0.025)] hover:bg-[rgba(255,255,255,0.055)] border border-white/[0.03] hover:border-white/[0.08]"
      }`}
    >
      {active && (
        <span
          aria-hidden
          className="w-[3px] h-7 rounded-full bg-[#D97757] shrink-0 mr-2 shadow-[0_0_8px_rgba(217,119,87,0.8)]"
        />
      )}
      <div
        className={`relative size-10 rounded-[12px] p-[1.5px] shrink-0 transition-all duration-180 ease-out ${
          active
            ? "shadow-[0_-4px_14px_rgba(255,255,255,0.70),0_5px_18px_rgba(217,119,87,0.90)] mr-2.5"
            : "shadow-[0_-2px_6px_rgba(255,255,255,0.30),0_3px_8px_rgba(217,119,87,0.40)] group-hover/model-row:shadow-[0_-3px_10px_rgba(255,255,255,0.50),0_4px_14px_rgba(217,119,87,0.65)] group-hover/model-row:scale-[1.02] mr-3"
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
            <span className="flex items-center gap-1">
              <Diamond className="size-3" />
              {model.resolution}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {model.durationLabel}
            </span>
          </span>
        ) : model.description ? (
          <span className="block truncate text-[10px] font-normal text-white/45 group-hover/model-row:text-white/60">
            {model.description}
          </span>
        ) : null}
      </div>
      <div className="size-5 shrink-0 flex items-center justify-center ml-1">
        {active && <Check className="size-4 text-[#D97757] drop-shadow-[0_0_6px_rgba(217,119,87,0.6)]" />}
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
}) {
  const subs = model.submodels ?? [];
  const Icon = typeof model.icon === "string" ? null : (model.icon ?? Clapperboard);
  const iconPath = typeof model.icon === "string" ? model.icon : null;
  const active = model.id === value || subs.some((s) => s.id === value);
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
        {active && (
          <span
            aria-hidden
            className="w-[3px] h-7 rounded-full bg-[#D97757] shrink-0 mr-2 shadow-[0_0_8px_rgba(217,119,87,0.8)]"
          />
        )}
        <div
          className={`relative size-10 rounded-[12px] p-[1.5px] shrink-0 transition-all duration-180 ease-out ${
            active
              ? "shadow-[0_-4px_14px_rgba(255,255,255,0.70),0_5px_18px_rgba(217,119,87,0.90)] mr-2.5"
              : "shadow-[0_-2px_6px_rgba(255,255,255,0.30),0_3px_8px_rgba(217,119,87,0.40)] group-hover/model-row:shadow-[0_-3px_10px_rgba(255,255,255,0.50),0_4px_14px_rgba(217,119,87,0.65)] group-hover/model-row:scale-[1.02] mr-3"
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
                      <span className="truncate text-xs font-medium text-white">
                        {s.name}
                      </span>
                      {s.sound && <Volume2 className="size-3 shrink-0 text-gray-400" />}
                      {s.badges?.map((b) => <VersionBadge key={b} badge={b} />)}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-[10px] font-normal text-gray-400">
                      <span className="flex items-center gap-1">
                        <Diamond className="size-3" />
                        {s.resolution}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        {s.durationLabel ?? `${s.durations[0]}s`}
                      </span>
                    </span>
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

  const select = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  const categories = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return source;
    const match = (m: ModelInfo) =>
      m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q);
    return source
      .map((c) => ({
        ...c,
        models: c.models.filter((m) => match(m) || m.submodels?.some(match)),
      }))
      .filter((c) => c.models.length > 0);
  }, [query, source]);

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
    setActiveIndex(0);
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

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (openParentIndex !== null) {
        const len = flatEntries[openParentIndex]?.model.submodels?.length ?? 0;
        setActiveSubIndex((i) => Math.min(len - 1, i + 1));
      } else {
        setActiveIndex((i) => Math.min(flatEntries.length - 1, (inSearchInput ? -1 : i) + 1));
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
              className="flex h-7 items-center gap-1.5 rounded-full bg-white/[0.06] px-2 py-1 transition-all duration-150 hover:brightness-150 focus:outline-none focus:ring-2 focus:ring-[#D97757]"
            >
              {triggerIconPath ? (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden">
                  <img
                    src={triggerIconPath}
                    alt=""
                    className={iconImgClassName(triggerIconPath, "h-5 w-5 object-cover")}
                  />
                </span>
              ) : (
                <SelectedIcon className="h-5 w-5" style={{ color: "#D97757" }} aria-hidden="true" />
              )}
              <span className="max-w-[140px] truncate text-xs font-semibold text-white">
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
                  ? "border-[#D97757] bg-[#181a1d] shadow-[0_0_12px_rgba(217,119,87,0.40)]"
                  : "border-[rgba(217,119,87,0.45)] bg-[#101112] hover:border-[#D97757] hover:bg-[#181a1d]"
              }`}
            >
              {triggerIconPath ? (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden">
                  <img
                    src={triggerIconPath}
                    alt=""
                    className={iconImgClassName(triggerIconPath, "h-5 w-5 object-cover")}
                  />
                </span>
              ) : (
                <SelectedIcon className="h-5 w-5" style={{ color: "#D97757" }} aria-hidden="true" />
              )}
              <span className="max-w-[140px] truncate text-white">
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
                <div className="group/search flex h-[38px] items-center gap-2.5 rounded-xl border border-[rgba(217,119,87,0.40)] bg-white/[0.035] px-3 transition-all duration-200 focus-within:border-[#D97757] focus-within:bg-white/[0.06] focus-within:shadow-[0_0_12px_rgba(217,119,87,0.30)]">
                  <Search className="size-4 shrink-0 text-[#D97757] drop-shadow-[0_0_5px_rgba(217,119,87,0.5)]" />
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
                className="relative z-10 flex-1 min-h-0 overflow-y-auto p-2 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.18)_transparent]"
                role="listbox"
                aria-label="AI models"
                onWheel={(e) => e.stopPropagation()}
              >
                {categories.length === 0 && (
                  <p className="px-2 py-6 text-center text-xs text-neutral-500">
                    No models match &quot;{query}&quot;.
                  </p>
                )}
                {categories.map((cat) => (
                  <div key={cat.label} className="mb-2">
                    <p className="flex items-center gap-1.5 px-3 pt-2 pb-2 text-xs font-medium text-gray-400">
                      {isKlingTurboSkin ? (
                        cat.label === "All models" ? (
                          <Grid3x3 className="size-3" />
                        ) : (
                          <Diamond className="size-3" />
                        )
                      ) : isImage || cat.label !== "All models" ? (
                        <Sparkles className="size-3" />
                      ) : (
                        <Film className="size-3" />
                      )}
                      {cat.label}
                    </p>
                    <div className="space-y-1">
                      {cat.models.map((m, i) => {
                        const key = `${m.id}-${i}`;
                        const entryIndex = flatIndexById.get(m.id) ?? 0;
                        const focused = open && openParentIndex === null && activeIndex === entryIndex;
                        const registerRef = (el: HTMLButtonElement | null) => {
                          rowRefs.current[entryIndex] = el;
                        };

                        if (isImage)
                          return (
                            <ImageRow
                              key={key}
                              model={m}
                              value={value}
                              onSelect={select}
                              focused={focused}
                              buttonRef={registerRef}
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
                          />
                        ) : (
                          <VideoFlatRow
                            key={key}
                            model={m}
                            value={value}
                            onSelect={select}
                            focused={focused}
                            buttonRef={registerRef}
                            skin={rowSkin}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
