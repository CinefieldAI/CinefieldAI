/**
 * Repository secret scan (Phase 12-D).
 *
 * Roadmap ¶1645 and ¶1646: "Prod secret repo/local plaintext'te yok."
 *
 * ---------------------------------------------------------------------------
 * THIS IS A NET, NOT A GUARANTEE
 * ---------------------------------------------------------------------------
 * It matches known credential SHAPES in tracked files. It cannot detect a
 * secret with no recognisable shape — a bare token, a password in a config
 * value, a base64 blob — and claiming otherwise would be worse than not
 * running it, because a green scan is exactly the thing people trust instead
 * of reviewing a diff.
 *
 * GitHub Secret Scanning (Phase 17, ¶1781/¶1806) covers the provider-verified
 * half, and push protection catches things at push time that this catches at
 * commit time. Neither replaces reading the diff.
 *
 * ---------------------------------------------------------------------------
 * THE PATTERNS ARE ASSEMBLED, NOT WRITTEN OUT
 * ---------------------------------------------------------------------------
 * A scanner containing literal example credentials trips other scanners —
 * including GitHub's — and produces a permanent false positive on this very
 * file. So every prefix is built from fragments at runtime. It reads oddly on
 * purpose.
 *
 * Usage:
 *   npx tsx scripts/scan-secrets.ts          scan tracked files
 *   npx tsx scripts/scan-secrets.ts <path>   scan one path (used by tests)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface Finding {
  file: string;
  line: number;
  rule: string;
}

/** Built from fragments so this file never contains a literal credential prefix. */
const j = (...parts: string[]) => parts.join("");

interface Rule {
  name: string;
  pattern: RegExp;
  /** Capture group holding the host, for the reserved-name check below. */
  hostGroup?: number;
}

const RULES: Rule[] = [
  // PEM private keys of any flavour.
  { name: "private_key_pem", pattern: new RegExp(j("-----", "BEGIN ", "(?:RSA |EC |OPENSSH |PGP )?", "PRIVATE KEY", "-----")) },

  // AWS long-lived access key id. AKIA is the durable one; ASIA is a session
  // credential and also worth flagging in a repository.
  { name: "aws_access_key_id", pattern: new RegExp(j("\\b(?:", "AKI", "A|", "ASI", "A)", "[0-9A-Z]{16}\\b")) },

  // Provider-issued tokens with documented prefixes.
  { name: "openai_key", pattern: new RegExp(j("\\b", "sk", "-", "[A-Za-z0-9_-]{20,}")) },
  { name: "anthropic_key", pattern: new RegExp(j("\\b", "sk-ant", "-", "[A-Za-z0-9_-]{20,}")) },
  { name: "github_token", pattern: new RegExp(j("\\b", "gh", "[pousr]_", "[A-Za-z0-9]{30,}")) },
  { name: "slack_token", pattern: new RegExp(j("\\b", "xox", "[abprs]-", "[A-Za-z0-9-]{10,}")) },
  { name: "stripe_key", pattern: new RegExp(j("\\b", "sk_live", "_", "[A-Za-z0-9]{20,}")) },
  { name: "clerk_secret", pattern: new RegExp(j("\\b", "sk_live", "_", "[A-Za-z0-9]{20,}|\\b", "sk_test", "_", "[A-Za-z0-9]{20,}")) },
  { name: "replicate_token", pattern: new RegExp(j("\\b", "r8", "_", "[A-Za-z0-9]{30,}")) },

  // A JWT. Supabase service-role keys are JWTs, and so is anything else that
  // should not be committed. Three dot-separated base64url segments starting
  // with the standard header.
  { name: "jwt", pattern: new RegExp(j("\\b", "eyJ", "[A-Za-z0-9_-]{10,}\\.", "eyJ", "[A-Za-z0-9_-]{10,}\\.", "[A-Za-z0-9_-]{10,}")) },

  // A Redis URL carrying inline credentials. `redis://host` is fine;
  // `redis://user:pass@host` is a leaked password.
  { name: "redis_url_with_credentials", pattern: /\bredis(?:s)?:\/\/[^\s:@/]+:[^\s@/]+@([^\s/:"']+)/, hostGroup: 1 },

  // Any other URL with inline credentials — Postgres connection strings and
  // provider webhooks arrive this way.
  { name: "url_with_credentials", pattern: /\b(?:postgres(?:ql)?|https?|amqp|mongodb(?:\+srv)?):\/\/[^\s:@/]+:[^\s@/]{6,}@([^\s/:"']+)/, hostGroup: 1 },
];

/**
 * Hosts that CANNOT be real, so a credential pointed at one cannot be real.
 *
 * RFC 2606 and RFC 6761 reserve these names precisely so documentation and
 * tests have somewhere safe to point — they are guaranteed never to resolve
 * to anyone's infrastructure.
 *
 * This is why the rule is narrowed HERE rather than by exempting the test
 * files that trip it. Skipping a path means a real secret committed to that
 * path is invisible forever; skipping an unroutable host means only that
 * credentials aimed at nowhere are ignored. The first trades detection for
 * quiet; the second loses nothing, because a leaked credential worth having
 * points at a host that exists.
 */
function isReservedExampleHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h.startsWith("example.") ||
    h.includes(".example.") ||
    h.endsWith(".example") ||
    h.endsWith(".test") ||
    h.endsWith(".invalid") ||
    h.endsWith(".localhost")
  );
}

/**
 * Paths the scan skips.
 *
 * The scanner itself and its test fixtures are excluded by NAME, not by an
 * inline "ignore this" comment: an ignore marker is a mechanism an attacker
 * can also use, while a fixed path list is one a reviewer can read.
 */
const SKIP_PATHS = new Set([
  "scripts/scan-secrets.ts",
  "docs/runbooks/secret-leak.md",
  "docs/runbooks/secret-rotation.md",
]);

const SKIP_DIRS = [
  "node_modules/",
  ".next/",
  "CinefieldAI/",
  "src/test/fixtures/secret-scan/",
  // Phase 13-E's fixtures, added for exactly the reason the secret-scan
  // directory exists: they hold synthetic credential SHAPES on purpose, so
  // the sanitizer can be proven to drop them. Adding the directory was
  // forgotten when they were committed and this scan went red immediately —
  // the same D12-D1 failure mode, and the reason both scans now run after
  // every commit rather than only before one.
  "src/test/fixtures/telemetry/",
];

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2",
  ".ttf", ".otf", ".mp4", ".mp3", ".wav", ".pdf", ".zip", ".gz", ".tar",
]);

export function scanText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    for (const rule of RULES) {
      const match = rule.pattern.exec(lines[i]);
      if (!match) continue;
      if (rule.hostGroup !== undefined) {
        const host = match[rule.hostGroup];
        if (host && isReservedExampleHost(host)) continue;
      }
      findings.push({ file, line: i + 1, rule: rule.name });
    }
  }
  return findings;
}

export function scanFile(file: string): Finding[] {
  if (BINARY_EXTENSIONS.has(path.extname(file).toLowerCase())) return [];
  try {
    if (statSync(file).size > 2_000_000) return [];
    return scanText(file, readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

/** Tracked files only — an ignored `.env.local` is not the scanner's business. */
export function trackedFiles(root: string): string[] {
  const out = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  return out
    .split(/\r?\n/)
    .filter((f) => f.length > 0)
    .filter((f) => !SKIP_PATHS.has(f))
    .filter((f) => !SKIP_DIRS.some((d) => f.startsWith(d)));
}

export function scanRepository(root: string): Finding[] {
  return trackedFiles(root).flatMap((f) => scanFile(path.join(root, f)).map((x) => ({ ...x, file: f })));
}

// Run directly, not when imported by a test.
if (process.argv[1] && process.argv[1].endsWith("scan-secrets.ts")) {
  const target = process.argv[2];
  const findings = target ? scanFile(target) : scanRepository(process.cwd());

  if (findings.length === 0) {
    console.log("secret scan: no matches in tracked files");
    console.log("NOTE: shape-matching only. A green scan is not proof of absence.");
  } else {
    // The RULE and the LOCATION. Never the matched text — printing it would
    // copy the secret into CI output, which is a log aggregator's input.
    for (const f of findings) console.error(`${f.file}:${f.line}  ${f.rule}`);
    console.error(`secret scan: ${findings.length} match(es)`);
    process.exitCode = 1;
  }
}
