/**
 * Phase 27 / 9-C closure proof: produce real signed artifacts and verify them
 * with ContentAuth's maintained official Node SDK.
 *
 * Synthetic media only. The test certificate/private key are generated in a
 * temporary directory for this process and deleted afterwards; no signer key,
 * even a development one, is committed to the repository.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  embedC2paProvenance,
  readEmbeddedProvenance,
  resetC2paSignerMode,
  setC2paSignerMode,
  setC2paTestSignerMaterialForTesting,
} from "../src/lib/provenance/c2pa-embedder";

const FFMPEG = process.env.CINEFIELD_FFMPEG_PATH || "ffmpeg";
const OPENSSL = process.env.CINEFIELD_OPENSSL_PATH || "openssl";

function run(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 60_000, windowsHide: true }, (error) =>
      error ? reject(error) : resolve()
    );
  });
}

interface Case {
  readonly label: string;
  readonly mime: string;
  readonly file: string;
  readonly makeArgs: (out: string) => string[];
}

const CASES: readonly Case[] = [
  {
    label: "image/png",
    mime: "image/png",
    file: "sample.png",
    makeArgs: (out) => ["-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1", "-frames:v", "1", out],
  },
  {
    label: "image/jpeg",
    mime: "image/jpeg",
    file: "sample.jpg",
    makeArgs: (out) => ["-y", "-f", "lavfi", "-i", "color=c=green:s=64x64:d=1", "-frames:v", "1", out],
  },
  {
    label: "video/mp4",
    mime: "video/mp4",
    file: "sample.mp4",
    makeArgs: (out) => [
      "-y", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", out,
    ],
  },
  {
    label: "audio/wav",
    mime: "audio/wav",
    file: "sample.wav",
    makeArgs: (out) => ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", out],
  },
];

async function generateEphemeralSigner(dir: string): Promise<{
  certificatePem: string;
  privateKeyPem: string;
}> {
  const keyPath = join(dir, "c2pa-test-key.pem");
  const certPath = join(dir, "c2pa-test-cert.pem");

  await run(OPENSSL, [
    "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", keyPath,
  ]);

  await run(OPENSSL, [
    "req", "-new", "-x509",
    "-key", keyPath,
    "-out", certPath,
    "-days", "1",
    "-sha256",
    "-subj", "/C=AT/O=Cinefield Test/OU=FOR TESTING ONLY/CN=Cinefield C2PA Test Signer",
    "-addext", "basicConstraints=critical,CA:FALSE",
    "-addext", "keyUsage=critical,digitalSignature,nonRepudiation",
    "-addext", "extendedKeyUsage=critical,emailProtection",
  ]);

  return {
    certificatePem: await readFile(certPath, "utf8"),
    privateKeyPem: await readFile(keyPath, "utf8"),
  };
}

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "cinefield-c2pa-proof-"));
  let failures = 0;

  try {
    const signer = await generateEphemeralSigner(dir);
    setC2paTestSignerMaterialForTesting(signer);
    setC2paSignerMode("test");

    console.log("Phase 27 / 9-C — official C2PA verification proof");
    console.log("SDK: @contentauth/c2pa-node");
    console.log("Signer: ephemeral ES256 DEVELOPMENT certificate generated for this run;");
    console.log("        NOT a production trust-list identity and never stored in the repository.\n");

    for (const testCase of CASES) {
      const path = join(dir, testCase.file);
      await run(FFMPEG, testCase.makeArgs(path));
      const bytes = new Uint8Array(await readFile(path));

      const embedded = await embedC2paProvenance({
        bytes,
        mime: testCase.mime,
        digitalSourceType: "trainedAlgorithmicMedia",
        softwareAgent: "Cinefield (model via provider)",
      });

      if (!embedded.ok) {
        console.log(`${testCase.label.padEnd(12)} EMBED FAILED (${embedded.reasonCode})`);
        if (embedded.validationCodes) console.log(`             validation    ${JSON.stringify(embedded.validationCodes)}`);
        failures += 1;
        continue;
      }

      const digest = createHash("sha256").update(embedded.bytes).digest("hex");
      const verified = await readEmbeddedProvenance({ bytes: embedded.bytes, mime: testCase.mime });

      if (!verified.present || !verified.valid) {
        console.log(`${testCase.label.padEnd(12)} OFFICIAL VERIFY FAILED`);
        if (verified.present) console.log(`             validation    ${JSON.stringify(verified.validationCodes)}`);
        failures += 1;
        continue;
      }

      console.log(`${testCase.label.padEnd(12)} EMBED OK -> OFFICIAL VERIFY: VALID`);
      console.log(`             bytes        ${bytes.byteLength} -> ${embedded.bytes.byteLength}`);
      console.log(`             sha256       ${digest}`);
      console.log(`             generator    ${verified.claimGenerator}`);
      console.log(`             issuer       ${verified.signerIssuer}`);
      console.log(`             sourceType   ${verified.digitalSourceType}`);

      const tampered = Uint8Array.from(embedded.bytes);
      tampered[tampered.length - 30] ^= 0xff;
      const tamperResult = await readEmbeddedProvenance({ bytes: tampered, mime: testCase.mime });
      const tamperDetected = !tamperResult.present || (tamperResult.present && !tamperResult.valid);
      console.log(
        `             tamper       ${tamperDetected ? "DETECTED" : "NOT DETECTED (!)"}` +
          (tamperResult.present && !tamperResult.valid
            ? ` ${JSON.stringify(tamperResult.validationCodes)}`
            : "")
      );
      if (!tamperDetected) failures += 1;
      console.log("");
    }

    if (failures > 0) {
      console.log(`FAILURES: ${failures}`);
      process.exitCode = 1;
    } else {
      console.log("All formats embedded and officially verified. Tamper detected in every case.");
    }
  } finally {
    resetC2paSignerMode();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

void main();
