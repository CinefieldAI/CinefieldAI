"use client";

import { useRef } from "react";

/**
 * Left/right arrow navigation across a prompt-bar control row.
 *
 * Bind `containerProps` to the toolbar element itself — never the document.
 * The prompt editor is a sibling of the toolbar, not a child, so typing keeps
 * its own caret behaviour; and open popovers render through a portal outside
 * the toolbar, so their up/down list navigation never collides with this.
 *
 *   ArrowLeft / ArrowRight  move between controls
 *   Home / End              jump to the first / last control
 *   ArrowDown / Enter / Space  open the focused control's panel
 */
export function useToolbarNav() {
  const containerRef = useRef<HTMLDivElement>(null);

  const controls = (): HTMLElement[] => {
    const root = containerRef.current;
    if (!root) return [];
    return Array.from(
      root.querySelectorAll<HTMLElement>("button, [role='button'], a[href]"),
    ).filter((el) => !el.hasAttribute("disabled") && el.getBoundingClientRect().width > 0);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    // Never intercept while the caret is in a field that lives in the row.
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      return;
    }

    const items = controls();
    if (items.length === 0) return;
    const current = items.indexOf(target.closest("button, [role='button'], a[href]") as HTMLElement);
    if (current < 0) return;

    const focusAt = (index: number) => {
      const el = items[index];
      if (!el) return;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    };

    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        focusAt(Math.min(current + 1, items.length - 1));
        break;
      case "ArrowLeft":
        event.preventDefault();
        focusAt(Math.max(current - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        event.preventDefault();
        focusAt(items.length - 1);
        break;
      case "ArrowDown":
        // Opens the focused control; the panel's own hook takes over from here.
        event.preventDefault();
        items[current]?.click();
        break;
      default:
        break;
    }
  };

  return { containerRef, containerProps: { ref: containerRef, onKeyDown: handleKeyDown } };
}
