/**
 * Phase 23-D Admin Privacy dashboard contract — read-only.
 *
 * Mirrors `model-quality-admin-contract.ts`'s own shape: every row here is
 * exactly what the real Phase 23-A governance modules
 * (`data-classification.ts`/`processor-inventory.ts`) and the real
 * `privacy_requests` table already say — no second opinion computed here.
 */

import type { DataClassificationEntry } from "@/lib/privacy/data-classification";
import type { ProcessorEntry } from "@/lib/privacy/processor-inventory";
import type { PrivacyRequestRow } from "@/lib/privacy/privacy-request-store";

export interface PrivacyAdminView {
  readonly dataClassification: readonly DataClassificationEntry[];
  readonly processors: readonly ProcessorEntry[];
  readonly recentRequests: readonly PrivacyRequestRow[];
  readonly tombstoneCount: number;
}

export type PrivacyAdminResult =
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "FOUND"; readonly view: PrivacyAdminView };
