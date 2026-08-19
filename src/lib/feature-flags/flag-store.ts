import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FlagProvider, FlagRecord, FlagValue } from "./flag-contract";

/**
 * The local, Supabase-backed flag provider (Phase 21-A).
 *
 * The ONLY `FlagProvider` implementation today — see `flag-contract.ts`'s
 * header for why no OpenFeature/LaunchDarkly package is installed. Every
 * read and write goes through the service-role Supabase client and the
 * SECURITY DEFINER `set_feature_flag()` function
 * (`20260901000000_feature_flags.sql`) — `feature_flags` has RLS enabled
 * with no `authenticated` policy, so a real flag value can only ever be
 * read or changed server-side.
 */

function rowToRecord(row: Record<string, unknown>): FlagRecord {
  return {
    key: String(row.flag_key),
    value: row.value as FlagValue,
    rollbackValue: (row.rollback_value ?? null) as FlagValue | null,
    reasonCode: (row.reason_code ?? null) as string | null,
    ticketRef: (row.ticket_ref ?? null) as string | null,
    expiresAt: (row.expires_at ?? null) as string | null,
    updatedBy: String(row.updated_by),
    updatedAt: String(row.updated_at),
  };
}

/**
 * PHASE 21-C: lazy expiry. An emergency flag whose `expiresAt` has passed
 * reads as its own `rollbackValue` — never a background writer, the same
 * "computed lazily from elapsed time" discipline
 * `src/lib/routing/circuit-breaker.ts`'s OPEN→HALF_OPEN transition already
 * uses. The durable row is NOT rewritten by this read; the next real
 * `set_feature_flag` write is what makes the reversion durable.
 */
export function effectiveRecord(record: FlagRecord): { record: FlagRecord; expired: boolean } {
  if (!record.expiresAt) return { record, expired: false };
  if (Date.parse(record.expiresAt) > Date.now()) return { record, expired: false };
  if (record.rollbackValue === null) return { record, expired: false };
  return { record: { ...record, value: record.rollbackValue }, expired: true };
}

export class LocalSupabaseFlagProvider implements FlagProvider {
  constructor(private readonly admin: SupabaseClient) {}

  async resolve(key: string): Promise<FlagRecord | null> {
    const { data, error } = await this.admin
      .from("feature_flags")
      .select("flag_key, value, rollback_value, reason_code, ticket_ref, expires_at, updated_by, updated_at")
      .eq("flag_key", key)
      .maybeSingle();

    if (error || !data) return null;
    return effectiveRecord(rowToRecord(data as Record<string, unknown>)).record;
  }
}

export type WriteFlagOutcome =
  | { outcome: "written"; previousValue: FlagValue | null; newValue: FlagValue }
  | { outcome: "failed"; errorCode: string };

/**
 * The one write path. Never called directly by an admin route —
 * `feature-flag-admin-service.ts` calls this only AFTER `requirePolicy()`
 * and `authorizeTier0Action()` both allow.
 */
export async function writeFlag(
  admin: SupabaseClient,
  params: {
    key: string;
    valueType: "boolean" | "string" | "enum";
    newValue: FlagValue;
    actorClerkUserId: string;
    rollbackValue?: FlagValue | null;
    reasonCode?: string | null;
    ticketRef?: string | null;
    expiresAt?: string | null;
  }
): Promise<WriteFlagOutcome> {
  const { data, error } = await admin.rpc("set_feature_flag", {
    p_flag_key: params.key,
    p_value_type: params.valueType,
    p_new_value: params.newValue,
    p_actor_clerk_user_id: params.actorClerkUserId,
    p_rollback_value: params.rollbackValue ?? null,
    p_reason_code: params.reasonCode ?? null,
    p_ticket_ref: params.ticketRef ?? null,
    p_expires_at: params.expiresAt ?? null,
  });

  if (error) return { outcome: "failed", errorCode: "set_flag_failed" };
  const row = Array.isArray(data) ? data[0] : data;
  return {
    outcome: "written",
    previousValue: (row?.previous_value ?? null) as FlagValue | null,
    newValue: params.newValue,
  };
}
