import "server-only";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildC2paManifest } from "./manifest-builder";
import { CLAIM_GENERATOR, type DigitalSourceType } from "./provenance-contract";

/**
 * C2PA embedding + official verification.
 *
 * Uses ContentAuth's maintained `@contentauth/c2pa-node` binding. The former
 * `c2pa-node` package is deprecated and pinned a vulnerable image dependency,
 * so it is deliberately no longer part of the production dependency graph.
 *
 * The native SDK is lazy-loaded. Environments that cannot load its binary fail
 * closed with `c2pa_unavailable`; importing an unrelated server route never
 * crashes merely because C2PA is unavailable.
 */

export type EmbedOutcome =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly signerIssuer: string;
      readonly officiallyVerified: true;
    }
  | {
      readonly ok: false;
      readonly reasonCode:
        | "c2pa_unavailable"
        | "signer_not_configured"
        | "unsupported_format"
        | "embed_failed"
        | "verify_failed"
        | "manifest_invalid";
      readonly validationCodes?: readonly string[];
    };

const EMBEDDABLE_MIMES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "video/mp4",
  "audio/wav",
]);

export function isEmbeddableMime(mime: string): boolean {
  return EMBEDDABLE_MIMES.has(mime);
}

const EXTENSION_FOR_MIME: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "video/mp4": "mp4",
  "audio/wav": "wav",
};

/**
 * Production default is always `none` until a real trust-list identity is
 * provisioned. `test` exists only for the repository proof harness.
 */
export type C2paSignerMode = "none" | "test";

interface TestSignerMaterial {
  readonly certificatePem: string;
  readonly privateKeyPem: string;
}

let signerMode: C2paSignerMode = "none";
let testSignerMaterial: TestSignerMaterial | null = null;

export function currentC2paSignerMode(): C2paSignerMode {
  return signerMode;
}

export function setC2paSignerMode(mode: C2paSignerMode): void {
  if (mode === "test" && process.env.NODE_ENV === "production") {
    throw new Error("C2PA_TEST_SIGNER_FORBIDDEN_IN_PRODUCTION");
  }
  signerMode = mode;
}

/**
 * Test-only seam. The proof script generates an ephemeral certificate/key at
 * runtime; no private key (even a development key) is committed to the repo.
 */
export function setC2paTestSignerMaterialForTesting(material: TestSignerMaterial | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("C2PA_TEST_SIGNER_FORBIDDEN_IN_PRODUCTION");
  }
  testSignerMaterial = material;
}

export function resetC2paSignerMode(): void {
  signerMode = "none";
  testSignerMaterial = null;
}

export interface EmbedParams {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly digitalSourceType: DigitalSourceType;
  readonly softwareAgent: string;
}

function boundedValidationCodes(status: unknown): readonly string[] {
  if (!Array.isArray(status)) return [];
  return status
    .map((entry) => {
      if (entry && typeof entry === "object" && "code" in entry) {
        return String((entry as { code?: unknown }).code ?? "unknown");
      }
      return String(entry ?? "unknown");
    })
    .slice(0, 10);
}

function activeManifestFromStore(store: unknown): Record<string, unknown> | null {
  if (!store || typeof store !== "object") return null;
  const record = store as {
    active_manifest?: unknown;
    manifests?: Record<string, unknown>;
  };
  if (typeof record.active_manifest !== "string" || !record.manifests) return null;
  const active = record.manifests[record.active_manifest];
  return active && typeof active === "object" ? (active as Record<string, unknown>) : null;
}

function signerIssuerFromManifest(active: Record<string, unknown> | null): string {
  const signature = active?.signature_info;
  if (!signature || typeof signature !== "object") return "unknown";
  return String((signature as { issuer?: unknown }).issuer ?? "unknown").slice(0, 200);
}

function claimGeneratorFromManifest(active: Record<string, unknown> | null): string {
  return String(active?.claim_generator ?? "unknown").slice(0, 200);
}

function digitalSourceTypeFromManifest(active: Record<string, unknown> | null): string | null {
  const assertions = active?.assertions;
  if (!Array.isArray(assertions)) return null;
  for (const assertion of assertions) {
    if (!assertion || typeof assertion !== "object") continue;
    const a = assertion as { label?: unknown; data?: unknown };
    if (a.label !== "c2pa.actions" && a.label !== "c2pa.actions.v2") continue;
    if (!a.data || typeof a.data !== "object") continue;
    const actions = (a.data as { actions?: unknown }).actions;
    if (!Array.isArray(actions) || !actions[0] || typeof actions[0] !== "object") continue;
    const dst = (actions[0] as { digitalSourceType?: unknown }).digitalSourceType;
    return typeof dst === "string" ? dst : null;
  }
  return null;
}

/** Test certificates are deliberately not trusted; production readers use defaults. */
function readerSettings(): object | undefined {
  return signerMode === "test" ? { verify: { verify_trust: false } } : undefined;
}

export async function embedC2paProvenance(params: EmbedParams): Promise<EmbedOutcome> {
  if (!isEmbeddableMime(params.mime)) return { ok: false, reasonCode: "unsupported_format" };
  if (signerMode === "none") return { ok: false, reasonCode: "signer_not_configured" };
  if (!testSignerMaterial) return { ok: false, reasonCode: "signer_not_configured" };

  const built = buildC2paManifest({
    digitalSourceType: params.digitalSourceType,
    softwareAgent: params.softwareAgent,
  });
  if (!built.ok) return { ok: false, reasonCode: "manifest_invalid" };

  let lib: typeof import("@contentauth/c2pa-node");
  try {
    lib = await import("@contentauth/c2pa-node");
  } catch {
    return { ok: false, reasonCode: "c2pa_unavailable" };
  }

  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "cinefield-c2pa-"));
    const ext = EXTENSION_FOR_MIME[params.mime];
    const inputPath = join(dir, `${randomUUID()}.${ext}`);
    const outputPath = join(dir, `${randomUUID()}.signed.${ext}`);
    await writeFile(inputPath, params.bytes);

    const builder = lib.Builder.new({ builder: { thumbnail: { enabled: false } } });
    builder.updateManifestProperty("claim_generator", CLAIM_GENERATOR);

    // Preserve Cinefield's single canonical actions assertion without carrying
    // prompts, provider payloads, object keys, credentials or signed URLs.
    const action = built.manifest.assertions[0]?.data.actions[0];
    if (!action) return { ok: false, reasonCode: "manifest_invalid" };
    builder.addAction(JSON.stringify(action));

    const signer = lib.LocalSigner.newSigner(
      Buffer.from(testSignerMaterial.certificatePem, "utf8"),
      Buffer.from(testSignerMaterial.privateKeyPem, "utf8"),
      "es256"
    );

    try {
      builder.sign(
        signer,
        { path: inputPath, mimeType: params.mime },
        { path: outputPath, mimeType: params.mime }
      );
    } catch {
      return { ok: false, reasonCode: "embed_failed" };
    }

    const signedBytes = new Uint8Array(await readFile(outputPath));
    const reader = await lib.Reader.fromAsset(
      { path: outputPath, mimeType: params.mime },
      readerSettings()
    );
    if (!reader) return { ok: false, reasonCode: "verify_failed" };

    const store = reader.json() as unknown as { validation_status?: unknown };
    const codes = boundedValidationCodes(store.validation_status);
    if (codes.length > 0) {
      return { ok: false, reasonCode: "verify_failed", validationCodes: codes };
    }

    const active = activeManifestFromStore(store);
    return {
      ok: true,
      bytes: signedBytes,
      signerIssuer: signerIssuerFromManifest(active),
      officiallyVerified: true,
    };
  } catch {
    return { ok: false, reasonCode: "embed_failed" };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export type ReadOutcome =
  | { readonly present: false; readonly reasonCode: "no_manifest" | "c2pa_unavailable" | "read_failed" }
  | {
      readonly present: true;
      readonly valid: boolean;
      readonly validationCodes: readonly string[];
      readonly claimGenerator: string;
      readonly signerIssuer: string;
      readonly digitalSourceType: string | null;
    };

export async function readEmbeddedProvenance(params: {
  bytes: Uint8Array;
  mime: string;
}): Promise<ReadOutcome> {
  let lib: typeof import("@contentauth/c2pa-node");
  try {
    lib = await import("@contentauth/c2pa-node");
  } catch {
    return { present: false, reasonCode: "c2pa_unavailable" };
  }

  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "cinefield-c2pa-read-"));
    const ext = EXTENSION_FOR_MIME[params.mime] ?? "bin";
    const path = join(dir, `${randomUUID()}.${ext}`);
    await writeFile(path, params.bytes);

    const reader = await lib.Reader.fromAsset({ path, mimeType: params.mime }, readerSettings());
    if (!reader) return { present: false, reasonCode: "no_manifest" };

    const store = reader.json() as unknown as { validation_status?: unknown };
    const codes = boundedValidationCodes(store.validation_status);
    const active = activeManifestFromStore(store);

    return {
      present: true,
      valid: codes.length === 0,
      validationCodes: codes,
      claimGenerator: claimGeneratorFromManifest(active),
      signerIssuer: signerIssuerFromManifest(active),
      digitalSourceType: digitalSourceTypeFromManifest(active),
    };
  } catch {
    return { present: false, reasonCode: "read_failed" };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
