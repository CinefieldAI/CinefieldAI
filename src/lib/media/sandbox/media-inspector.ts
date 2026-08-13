import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import type { DetectionResult } from "../mime-detect";

/**
 * Sandbox boundary for untrusted media (Phase 9-B).
 *
 * The parent side. It spawns a disposable child, hands it bytes on stdin, and
 * reads one JSON line back. Everything hostile media could do — hang, crash,
 * allocate without bound, try to read a credential — happens over there, in a
 * process that holds nothing and dies either way.
 *
 * THE ENVIRONMENT IS THE CONTROL, and it is built by allowlist. Not "delete
 * the secrets we thought of" — start from nothing and add the three variables
 * Node needs to run. A future secret added to `.env.local` is therefore
 * excluded automatically, which a denylist could never promise.
 *
 * HONEST SCOPE. This is process isolation, not a container. It gives:
 *   - no inherited environment, so no credential
 *   - a hard wall-clock kill
 *   - a byte ceiling enforced inside the child as it reads
 *   - a crash that cannot corrupt caller state, because there is no shared
 *     state to corrupt
 *
 * It does NOT give: a read-only root filesystem, cgroup CPU/RAM limits, or a
 * network namespace. Those are properties of a container runtime, and the
 * roadmap places them in production infrastructure hardening. They are listed
 * as outstanding in docs/security-gates.md rather than implied by this file.
 * Nothing here claims the sandbox is complete.
 *
 * NO NETWORK TODAY, BY CONSTRUCTION. The child imports no client and is given
 * bytes rather than a URL — it has nothing to fetch and no address to fetch
 * from. When 9-C adds FFmpeg, that changes: FFmpeg resolves URLs in
 * playlists, concat lists and protocol handlers, and a network namespace stops
 * being optional.
 */

export interface InspectionOutcome {
  ok: boolean;
  byteLength?: number;
  sha256?: string;
  detection?: DetectionResult;
  /** Non-secret failure class. */
  failure?:
    | "too_large"
    | "read_failed"
    | "inspect_failed"
    | "timeout"
    | "crashed"
    | "unreadable_result";
}

export const INSPECT_MAX_BYTES = 64 * 1024 * 1024;
export const INSPECT_TIMEOUT_MS = 20_000;

/**
 * The child's entire environment. An allowlist, deliberately three entries
 * long, and PATH only because Windows needs it to resolve the runtime.
 */
function sandboxEnvironment(): NodeJS.ProcessEnv {
  return {
    // PATH only so the OS can resolve the runtime. NODE_ENV because Node reads
    // it for its own behaviour. Nothing else — and specifically no loader
    // options, because the child is plain .mjs and needs no toolchain.
    PATH: process.env.PATH ?? "",
    NODE_ENV: process.env.NODE_ENV ?? "production",
  };
}

/** Exported so a test can assert the allowlist rather than trust the comment. */
export function __sandboxEnvironmentForTesting(): NodeJS.ProcessEnv {
  return sandboxEnvironment();
}

/**
 * Inspects untrusted bytes out of process.
 *
 * Never throws: every failure is an outcome. A caller deciding what to do with
 * an asset should branch on data, not catch an exception whose type depends on
 * how the media happened to be malformed.
 */
export async function inspectUntrustedMedia(
  bytes: Uint8Array,
  options: { maxBytes?: number; timeoutMs?: number } = {}
): Promise<InspectionOutcome> {
  const maxBytes = options.maxBytes ?? INSPECT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? INSPECT_TIMEOUT_MS;

  // Refused before a process is even spawned. Cheapest possible rejection for
  // the cheapest possible attack.
  if (bytes.byteLength > maxBytes) return { ok: false, failure: "too_large" };

  const childPath = path.join(process.cwd(), "src/lib/media/sandbox/inspector-child.mjs");

  return new Promise<InspectionOutcome>((resolve) => {
    const child = spawn(process.execPath, [childPath, String(maxBytes)], {
      env: sandboxEnvironment(),
      // No shell: nothing here is parsed as a command line.
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
      // The child's working directory is the repo root only because the entry
      // point lives there. It reads no file of its own.
      cwd: process.cwd(),
    });

    let stdout = "";
    let settled = false;

    const finish = (outcome: InspectionOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(outcome);
    };

    // A hard wall-clock kill. Media designed to make a parser spin is the
    // classic case, and SIGKILL is used rather than SIGTERM because a hung
    // parser is exactly the thing that will not honour a polite signal.
    const timer = setTimeout(() => finish({ ok: false, failure: "timeout" }), timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      // A child that talks too much is misbehaving; the contract is one small
      // JSON line.
      if (stdout.length > 64 * 1024) finish({ ok: false, failure: "unreadable_result" });
    });

    child.on("error", () => finish({ ok: false, failure: "crashed" }));

    child.on("close", (code) => {
      if (settled) return;
      try {
        const parsed = JSON.parse(stdout) as InspectionOutcome & { reason?: string };
        if (parsed.ok) {
          finish({
            ok: true,
            byteLength: parsed.byteLength,
            sha256: parsed.sha256,
            detection: parsed.detection,
          });
          return;
        }
        finish({ ok: false, failure: (parsed.reason as InspectionOutcome["failure"]) ?? "inspect_failed" });
      } catch {
        // No parseable answer: the child died before it could speak, which is
        // a crash regardless of what the exit code says.
        finish({ ok: false, failure: code === 0 ? "unreadable_result" : "crashed" });
      }
    });

    child.stdin.on("error", () => finish({ ok: false, failure: "crashed" }));
    child.stdin.end(Buffer.from(bytes));
  });
}
