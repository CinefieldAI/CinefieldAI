import type { MarketingModelCategory, MarketingModelOption } from "@/components/marketing-studio/MarketingModelSelector";

/**
 * AI Video model tree — families, submodels and the controls each one
 * exposes, transcribed from a live audit of the reference site's own model
 * selector (structure and control vocabulary only; every "Higgsfield X"
 * family name is Cinefield's own here).
 *
 * Two tiers, matching the reference's own popup: a horizontal "Featured
 * models" quick-access row, then the real "All models" list where cards
 * with `submodels` open a family flyout and cards without one select
 * directly.
 */

export interface AiVideoControlSpec {
  /** Duration values, or a [min, max] slider range in seconds. */
  durations?: string[];
  durationRange?: [number, number];
  resolutions?: string[];
  ratios?: string[];
  /** Real audio/sound-generation switch, not an implicit one. */
  audio?: boolean;
  startFrame?: boolean;
  endFrame?: boolean;
  /** "Ingredients"/"References" multi-image slot, with its cap. */
  multiReference?: number;
  referenceVideo?: boolean;
  elements?: boolean;
  multiShot?: boolean;
  promptEnhance?: boolean;
  bitrate?: boolean;
  /** Camera/effect presets instead of manual duration/ratio controls. */
  presetDriven?: boolean;
  advancedSettings?: boolean;
  credits?: number;
}

/** Per-model controls. Only models whose panels were actually opened during
 *  the audit have an entry; the rest fall back to their family's shape. */
export const AI_VIDEO_CONTROLS: Record<string, AiVideoControlSpec> = {
  "Seedance 2.5": {
    durationRange: [4, 30],
    resolutions: ["480p", "720p", "1080p"],
    ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    elements: true,
    bitrate: true,
    referenceVideo: true,
    credits: 45,
  },
  "Seedance 2.0": {
    durations: ["4s", "8s", "12s", "15s"],
    resolutions: ["720p"],
    ratios: ["Auto"],
    bitrate: true,
    credits: 48,
  },
  "Kling 3.0": {
    durations: ["5s"],
    resolutions: ["720p", "1080p", "4K"],
    ratios: ["16:9", "9:16", "1:1"],
    startFrame: true,
    endFrame: true,
    multiShot: true,
    elements: true,
    promptEnhance: true,
    credits: 30,
  },
  "Kling 3.0 Motion Control": {
    resolutions: ["720p"],
    referenceVideo: true,
    advancedSettings: true,
    credits: 7,
  },
  "Sora 2": {
    durations: ["4s", "8s", "12s"],
    ratios: ["16:9", "9:16"],
    credits: 29,
  },
  "Google Veo 3.1": {
    durations: ["4s", "6s", "8s"],
    resolutions: ["720p", "1080p", "4K"],
    ratios: ["16:9", "9:16"],
    startFrame: true,
    endFrame: true,
    multiReference: 3,
    multiShot: true,
    promptEnhance: true,
    credits: 58,
  },
  "Wan 2.7": {
    durations: ["5s"],
    resolutions: ["720p"],
    startFrame: true,
    endFrame: true,
    credits: 8,
  },
  "Grok Imagine 1.5": {
    durations: ["5s"],
    resolutions: ["720p"],
    ratios: ["Auto"],
    startFrame: true,
    credits: 22.5,
  },
  "Gemini Omni Flash": {
    durations: ["8s"],
    resolutions: ["720p"],
    ratios: ["16:9"],
    startFrame: true,
    endFrame: true,
    credits: 24,
  },
  HappyHorse: {
    durations: ["5s"],
    resolutions: ["720p"],
    ratios: ["16:9"],
    credits: 20,
  },
  "FLUX.3 Video": {
    durations: ["5s"],
    resolutions: ["720p"],
    ratios: ["Auto"],
    audio: true,
    multiReference: 10,
    referenceVideo: true,
    credits: 27.5,
  },
  "MiniMax H3": {
    durations: ["5s"],
    resolutions: ["2K"],
    ratios: ["Auto"],
    startFrame: true,
    endFrame: true,
    credits: 20,
  },
  "Cinefield Standard": {
    presetDriven: true,
    promptEnhance: true,
    advancedSettings: true,
    credits: 10,
  },
};

const m = (
  id: string,
  name: string,
  description: string,
  extra: Partial<MarketingModelOption> = {},
): MarketingModelOption => ({ id, name, description, ...extra });

/** The "All models" list — the real card hierarchy. */
const ALL_MODELS: MarketingModelOption[] = [
  m("minimax-hailuo", "Minimax Hailuo", "Fast, high-resolution general motion", {
    submodels: [
      m("minimax-h3", "MiniMax H3", "Latest Hailuo engine at 2K", { badges: ["NEW"], meta: ["2K", "5-15s"] }),
      m("hailuo-23-fast", "Minimax Hailuo 2.3 Fast", "Quicker turnaround at 1080p", { meta: ["1080p", "6-10s"] }),
      m("hailuo-23", "Minimax Hailuo 2.3", "Full-quality 2.3 generation", { badges: ["PREMIUM"], meta: ["1080p", "6-10s"] }),
      m("hailuo-02-fast", "Minimax Hailuo 02 Fast", "Draft speed at 512p", { meta: ["512p", "6-10s"] }),
      m("hailuo-02", "Minimax Hailuo 02", "Previous-generation flagship", { badges: ["PREMIUM"], meta: ["1080p", "6-10s"] }),
    ],
  }),
  m("flux-3-video", "FLUX.3 Video", "Up to 10 frame references, with sound", { sound: true, meta: ["720p", "5s"] }),
  m("kling", "Kling", "Cinema-grade motion and camera control", {
    submodels: [
      m("kling-30", "Kling 3.0", "Flagship quality up to 4K", { meta: ["4K", "3-15s"] }),
      m("kling-30-turbo", "Kling 3.0 Turbo", "Faster 3.0 generation", { meta: ["1080p", "3-15s"] }),
      m("kling-30-omni", "Kling 3.0 Omni", "Unified multimodal generation", { badges: ["EXCLUSIVE"], meta: ["3-15s"] }),
      m("kling-30-omni-edit", "Kling 3.0 Omni Edit", "Edit video with text prompts", { badges: ["EXCLUSIVE"], meta: ["1080p", "3-10s"] }),
      m("kling-26", "Kling 2.6", "Stable general motion", { meta: ["1080p", "5-10s"] }),
      m("kling-o1-video", "Kling O1 Video", "First unified multimodal video model", { badges: ["PREMIUM"], meta: ["1080p", "5-10s"] }),
      m("kling-o1-video-edit", "Kling O1 Video Edit", "Prompt-driven video editing", { badges: ["PREMIUM"], meta: ["1080p", "3-10s"] }),
      m("kling-motion-control", "Kling Motion Control", "Copy motion from any video", { meta: ["1080p", "3-30s"] }),
      m("kling-30-motion-control", "Kling 3.0 Motion Control", "3.0 engine with motion transfer", { meta: ["1080p", "3-30s"] }),
      m("kling-25-turbo", "Kling 2.5 Turbo", "Fast 2.5 generation", { meta: ["1080p", "5-10s"] }),
      m("kling-21", "Kling 2.1", "Earlier general model", { badges: ["PREMIUM"], meta: ["1080p", "5-10s"] }),
      m("kling-21-master", "Kling 2.1 Master", "Highest-fidelity 2.1 tier", { badges: ["PREMIUM"], meta: ["1080p", "5-10s"] }),
    ],
  }),
  m("openai-sora-2", "OpenAI Sora 2", "Native sound and physical realism", {
    submodels: [
      m("sora-2", "Sora 2", "Standard Sora 2 generation", { badges: ["PREMIUM"], sound: true, meta: ["720p", "4-12s"] }),
      m("sora-2-pro", "Sora 2 Pro", "Higher fidelity at 1080p", { badges: ["PREMIUM"], sound: true, meta: ["1080p", "4-12s"] }),
      m("sora-2-max", "Sora 2 Max", "Maximum-quality standard tier", { badges: ["PREMIUM"], sound: true, meta: ["1080p", "4-12s"] }),
      m("sora-2-pro-max", "Sora 2 Pro Max", "Top Sora 2 tier", { badges: ["PREMIUM"], sound: true, meta: ["1080p", "4-12s"] }),
    ],
  }),
  m("google-veo", "Google Veo", "Multi-shot scenes with ingredients", {
    submodels: [
      m("veo-31-lite", "Google Veo 3.1 Lite", "Lightweight 3.1 generation", { meta: ["1080p", "4-8s"] }),
      m("veo-31-fast", "Google Veo 3.1 Fast", "Faster 3.1 tier", { badges: ["PREMIUM"], meta: ["1080p", "4-8s"] }),
      m("veo-31", "Google Veo 3.1", "Full 3.1 with multi-shot", { badges: ["PREMIUM"], meta: ["1080p", "4-8s"] }),
      m("veo-3-fast", "Google Veo 3 Fast", "Faster previous generation", { badges: ["PREMIUM"], meta: ["1080p", "8s"] }),
      m("veo-3", "Google Veo 3", "Previous-generation flagship", { badges: ["PREMIUM"], meta: ["1080p", "8s"] }),
    ],
  }),
  m("gemini-omni-flash", "Gemini Omni Flash", "Generate and edit video from any input", { meta: ["720p", "8s"] }),
  m("cinefield", "Cinefield", "Advanced camera controls and effect presets", {
    submodels: [
      m("marketing-studio-video", "Marketing Studio Video", "Ad-ready shorts and product creatives", { badges: ["NEW"], meta: ["5-30s"] }),
      m("cinefield-lite", "Cinefield Lite", "Fastest preset-driven tier", { badges: ["PREMIUM"], meta: ["720p", "3-5s"] }),
      m("cinefield-standard", "Cinefield Standard", "Balanced preset-driven tier", { badges: ["PREMIUM"], meta: ["720p", "3-5s"] }),
      m("cinefield-turbo", "Cinefield Turbo", "Highest-throughput preset tier", { badges: ["PREMIUM"], meta: ["720p", "3-5s"] }),
    ],
  }),
  m("wan", "Wan", "Consistent characters across scenes", {
    submodels: [
      m("wan-27", "Wan 2.7", "Latest Wan generation", { meta: ["1080p", "2-15s"] }),
      m("wan-26", "Wan 2.6", "Multi-scene character consistency", { meta: ["1080p", "5-15s"] }),
      m("wan-25", "Wan 2.5", "Previous flagship", { badges: ["PREMIUM"], meta: ["1080p", "5-10s"] }),
      m("wan-25-fast", "Wan 2.5 Fast", "Faster 2.5 tier", { badges: ["PREMIUM"], meta: ["1080p", "5-10s"] }),
      m("wan-22", "Wan 2.2", "Earlier generation", { badges: ["PREMIUM"], meta: ["720p", "5s"] }),
      m("wan-22-fast", "Wan 2.2 Fast", "Draft-speed 2.2", { meta: ["720p", "5s"] }),
    ],
  }),
  m("seedance", "Seedance", "The most controllable video family", {
    submodels: [
      m("seedance-25", "Seedance 2.5", "30 seconds in one take", { badges: ["NEW"], meta: ["1080p", "4-30s"] }),
      m("seedance-25-edit", "Seedance 2.5 Edit", "Edit existing video with sound", { badges: ["NEW"], sound: true, meta: ["720p"] }),
      m("seedance-20-fast", "Seedance 2.0 Fast", "Faster 2.0 generation", { meta: ["720p", "4-15s"] }),
      m("seedance-20-mini", "Seedance 2.0 Mini", "Lightweight 2.0 tier", { badges: ["EXCLUSIVE"], meta: ["720p", "4-15s"] }),
      m("seedance-20", "Seedance 2.0", "Standard 2.0 generation", { meta: ["4-15s"] }),
      m("seedance-15-pro", "Seedance 1.5 Pro", "Multi-shot storytelling", { meta: ["720p", "4-12s"] }),
      m("seedance-pro", "Seedance Pro", "Pro-tier fidelity", { badges: ["PREMIUM"], meta: ["1080p", "5-10s"] }),
      m("seedance-pro-fast", "Seedance Pro Fast", "Faster Pro tier", { badges: ["PREMIUM"], meta: ["1080p", "5-10s"] }),
    ],
  }),
  m("grok-imagine", "Grok Imagine", "Cinematic video with synchronized audio", {
    submodels: [
      m("grok-imagine", "Grok Imagine", "Standard Grok generation", { meta: ["720p", "1-15s"] }),
      m("grok-imagine-15", "Grok Imagine 1.5", "Latest xAI video model", { meta: ["720p", "1-15s"] }),
      m("grok-imagine-edit", "Grok Imagine Edit", "Edit videos with text prompts", {}),
    ],
  }),
  m("happyhorse", "HappyHorse", "Fast stylized motion drafts", { meta: ["720p", "5s"] }),
];

/** Horizontal quick-access row above the full list. */
const FEATURED_MODELS: MarketingModelOption[] = [
  m("f-seedance-25", "Seedance 2.5", "30 seconds in one take", { badges: ["NEW"], meta: ["1080p", "4-30s"] }),
  m("f-seedance-25-edit", "Seedance 2.5 Edit", "Edit existing video with sound", { badges: ["NEW"], sound: true, meta: ["720p"] }),
  m("f-seedance-20", "Seedance 2.0", "Standard 2.0 generation", { meta: ["4-15s"] }),
  m("f-seedance-20-fast", "Seedance 2.0 Fast", "Faster 2.0 generation", { meta: ["720p", "4-15s"] }),
  m("f-seedance-20-mini", "Seedance 2.0 Mini", "Lightweight 2.0 tier", { badges: ["EXCLUSIVE"], meta: ["720p", "4-15s"] }),
  m("f-minimax-h3", "MiniMax H3", "Latest Hailuo engine at 2K", { badges: ["NEW"], meta: ["2K", "5-15s"] }),
  m("f-gemini-omni-flash", "Gemini Omni Flash", "Generate and edit video from any input", { meta: ["720p", "8s"] }),
  m("f-kling-30", "Kling 3.0", "Flagship quality up to 4K", { meta: ["4K", "3-15s"] }),
  m("f-kling-30-motion", "Kling 3.0 Motion Control", "3.0 engine with motion transfer", { meta: ["1080p", "3-30s"] }),
  m("f-flux-3-video", "FLUX.3 Video", "Up to 10 frame references, with sound", { sound: true, meta: ["720p", "5s"] }),
  m("f-grok-imagine-15", "Grok Imagine 1.5", "Latest xAI video model", { meta: ["720p", "1-15s"] }),
];

export const AI_VIDEO_CATEGORIES: MarketingModelCategory[] = [
  { label: "Featured models", models: FEATURED_MODELS },
  { label: "All models", models: ALL_MODELS },
];

export const AI_VIDEO_FALLBACK_MODEL: MarketingModelOption = m(
  "seedance-20",
  "Seedance 2.0",
  "Standard 2.0 generation",
  { meta: ["4-15s"] },
);

export const AI_VIDEO_DEFAULT_MODEL = "Seedance 2.0";
