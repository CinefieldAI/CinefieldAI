"use client";

import { useEffect, useState } from "react";
import {
  fetchModelAvailability,
  peekModelAvailability,
} from "@/lib/orchestration/model-availability-client";

/**
 * Runtime production availability for the model picker (Phase 8).
 *
 * Deliberately tiny. It owns no policy — `resolveRuntimeAvailability` decides
 * what an answer means — and it introduces no state-management library. One
 * fetch, shared through the module cache, so the picker and the Generate guard
 * see the same thing.
 *
 * Starts from whatever the cache already holds, so a second mount does not
 * flash "checking" for data that has already arrived.
 */
export function useModelAvailability(): Map<string, boolean> | null {
  const [availability, setAvailability] = useState<Map<string, boolean> | null>(() =>
    peekModelAvailability()
  );

  useEffect(() => {
    if (availability) return;

    let active = true;
    void fetchModelAvailability().then((resolved) => {
      // A failed fetch resolves to null and leaves the state unresolved, which
      // reads as "checking" — never as "available". Availability is a UX
      // refinement and must not be able to break the page.
      if (active && resolved) setAvailability(resolved);
    });

    return () => {
      active = false;
    };
  }, [availability]);

  return availability;
}
