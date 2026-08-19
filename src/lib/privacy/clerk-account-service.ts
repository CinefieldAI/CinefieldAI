import "server-only";

/**
 * Clerk account deletion seam (Phase 23-C).
 *
 * ---------------------------------------------------------------------------
 * DEPENDENCY-INJECTED, NEVER CALLED DIRECTLY BY A LIBRARY FUNCTION
 * ---------------------------------------------------------------------------
 * Same discipline `eval-runner.ts`'s `ProduceOutputFn` and
 * `judge-provider.ts`'s `AiJudgeProvider` already established for this
 * codebase: `AccountDeletionWorkflow` takes a `ClerkUserDeleter` as a
 * parameter, defaulting to the real implementation below, so a test proves
 * the workflow's own orchestration logic against a fake deleter and never
 * needs (or risks) a live Clerk call. Deleting a real Clerk user is a
 * genuinely irreversible, account-destroying action — this repository's
 * standing "never trigger a live/paid/irreversible external action without
 * explicit authorization" boundary applies here at least as strongly as it
 * does to a paid generation, and this seam is what makes that boundary
 * possible to hold in code review and in tests alike.
 */
export interface ClerkUserDeleter {
  deleteUser(clerkUserId: string): Promise<{ deleted: boolean }>;
}

/**
 * The real implementation — calls Clerk's Backend API via `clerkClient()`
 * from `@clerk/nextjs/server`. Never invoked by this repository's own test
 * suite; only `LiveClerkUserDeleter`'s SHAPE is verified (it calls
 * `users.deleteUser`, nothing else), never its live behavior.
 */
export const LiveClerkUserDeleter: ClerkUserDeleter = {
  async deleteUser(clerkUserId: string): Promise<{ deleted: boolean }> {
    const { clerkClient } = await import("@clerk/nextjs/server");
    try {
      const client = await clerkClient();
      await client.users.deleteUser(clerkUserId);
      return { deleted: true };
    } catch {
      return { deleted: false };
    }
  },
};
