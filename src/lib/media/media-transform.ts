import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { VerifiedMime } from "./mime-detect";

/**
 * Phase 9-C — the final-media transform step.
 *
 * ---------------------------------------------------------------------------
 * THE NARROWEST THING THAT UNBLOCKS PHASE 27
 * ---------------------------------------------------------------------------
 * The roadmap's Phase 27 pipeline is "… → FFmpeg → final.mp4/images → C2PA
 * sign → R2". Phase 27 could not close because that FFmpeg position did not
 * exist. This module is that position and nothing more: it normalises already
 * validated bytes into the final delivered artifact so a provenance manifest
 * can bind to bytes that will never change again.
 *
 * It is deliberately NOT a general media-processing service. No thumbnails, no
 * previews, no resolution ladder, no format negotiation — those are the rest
 * of 9-C and are not required to close Phase 27.
 *
 * ---------------------------------------------------------------------------
 * NO ARBITRARY FFmpeg. EVER.
 * ---------------------------------------------------------------------------
 * Every invocation is `execFile` with an ARRAY of arguments built here from a
 * fixed profile — never a shell string, so there is no interpolation point and
 * no shell to inject into. The caller supplies bytes and a verified MIME; it
 * cannot supply a codec, a filter, a flag, an input path, or an output path.
 * `TRANSFORM_PROFILES` is the complete set of operations this system can
 * perform, and adding one is an edit here.
 *
 * Paths are generated with `randomUUID()` inside a fresh `mkdtemp` directory
 * and are deleted in a `finally`. No caller-supplied path reaches the
 * filesystem, so traversal has no entry point.
 *
 * ---------------------------------------------------------------------------
 * SANDBOX POSTURE
 * ---------------------------------------------------------------------------
 * Untrusted bytes reach FFmpeg, which red notes ¶327/¶1458 call out directly.
 * Mitigations here: a hard byte ceiling checked BEFORE anything is written, a
 * kill-on-timeout, a bounded stdout/stderr buffer, `-nostdin` so a malformed
 * input can never block waiting on input, and `env: {}` so the child inherits
 * NO environment — no Supabase key, no provider key, no AWS credential. That
 * last one is the important one: a parser exploit in a process holding no
 * secret is a wasted container.
 *
 * What this does NOT do is network isolation at the OS level. FFmpeg can open
 * protocols, so `-protocol_whitelist file` restricts it to local files only.
 * Full sandboxing (a disposable container, cgroups) remains infrastructure
 * work — stated, not pretended.
 */

export type TransformProfileName = "image_normalize_png" | "image_normalize_jpeg" | "video_normalize_mp4" | "audio_normalize_wav";

interface TransformProfile {
  readonly name: TransformProfileName;
  readonly outputExtension: string;
  readonly outputMime: VerifiedMime;
  /** Fixed FFmpeg arguments, minus the input/output paths this module supplies. */
  readonly args: readonly string[];
}

/**
 * The complete operation set. Each profile normalises to a container the
 * official C2PA tooling can actually carry a manifest in (png/jpeg/mp4/wav) —
 * a format this pipeline cannot mark is a format it should not silently
 * produce and call final.
 */
const TRANSFORM_PROFILES: Readonly<Record<TransformProfileName, TransformProfile>> = {
  image_normalize_png: {
    name: "image_normalize_png",
    outputExtension: "png",
    outputMime: "image/png",
    args: ["-frames:v", "1", "-c:v", "png"],
  },
  image_normalize_jpeg: {
    name: "image_normalize_jpeg",
    outputExtension: "jpg",
    outputMime: "image/jpeg",
    args: ["-frames:v", "1", "-c:v", "mjpeg", "-q:v", "2"],
  },
  video_normalize_mp4: {
    name: "video_normalize_mp4",
    outputExtension: "mp4",
    outputMime: "video/mp4",
    args: ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac"],
  },
  audio_normalize_wav: {
    name: "audio_normalize_wav",
    outputExtension: "wav",
    outputMime: "audio/wav",
    args: ["-c:a", "pcm_s16le"],
  },
};

/**
 * Which profile a verified input MIME normalises through.
 *
 * `null` means this pipeline does not produce a markable final artifact for
 * that input — reported honestly as UNSUPPORTED_FORMAT rather than passed
 * through unmarked and called done.
 */
const PROFILE_FOR_MIME: Readonly<Record<VerifiedMime, TransformProfileName | null>> = {
  "image/png": "image_normalize_png",
  "image/jpeg": "image_normalize_jpeg",
  "image/webp": "image_normalize_png",
  "image/avif": "image_normalize_png",
  // Animated by nature; a single-frame normalise would silently destroy the
  // content. Refused rather than mangled.
  "image/gif": null,
  "video/mp4": "video_normalize_mp4",
  "video/webm": "video_normalize_mp4",
  "audio/wav": "audio_normalize_wav",
  "audio/mpeg": "audio_normalize_wav",
};

export function profileForMime(mime: string): TransformProfileName | null {
  return Object.prototype.hasOwnProperty.call(PROFILE_FOR_MIME, mime)
    ? PROFILE_FOR_MIME[mime as VerifiedMime]
    : null;
}

export const MAX_TRANSFORM_INPUT_BYTES = 512 * 1024 * 1024;
export const TRANSFORM_TIMEOUT_MS = 120_000;
const MAX_STDIO_BYTES = 1024 * 1024;

export type TransformOutcome =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly outputMime: VerifiedMime; readonly profile: TransformProfileName }
  | { readonly ok: false; readonly reasonCode: "unsupported_format" | "input_too_large" | "transform_failed" | "transform_timeout" | "ffmpeg_unavailable" };

/** Overridable only for tests; production always uses the PATH binary. */
let ffmpegBinary = process.env.CINEFIELD_FFMPEG_PATH || "ffmpeg";

export function __setFfmpegBinaryForTesting(path: string | null): void {
  ffmpegBinary = path ?? process.env.CINEFIELD_FFMPEG_PATH ?? "ffmpeg";
}

function runFfmpeg(args: readonly string[]): Promise<{ ok: true } | { ok: false; timedOut: boolean }> {
  return new Promise((resolve) => {
    execFile(
      ffmpegBinary,
      args as string[],
      {
        timeout: TRANSFORM_TIMEOUT_MS,
        maxBuffer: MAX_STDIO_BYTES,
        killSignal: "SIGKILL",
        windowsHide: true,
        // NO inherited environment. The child holds no credential of any
        // kind. The cast is required only because this repository augments
        // `ProcessEnv` to require NODE_ENV — the runtime value stays a
        // genuinely empty object, which is the security property.
        env: {} as NodeJS.ProcessEnv,
      },
      (error: Error | null) => {
        if (!error) return resolve({ ok: true });
        const timedOut = (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
        resolve({ ok: false, timedOut });
      }
    );
  });
}

/**
 * Normalises validated bytes into the final delivered artifact.
 *
 * The returned bytes are FINAL: nothing downstream re-encodes them, which is
 * what makes it safe for a C2PA manifest to bind to their digest.
 */
export async function transformToFinalMedia(params: {
  readonly bytes: Uint8Array;
  readonly verifiedMime: string;
}): Promise<TransformOutcome> {
  if (params.bytes.byteLength > MAX_TRANSFORM_INPUT_BYTES) {
    return { ok: false, reasonCode: "input_too_large" };
  }

  const profileName = profileForMime(params.verifiedMime);
  if (!profileName) return { ok: false, reasonCode: "unsupported_format" };
  const profile = TRANSFORM_PROFILES[profileName];

  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "cinefield-transform-"));
    const inputPath = join(dir, `${randomUUID()}.in`);
    const outputPath = join(dir, `${randomUUID()}.${profile.outputExtension}`);
    await writeFile(inputPath, params.bytes);

    const result = await runFfmpeg([
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      // Local files only. FFmpeg speaks http/rtmp/etc. otherwise, and an
      // untrusted container can name an input the demuxer would then fetch.
      "-protocol_whitelist",
      "file",
      "-y",
      "-i",
      inputPath,
      ...profile.args,
      outputPath,
    ]);

    if (!result.ok) {
      return { ok: false, reasonCode: result.timedOut ? "transform_timeout" : "transform_failed" };
    }

    const bytes = new Uint8Array(await readFile(outputPath));
    if (bytes.byteLength === 0) return { ok: false, reasonCode: "transform_failed" };

    return { ok: true, bytes, outputMime: profile.outputMime, profile: profile.name };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ok: false, reasonCode: "ffmpeg_unavailable" };
    return { ok: false, reasonCode: "transform_failed" };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
