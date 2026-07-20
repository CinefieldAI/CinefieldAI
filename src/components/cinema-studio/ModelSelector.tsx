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
  SEEDANCE_ICON,
  getModel,
  type ModelBadge,
  type ModelInfo,
} from "./cinemaStudioData";

/** The Seedance PNG has more transparent margin baked in than the other model
 * icons, so it renders visibly smaller at the shared icon size — zoom it in
 * specifically rather than resizing every model's icon. */
function iconImgClassName(iconPath: string, base: string) {
  return iconPath === SEEDANCE_ICON ? `${base} scale-150` : base;
}

/** Compact NEW/PREMIUM/EXCLUSIVE pill — reuses the app's existing lime accent (#D1FE17). */
function VersionBadge({ badge }: { badge: ModelBadge }) {
  return (
    <span
      className="shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase leading-none tracking-wide text-black"
      style={{ backgroundColor: "#D1FE17" }}
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
  "rounded-2xl border border-[rgba(217,217,217,0.08)] bg-[rgba(24,26,30,0.92)] shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-[24px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/**
 * Alternate panel skin shown ONLY while Kling 3.0 Turbo is the selected model
 * (per explicit request — every other model keeps the standard FROSTED look).
 */
const KLING_TURBO_PANEL =
  "rounded-2xl border border-white/[0.06] bg-[rgba(20,20,20,0.95)] shadow-[0_24px_48px_rgba(0,0,0,0.4)] backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** Roving-focus ring shown when a row is keyboard-active (distinct from the "selected model" state). */
const FOCUS_RING = "ring-2 ring-[#00e5ff]";

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
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-200 ease-out focus:outline-none ${
        active ? "bg-white/5" : "hover:bg-white/5"
      } ${focused ? FOCUS_RING : ""}`}
    >
      <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5 text-white">
        {iconPath ? (
          <img src={iconPath} alt="" className={iconImgClassName(iconPath, "size-10 object-cover")} />
        ) : (
          Icon && <Icon className="size-10" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-white">{model.name}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-gray-400">
          {model.description}
        </span>
      </span>
      {active && <Check className="size-4 shrink-0 text-white" />}
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
  skin = "default",
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
  const isKT = skin === "klingTurbo";

  return (
    <button
      ref={buttonRef}
      type="button"
      role="option"
      aria-selected={active}
      tabIndex={focused ? 0 : -1}
      onClick={() => onSelect(model.id)}
      className={`flex w-full items-center gap-3 rounded-lg text-left transition-all duration-100 ease-out focus:outline-none ${
        isKT
          ? `py-2.5 pr-3.5 ${active ? "border-l-2 border-l-[#d1fe17] bg-white/[0.08] pl-3" : "border-l-2 border-l-transparent pl-3 hover:bg-white/5"}`
          : `border px-3 py-2.5 ${active ? "border-white/20 bg-white/10" : "border-transparent hover:bg-white/5"}`
      } ${focused ? FOCUS_RING : ""}`}
    >
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5 text-white">
        {iconPath ? (
          <img src={iconPath} alt="" className={iconImgClassName(iconPath, "size-6 object-cover")} />
        ) : (
          Icon && <Icon className="size-6" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-white">{model.name}</span>
          {model.sound && <Volume2 className="size-3 shrink-0 text-gray-400" />}
          {model.badges?.map((b) => <VersionBadge key={b} badge={b} />)}
        </span>
        {model.durationLabel ? (
          <span className="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
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
          <span className="mt-0.5 block truncate text-xs text-gray-400">
            {model.description}
          </span>
        ) : null}
      </span>
      {active && <Check className="size-4 shrink-0" style={{ color: "#D1FE17" }} />}
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
  skin = "default",
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
  const isKT = skin === "klingTurbo";
  const subs = model.submodels ?? [];
  const Icon = typeof model.icon === "string" ? null : (model.icon ?? Clapperboard);
  const iconPath = typeof model.icon === "string" ? model.icon : null;
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
        aria-selected={false}
        tabIndex={focused ? 0 : -1}
        onClick={openFlyout}
        className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-left transition-all duration-200 ease-out hover:bg-white/5 focus:outline-none ${
          focused ? FOCUS_RING : ""
        }`}
      >
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5 text-white">
          {iconPath ? (
            <img src={iconPath} alt="" className={iconImgClassName(iconPath, "size-6 object-cover")} />
          ) : (
            Icon && <Icon className="size-6" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-white">{model.name}</span>
          </span>
          {model.description && (
            <span className="mt-0.5 block truncate text-xs text-gray-400">
              {model.description}
            </span>
          )}
        </span>
        <ChevronRight className="size-4 shrink-0 text-gray-400" />
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
            className={`fixed z-[100000] max-h-[500px] w-[280px] overflow-y-auto p-1 ${isKT ? KLING_TURBO_PANEL : FROSTED}`}
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
                  className={`flex w-full items-center justify-between gap-2 rounded-lg text-left transition-all duration-100 ${
                    isKT
                      ? `py-2.5 pr-3.5 ${sel ? "border-l-2 border-l-[#d1fe17] bg-white/[0.08] pl-3" : "border-l-2 border-l-transparent pl-3 hover:bg-white/5"}`
                      : `border px-3 py-2.5 ${sel ? "border-white/20 bg-white/10" : "border-transparent hover:bg-white/5"}`
                  } ${subFocused ? FOCUS_RING : ""}`}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-white">
                        {s.name}
                      </span>
                      {s.sound && <Volume2 className="size-3 shrink-0 text-gray-400" />}
                      {s.badges?.map((b) => <VersionBadge key={b} badge={b} />)}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
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
                    {sel && <Check className="size-4" style={{ color: "#D1FE17" }} />}
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
  const accent = isImage ? "#D1FE17" : "#00e5ff";
  const TriggerIcon = isImage ? LocationPin : Clapperboard;
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
              className="flex h-7 items-center gap-1.5 rounded-full bg-white/[0.06] px-2 py-1 transition-all duration-150 hover:brightness-150 focus:outline-none focus:ring-2 focus:ring-[#d1fe17]"
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
                <TriggerIcon className="h-5 w-5" style={{ color: "#d1fe17" }} />
              )}
              <span
                className="max-w-[140px] truncate text-xs font-semibold"
                style={{ color: "rgb(209, 254, 23)" }}
              >
                {selected.name}
              </span>
            </button>
          ) : (
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={open}
              className="flex h-9 items-center gap-2 rounded-lg bg-card px-2 py-1 text-xs font-medium text-white transition-all duration-200 ease-out hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#00e5ff]"
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
                <TriggerIcon className="h-5 w-5" style={{ color: accent }} />
              )}
              <span className="max-w-[140px] truncate" style={{ color: accent }}>
                {selected.name}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
            </button>
          )}
        </Popover.Trigger>
        <Popover.Portal container={portalContainer}>
          <Popover.Content
            side="top"
            align="start"
            sideOffset={8}
            onKeyDown={handleKeyDown}
            className={`z-[100000] overflow-y-auto pointer-events-auto ${
              isKlingTurboSkin ? KLING_TURBO_PANEL : FROSTED
            } ${
              isKlingTurboSkin ? "max-h-[70vh] w-[380px]" : `max-h-[500px] ${isImage ? "w-[400px]" : "w-[340px]"}`
            }`}
          >
            {isKlingTurboSkin ? (
              <div className="sticky top-0 z-10 p-3">
                <div className="flex h-9 items-center gap-2 rounded-[10px] border border-white/[0.06] bg-white/[0.04] px-3 transition-colors focus-within:border-white/15">
                  <Search className="size-4 shrink-0" style={{ color: "rgba(255,255,255,0.3)" }} />
                  <input
                    ref={searchInputRef}
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search..."
                    aria-label="Search models"
                    className="w-full bg-transparent text-[13px] text-white placeholder:text-white/30 focus:outline-none"
                  />
                </div>
              </div>
            ) : (
              <div className="sticky top-0 z-10 flex h-[41px] items-center gap-2 border-b border-white/10 bg-[rgba(24,26,30,0.92)] px-3 backdrop-blur-[24px]">
                <Search className="size-4 shrink-0 text-gray-400" />
                <input
                  ref={searchInputRef}
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search..."
                  aria-label="Search models"
                  className="w-full bg-transparent text-sm text-white placeholder:text-gray-400 focus:outline-none"
                />
              </div>
            )}

            <div className="p-2" role="listbox" aria-label="AI video models">
              {categories.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-neutral-500">
                  No models match &quot;{query}&quot;.
                </p>
              )}
              {categories.map((cat) => (
                  <div key={cat.label} className="mb-2">
                    <p className="flex items-center gap-1.5 px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
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
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
