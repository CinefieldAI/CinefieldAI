"use client";

import { createElement, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronRight, Search, Sparkles, Volume2 } from "lucide-react";
import { GLASS_PANEL } from "./AiVideoControls";
import {
  ALL_MODELS,
  FEATURED_MODELS,
  getModelName,
  iconForModel,
  type AiVideoFamily,
  type AiVideoModel,
} from "./aiVideoModels";

/**
 * Model picker for the AI Video prompt bar. Deliberately its own component
 * rather than a reuse of Marketing Studio's: the two behave differently in a
 * way that matters here — a family card in this one is *not* selectable, it
 * only reveals its submodels on hover, and clicking it does nothing.
 *
 * Searching flattens the tree: the two section headings collapse to a single
 * "All models" list and family cards are replaced by the submodels that
 * matched, so a search result is always something you can actually pick.
 *
 * Selection travels as a model **id**, never a name — the Kling family holds
 * two models called `Kling 3.0 Omni` and two called `Kling O1 Video`, and
 * matching on the label would highlight both rows of a pair at once.
 */

/**
 * The panel's leading icon tile: a 40×40 square whose 1.5px ring is white on
 * the top half and accent on the bottom, matching the tile the Marketing
 * Studio and Cinema Studio pickers already use.
 */
function ModelIconTile({ model }: { model: AiVideoModel }) {
  const icon = iconForModel(model.name);
  return (
    <div
      className="relative mr-2 size-10 shrink-0 rounded-[12px] p-[1.5px]"
      style={{ background: "linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 50%, #D97757 50%, #D97757 100%)" }}
    >
      <div className="flex size-full items-center justify-center overflow-hidden rounded-[10.5px] bg-[radial-gradient(ellipse_at_center,rgba(18,18,18,0.95)_0%,rgba(28,28,28,0.90)_100%)]">
        {icon ? createElement(icon, { className: "size-4.5 text-white" }) : null}
      </div>
    </div>
  );
}

/** The prompt bar's own icon: bare and accent-coloured, no tile.
 *  Rendered through createElement because the icon comes back from a lookup —
 *  assigning it to a capitalised local and using JSX reads to the linter as
 *  defining a component mid-render. */
function TriggerIcon({ name }: { name: string }) {
  const icon = iconForModel(name);
  return icon ? createElement(icon, { className: "size-4 shrink-0 text-[#D97757]" }) : null;
}

function Chip({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-0.5 rounded-sm bg-white/5 px-1 py-0.5 text-[10px] font-medium text-white/55">
      {label}
    </span>
  );
}

/** One row. `compact` drops the leading icon tile — family flyout rows have
 *  no icon in the reference, only the main list does. */
function ModelRow({
  model,
  selected,
  isFamily,
  compact,
  onSelect,
  onHover,
  optionRef,
  tabIndex,
}: {
  model: AiVideoModel;
  selected: boolean;
  isFamily?: boolean;
  compact?: boolean;
  onSelect: () => void;
  onHover?: (el: HTMLButtonElement) => void;
  optionRef?: (el: HTMLElement | null) => void;
  tabIndex?: number;
}) {
  return (
    <button
      ref={optionRef}
      tabIndex={tabIndex}
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      onMouseEnter={(event) => onHover?.(event.currentTarget)}
      className={`flex w-full cursor-pointer items-center gap-0 rounded-xl py-1.5 pl-1.5 pr-3 text-start outline-none transition-colors hover:bg-white/5 focus-visible:bg-white/5 ${
        selected ? "bg-white/5" : ""
      }`}
    >
      {!compact && <ModelIconTile model={model} />}

      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-white">{model.name}</span>
          {model.sound && <Volume2 className="size-3 text-white/45" />}
        </div>

        {model.chips && model.chips.length > 0 ? (
          <div className="flex gap-1 overflow-hidden">
            {model.chips.map((chip) => (
              <Chip key={chip} label={chip} />
            ))}
          </div>
        ) : model.description ? (
          <span className="truncate text-[10px] text-white/45">{model.description}</span>
        ) : null}
      </div>

      <div className="flex size-5 shrink-0 items-center justify-center">
        {isFamily ? (
          <ChevronRight className="size-4 text-white/45" />
        ) : (
          selected && <Check className="size-4 text-[#D97757]" />
        )}
      </div>
    </button>
  );
}

function SectionHeading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pb-2 pt-2">
      <Sparkles className="size-3.5 shrink-0 text-white/45" />
      <span className="flex-1 text-xs font-medium text-white/45">{label}</span>
    </div>
  );
}

export default function AiVideoModelSelector({
  selected,
  onSelect,
}: {
  /** Id of the selected model. */
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [flyout, setFlyout] = useState<{ family: AiVideoFamily; top: number; left: number } | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);

  const selectedName = getModelName(selected);
  const trimmed = query.trim().toLowerCase();

  /** Searching flattens families into their matching submodels, so every
   *  result row is directly selectable. */
  const searchResults = useMemo(() => {
    if (!trimmed) return null;
    const hits: AiVideoModel[] = [];
    const seen = new Set<string>();
    const push = (model: AiVideoModel) => {
      if (!model.name.toLowerCase().includes(trimmed) || seen.has(model.id)) return;
      seen.add(model.id);
      hits.push(model);
    };
    for (const card of ALL_MODELS) {
      if (card.submodels) card.submodels.forEach(push);
      else push(card);
    }
    return hits;
  }, [trimmed]);

  /** Closing clears the search and any open family flyout, so the panel
   *  always reopens on the full tree. Done here rather than in an effect —
   *  it is a reaction to the event, not state to synchronise. */
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      setFlyout(null);
    }
  };

  const showFlyout = (el: HTMLButtonElement, family: AiVideoFamily) => {
    const rect = el.getBoundingClientRect();
    setFlyout({ family, top: Math.max(8, Math.min(rect.top, window.innerHeight - 420)), left: rect.right + 10 });
  };

  const pick = (id: string) => {
    onSelect(id);
    handleOpenChange(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Model: ${selectedName}`}
          className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-white/[0.04] bg-white/5 px-2 transition-colors hover:bg-white/10 focus:outline-none"
        >
          <TriggerIcon name={selectedName} />
          <span className="px-1 text-xs font-semibold text-white">{selectedName}</span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() => searchRef.current?.focus());
          }}
          onInteractOutside={(event) => {
            const target = event.target;
            if (target instanceof Node && flyoutRef.current?.contains(target)) event.preventDefault();
          }}
          className={`z-[100000] flex max-h-[min(40rem,calc(100vh-32px))] w-100 max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl outline-none ${GLASS_PANEL}`}
        >
          <label className="flex h-[41px] min-h-[41px] items-center gap-2 border-b border-white/[0.06] px-1.5 py-0.5">
            <Search className="size-4 shrink-0 text-white/40" />
            <input
              ref={searchRef}
              autoFocus
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search..."
              aria-label="Search models"
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
            />
          </label>

          <div
            className="hide-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5"
            role="listbox"
            aria-label="AI Video models"
          >
            {searchResults ? (
              searchResults.length === 0 ? (
                <p className="px-3 py-8 text-center text-xs text-white/40">No models found</p>
              ) : (
                <>
                  <SectionHeading label="All models" />
                  {searchResults.map((model) => (
                    <ModelRow
                      key={model.id}
                      model={model}
                      selected={model.id === selected}
                      onSelect={() => pick(model.id)}
                      onHover={() => setFlyout(null)}
                    />
                  ))}
                </>
              )
            ) : (
              <>
                <SectionHeading label="Featured models" />
                {FEATURED_MODELS.map((model) => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    selected={model.id === selected}
                    onSelect={() => pick(model.id)}
                    onHover={() => setFlyout(null)}
                  />
                ))}

                <SectionHeading label="All models" />
                {ALL_MODELS.map((card) => {
                  const isFamily = !!card.submodels?.length;
                  const selectedHere = isFamily
                    ? !!card.submodels?.some((sub) => sub.id === selected)
                    : card.id === selected;
                  return (
                    <ModelRow
                      key={card.id}
                      model={card}
                      isFamily={isFamily}
                      selected={selectedHere}
                      // A family card is display-only: hovering reveals its
                      // submodels, clicking it is a deliberate no-op.
                      onSelect={() => {
                        if (!isFamily) pick(card.id);
                      }}
                      onHover={(el) => (isFamily ? showFlyout(el, card) : setFlyout(null))}
                    />
                  );
                })}
              </>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>

      {open &&
        flyout &&
        createPortal(
          <div
            ref={flyoutRef}
            className={`hide-scrollbar fixed z-[100001] max-h-[400px] min-w-[280px] overflow-y-auto overscroll-contain rounded-xl p-1.5 shadow-xl shadow-black/30 ${GLASS_PANEL}`}
            style={{ top: flyout.top, left: flyout.left }}
            onMouseEnter={() => setFlyout(flyout)}
          >
            {flyout.family.submodels?.map((sub) => (
              <ModelRow
                key={sub.id}
                model={sub}
                compact
                selected={sub.id === selected}
                onSelect={() => pick(sub.id)}
              />
            ))}
          </div>,
          document.body,
        )}
    </Popover.Root>
  );
}
