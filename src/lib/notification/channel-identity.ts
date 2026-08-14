import "server-only";

/**
 * Channel identity (Phase 11-A).
 *
 * THE CHANNEL IS DERIVED, NEVER SUPPLIED.
 *
 * The roadmap forbids the obvious shape outright: "`/events?workspace=...`
 * gibi istemci-kontrollü subscription hedefi KULLANILMAZ." So there is no
 * function here that turns a request parameter into a channel, and no
 * parameter of that kind exists to pass. A channel comes from exactly one
 * place — a tenant the DATABASE captured inside the transaction that produced
 * the fact — and this module's whole job is to make any other origin
 * unrepresentable.
 *
 * WHY A TYPE AND NOT A STRING
 * `ChannelId` is a branded type. A plain `string` would let a caller pass a
 * user id read from a request body straight into a publish call and it would
 * type-check. The brand means the only way to obtain a `ChannelId` is to call
 * `channelForTenant`, which is only ever handed a database-captured tenant.
 * The compiler enforces the provenance rule that a comment could only ask for.
 *
 * FORWARD SHAPE, NOT FORWARD BEHAVIOUR
 * Cinefield has no Clerk organizations today — `clerk_user_id` is the tenant
 * key throughout the schema, and inventing a workspace layer here would be
 * inventing a security boundary nothing enforces. The channel string is
 * therefore namespaced (`user:<id>`) so an `org:<id>` scope can be added later
 * without changing the boundary or colliding with existing channels. Adding
 * the scope is a new constructor, not a change to this one.
 */

/** Opaque. Obtainable only from `channelForTenant`. */
export type ChannelId = string & { readonly __brand: "ChannelId" };

/**
 * A Clerk user id, as stored in `profiles.clerk_user_id` and every
 * `clerk_user_id` column that references it.
 *
 * Deliberately conservative: Clerk ids are `user_` + base58-ish, and nothing
 * in this system has ever stored anything else. A tenant that does not match
 * is not coerced or trimmed into shape — it is refused, because a malformed
 * tenant means the capture went wrong, and guessing what it meant is how one
 * user's events reach another.
 */
const CLERK_USER_ID = /^user_[A-Za-z0-9]{10,64}$/;

export type ChannelResolution =
  | { ok: true; channelId: ChannelId; tenantId: string }
  | { ok: false; reason: "tenant_missing" | "tenant_malformed" };

/**
 * The only constructor.
 *
 * Returns a refusal rather than throwing: an unroutable event is a normal
 * outcome for the 92 historical rows that predate tenant capture, and a
 * consumer that has to try/catch its way through normal outcomes ends up
 * swallowing the abnormal ones too.
 */
export function channelForTenant(tenantId: string | null | undefined): ChannelResolution {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { ok: false, reason: "tenant_missing" };
  }
  if (!CLERK_USER_ID.test(tenantId)) {
    return { ok: false, reason: "tenant_malformed" };
  }
  return { ok: true, channelId: `user:${tenantId}` as ChannelId, tenantId };
}

/**
 * Whether a channel belongs to a given tenant.
 *
 * Used by 11-D at connection time and by any replay path: a replayed event
 * must pass the SAME tenant filter as a live one, so this comparison exists
 * once and both sides call it.
 */
export function channelBelongsTo(channelId: ChannelId, tenantId: string): boolean {
  const expected = channelForTenant(tenantId);
  return expected.ok && expected.channelId === channelId;
}
