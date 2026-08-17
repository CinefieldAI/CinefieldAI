/**
 * Web Audio tick synthesis for Cinema Studio 4.0's Era ruler — no audio
 * file, no remote URL, generated on the fly. AudioContext is lazy
 * (created on first call) and shared across calls via a module-level
 * singleton, not per-invocation.
 *
 * Pitch is driven by `rate`, a playback-speed-style multiplier the caller
 * derives from drag/wheel velocity — not a fixed per-tick-type preset and
 * not random jitter. This shape was reverse-engineered by instrumenting
 * the reference site's own AudioBufferSourceNode calls while dragging its
 * Era ruler: every tick plays the identical short sample (same buffer
 * offset/duration), only playbackRate changes, observed clamped to
 * roughly [0.85, 1.5] and rising/falling with drag speed — there was no
 * separate "major" (era-boundary) or "settle" (release) sound, and button
 * clicks (Prev/Next, direct label click) played nothing at all.
 */

const BASE_FREQ = 2400;
const DURATION_MS = 10;
const GAIN = 0.06;
const OSC_TYPE: OscillatorType = "sine";
export const TICK_RATE_MIN = 0.85;
export const TICK_RATE_MAX = 1.5;

let ctx: AudioContext | null = null;

export function playTick(rate = 1) {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    const clampedRate = Math.min(TICK_RATE_MAX, Math.max(TICK_RATE_MIN, rate));
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = OSC_TYPE;
    osc.frequency.setValueAtTime(BASE_FREQ * clampedRate, t);
    gain.gain.setValueAtTime(GAIN, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + DURATION_MS / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + DURATION_MS / 1000 + 0.005);
  } catch {
    /* sessiz kal */
  }
}
