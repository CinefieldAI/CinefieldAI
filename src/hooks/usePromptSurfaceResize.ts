"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

type ResizeMode = "vertical" | "corner";

interface PromptSurfaceResizeOptions {
  width: number;
  height: number;
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  defaultWidth: number;
  defaultHeight: number;
  setWidth: (width: number) => void;
  setHeight: (height: number) => void;
  storageKey?: string;
  step?: number;
  onManualResize?: (width: number, height: number) => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export function usePromptSurfaceResize({
  width,
  height,
  minWidth,
  maxWidth,
  minHeight,
  maxHeight,
  defaultWidth,
  defaultHeight,
  setWidth,
  setHeight,
  storageKey,
  step = 16,
  onManualResize,
}: PromptSurfaceResizeOptions) {
  const [isResizing, setIsResizing] = useState(false);
  const [hasRestoredSize, setHasRestoredSize] = useState(false);
  const hasAttemptedRestoreRef = useRef(false);
  const modeRef = useRef<ResizeMode>("vertical");
  const startRef = useRef({ x: 0, y: 0, width, height });
  const pendingRef = useRef({ width, height });
  const frameRef = useRef<number | null>(null);

  const commitPendingSize = useCallback(() => {
    frameRef.current = null;
    setWidth(pendingRef.current.width);
    setHeight(pendingRef.current.height);
    onManualResize?.(pendingRef.current.width, pendingRef.current.height);
  }, [onManualResize, setHeight, setWidth]);

  const scheduleSize = useCallback(
    (nextWidth: number, nextHeight: number) => {
      pendingRef.current = { width: nextWidth, height: nextHeight };
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(commitPendingSize);
      }
    },
    [commitPendingSize],
  );

  useEffect(() => {
    if (hasAttemptedRestoreRef.current) return;
    hasAttemptedRestoreRef.current = true;
    if (!storageKey) {
      setHasRestoredSize(true);
      return;
    }

    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as { width?: number; height?: number };
        setWidth(clamp(parsed.width ?? defaultWidth, minWidth, maxWidth));
        setHeight(clamp(parsed.height ?? defaultHeight, minHeight, maxHeight));
      }
    } catch {
      // Ignore malformed or unavailable local storage.
    }
    setHasRestoredSize(true);
  }, [
    defaultHeight,
    defaultWidth,
    maxHeight,
    maxWidth,
    minHeight,
    minWidth,
    setHeight,
    setWidth,
    storageKey,
  ]);

  useEffect(() => {
    if (!storageKey || !hasRestoredSize) return;
    window.localStorage.setItem(storageKey, JSON.stringify({ width, height }));
  }, [hasRestoredSize, height, storageKey, width]);

  useEffect(() => {
    const nextWidth = clamp(width, minWidth, maxWidth);
    const nextHeight = clamp(height, minHeight, maxHeight);
    if (nextWidth !== width) setWidth(nextWidth);
    if (nextHeight !== height) setHeight(nextHeight);
  }, [height, maxHeight, maxWidth, minHeight, minWidth, setHeight, setWidth, width]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      document.body.style.userSelect = "";
    },
    [],
  );

  const startResize = useCallback(
    (mode: ResizeMode, event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      modeRef.current = mode;
      startRef.current = { x: event.clientX, y: event.clientY, width, height };
      pendingRef.current = { width, height };
      setIsResizing(true);
      document.body.style.userSelect = "none";
    },
    [height, width],
  );

  const moveResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const start = startRef.current;
      const nextWidth =
        modeRef.current === "corner"
          ? clamp(start.width + event.clientX - start.x, minWidth, maxWidth)
          : start.width;
      const nextHeight = clamp(
        start.height + start.y - event.clientY,
        minHeight,
        maxHeight,
      );
      scheduleSize(nextWidth, nextHeight);
    },
    [maxHeight, maxWidth, minHeight, minWidth, scheduleSize],
  );

  const finishResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
        setWidth(pendingRef.current.width);
        setHeight(pendingRef.current.height);
        onManualResize?.(pendingRef.current.width, pendingRef.current.height);
      }
      setIsResizing(false);
      document.body.style.userSelect = "";
    },
    [onManualResize, setHeight, setWidth],
  );

  const resetHeight = useCallback(() => {
    const nextHeight = clamp(defaultHeight, minHeight, maxHeight);
    setHeight(nextHeight);
    onManualResize?.(width, nextHeight);
  }, [defaultHeight, maxHeight, minHeight, onManualResize, setHeight, width]);

  const resetSize = useCallback(() => {
    const nextWidth = clamp(defaultWidth, minWidth, maxWidth);
    const nextHeight = clamp(defaultHeight, minHeight, maxHeight);
    setWidth(nextWidth);
    setHeight(nextHeight);
    onManualResize?.(nextWidth, nextHeight);
  }, [
    defaultHeight,
    defaultWidth,
    maxHeight,
    maxWidth,
    minHeight,
    minWidth,
    onManualResize,
    setHeight,
    setWidth,
  ]);

  const handleVerticalKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const amount = step * (event.shiftKey ? 4 : 1);
      let nextHeight: number | null = null;

      if (event.key === "ArrowUp") nextHeight = height + amount;
      if (event.key === "ArrowDown") nextHeight = height - amount;
      if (event.key === "Home") nextHeight = minHeight;
      if (event.key === "End") nextHeight = maxHeight;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        resetHeight();
        return;
      }
      if (nextHeight === null) return;

      event.preventDefault();
      const clampedHeight = clamp(nextHeight, minHeight, maxHeight);
      setHeight(clampedHeight);
      onManualResize?.(width, clampedHeight);
    },
    [height, maxHeight, minHeight, onManualResize, resetHeight, setHeight, step, width],
  );

  const handleCornerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const amount = step * (event.shiftKey ? 4 : 1);
      let nextWidth = width;
      let nextHeight = height;

      if (event.key === "ArrowRight") nextWidth += amount;
      else if (event.key === "ArrowLeft") nextWidth -= amount;
      else if (event.key === "ArrowUp") nextHeight += amount;
      else if (event.key === "ArrowDown") nextHeight -= amount;
      else if (event.key === "Home") {
        nextWidth = minWidth;
        nextHeight = minHeight;
      } else if (event.key === "End") {
        nextWidth = maxWidth;
        nextHeight = maxHeight;
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        resetSize();
        return;
      } else {
        return;
      }

      event.preventDefault();
      nextWidth = clamp(nextWidth, minWidth, maxWidth);
      nextHeight = clamp(nextHeight, minHeight, maxHeight);
      setWidth(nextWidth);
      setHeight(nextHeight);
      onManualResize?.(nextWidth, nextHeight);
    },
    [
      height,
      maxHeight,
      maxWidth,
      minHeight,
      minWidth,
      onManualResize,
      resetSize,
      setHeight,
      setWidth,
      step,
      width,
    ],
  );

  return {
    isResizing,
    verticalHandleProps: {
      role: "separator" as const,
      "aria-orientation": "horizontal" as const,
      "aria-label": "Resize prompt height",
      "aria-valuemin": minHeight,
      "aria-valuemax": maxHeight,
      "aria-valuenow": Math.round(height),
      tabIndex: 0,
      onPointerDown: (event: PointerEvent<HTMLDivElement>) =>
        startResize("vertical", event),
      onPointerMove: moveResize,
      onPointerUp: finishResize,
      onPointerCancel: finishResize,
      onDoubleClick: resetHeight,
      onKeyDown: handleVerticalKeyDown,
    },
    cornerHandleProps: {
      role: "separator" as const,
      "aria-orientation": "vertical" as const,
      "aria-label": "Resize prompt width and height",
      "aria-valuemin": minWidth,
      "aria-valuemax": maxWidth,
      "aria-valuenow": Math.round(width),
      "aria-valuetext": `${Math.round(width)} by ${Math.round(height)} pixels`,
      tabIndex: 0,
      onPointerDown: (event: PointerEvent<HTMLDivElement>) =>
        startResize("corner", event),
      onPointerMove: moveResize,
      onPointerUp: finishResize,
      onPointerCancel: finishResize,
      onDoubleClick: resetSize,
      onKeyDown: handleCornerKeyDown,
    },
  };
}

export type PromptSurfaceResizeController = ReturnType<
  typeof usePromptSurfaceResize
>;
