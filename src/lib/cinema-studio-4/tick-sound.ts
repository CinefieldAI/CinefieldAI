/**
 * Web Audio tick synthesis for Cinema Studio 4.0's Era ruler — no audio
 * file, no remote URL, generated on the fly. AudioContext is lazy
 * (created on first call) and shared across calls via a module-level
 * singleton, not per-invocation.
 *
 * A short filtered-noise burst rather than a pure oscillator tone — a
 * mechanical "tick" reads as a broadband, percussive click, not a clean
 * beep. The noise buffer is generated once and reused; each call only
 * creates the (cheap) source/filter/gain nodes needed to play a slice of
 * it. `rate`, a playback-speed-style multiplier the caller derives from
 * drag/wheel velocity, shifts the bandpass filter's center frequency —
 * not a fixed per-tick-type preset and not random jitter. The duration/
 * offset/rate-range shape was reverse-engineered by instrumenting the
 * reference site's own AudioBufferSourceNode calls while dragging its Era
 * ruler: every tick plays an identical short sample (same buffer offset/
 * duration), only playbackRate changes, observed clamped to roughly
 * [0.85, 1.5] and rising/falling with drag speed — there was no separate
 * "major" (era-boundary) or "settle" (release) sound, and button clicks
 * (Prev/Next, direct label click) played nothing at all. The reference's
 * actual audio sample itself was never extracted or reproduced — its
 * *timbre* isn't something a function-call trace can capture, and this
 * file's own noise burst is a from-scratch synthesis, not a copy.
 */

const DURATION_MS = 10;
const GAIN = 0.09;
const BASE_FILTER_FREQ = 3200;
const FILTER_Q = 3;
export const TICK_RATE_MIN = 0.85;
export const TICK_RATE_MAX = 1.5;

let ctx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

function getNoiseBuffer(context: AudioContext) {
  if (noiseBuffer) return noiseBuffer;
  const length = Math.ceil(context.sampleRate * 0.03);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

export function playTick(rate = 1) {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    const clampedRate = Math.min(TICK_RATE_MAX, Math.max(TICK_RATE_MIN, rate));
    const t = ctx.currentTime;

    const source = ctx.createBufferSource();
    source.buffer = getNoiseBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(BASE_FILTER_FREQ * clampedRate, t);
    filter.Q.setValueAtTime(FILTER_Q, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(GAIN, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + DURATION_MS / 1000);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);
    source.stop(t + DURATION_MS / 1000 + 0.005);
  } catch {
    /* sessiz kal */
  }
}
