import "server-only";
import { channelForTenant, type ChannelId } from "@/lib/notification/channel-identity";

/**
 * Connection tenant binding (Phase 11-D).
 *
 * Roadmap 11-D asks for the target to come from
 * "authenticated principal → membership → effective workspace" and for the
 * connection to be bound immutably to session + user + workspace.
 *
 * ---------------------------------------------------------------------------
 * THE WORKSPACE DOES NOT EXIST YET, AND THIS SAYS SO INSTEAD OF PRETENDING
 * ---------------------------------------------------------------------------
 * There is no `workspaces` table, no `workspace_id` column anywhere in
 * `supabase/migrations`, and no Clerk organization in the codebase — two
 * existing tests assert that absence deliberately. `clerk_user_id` is the
 * tenant key on `projects`, `generations`, `media_assets`, `credit_wallets`
 * and every RLS policy.
 *
 * So membership today is the IDENTITY relation: a principal is a member of
 * exactly one tenant, itself. That is written here as a real resolution step
 * rather than skipped, because the shape is what 11-D is asking for and the
 * shape is what a future workspace layer will fill. What is NOT done is
 * inventing a membership table, a workspace id, or an organization lookup —
 * a fake membership check returns a fake answer, and a security boundary
 * built on one is worse than an honest narrower boundary.
 *
 * When workspaces become real, `resolveEffectiveTenant` gains a lookup and
 * every caller keeps working: it already treats the result as opaque, already
 * binds it once, and already refuses to re-resolve it mid-connection.
 */

export interface EffectiveTenant {
  /** The authenticated principal. Never read from a request parameter. */
  principalId: string;
  /**
   * The tenant whose data this connection may see. Today always equal to
   * `principalId`; a workspace id when that concept exists.
   */
  tenantId: string;
  /**
   * Null while workspaces do not exist. Present so a reader can tell
   * "user-scoped" from "workspace-scoped" without inspecting the ids.
   */
  workspaceId: string | null;
  /** How the tenant was derived. Recorded so a change is visible in logs. */
  source: "principal_identity";
  channelId: ChannelId;
}

export type BindingResult =
  | { ok: true; tenant: EffectiveTenant }
  | { ok: false; reason: "unauthenticated" | "principal_malformed" };

/**
 * Resolves the one tenant a connection is allowed to observe.
 *
 * Called EXACTLY ONCE, at connection creation. The result is captured in a
 * const for the connection's lifetime; nothing re-resolves it, and no request
 * parameter can influence it — the function takes a principal and nothing
 * else, so there is no argument through which a query string could arrive.
 */
export function resolveEffectiveTenant(principalId: string | null | undefined): BindingResult {
  if (typeof principalId !== "string" || principalId.length === 0) {
    return { ok: false, reason: "unauthenticated" };
  }

  // MEMBERSHIP, as it genuinely is today: the principal is the tenant. The
  // channel constructor re-validates the id shape, so a malformed principal
  // is refused here rather than becoming a malformed Redis key later.
  const channel = channelForTenant(principalId);
  if (!channel.ok) {
    return { ok: false, reason: "principal_malformed" };
  }

  return {
    ok: true,
    tenant: {
      principalId,
      tenantId: channel.tenantId,
      workspaceId: null,
      source: "principal_identity",
      channelId: channel.channelId,
    },
  };
}

/**
 * Whether a resolved binding still describes the same principal.
 *
 * Used by nothing in the request path — the binding is immutable and there is
 * nothing to re-check against. It exists for the connection-lease layer,
 * which stores a tenant alongside a lease and must be able to prove the two
 * still agree before refreshing it.
 */
export function bindingMatches(tenant: EffectiveTenant, principalId: string): boolean {
  return tenant.principalId === principalId && tenant.tenantId === principalId;
}
