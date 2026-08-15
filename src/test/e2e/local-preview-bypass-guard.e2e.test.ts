import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * `CINEFIELD_LOCAL_PREVIEW` may only bypass authentication on a developer's
 * machine.
 *
 * The flag makes `proxy.ts` skip Clerk for the entire matcher — every page in
 * the application. It was unconditional, and the control that should have
 * caught it in production (`validateConfiguration()`, which registers the
 * name LOCAL_ONLY and refuses it) is never called in the web tier: the three
 * long-lived workers call `assertStartupConfiguration`, but a serverless
 * function has no startup to hook. The control existed and never ran.
 *
 * The realistic incident: `.env.example` documents this name, someone copies
 * that file into a Vercel project's environment variables, and every page
 * silently loses authentication with nothing reporting it.
 *
 * These tests exercise the decision logic against the real source rather than
 * mocking a middleware invocation, because the property that matters is the
 * CONDITION — and the condition is what a future edit would weaken.
 */

const ROOT = process.cwd();
const PROXY = readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");

/**
 * The predicate as written in `proxy.ts`.
 *
 * Duplicated here deliberately: the middleware cannot be imported into a test
 * process (it pulls Clerk's Edge middleware), so the guard below asserts this
 * copy still matches the source line for line. If someone edits the real one,
 * that assertion fails rather than this file quietly testing a stale rule.
 */
function isLocalDevelopment(env: Record<string, string | undefined>): boolean {
  if (env.VERCEL_ENV !== undefined) return false;
  const declared = env.CINEFIELD_ENV;
  if (declared === "production" || declared === "staging") return false;
  return env.NODE_ENV !== "production";
}

function bypasses(env: Record<string, string | undefined>): boolean {
  return env.CINEFIELD_LOCAL_PREVIEW === "1" && isLocalDevelopment(env);
}

test("1. the bypass is refused on every Vercel deployment, production and preview alike", () => {
  for (const vercelEnv of ["production", "preview", "development"]) {
    assert.equal(
      bypasses({ CINEFIELD_LOCAL_PREVIEW: "1", VERCEL_ENV: vercelEnv }),
      false,
      `VERCEL_ENV=${vercelEnv} still bypassed auth`
    );
  }
  // The presence of the marker is what decides, not its value — Vercel sets it
  // on every deployment, so a machine that has it is not a local machine.
  assert.equal(bypasses({ CINEFIELD_LOCAL_PREVIEW: "1", VERCEL_ENV: "" }), false);
});

test("2. the bypass is refused whenever the environment names production or staging", () => {
  for (const declared of ["production", "staging"]) {
    assert.equal(bypasses({ CINEFIELD_LOCAL_PREVIEW: "1", CINEFIELD_ENV: declared }), false, declared);
  }
  assert.equal(bypasses({ CINEFIELD_LOCAL_PREVIEW: "1", NODE_ENV: "production" }), false);
});

test("3. local development still works — the guard must not be one developers disable", () => {
  assert.equal(bypasses({ CINEFIELD_LOCAL_PREVIEW: "1" }), true);
  assert.equal(bypasses({ CINEFIELD_LOCAL_PREVIEW: "1", NODE_ENV: "development" }), true);
  assert.equal(bypasses({ CINEFIELD_LOCAL_PREVIEW: "1", CINEFIELD_ENV: "development" }), true);
});

test("4. without the flag nothing is bypassed, in any environment", () => {
  for (const env of [{}, { NODE_ENV: "development" }, { CINEFIELD_LOCAL_PREVIEW: "0" }, { CINEFIELD_LOCAL_PREVIEW: "true" }]) {
    assert.equal(bypasses(env), false, JSON.stringify(env));
  }
});

test("5. the predicate in this test still matches the one in proxy.ts", () => {
  // Without this, the four tests above could pass forever against a rule the
  // middleware no longer uses.
  const source = PROXY.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(source, /if \(process\.env\.VERCEL_ENV !== undefined\) return false;/);
  assert.match(source, /declared === "production" \|\| declared === "staging"/);
  assert.match(source, /return process\.env\.NODE_ENV !== "production";/);
  assert.match(
    source,
    /process\.env\.CINEFIELD_LOCAL_PREVIEW === "1" && isLocalDevelopment\(\)/,
    "the bypass is no longer conditional on the environment"
  );
  // And Clerk is still the default path.
  assert.match(source, /return clerkProxy\(request, event\);/);
});

test("6. the flag stays registered LOCAL_ONLY, so the validator keeps refusing it too", () => {
  // Belt and braces: the middleware guard is the one that runs, but the
  // 12-D registry entry is what makes the worker-side validator reject a
  // deployment carrying this flag at all.
  const registry = readFileSync(path.join(ROOT, "src/lib/config/secret-registry.ts"), "utf8");
  assert.match(registry, /name: "CINEFIELD_LOCAL_PREVIEW", class: "LOCAL_ONLY"/);
});
