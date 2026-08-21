"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, CSSProperties, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, ChevronRight, Clock, Search, Sparkles, Volume2 } from "lucide-react";
import { useListboxNav } from "@/hooks/useListboxNav";

export interface MarketingModelOption {
  id: string;
  name: string;
  description: string;
  badges?: string[];
  meta?: string[];
  sound?: boolean;
  icon?: ComponentType<{ className?: string; style?: CSSProperties }> | string | null;
  submodels?: MarketingModelOption[];
}

export interface MarketingModelCategory {
  label: string;
  models: MarketingModelOption[];
}

interface MarketingModelSelectorProps {
  ariaLabel: string;
  selected: string;
  fallback: MarketingModelOption;
  categories: MarketingModelCategory[];
  onSelect: (name: string) => void;
  triggerMinWidth?: string;
}

function cleanName(name: string) {
  return name.replace(/^\s*🚫\s*/, "").replace(/^Higgsfield\b/, "Cinefield").trim();
}

function SectionIcon({ all }: { all: boolean }) {
  return all ? (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0 text-white/40" aria-hidden>
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
    <Sparkles className="size-3.5 shrink-0 text-white/40" />
  );
}

function ModelBadge({ label }: { label: string }) {
  return (
    <span
      className={`ml-1.5 rounded px-1 py-px align-middle text-[8px] font-black uppercase italic leading-none ${
        label === "NEW" || label === "PREMIUM" || label === "EXCLUSIVE"
          ? "bg-[#D7FF2F] text-black"
          : "bg-white/15 text-white/55"
      }`}
    >
      {label}
    </span>
  );
}

function ModelIcon({
  model,
  marked,
}: {
  model: MarketingModelOption;
  marked: boolean;
}) {
  const Icon = typeof model.icon === "function" ? model.icon : null;
  const iconPath = typeof model.icon === "string" ? model.icon : null;

  return (
    <div
      className={`relative size-10 shrink-0 rounded-[12px] p-[1.5px] transition-all duration-180 ease-out ${
        marked ? "mr-2.5" : "mr-3 group-hover/model-row:scale-[1.02]"
      }`}
      style={{
        background: "linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 50%, #D97757 50%, #D97757 100%)",
      }}
    >
      <div className="flex size-full items-center justify-center overflow-hidden rounded-[10.5px] bg-[radial-gradient(ellipse_at_center,rgba(18,18,18,0.95)_0%,rgba(28,28,28,0.90)_100%)]">
        {iconPath ? (
          <img src={iconPath} alt="" className="size-5 object-contain" />
        ) : Icon ? (
          <Icon className="size-4.5 text-white" />
        ) : (
          <Sparkles className="size-4.5 text-white" />
        )}
      </div>
    </div>
  );
}

function TriggerIcon({ model }: { model: MarketingModelOption }) {
  const Icon = typeof model.icon === "function" ? model.icon : null;
  const iconPath = typeof model.icon === "string" ? model.icon : null;

  if (iconPath) return <img src={iconPath} alt="" className="size-4 shrink-0 object-contain" />;
  if (Icon) return <Icon className="size-4 shrink-0 text-[#D97757]" />;
  return <Sparkles className="size-4 shrink-0 text-[#D97757]" />;
}

function ModelMeta({ model }: { model: MarketingModelOption }) {
  const meta = model.meta ?? [];
  if (!meta.length && !model.sound) return null;

  return (
    <span className="mt-0.5 flex items-center gap-2 text-[10px] font-medium text-white/42">
      {meta.map((item) => (
        <span key={item} className="flex items-center gap-1">
          {item.includes("s") ? <Clock className="size-3" /> : <span className="size-2.5 rotate-45 border border-current" />}
          {item}
        </span>
      ))}
      {model.sound && <Volume2 className="size-3" />}
    </span>
  );
}

function MarketingModelRow({
  model,
  isSelected,
  isMarked,
  onSelect,
  optionRef,
  tabIndex,
  onHover,
  hasSubmodels,
}: {
  model: MarketingModelOption;
  isSelected: boolean;
  isMarked: boolean;
  onSelect: (model: MarketingModelOption) => void;
  optionRef: (el: HTMLElement | null) => void;
  tabIndex: number;
  onHover?: (button: HTMLButtonElement, model: MarketingModelOption) => void;
  hasSubmodels?: boolean;
}) {
  const marked = isMarked || isSelected;

  return (
    <button
      ref={optionRef}
      tabIndex={tabIndex}
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={() => onSelect(model)}
      onMouseEnter={(event) => onHover?.(event.currentTarget, model)}
      className={`group/model-row relative flex h-[56px] min-h-[56px] w-full cursor-pointer items-center rounded-[12px] border px-2.5 py-2 text-start outline-none transition-all duration-200 ease-out hover:translate-x-[2px] focus-visible:outline-none ${
        marked
          ? "border-[rgba(217,119,87,0.28)] bg-[rgba(217,119,87,0.10)] shadow-[0_4px_16px_rgba(0,0,0,0.34)]"
          : "border-white/[0.04] bg-[#101112] hover:border-white/[0.09] hover:bg-[#151719] focus:border-white/[0.09] focus:bg-[#151719]"
      }`}
    >
      {marked && <span aria-hidden className="mr-2 h-7 w-[3px] shrink-0 rounded-full bg-[#D97757]" />}
      <ModelIcon model={model} marked={marked} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`truncate text-xs font-semibold ${marked ? "text-white" : "text-white/90"}`}>
          {cleanName(model.name)}
          {model.sound && <Volume2 className="ml-1 inline size-3 text-white/45" />}
          {model.badges?.map((badge) => (
            <ModelBadge key={badge} label={badge} />
          ))}
        </span>
        <span className="truncate text-[10px] font-normal text-white/45 group-hover/model-row:text-white/60">
          {model.description}
        </span>
        <ModelMeta model={model} />
      </div>
      <div className="ml-1 flex size-5 shrink-0 items-center justify-center">
        {hasSubmodels ? <ChevronRight className="size-4 text-white/50" /> : marked && <Check className="size-4 text-[#D97757]" />}
      </div>
    </button>
  );
}

export default function MarketingModelSelector({
  ariaLabel,
  selected,
  fallback,
  categories,
  onSelect,
  triggerMinWidth = "156px",
}: MarketingModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [flyout, setFlyout] = useState<{ model: MarketingModelOption; top: number; left: number } | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const popoverContentRef = useRef<HTMLDivElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);

  const allModels = useMemo(
    () => categories.flatMap((category) => category.models.flatMap((model) => [model, ...(model.submodels ?? [])])),
    [categories],
  );
  const selectedModel = allModels.find((model) => cleanName(model.name) === selected || model.name === selected) ?? fallback;
  const triggerModel = selectedModel.submodels?.[0] ?? selectedModel;

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((category) => ({
        ...category,
        models: category.models.filter((model) => {
          const haystack = [model.name, model.description, ...(model.submodels ?? []).flatMap((sub) => [sub.name, sub.description])]
            .join(" ")
            .toLowerCase();
          return haystack.includes(q);
        }),
      }))
      .filter((category) => category.models.length > 0);
  }, [categories, query]);

  const flatRows = useMemo(
    () => filteredCategories.flatMap((category) => category.models),
    [filteredCategories],
  );
  const categoryRowOffsets = useMemo(() => {
    return filteredCategories.reduce<number[]>((offsets) => {
      const previousOffset = offsets[offsets.length - 1] ?? 0;
      const previousLength =
        filteredCategories[offsets.length - 1]?.models.length ?? 0;
      return [...offsets, previousOffset + previousLength];
    }, []);
  }, [filteredCategories]);

  const handleSelect = (model: MarketingModelOption) => {
    const target = model.submodels?.[0] ?? model;
    onSelect(cleanName(target.name));
    setOpen(false);
    setQuery("");
    setFlyout(null);
  };

  const nav = useListboxNav({
    count: flatRows.length,
    selectedIndex: flatRows.findIndex(
      (model) => cleanName(model.name) === selected || model.submodels?.some((sub) => cleanName(sub.name) === selected),
    ),
    open,
    onSelect: (index) => {
      const model = flatRows[index];
      if (model) handleSelect(model);
    },
  });

  // Typing narrows flatRows, which can leave nav.activeIndex pointing past the
  // end of the new list (or at an unrelated row) — reset it so ArrowDown from
  // the search box always lands on a row that actually exists.
  useEffect(() => {
    if (open) nav.setActiveIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (open && scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleWheel = (event: WheelEvent) => {
      const target = event.target;
      if (target instanceof Node && popoverContentRef.current?.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", handleWheel, { capture: true });
  }, [open]);

  const handlePanelKeyDown = (event: KeyboardEvent) => {
    const inSearch = event.target === searchInputRef.current;
    if (inSearch) {
      if (event.key === "ArrowUp") return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        nav.moveTo(nav.activeIndex);
        return;
      }
      if (event.key === " ") return;
    } else {
      const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (printable || event.key === "Backspace") {
        event.preventDefault();
        searchInputRef.current?.focus();
        setQuery((current) => (printable ? current + event.key : current.slice(0, -1)));
        return;
      }
    }
    nav.handleKeyDown(event);
  };

  const showFlyout = (button: HTMLButtonElement, model: MarketingModelOption) => {
    if (!model.submodels?.length) {
      setFlyout(null);
      return;
    }
    const rect = button.getBoundingClientRect();
    setFlyout({ model, top: Math.max(8, Math.min(rect.top, window.innerHeight - 440)), left: rect.right + 10 });
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setFlyout(null);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${ariaLabel}: ${selected}`}
          className={`flex h-8 items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 focus:outline-none ${
            open
              ? "border-[#D97757] bg-[#181a1d]"
              : "border-white/[0.08] bg-[#101112] hover:border-[#D97757] hover:bg-[#181a1d]"
          }`}
          style={{ minWidth: triggerMinWidth }}
        >
          <TriggerIcon model={triggerModel} />
          <span className="max-w-[124px] truncate text-white">{cleanName(selectedModel.name)}</span>
          <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180 text-[#D97757]" : "text-neutral-400"}`} />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          ref={popoverContentRef}
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          onKeyDown={handlePanelKeyDown}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() => searchInputRef.current?.focus());
          }}
          onInteractOutside={(event) => {
            const target = event.target;
            if (target instanceof Node && flyoutRef.current?.contains(target)) {
              event.preventDefault();
            }
          }}
          onEscapeKeyDown={nav.handleEscapeKeyDown}
          className="z-[100000] rounded-2xl border border-white/[0.08] bg-[rgba(19,21,23,0.92)] shadow-[0_22px_70px_rgba(0,0,0,0.55)] outline-none backdrop-blur-[28px] backdrop-saturate-[125%] transition-all duration-[170ms] ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2 data-[state=open]:zoom-in-95"
        >
          <div className="relative flex h-[520px] max-h-[var(--radix-popover-content-available-height,520px)] w-[420px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl">
            <div aria-hidden className="pointer-events-none absolute left-0 top-0 z-0 h-[42px] w-full rounded-[317px] bg-[rgba(217,119,87,0.13)] blur-[50px]" />
            <div className="relative z-10 p-2.5 pb-1">
              <div className="group/search flex h-[38px] items-center gap-2.5 rounded-xl border border-white/[0.08] bg-[#101112] px-3 transition-all duration-200 focus-within:border-[#D97757]/60 focus-within:bg-[#151719]">
                <Search className="size-4 shrink-0 text-white/40 transition-colors duration-200 group-focus-within/search:text-[#F19A72]" />
                <input
                  ref={searchInputRef}
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search models..."
                  aria-label="Search models"
                  className="w-full bg-transparent text-xs font-medium text-white outline-none placeholder:text-white/35"
                />
              </div>
            </div>

            <div
              ref={scrollContainerRef}
              className="hide-scrollbar relative z-10 min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-2.5 pb-2.5"
              role="listbox"
              aria-label={ariaLabel}
              onWheel={(event) => event.stopPropagation()}
            >
              {filteredCategories.length === 0 && (
                <p className="px-3 py-8 text-center text-xs text-white/40">
                  No models match &quot;{query}&quot;.
                </p>
              )}

              {filteredCategories.map((category, categoryIndex) => {
                const isAll = category.label.toLowerCase().includes("all");
                return (
                  <div key={`${category.label}-${categoryIndex}`} className="mb-3">
                    <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-2 text-xs font-medium text-white/40">
                      <SectionIcon all={isAll} />
                      <span>{category.label}</span>
                    </div>
                    <div className="space-y-1.5">
                      {category.models.map((model, modelIndex) => {
                        const rowIndex = (categoryRowOffsets[categoryIndex] ?? 0) + modelIndex;
                        const optionProps = nav.getOptionProps(rowIndex);
                        const selectedInRow =
                          cleanName(model.name) === selected ||
                          model.submodels?.some((sub) => cleanName(sub.name) === selected) ||
                          false;
                        return (
                          <MarketingModelRow
                            key={`${categoryIndex}-${model.id}`}
                            model={model}
                            isSelected={selectedInRow}
                            isMarked={nav.activeIndex === rowIndex}
                            onSelect={handleSelect}
                            optionRef={optionProps.ref}
                            tabIndex={optionProps.tabIndex}
                            onHover={showFlyout}
                            hasSubmodels={!!model.submodels?.length}
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

      {open && flyout && createPortal(
        <div
          ref={flyoutRef}
          className="fixed z-[100001] max-h-[430px] w-[260px] overflow-y-auto rounded-2xl border border-white/[0.08] bg-[rgba(19,21,23,0.94)] p-2 shadow-[0_22px_70px_rgba(0,0,0,0.55)] backdrop-blur-[28px]"
          style={{ top: flyout.top, left: flyout.left }}
          onMouseEnter={() => setFlyout(flyout)}
          onWheel={(event) => event.stopPropagation()}
        >
          <div className="space-y-1">
            {flyout.model.submodels?.map((submodel) => (
              <button
                key={submodel.id}
                type="button"
                onClick={() => handleSelect(submodel)}
                className={`flex h-[54px] w-full items-center gap-2 rounded-[10px] px-2 text-left transition-colors ${
                  cleanName(submodel.name) === selected
                    ? "bg-[rgba(217,119,87,0.16)] text-white"
                    : "text-white/88 hover:bg-white/[0.06]"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">
                    {cleanName(submodel.name)}
                    {submodel.sound && <Volume2 className="ml-1 inline size-3 text-white/45" />}
                    {submodel.badges?.map((badge) => (
                      <ModelBadge key={badge} label={badge} />
                    ))}
                  </div>
                  <ModelMeta model={submodel} />
                </div>
                {cleanName(submodel.name) === selected && <Check className="size-4 shrink-0 text-[#D97757]" />}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </Popover.Root>
  );
}
