/**
 * CI telemetry call-site scan (Phase 13-E).
 *
 * Roadmap ¶1722: "CI'da secret-in-log taraması koşar."
 *
 * ---------------------------------------------------------------------------
 * DIFFERENT JOB FROM scan-secrets.ts
 * ---------------------------------------------------------------------------
 * `scan-secrets.ts` looks for secret VALUES committed to the repository. This
 * looks for risky log CALL SITES — code that would put a secret into telemetry
 * at RUNTIME, where no committed value exists to find. A repository can be
 * perfectly clean by the first scanner and still ship prompts to Sentry.
 *
 * ---------------------------------------------------------------------------
 * IT MATCHES ARGUMENTS, NOT WHOLE FILES
 * ---------------------------------------------------------------------------
 * A blanket "no console in src/" rule is brittle: it fires on comments,
 * strings and legitimate process-lifecycle output, so people add ignore
 * markers and the rule stops meaning anything. This extracts the ARGUMENT
 * TEXT of each log call — depth-aware, from the opening paren to its match —
 * and flags what is being passed.
 *
 * Two things the first version got wrong, both fixed here and both worth
 * recording because they are the usual ways a scanner like this becomes
 * useless:
 *
 *   1. It replaced block comments with an empty string, collapsing their
 *      newlines. Every line number after a doc comment was wrong and text
 *      slid upward into what looked like a log argument.
 *   2. It matched a bare `e` as an error variable and used a fixed six-line
 *      window. Between them that produced 45 findings, 44 of them false.
 *
 * A scanner that cries wolf is worse than none, because the response is to
 * stop reading it.
 *
 * Usage:
 *   npx tsx scripts/scan-telemetry.ts          scan production sources
 *   npx tsx scripts/scan-telemetry.ts <path>   scan one file (used by tests)
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export interface TelemetryFinding {
  file: string;
  line: number;
  rule: string;
}

/**
 * Files that may hand a raw thrown value to console.
 *
 * PROCESS LIFECYCLE ONLY — started, stopped, refusing to start, fatal. They
 * must survive a broken logger: "the logger threw" is exactly when you need
 * to see why a process died, and these run before or after the loop the
 * logger serves.
 *
 * Scoped to named FILES, never a directory, and the exemption covers exactly
 * ONE rule. A lifecycle file logging a request, a body, headers, a prompt or
 * an environment variable is still a finding.
 */
const LIFECYCLE_FILES: ReadonlySet<string> = new Set([
  "worker/temporal-worker.ts",
  "worker/provider-worker.ts",
  "worker/realtime-dispatcher-worker.ts",
  "src/lib/config/startup-validation.ts",
  "src/lib/bullmq/bullmq-config.ts",
  "src/lib/observability/logger.ts",
]);

/** Which rules a lifecycle file is exempt from. Never "all of them". */
const LIFECYCLE_EXEMPT_RULES: ReadonlySet<string> = new Set([
  "raw_error_object",
  // Three startup lines spread a locally-defined `describe*()` result —
  // `describeRedisSecurity().bullmq` and `describeSqsConfig()`. Both return a
  // typed record of booleans plus a connection FINGERPRINT (never a URL), and
  // both exist specifically to be logged safely. The waiver is backed by a
  // test asserting those functions return only booleans and short strings, so
  // it rests on a checked property rather than on trust.
  "object_spread",
]);

/**
 * Client components are out of scope for THIS scanner.
 *
 * Not an exemption to dodge findings — a different contract. This scanner
 * enforces the SERVER telemetry allow-list, whose threat model is "a second
 * copy of production data in a third-party system" (¶1753). A `console.log`
 * in a browser component writes to the user's own console; it copies nothing
 * anywhere. Client telemetry needs its own restricted contract before it can
 * be scanned meaningfully, and Phase 13 has not written one.
 *
 * That is NOT a claim the client code is clean. Two client components log the
 * user's raw prompt, and `phase-13e-sensitive-data-guard.e2e.test.ts` pins
 * both so a third cannot appear unnoticed. One of them is inside a locked
 * route and needs an explicit unlock before it can be touched.
 */
function isClientModule(text: string): boolean {
  return /^\s*["']use client["']/m.test(text);
}

const SKIP_DIRS = ["node_modules/", ".next/", "CinefieldAI/", "src/test/", "scripts/"];

/** What must never be handed to a log or telemetry call. */
const ARGUMENT_RULES: { name: string; pattern: RegExp }[] = [
  // A raw thrown value. `errorFields(error)` is the sanctioned form, and
  // `.name` / `.code` / `instanceof` are inspections rather than payloads.
  // A bare single-letter `e` is deliberately not matched — it is a loop
  // variable everywhere.
  // `error:` as an object KEY is the allow-listed field carrying a code —
  // `{ error: caught instanceof Error ? caught.name : "Unknown" }` is the
  // sanctioned pattern and appears 33 times. Excluding a following `:` is
  // what separates the key from a raw value being passed; without it this
  // rule flagged every safe call site in the Redis and routing modules.
  {
    name: "raw_error_object",
    pattern:
      /(?<!errorFields\()(?<![\w.])(?:error|err|caught|thrown)\b(?!\s*(?::|instanceof|\.name|\.code)|Code\b|Class\b|Fields\b|Message\b)/,
  },
  { name: "process_env", pattern: /process\.env/ },
  // `request.cinefieldModelId` reads one scalar off a domain object; passing
  // `request` WHOLE is the hazard. Without the lookahead this fired on four
  // safe routing log lines.
  { name: "request_object", pattern: /(?<![\w.])(?:req|request)\b(?!\s*\.)/ },
  { name: "request_body", pattern: /\.(?:body|json\(\))/ },
  { name: "headers", pattern: /(?<![\w.])headers?\b/i },
  {
    name: "provider_response",
    pattern: /(?<![\w.])(?:providerResponse|rawResponse|responseBody|payload)\b(?!\s*\.)/i,
  },
  { name: "prompt", pattern: /(?<![\w.])(?:prompt|negativePrompt|systemPrompt)\b/i },
  { name: "object_spread", pattern: /\.\.\.(?!errorFields)/ },
  { name: "stack", pattern: /\.stack\b/ },
  {
    name: "secret_variable",
    pattern: /\b(?:SECRET|API_KEY|TOKEN|SERVICE_ROLE|REDIS_URL|PASSWORD)\b/,
  },
];

const NEWLINE = String.fromCharCode(10);

/** Blanks a run of text, keeping every newline so line numbers survive. */
function blank(text: string): string {
  let out = "";
  for (const ch of text) out += ch === NEWLINE ? NEWLINE : " ";
  return out;
}

/**
 * Removes comments and string literal CONTENTS, preserving line count.
 *
 * Quotes are kept so a call passing a fixed message still looks like a call,
 * while the words inside cannot match a rule — a comment explaining "never
 * log the prompt" must not be a finding.
 */
export function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1: string) => p1 + blank(m.slice(p1.length)))
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => '"' + blank(m.slice(1, -1)) + '"')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, (m) => "'" + blank(m.slice(1, -1)) + "'")
    .replace(/`(?:[^`\\]|\\.)*`/g, (m) => "`" + blank(m.slice(1, -1)) + "`");
}

const CALL_START =
  /(?:console\.(?:log|info|warn|error|debug)|logger\.(?:info|warn|error|debug)|log\.(?:info|warn|error|debug)|(?<![\w.])log)\s*\(/g;

/** Extracts each log call's argument text, depth-aware rather than by window. */
function logCallArguments(code: string): { args: string; line: number }[] {
  const out: { args: string; line: number }[] = [];
  CALL_START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL_START.exec(code)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let i = open;
    for (; i < code.length && i < open + 4000; i += 1) {
      if (code[i] === "(") depth += 1;
      else if (code[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push({
      args: code.slice(open + 1, i),
      line: code.slice(0, m.index).split(NEWLINE).length,
    });
  }
  return out;
}

export function scanTelemetryText(file: string, text: string): TelemetryFinding[] {
  if (isClientModule(text)) return [];
  const code = stripNonCode(text);
  const findings: TelemetryFinding[] = [];
  const lifecycleExempt = LIFECYCLE_FILES.has(file.replace(/\\/g, "/"));

  for (const call of logCallArguments(code)) {
    for (const rule of ARGUMENT_RULES) {
      if (lifecycleExempt && LIFECYCLE_EXEMPT_RULES.has(rule.name)) continue;
      if (rule.pattern.test(call.args)) {
        findings.push({ file, line: call.line, rule: rule.name });
      }
    }
  }
  return findings;
}

/**
 * Scans one file, keyed on its REPO-RELATIVE path.
 *
 * The normalisation is the point. The lifecycle exemption is a set of
 * repo-relative names, so an absolute path silently matched nothing and every
 * exemption vanished — the same mistake, made twice, once here and once in
 * `scanTelemetryRepository`. Normalising inside means a caller cannot get it
 * wrong by passing the path it naturally has.
 */
export function scanTelemetryFile(file: string): TelemetryFinding[] {
  try {
    const rel = path.isAbsolute(file) ? path.relative(process.cwd(), file) : file;
    return scanTelemetryText(rel.replace(/\\/g, "/"), readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

export function productionSources(root: string): string[] {
  const out = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  return out
    .split(/\r?\n/)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
    .filter((f) => !SKIP_DIRS.some((d) => f.startsWith(d)));
}

export function scanTelemetryRepository(root: string): TelemetryFinding[] {
  return productionSources(root).flatMap((rel) => {
    // The REPO-RELATIVE path is what reaches scanTelemetryText, because that
    // is what the lifecycle exemption is keyed on. Passing the absolute path
    // and renaming afterwards silently disabled every exemption.
    try {
      return scanTelemetryText(rel, readFileSync(path.join(root, rel), "utf8"));
    } catch {
      return [];
    }
  });
}

if (process.argv[1] && process.argv[1].endsWith("scan-telemetry.ts")) {
  const target = process.argv[2];
  const findings = target
    ? scanTelemetryFile(target).map((f) => ({ ...f, file: target }))
    : scanTelemetryRepository(process.cwd());

  if (findings.length === 0) {
    console.log("telemetry scan: no risky log call sites in production sources");
    console.log("NOTE: call-site matching only. It cannot prove a runtime value is safe.");
  } else {
    // The rule and the location. Never the matched text — printing it would
    // copy the very argument the rule is worried about into CI output.
    for (const f of findings) console.error(`${f.file}:${f.line}  ${f.rule}`);
    console.error(`telemetry scan: ${findings.length} risky call site(s)`);
    process.exitCode = 1;
  }
}
