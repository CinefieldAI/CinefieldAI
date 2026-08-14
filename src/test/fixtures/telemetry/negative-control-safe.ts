// Phase 13-E NEGATIVE CONTROL — test fixture only, never imported by
// runtime code. Each file contains only SAFE log call sites the scan must NOT flag. Values are assembled from fragments so no
// literal credential shape is typed by hand.

import { createLogger } from "@/lib/observability/logger";
import { errorFields } from "@/lib/observability/error-projection";

const log = createLogger("fixture");

export function ok(generationId: string, caught: unknown) {
  log.info("generation_started", { generationId, result: "queued" });
  log.error("generation_failed", errorFields(caught));
}
