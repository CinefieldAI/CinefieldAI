/**
 * The untrusted-media inspector, as it runs INSIDE the sandbox child.
 *
 * This file is the whole reason the sandbox exists. The roadmap red note is
 * explicit: the Outbound Fetch Gateway bounds where bytes come from, but
 * "kötü niyetli medya FFmpeg/decoder/parser yüzeyine ulaşır" — malicious
 * media still reaches whatever reads it. So whatever reads it must be
 * disposable and hold nothing worth stealing.
 *
 * WHAT THIS PROCESS HAS
 *   stdin  — the bytes, and nothing else
 *   argv   — a byte ceiling
 *   stdout — one JSON line
 *
 * WHAT IT DOES NOT HAVE
 *   No provider key, no Supabase service role, no R2 credential, no Clerk
 *   secret, no Temporal credential, no Redis URL. The parent spawns it with an
 *   allowlisted environment rather than trusting this file not to read one —
 *   a file cannot be relied on to avoid `process.env` forever, but an
 *   environment that never contained the secret cannot leak it.
 *
 *   No database handle. No network client. It imports exactly two things: the
 *   pure detector and node:crypto. If that list ever grows a client of any
 *   kind, the isolation is gone.
 *
 * PLAIN .mjs ON PURPOSE — it is spawned by bare `node`, with no tsx and no
 * build step, so the boundary does not depend on a dev toolchain.
 *
 * TODAY IT RUNS PURE JS. `detectMediaType` reads a bounded prefix and
 * `createHash` is a native digest over a buffer — neither is a decoder. The
 * sandbox is built now anyway, because 9-C introduces FFmpeg and the moment to
 * have a containment boundary is before the thing it contains arrives.
 */

import { createHash } from "node:crypto";
import { detectMediaType } from "../mime-detect.mjs";

/** Fixed vocabulary. Never a stack, never a path, never input content. */
function emit(result) {
  process.stdout.write(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}

async function main() {
  const maxBytes = Number(process.argv[2]);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) emit({ ok: false, reason: "inspect_failed" });

  const chunks = [];
  let received = 0;

  try {
    for await (const chunk of process.stdin) {
      received += chunk.byteLength;
      // Counted as it arrives. A declared size is a claim; this is the fact,
      // and it stops a bomb before the whole thing is resident.
      if (received > maxBytes) emit({ ok: false, reason: "too_large" });
      chunks.push(chunk);
    }
  } catch {
    emit({ ok: false, reason: "read_failed" });
  }

  try {
    const bytes = new Uint8Array(Buffer.concat(chunks));
    emit({
      ok: true,
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      detection: detectMediaType(bytes),
    });
  } catch {
    // A crash here is the case the sandbox exists for. It reports a class and
    // dies; the parent decides what that means for the asset.
    emit({ ok: false, reason: "inspect_failed" });
  }
}

void main();
