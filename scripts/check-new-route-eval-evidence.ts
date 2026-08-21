import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Cinefield new-route eval-evidence gate (Phase 22 corrective batch, 22-C).
 *
 * ---------------------------------------------------------------------------
 * SECRET BOUNDARY — WHY THIS SCRIPT TOUCHES NO DATABASE
 * ---------------------------------------------------------------------------
 * SECURITY_FINDINGS_9751bd11, finding 1. This gate runs from a
 * `pull_request`-triggered job, which checks out the PR's own code and runs
 * `npm ci` and an npm script from that checkout. It used to receive
 * SUPABASE_SERVICE_ROLE_KEY so it could look up `model_eval_runs`.
 *
 * That combination is the defect: PR-authored code executing with a
 * credential that BYPASSES RLS ENTIRELY — the highest-value secret this
 * system has, by its own registry's description. A PR could edit this file,
 * or `package.json`'s script target, and read the key straight out of the
 * environment.
 *
 * The trigger is `pull_request`, not `pull_request_target`, so GitHub
 * withholds secrets from FORK PRs — the exposure is to a principal that can
 * push a branch to this repository, i.e. someone with write access. That
 * narrows who can exploit it; it does not make an RLS-bypassing credential in
 * PR-controlled execution acceptable.
 *
 * So the database question was REMOVED rather than re-credentialed. What
 * remains is answerable from repository-controlled text alone: does this PR
 * introduce a new (provider, provider model) pair? The evidence question is
 * handed to a human. See the end of `main()` for the trade this makes.
 *
 * Nothing here may reintroduce a Supabase client, a service-role read, or any
 * other live credential — `check-new-route-eval-evidence.test.ts` asserts it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The Phase 22 closure audit found `check-model-eval-regression.ts` real and
 * fail-closed, but reachable only via `workflow_dispatch` — an operator has
 * to remember to run it. That leaves a real gap: nothing actually stops a
 * new (provider, provider model) pair from entering `model_routes` — the
 * router's own traffic-eligibility table — without ever having been
 * measured. 22-C's own done-criterion is "Threshold aşan upgrade default
 * route olamıyor" (an upgrade exceeding the regression threshold cannot
 * become the default route); a route that could never legally exist without
 * evidence is a stronger, simpler guarantee than trying to detect the exact
 * moment one becomes "default".
 *
 * ---------------------------------------------------------------------------
 * THE REAL PROMOTION PATH THIS GATES — NOT AN INVENTED ONE
 * ---------------------------------------------------------------------------
 * Audited directly: `src/lib/routing/admin-route-service.ts` is the ONLY
 * live route-mutation surface, and it has exactly three operations —
 * enable/disable, change priority, and the runtime kill switch. None of
 * them can introduce a NEW (provider_id, provider_model_id) pair into
 * `model_routes`; that only ever happens via a migration file (confirmed:
 * the only non-test INSERT into `model_routes` anywhere in this repository
 * is in 20260817000000_model_routing.sql). Migrations in this repo are
 * append-only by convention — an already-merged one is never edited — so
 * the only way a new pair reaches `model_routes` is a NEW migration FILE in
 * a PR. Gating every new migration file closes the loop: any pair capable
 * of ever receiving traffic passed through this gate once, and no runtime
 * admin action can introduce a pair that skipped it.
 *
 * ---------------------------------------------------------------------------
 * HOW A NEW ROUTE IS RECOGNIZED — THE REAL, DEMONSTRATED CONVENTION
 * ---------------------------------------------------------------------------
 * 20260817000000_model_routing.sql's own INSERT is a
 * `FROM (VALUES (...)) AS seed(model_id, provider_id, provider_model_id)`
 * block — a plain, git-diffable list of string triples. This script parses
 * exactly that shape from every newly ADDED migration file (never an edited
 * one — migrations don't change in place here). An INSERT INTO
 * "model_routes" found in a new migration that does NOT match this shape is
 * NOT silently skipped: it is reported as UNVERIFIABLE and blocks, because
 * "I could not parse it" and "it is safe" are not the same fact. This is
 * intentionally not a general SQL parser — building one for a hypothetical
 * future shape this repo does not use yet would be exactly the invented
 * parser the Phase 22 corrective brief warns against.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT DO
 * ---------------------------------------------------------------------------
 * It does not run a regression comparison (that stays
 * check-model-eval-regression.ts's job, deliberately manual — see that
 * script's own header for why an automatic candidate/baseline comparison
 * would mean silently spending real provider budget). It only proves
 * evidence EXISTS at all for a pair before it can enter the router's table.
 * A pair that already has a completed run (e.g. a reseed migration
 * reasserting an existing pair) passes trivially — the dangerous case this
 * guards is a pair with NO evidence, not a redundant check on one that
 * already has some.
 */

const ROOT = process.cwd();

function baseRef(): string {
  return process.env.EVAL_GATE_BASE_REF ?? process.argv[2] ?? "origin/main";
}

function gitAddedMigrationFiles(ref: string): string[] | null {
  try {
    const out = execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=A", `${ref}...HEAD`, "--", "supabase/migrations/"],
      { cwd: ROOT, encoding: "utf8" }
    );
    return out.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  } catch {
    return null;
  }
}

function gitShowHead(relPath: string): string | null {
  try {
    return execFileSync("git", ["show", `HEAD:${relPath}`], { cwd: ROOT, encoding: "utf8" });
  } catch {
    return null;
  }
}

export interface RoutePair {
  readonly providerId: string;
  readonly providerModelId: string;
}

export type ExtractResult =
  | { readonly outcome: "found"; readonly pairs: RoutePair[] }
  | { readonly outcome: "none" }
  | { readonly outcome: "unverifiable"; readonly reason: string };

/**
 * Finds every `INSERT INTO "public"."model_routes"` statement and, for each,
 * either extracts the seed(...) triples or reports it as unverifiable.
 * Deliberately simple (statement-boundary = next semicolon) because this
 * repo's migrations write one INSERT per statement, never a nested one.
 * Exported for direct unit testing (see check-new-route-eval-evidence.test.ts)
 * — this is the one piece of this gate genuinely worth testing against real
 * SQL text rather than only asserting the source file's own shape.
 */
export function extractRoutePairs(sql: string): ExtractResult {
  const insertMarker = /INSERT INTO\s+"public"\."model_routes"/g;
  const matches = [...sql.matchAll(insertMarker)];
  if (matches.length === 0) return { outcome: "none" };

  const pairs: RoutePair[] = [];
  for (const match of matches) {
    const start = match.index ?? 0;
    const terminator = sql.indexOf(";", start);
    if (terminator === -1) {
      return { outcome: "unverifiable", reason: "INSERT INTO model_routes has no terminating ';' — cannot bound the statement" };
    }
    const statement = sql.slice(start, terminator);

    if (!/AS\s+seed\(\s*model_id\s*,\s*provider_id\s*,\s*provider_model_id\s*\)/.test(statement)) {
      return {
        outcome: "unverifiable",
        reason:
          "INSERT INTO model_routes does not use the recognized 'FROM (VALUES (...)) AS seed(model_id, provider_id, provider_model_id)' shape",
      };
    }

    const tuplePattern = /\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/g;
    const valuesBlockEnd = statement.search(/\)\s*AS\s+seed/);
    if (valuesBlockEnd === -1) {
      return { outcome: "unverifiable", reason: "could not locate the end of the VALUES block before its seed(...) alias" };
    }
    const valuesBlock = statement.slice(0, valuesBlockEnd);

    let found = 0;
    for (const tuple of valuesBlock.matchAll(tuplePattern)) {
      found += 1;
      pairs.push({ providerId: tuple[2], providerModelId: tuple[3] });
    }
    if (found === 0) {
      return { outcome: "unverifiable", reason: "matched the seed(...) shape but found zero parseable (model_id, provider_id, provider_model_id) tuples" };
    }
  }

  return { outcome: "found", pairs };
}

async function main(): Promise<void> {
  const ref = baseRef();
  const addedFiles = gitAddedMigrationFiles(ref);
  if (addedFiles === null) {
    console.error(
      `check-new-route-eval-evidence: NOT_CONFIGURED — base ref "${ref}" is unavailable (shallow checkout or offline). No comparison was made.`
    );
    process.exit(2);
  }

  if (addedFiles.length === 0) {
    console.log("check-new-route-eval-evidence: no new migration files in this change. Nothing to check. PASS (no-op).");
    return;
  }

  const allPairs: RoutePair[] = [];
  for (const file of addedFiles) {
    const sql = gitShowHead(file);
    if (sql === null) {
      console.error(`check-new-route-eval-evidence: UNVERIFIABLE — could not read ${file} at HEAD.`);
      process.exit(1);
    }
    const extracted = extractRoutePairs(sql);
    if (extracted.outcome === "unverifiable") {
      console.error(
        `check-new-route-eval-evidence: UNVERIFIABLE — ${file}: ${extracted.reason}. ` +
          "A migration touching model_routes must use the recognized seed(...) convention, or be reviewed by hand and this gate updated deliberately. Blocking rather than guessing."
      );
      process.exit(1);
    }
    if (extracted.outcome === "found") allPairs.push(...extracted.pairs);
  }

  if (allPairs.length === 0) {
    console.log(`check-new-route-eval-evidence: ${addedFiles.length} new migration file(s), none touch model_routes. PASS (no-op).`);
    return;
  }

  const uniquePairs = [...new Map(allPairs.map((p) => [`${p.providerId} ${p.providerModelId}`, p])).values()];

  // ---- A NEW PAIR EXISTS. THAT IS WHERE AUTOMATION STOPS. ----------------
  //
  // This gate used to ask a second question here — "does this pair already
  // have a completed golden-dataset run?" — by querying `model_eval_runs`
  // with SUPABASE_SERVICE_ROLE_KEY. That query is gone, and the credential
  // with it. See the SECRET BOUNDARY section in this file's header.
  //
  // What replaces it is deliberately MORE conservative, not less: a new pair
  // never auto-passes now. Previously a pair that already had evidence merged
  // unattended; today every new pair stops for a human. That cost is paid
  // once per new model integration — a rare event — and it buys the removal
  // of an RLS-bypassing credential from PR-controlled execution.
  console.error(
    `check-new-route-eval-evidence: MANUAL_MODEL_EVAL_EVIDENCE_VERIFICATION_REQUIRED — ` +
      `${uniquePairs.length} new (provider, provider_model) pair(s) across ${addedFiles.length} new migration file(s):`
  );
  for (const pair of uniquePairs) {
    console.error(`  - ${pair.providerId}/${pair.providerModelId}`);
  }
  console.error("New migration file(s) inspected:");
  for (const file of addedFiles) {
    console.error(`  - ${file}`);
  }
  console.error(
    "A new (provider, provider model) pair may not enter model_routes without being measured first. " +
      "Before merging, an operator must confirm every pair above has a completed golden-dataset eval run — " +
      "the admin Model Quality surface shows them, or run 'npm run eval:run' against the pair. " +
      "This check deliberately cannot confirm it: PR CI holds no database credential. " +
      "There is no bypass flag; the confirmation is a human decision recorded in the PR. " +
      "See docs/security-gates.md's Phase 22 section."
  );
  process.exit(1);
}

/**
 * Guarded so importing this module for its exported `extractRoutePairs`
 * (see check-new-route-eval-evidence.test.ts) does not also run `main()` —
 * and so `main()` still runs normally under `npm run eval:check-new-route-
 * evidence`, this file's only other caller.
 */
function isDirectlyExecuted(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isDirectlyExecuted()) {
  main().catch((error) => {
    console.error("check-new-route-eval-evidence: unexpected error", error);
    process.exit(1);
  });
}
