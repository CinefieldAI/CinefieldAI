import "server-only";

/**
 * Minimal, dependency-free WAV (PCM16, mono) encoder.
 *
 * Produces genuine, spec-valid WAV bytes (RIFF/WAVE header + fmt + data
 * chunks) using nothing but built-in typed arrays — the same "real bytes,
 * honest labeling" approach as png-encoder.ts. Used by the mock TTS provider
 * so the audio orchestration chain (validate → submit → normalize → upload →
 * sign) can be proven end-to-end without a real TTS engine or a native audio
 * dependency.
 */

const SAMPLE_RATE = 22050;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/** Wraps raw PCM16LE samples in a canonical 44-byte WAV header. */
export function encodeWav(samples: Int16Array): Uint8Array {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");

  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // audio format: PCM
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8), true); // byte rate
  view.setUint16(32, CHANNELS * (BITS_PER_SAMPLE / 8), true); // block align
  view.setUint16(34, BITS_PER_SAMPLE, true);

  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(44 + i * 2, samples[i], true);
  }

  return new Uint8Array(buffer);
}

/**
 * Synthesizes a short, deterministic tone whose pitch is derived from `seed`
 * — mirroring paintMockCard's approach for the mock image provider, so
 * different generations produce audibly different but always-valid
 * placeholder audio.
 *
 * This is NOT text-to-speech. It never inspects, reads, or depends on the
 * actual text content — only its length feeds the duration, and the seed
 * (caller-supplied, typically generationId-derived) feeds the pitch. Real
 * synthesis is a future provider adapter's job; this exists solely to prove
 * the audio orchestration chain end-to-end at zero cost.
 */
export function synthesizeMockTone(params: {
  seed: string;
  textLength: number;
}): Int16Array {
  const { seed, textLength } = params;

  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  const frequency = 220 + (hash % 660); // audible, roughly A3–A5
  // Duration loosely tracks text length so longer scripts produce longer
  // placeholder clips, capped well inside maxAudioDurationSeconds.
  const durationSeconds = Math.min(6, Math.max(0.6, textLength / 40));
  const sampleCount = Math.round(SAMPLE_RATE * durationSeconds);
  const samples = new Int16Array(sampleCount);

  const amplitude = 0.3 * 0x7fff;
  const fadeSamples = Math.min(sampleCount, Math.round(SAMPLE_RATE * 0.02));

  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / SAMPLE_RATE;
    let sample = Math.sin(2 * Math.PI * frequency * t) * amplitude;

    if (i < fadeSamples) sample *= i / fadeSamples;
    else if (i > sampleCount - fadeSamples) sample *= (sampleCount - i) / fadeSamples;

    samples[i] = Math.round(sample);
  }

  return samples;
}

export function wavDurationSeconds(samples: Int16Array): number {
  return samples.length / SAMPLE_RATE;
}
