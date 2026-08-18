import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Cinefield breaking-change detector for the event schema registry
 * (Phase 20-D — "Kafka schema compatibility... CI gate'i ekle").
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CATCHES, PRECISELY
 * ---------------------------------------------------------------------------
 * `schema-registry.ts`'s own documented policy is: a registered
 * `eventType@eventVersion` schema may be edited IN PLACE only for
 * compatible changes (adding an optional field, widening an enum,
 * relaxing a bound); an INCOMPATIBLE change requires registering a NEW
 * version instead of mutating the old one, because old consumers and
 * already-published events depend on that version's shape staying what it
 * was.
 *
 * This script proves that rule held for a real change: for every schema
 * key (`eventType@eventVersion`) that exists in BOTH a base git ref and the
 * current working tree, it runs the registry's own `classifyCompatibility`
 * function against the two shapes. A `compatible: false` verdict means an
 * ALREADY-PUBLISHED version's schema was mutated incompatibly in place —
 * exactly the silent breaking change Phase 20 exists to block. It does NOT
 * flag a brand-new version key (`@2` added alongside `@1`) as anything —
 * that is the CORRECT way to make an incompatible change.
 *
 * ---------------------------------------------------------------------------
 * HOW THE BASE REVISION IS READ
 * ---------------------------------------------------------------------------
 * `git show <baseRef>:<path>` for exactly the two files the registry
 * depends on (`event-schemas.ts`, `json-schema.ts`) — no network, no GitHub
 * API. Written to a throwaway temp directory (never inside the repo tree)
 * and dynamically imported from there, so the comparison runs the SAME
 * `classifyCompatibility` logic (imported normally, from the CURRENT
 * working tree) against real old data, not a hand-parsed approximation of
 * it. If the validator engine itself (`json-schema.ts`) also changed
 * between the two revisions, that is reported as a separate, honest
 * warning rather than silently trusted or silently ignored.
 */

const ROOT = process.cwd();
const REGISTRY_REL = "src/lib/events/event-schemas.ts";
const VALIDATOR_REL = "src/lib/events/json-schema.ts";

function baseRef(): string {
  return process.env.CONTRACT_BASE_REF ?? process.argv[2] ?? "origin/main";
}

function gitShow(ref: string, relPath: string): string | null {
  try {
    return execFileSync("git", ["show", `${ref}:${relPath}`], { cwd: ROOT, encoding: "utf8" });
  } catch {
    return null;
  }
}

async function loadBaseRegistry(
  ref: string
): Promise<{ schemas: Map<string, unknown>; validatorChanged: boolean } | null> {
  const registrySource = gitShow(ref, REGISTRY_REL);
  const validatorSource = gitShow(ref, VALIDATOR_REL);
  if (registrySource === null || validatorSource === null) return null;

  const currentValidatorSource = gitShow("HEAD", VALIDATOR_REL);
  const validatorChanged = currentValidatorSource !== null && currentValidatorSource !== validatorSource;

  const tempDir = mkdtempSync(path.join(tmpdir(), "cinefield-contract-check-"));
  try {
    const eventsDir = path.join(tempDir, "events");
    mkdirSync(eventsDir, { recursive: true });
    writeFileSync(path.join(eventsDir, "event-schemas.ts"), registrySource, "utf8");
    writeFileSync(path.join(eventsDir, "json-schema.ts"), validatorSource, "utf8");

    const mod = (await import(pathToFileURL(path.join(eventsDir, "event-schemas.ts")).href)) as {
      EVENT_SCHEMAS: Map<string, { schemaName: string; eventType: string; eventVersion: number; payload: unknown }>;
    };
    return { schemas: mod.EVENT_SCHEMAS as unknown as Map<string, unknown>, validatorChanged };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const ref = baseRef();
  const base = await loadBaseRegistry(ref);
  if (!base) {
    console.log(`contracts:check-compat: base ref "${ref}" or its registry files are unavailable — nothing to compare (first change, or shallow checkout).`);
    return;
  }

  const { EVENT_SCHEMAS: currentSchemas } = (await import(pathToFileURL(path.join(ROOT, REGISTRY_REL)).href)) as {
    EVENT_SCHEMAS: Map<string, { schemaName: string; eventType: string; eventVersion: number; payload: unknown }>;
  };
  const { classifyCompatibility } = (await import(
    pathToFileURL(path.join(ROOT, "src/lib/events/schema-registry.ts")).href
  )) as { classifyCompatibility: (a: unknown, b: unknown) => { compatible: boolean; breaks?: string[] } };

  if (base.validatorChanged) {
    console.log(
      `contracts:check-compat: WARNING — json-schema.ts (the validator engine itself) changed between ${ref} and HEAD. ` +
        `Payload comparisons below still ran, but a validator-level change is not something this script can classify — review it by hand.`
    );
  }

  const breakingFindings: string[] = [];
  let comparedCount = 0;

  for (const [key, currentEntry] of currentSchemas as unknown as Map<
    string,
    { schemaName: string; payload: unknown }
  >) {
    const baseEntry = (base.schemas as unknown as Map<string, { schemaName: string; payload: unknown }>).get(key);
    if (!baseEntry) continue; // new key — a new version or a new event type, never a mutation.
    comparedCount += 1;

    if (JSON.stringify(baseEntry.payload) === JSON.stringify(currentEntry.payload)) continue;

    const verdict = classifyCompatibility(baseEntry.payload, currentEntry.payload);
    if (!verdict.compatible) {
      breakingFindings.push(
        `${key} (${currentEntry.schemaName}): ALREADY-PUBLISHED version mutated incompatibly — ${(verdict.breaks ?? []).join(", ")}. ` +
          `Register a NEW eventVersion instead of editing this one in place.`
      );
    }
  }

  console.log(`contracts:check-compat: compared ${comparedCount} unchanged-key schema(s) against ${ref}.`);

  if (breakingFindings.length > 0) {
    console.error("contracts:check-compat: BREAKING CHANGE(S) DETECTED:");
    for (const finding of breakingFindings) console.error(`  - ${finding}`);
    process.exit(1);
  }

  console.log("contracts:check-compat: no breaking in-place schema mutation found.");
}

main().catch((error) => {
  console.error("contracts:check-compat: failed", error);
  process.exit(1);
});
