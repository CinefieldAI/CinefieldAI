import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectCatalog } from "../src/lib/orchestration/capability-projection";

/**
 * Emits the public model catalog the browser imports (Phase 7-F).
 *
 * WHY A GENERATED FILE AND NOT A DIRECT IMPORT
 * The projection is derived from `model-registry.ts`, which also holds
 * `providerId` and `providerModelId` — "fal-ai/flux/schnell",
 * "gemini-3-pro-image". Importing the projection from a client component
 * would evaluate the registry in the browser and ship those strings in the
 * bundle. They are not secrets, but publishing the provider map to every
 * visitor contradicts the whole point of having a projection.
 *
 * So the projection runs at build time and only its OUTPUT is committed. The
 * browser gets capabilities and nothing else; the registry never leaves the
 * server.
 *
 * This is a build artifact, NOT a second source of truth. A test regenerates
 * it in memory and fails if the committed file differs, so a registry change
 * that was not regenerated breaks the suite instead of quietly drifting.
 *
 *   npm run catalog:generate
 */

const OUTPUT = join(process.cwd(), "src", "lib", "orchestration", "public-model-catalog.ts");

export function renderCatalog(): string {
  const catalog = projectCatalog();
  return `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Produced by scripts/generate-public-catalog.ts from the canonical model
// registry. Run \`npm run catalog:generate\` after changing a model's
// capabilities; src/test/e2e/phase-7-routing.e2e.test.ts fails if this file
// and the registry disagree.
//
// Contains capabilities only. No provider id, no provider endpoint, no route,
// no priority, no cost — the browser has no business knowing where a
// generation runs.

import type { PublicModelDescriptor } from "./capability-projection";

export const PUBLIC_MODEL_CATALOG: readonly PublicModelDescriptor[] = ${JSON.stringify(
    catalog,
    null,
    2
  )} as const;
`;
}

if (process.argv[1] && process.argv[1].includes("generate-public-catalog")) {
  writeFileSync(OUTPUT, renderCatalog(), "utf8");
  console.info(`wrote ${OUTPUT}`);
}
