import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * LEGAL SURFACE HONESTY — regression guards.
 *
 * The product used to tell every visitor at the auth screen that continuing
 * meant they agreed to a Privacy Policy and Terms of Use. Neither document
 * existed, and both links 404'd. These tests exist so that claim cannot come
 * back while the documents are still unwritten.
 *
 * They are deliberately SEMANTIC rather than snapshot-based: the wording is
 * allowed to change, the assertion of acceptance is not.
 */

const ROOT = process.cwd();
const AUTH = path.join(ROOT, "src/components/auth/PasswordSignIn.tsx");
const NOTICE = path.join(ROOT, "src/components/legal/LegalPendingNotice.tsx");
const TERMS = path.join(ROOT, "src/app/terms/page.tsx");
const PRIVACY = path.join(ROOT, "src/app/privacy/page.tsx");

/** Source with comments stripped — a comment explaining the old claim must not trip the guard. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// ===========================================================================
// A. The auth surface no longer asserts acceptance
// ===========================================================================

test("L-1  the auth screen makes no claim that continuing accepts anything", () => {
  const src = code(AUTH);
  for (const claim of [
    /you\s+agree\s+to/i,
    /by\s+continuing[^.]{0,40}\bagree\b/i,
    /by\s+signing\s+up[^.]{0,40}\bagree\b/i,
    /agree\s+to\s+(our|the)\s+(terms|privacy)/i,
    /accept(ing)?\s+(our|the)\s+(terms|privacy)/i,
    /consent\s+to\s+(our|the)\s+(terms|privacy)/i,
  ]) {
    assert.doesNotMatch(src, claim, `the auth surface must not assert acceptance: ${claim}`);
  }
});

test("L-2  the auth screen states the documents are unpublished", () => {
  const src = code(AUTH);
  assert.match(
    src,
    /not\s+published\s+yet|being\s+prepared/i,
    "a visitor must be told the documents do not exist yet, not left to guess"
  );
});

// ===========================================================================
// B/C. The linked routes resolve
// ===========================================================================

test("L-3  every legal route the auth screen links to actually exists", () => {
  const src = readFileSync(AUTH, "utf8");
  const linked = [...src.matchAll(/href="(\/[a-z-]+)"/g)]
    .map((m) => m[1])
    .filter((h) => ["/terms", "/privacy", "/impressum", "/cookies", "/aup", "/legal"].includes(h));

  assert.ok(linked.length > 0, "the auth screen should still point somewhere for status");

  for (const route of new Set(linked)) {
    assert.ok(
      existsSync(path.join(ROOT, "src/app", route.slice(1), "page.tsx")),
      `${route} is linked from the auth screen but has no page — that is the 404 this batch closed`
    );
  }
});

// ===========================================================================
// D. A status page cannot be mistaken for a finalised legal document
// ===========================================================================

test("L-4  the status pages invent no legal content", () => {
  const all = [code(NOTICE), code(TERMS), code(PRIVACY)].join("\n");
  for (const fabricated of [
    /Firmenbuch|UID[- ]?Nummer|registered office|company registration/i,
    /governing law|jurisdiction of|shall be governed/i,
    /limitation of liability|we are not liable|disclaim(s|er) of warranties/i,
    /we retain your data for|retention period of \d/i,
    /legitimate interest|lawful basis is/i,
    /right of withdrawal|cooling[- ]off period/i,
    /you must be (at least )?\d+ years/i,
    /we use cookies|essential cookies only/i,
  ]) {
    assert.doesNotMatch(all, fabricated, `no legal text may be invented here: ${fabricated}`);
  }
});

test("L-5  the privacy page does not present itself AS the privacy notice", () => {
  const src = code(PRIVACY) + code(NOTICE);
  assert.doesNotMatch(
    src,
    /this (privacy )?(notice|policy) (describes|explains|sets out|applies)/i,
    "a status page must not speak as though it were the notice itself"
  );
  assert.match(src, /has not been published/i, "it must say plainly that the document is absent");
});

test("L-6  neither status page implies acceptance", () => {
  const all = [code(NOTICE), code(TERMS), code(PRIVACY)].join("\n");
  for (const claim of [
    /by using (this|the) (site|service|platform)[^.]{0,40}\bagree\b/i,
    /continued use[^.]{0,40}\b(accept|agree)/i,
    /you agree/i,
    /these terms apply/i,
  ]) {
    assert.doesNotMatch(all, claim, `a status page may not form an agreement: ${claim}`);
  }
});

// ===========================================================================
// E/F. No acceptance is claimed, versioned, or stored
// ===========================================================================

test("L-7  no versioned legal acceptance is emitted anywhere in this surface", () => {
  const all = [code(AUTH), code(NOTICE), code(TERMS), code(PRIVACY)].join("\n");
  for (const versioned of [
    /terms[_ ]?version/i,
    /policy[_ ]?version/i,
    /accepted[_ ]?at/i,
    /acceptance[_ ]?id/i,
    /consent[_ ]?version/i,
  ]) {
    assert.doesNotMatch(all, versioned, `no version/acceptance token may exist yet: ${versioned}`);
  }
});

test("L-8  no legal acceptance store is written — the absence stays explicit", () => {
  const all = [code(AUTH), code(NOTICE), code(TERMS), code(PRIVACY)].join("\n");
  for (const write of [/legal_documents/, /legal_acceptances/, /recordLegalAcceptance/, /consent_records/]) {
    assert.doesNotMatch(all, write, `Phase 29 owns the acceptance store; this batch creates none: ${write}`);
  }
  // And the status pages must not reach a database at all.
  for (const file of [NOTICE, TERMS, PRIVACY]) {
    const src = code(file);
    assert.doesNotMatch(src, /supabase|\.rpc\(|from\(["'`]/i, `${path.basename(file)} must not touch a database`);
  }
});

// ===========================================================================
// G. The auth flow itself still works
// ===========================================================================

test("L-9  the correction did not disturb the Clerk sign-in flow", () => {
  const src = code(AUTH);
  assert.match(src, /signIn\.password\(/, "password sign-in must still be wired");
  assert.match(src, /setActive\(/, "session activation must still be wired");
  assert.match(src, /<LegalFooter \/>/, "the footer must still render on the auth surfaces");
  // Every surface that showed the footer before must still show it.
  assert.equal(
    (src.match(/<LegalFooter \/>/g) ?? []).length,
    7,
    "all seven auth surfaces keep the footer — the fix is the wording, not its removal"
  );
});
