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
  Search,
  Sparkles,
} from "lucide-react";
import {
  IMAGE_MODEL_CATEGORIES,
  MODEL_CATEGORIES,
  getModel,
  type ModelInfo,
} from "./cinemaStudioData";

interface ModelSelectorProps {
  value: string;
  onChange: (id: string) => void;
  mode?: "image" | "video";
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

/* ---------------------- Image-mode row ---------------------- */

function ImageRow({
  model,
  value,
  onSelect,
}: {
  model: ModelInfo;
  value: string;
  onSelect: (id: string) => void;
}) {
  const Icon = typeof model.icon === "string" ? null : (model.icon ?? Clapperboard);
  const iconPath = typeof model.icon === "string" ? model.icon : null;
  const active = model.id === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(model.id)}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-[#00e5ff] ${
        active ? "bg-white/5" : "hover:bg-white/5"
      }`}
    >
      <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white">
        {iconPath ? (
          <img src={iconPath} alt="" className="size-10 object-cover" />
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
}: {
  model: ModelInfo;
  value: string;
  onSelect: (id: string) => void;
}) {
  const Icon = typeof model.icon === "string" ? null : (model.icon ?? Clapperboard);
  const iconPath = typeof model.icon === "string" ? model.icon : null;
  const active = model.id === value;

  return (
    <button
      type="button"
      onClick={() => onSelect(model.id)}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all duration-200 ease-out focus:outline-none ${
        active ? "border-white/20 bg-white/10" : "border-transparent hover:bg-white/5"
      }`}
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white">
        {iconPath ? (
          <img src={iconPath} alt="" className="size-8 object-cover" />
        ) : (
          Icon && <Icon className="size-8" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-white">{model.name}</span>
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
}: {
  model: ModelInfo;
  value: string;
  onSelect: (id: string) => void;
}) {
  const subs = model.submodels ?? [];
  const Icon = typeof model.icon === "string" ? null : (model.icon ?? Clapperboard);
  const iconPath = typeof model.icon === "string" ? model.icon : null;
  const rowRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  return (
    <div onMouseEnter={openFlyout} onMouseLeave={scheduleClose}>
      <button
        ref={rowRef}
        type="button"
        onClick={openFlyout}
        className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-left transition-all duration-200 ease-out hover:bg-white/5 focus:outline-none"
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white">
          {iconPath ? (
            <img src={iconPath} alt="" className="size-8 object-cover" />
          ) : (
            Icon && <Icon className="size-8" />
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

      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            data-model-flyout
            onMouseEnter={openFlyout}
            onMouseLeave={scheduleClose}
            className={`fixed z-[100000] max-h-[500px] w-[280px] overflow-y-auto p-1 ${FROSTED}`}
            style={{ top: pos.top, left: pos.left }}
          >
            {subs.map((s) => {
              const sel = s.id === value;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelect(s.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-all duration-200 ${
                    sel
                      ? "border-white/20 bg-white/10"
                      : "border-transparent hover:bg-white/5"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-white">
                      {s.name}
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

export default function ModelSelector({
  value,
  onChange,
  mode = "video",
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = getModel(value);
  const isImage = mode === "image";
  const source = isImage ? IMAGE_MODEL_CATEGORIES : MODEL_CATEGORIES;
  const accent = isImage ? "#D1FE17" : "#00e5ff";
  const TriggerIcon = isImage ? LocationPin : Clapperboard;
  const triggerIconPath = typeof selected.icon === "string" ? selected.icon : null;

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

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            className="flex h-9 items-center gap-2 rounded-lg bg-card px-2 py-1 text-xs font-medium text-white transition-all duration-200 ease-out hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#00e5ff]"
          >
            {triggerIconPath ? (
              <img src={triggerIconPath} alt="" className="h-5 w-5 object-cover" />
            ) : (
              <TriggerIcon className="h-5 w-5" style={{ color: accent }} />
            )}
            <span className="max-w-[140px] truncate" style={{ color: accent }}>
              {selected.name}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align="start"
            sideOffset={8}
            className={`z-[100000] max-h-[500px] overflow-y-auto ${FROSTED} ${
              isImage ? "w-[400px]" : "w-[320px]"
            }`}
          >
            <div className="sticky top-0 z-10 flex h-[41px] items-center gap-2 border-b border-white/10 bg-[rgba(24,26,30,0.92)] px-3 backdrop-blur-[24px]">
              <Search className="size-4 shrink-0 text-gray-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                aria-label="Search models"
                className="w-full bg-transparent text-sm text-white placeholder:text-gray-400 focus:outline-none"
              />
            </div>

            <div className="p-2">
              {categories.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-neutral-500">
                  No models match "{query}".
                </p>
              )}
              {categories.map((cat) => (
                <div key={cat.label} className="mb-2">
                  <p className="flex items-center gap-1.5 px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    {isImage || cat.label !== "All models" ? (
                      <Sparkles className="size-3" />
                    ) : (
                      <Film className="size-3" />
                    )}
                    {cat.label}
                  </p>
                  <div className="space-y-1">
                    {cat.models.map((m, i) => {
                      const key = `${m.id}-${i}`;
                      if (isImage)
                        return (
                          <ImageRow
                            key={key}
                            model={m}
                            value={value}
                            onSelect={(id) => select(id)}
                          />
                        );
                      return m.submodels?.length ? (
                        <VideoParentRow
                          key={key}
                          model={m}
                          value={value}
                          onSelect={(id) => select(id)}
                        />
                      ) : (
                        <VideoFlatRow
                          key={key}
                          model={m}
                          value={value}
                          onSelect={select}
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
