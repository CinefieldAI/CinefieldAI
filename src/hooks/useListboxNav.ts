"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Roving-tabindex keyboard navigation for a popover's option list.
 *
 * The active option holds real DOM focus (and is the only tabbable row), so the
 * highlight, the focus ring and what a screen reader announces can never drift
 * apart. Handlers are bound to the popover content, so arrow keys are only ever
 * intercepted while that panel is open — nothing is registered at the document
 * level. Escape-to-close and focus-return-to-trigger are left to Radix, which
 * already does both.
 *
 * Shared by the /image control popovers, both model lists and the Cinema Studio
 * ratio/resolution panels so they all navigate identically.
 */
export function useListboxNav({
  count,
  selectedIndex,
  open,
  onSelect,
  onActivate,
}: {
  count: number;
  selectedIndex: number;
  open: boolean;
  onSelect: (index: number) => void;
  /**
   * Opt in to "selection follows focus": every arrow/Home/End move commits the
   * value straight away, so the fill and the checkmark travel together with the
   * keyboard instead of the checkmark lagging on the old row. Escape puts back
   * whatever was selected when the panel opened.
   *
   * Only for cheap, reversible values (ratio, resolution, quality). Model lists
   * deliberately leave this off — swapping the model rebuilds the whole control
   * row, so that stays an explicit Enter/click.
   */
  onActivate?: (index: number) => void;
}) {
  const initialIndex = selectedIndex < 0 ? 0 : selectedIndex;
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const optionRefs = useRef<(HTMLElement | null)[]>([]);

  // Latest selection, read when the panel opens without making the reset
  // effect depend on it (with selection-follows-focus it changes constantly).
  const selectedIndexRef = useRef(initialIndex);
  selectedIndexRef.current = initialIndex;
  /** What to restore if the user escapes out of the panel. */
  const restoreIndexRef = useRef(initialIndex);

  useEffect(() => {
    if (!open) return;
    const start = selectedIndexRef.current;
    restoreIndexRef.current = start;
    setActiveIndex(start);
  }, [open]);

  const focusOption = (index: number) => {
    const el = optionRefs.current[index];
    if (!el) return;
    // preventScroll stops the browser nudging the whole page; the explicit
    // scrollIntoView then moves only the list's own scroll container.
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
  };

  const moveTo = (index: number) => {
    setActiveIndex(index);
    focusOption(index);
    onActivate?.(index);
  };

  /** Escape leaves the value the panel opened with, even after arrow keys
   *  committed intermediate ones. Radix still does the closing. */
  const handleEscapeKeyDown = () => {
    if (onActivate && restoreIndexRef.current !== activeIndex) {
      onActivate(restoreIndexRef.current);
    }
  };

  /** Radix focuses the panel wrapper on open; take that over so the currently
   *  selected row is focused instead and ArrowDown works without a click. */
  const handleOpenAutoFocus = (event: Event) => {
    event.preventDefault();
    setActiveIndex(initialIndex);
    requestAnimationFrame(() => focusOption(initialIndex));
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (count === 0) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveTo(Math.min(activeIndex + 1, count - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        moveTo(Math.max(activeIndex - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        moveTo(0);
        break;
      case "End":
        event.preventDefault();
        moveTo(count - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        onSelect(activeIndex);
        break;
      default:
        break;
    }
  };

  const getOptionProps = (index: number) => ({
    ref: (el: HTMLElement | null) => {
      optionRefs.current[index] = el;
    },
    tabIndex: index === activeIndex ? 0 : -1,
  });

  return {
    activeIndex,
    /** Move the marker without stealing focus — used for mouse hover, so the
     *  pointer and the arrow keys share one highlighted row. */
    setActiveIndex,
    handleKeyDown,
    handleOpenAutoFocus,
    handleEscapeKeyDown,
    getOptionProps,
    moveTo,
  };
}
