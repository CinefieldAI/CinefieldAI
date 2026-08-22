/**
 * AI Video model tree and per-model control shapes, transcribed from a live
 * audit of the reference site's own /ai-video landing-page prompt bar
 * (structure, control vocabulary and option sets only). Every "Higgsfield"
 * name is Cinefield's own here.
 *
 * Two things the audit settled that are easy to get wrong:
 *  - Duration is TWO different controls: a continuous slider for models with
 *    a range, and a fixed option list for models with discrete steps.
 *  - The aspect-ratio set is per model, not global — `Auto` only exists on
 *    some, and 2:1 / 3:2 / 2:3 appear on exactly one model each.
 */

import type { ComponentType, SVGProps } from "react";
import { Clapperboard } from "lucide-react";
import {
  FluxIcon,
  GoogleIcon,
  GrokIcon,
  HappyHorseIcon,
  HiggsfieldIcon,
  KlingIcon,
  MinimaxIcon,
  OpenAISoraIcon,
  SeedanceIcon,
} from "@/components/cinema-studio/icons/ProviderIcons";
import WanIcon from "@/components/cinema-studio/icons/WanIcon";

export type BadgeKind = "New" | "Premium" | "Exclusive" | "Unlimited";

export type ProviderIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** Provider brand icons, reusing the same components the Cinema Studio
 *  pickers already map these families to, so one model looks the same
 *  everywhere in the app. */
const ICONS = {
  seedance: SeedanceIcon as ProviderIcon,
  google: GoogleIcon as ProviderIcon,
  kling: KlingIcon as ProviderIcon,
  sora: OpenAISoraIcon as ProviderIcon,
  grok: GrokIcon as ProviderIcon,
  flux: FluxIcon as ProviderIcon,
  minimax: MinimaxIcon as ProviderIcon,
  happyhorse: HappyHorseIcon as ProviderIcon,
  cinefield: HiggsfieldIcon as ProviderIcon,
  wan: WanIcon as ProviderIcon,
  cinemaStudio: Clapperboard as unknown as ProviderIcon,
} as const;

/**
 * Brand icon for a model or family. Matched on the name so a family card and
 * every submodel under it resolve to the same icon without repeating it on
 * ~70 entries. Anything with no in-house brand icon (nothing currently)
 * falls through to undefined and renders without one.
 */
export function iconForModel(name: string): ProviderIcon | undefined {
  if (name.startsWith("Seedance") || name.startsWith("Enhanced Seedance")) return ICONS.seedance;
  if (name.startsWith("MiniMax") || name.startsWith("Minimax")) return ICONS.minimax;
  if (name.startsWith("FLUX")) return ICONS.flux;
  if (name.startsWith("Kling")) return ICONS.kling;
  if (name.startsWith("Sora") || name.startsWith("OpenAI Sora")) return ICONS.sora;
  if (name.startsWith("Google Veo") || name.startsWith("Gemini")) return ICONS.google;
  // Cinema Studio keeps the clapperboard it uses everywhere else, so it stays
  // distinct from the rest of the Cinefield family.
  if (name.startsWith("Cinema Studio")) return ICONS.cinemaStudio;
  if (name.startsWith("Cinefield")) return ICONS.cinefield;
  if (name.startsWith("Wan")) return ICONS.wan;
  if (name.startsWith("Grok")) return ICONS.grok;
  if (name.startsWith("HappyHorse")) return ICONS.happyhorse;
  return undefined;
}

export interface AiVideoModel {
  id: string;
  name: string;
  badges?: BadgeKind[];
  /** Speaker icon next to the name — the model generates sound itself. This
   *  is independent of whether the prompt bar gets an audio toggle. */
  sound?: boolean;
  /** Small pills under the name: resolution, duration range, extra tags. */
  chips?: string[];
  /** Shown instead of chips on cards that describe rather than specify. */
  description?: string;
}

export interface AiVideoFamily extends AiVideoModel {
  submodels?: AiVideoModel[];
}

export interface AiVideoControlSpec {
  /** Continuous slider, in seconds. */
  durationRange?: [min: number, max: number];
  /** Discrete option list, in the order the reference lists them. */
  durationOptions?: string[];
  defaultDuration?: string;
  /** Per-model ratio set. Omitted entirely when the model has no ratio control. */
  ratios?: string[];
  /** Whether the prompt bar gets the audio toggle. Note: several models show a
   *  speaker icon on their card but still have no toggle — sound is baked in
   *  and can't be switched off. */
  audio?: boolean;
}

/** Ratio sets, named where they repeat across models. */
const RATIOS_FULL = ["Auto", "16:9", "9:16", "4:3", "3:4", "1:1", "21:9"];
const RATIOS_NO_AUTO = ["16:9", "9:16", "21:9", "4:3", "1:1", "3:4"];
const RATIOS_WIDE_TALL = ["16:9", "9:16"];

export const AI_VIDEO_CONTROLS: Record<string, AiVideoControlSpec> = {
  // Seedance 2.0 family — slider, full ratio set, audio toggle
  "Seedance 2.0": { durationRange: [4, 15], defaultDuration: "8s", ratios: RATIOS_FULL, audio: true },
  "Seedance 2.0 Fast": { durationRange: [4, 15], defaultDuration: "8s", ratios: RATIOS_FULL, audio: true },
  "Seedance 2.0 Mini": { durationRange: [4, 15], defaultDuration: "8s", ratios: RATIOS_FULL, audio: true },
  "Enhanced Seedance 2.0 Fast": { durationRange: [4, 15], defaultDuration: "8s", ratios: RATIOS_FULL, audio: true },

  // Seedance 2.5 — longer range, no Auto
  "Seedance 2.5": { durationRange: [4, 30], defaultDuration: "5s", ratios: RATIOS_NO_AUTO, audio: true },
  // Edit model: audio only, no duration or ratio at all
  "Seedance 2.5 Edit": { audio: true },
  "Seedance 1.5 Pro": { durationRange: [4, 12], defaultDuration: "5s", ratios: RATIOS_FULL, audio: true },
  "Seedance Pro": { durationOptions: ["5s", "10s"], defaultDuration: "5s", ratios: RATIOS_WIDE_TALL },
  "Seedance Pro Fast": { durationOptions: ["5s", "10s"], defaultDuration: "5s", ratios: RATIOS_WIDE_TALL },

  // Minimax Hailuo
  "MiniMax H3": { durationRange: [5, 15], defaultDuration: "5s", ratios: RATIOS_FULL },
  "Minimax Hailuo 2.3": { durationOptions: ["6s", "10s"], defaultDuration: "6s" },
  "Minimax Hailuo 2.3 Fast": { durationOptions: ["6s", "10s"], defaultDuration: "6s" },
  "Minimax Hailuo 02": { durationOptions: ["6s", "10s"], defaultDuration: "6s" },
  "Minimax Hailuo 02 Fast": { durationOptions: ["6s", "10s"], defaultDuration: "6s" },

  "Gemini Omni Flash": {
    durationOptions: ["4s", "6s", "8s", "10s"],
    defaultDuration: "8s",
    ratios: RATIOS_WIDE_TALL,
  },

  // Kling
  "Kling 3.0": { durationRange: [3, 15], defaultDuration: "5s", ratios: ["16:9", "9:16", "1:1"], audio: true },
  "Kling 3.0 Turbo": { durationRange: [3, 15], defaultDuration: "5s", ratios: ["16:9", "9:16", "1:1"], audio: true },
  "Kling 3.0 Omni": { durationRange: [3, 15], defaultDuration: "5s", ratios: ["16:9", "9:16", "1:1"] },
  "Kling 3.0 Omni Edit": { durationRange: [3, 10], defaultDuration: "5s", ratios: ["1:1", "16:9", "9:16"] },
  "Kling 2.6": { durationOptions: ["5s", "10s"], defaultDuration: "5s", ratios: ["16:9", "9:16", "1:1"], audio: true },
  "Kling O1 Video": { durationOptions: ["5s", "10s"], defaultDuration: "5s", ratios: ["1:1", "16:9", "9:16"] },
  "Kling O1 Video Edit": {
    durationOptions: ["6s", "10s", "3s", "4s", "5s", "7s", "8s", "9s"],
    defaultDuration: "6s",
    ratios: ["1:1", "16:9", "9:16"],
  },
  // Motion Control strips the row down to nothing but the model itself
  "Kling Motion Control": {},
  "Kling 3.0 Motion Control": {},
  "Kling 2.5 Turbo": { durationOptions: ["5s", "10s"], defaultDuration: "5s", ratios: ["16:9", "9:16", "1:1"] },
  "Kling 2.1": { durationOptions: ["5s", "10s"], defaultDuration: "5s", ratios: ["16:9", "9:16", "1:1"] },
  "Kling 2.1 Master": { durationOptions: ["5s", "10s"], defaultDuration: "5s", ratios: ["16:9", "9:16", "1:1"] },

  // Sora — sound is baked in, so no toggle despite the speaker icon
  "Sora 2": { durationOptions: ["4s", "8s", "12s"], defaultDuration: "4s", ratios: RATIOS_WIDE_TALL },
  "Sora 2 Pro": { durationOptions: ["4s", "8s", "12s"], defaultDuration: "4s", ratios: RATIOS_WIDE_TALL },
  "Sora 2 Max": { durationOptions: ["4s", "8s", "12s"], defaultDuration: "4s", ratios: RATIOS_WIDE_TALL },
  "Sora 2 Pro Max": { durationOptions: ["4s", "8s", "12s"], defaultDuration: "4s", ratios: RATIOS_WIDE_TALL },

  // Veo — same, sound baked in
  "Google Veo 3.1": { durationOptions: ["4s", "8s", "6s"], defaultDuration: "4s", ratios: RATIOS_WIDE_TALL },
  "Google Veo 3.1 Fast": { durationOptions: ["4s", "8s", "6s"], defaultDuration: "4s", ratios: RATIOS_WIDE_TALL },
  "Google Veo 3.1 Lite": { durationOptions: ["4s", "8s", "6s"], defaultDuration: "4s", ratios: RATIOS_WIDE_TALL },
  "Google Veo 3": { durationOptions: ["8s"], defaultDuration: "8s", ratios: RATIOS_WIDE_TALL },
  "Google Veo 3 Fast": { durationOptions: ["8s"], defaultDuration: "8s", ratios: RATIOS_WIDE_TALL },

  // Cinefield's own camera-control family
  "Cinema Studio 4.0 Video": { durationRange: [4, 30], defaultDuration: "5s", ratios: RATIOS_NO_AUTO, audio: true },
  "Cinefield Lite": { durationOptions: ["3s", "5s"], defaultDuration: "3s" },
  "Cinefield Standard": { durationOptions: ["3s", "5s"], defaultDuration: "3s" },
  "Cinefield Turbo": { durationOptions: ["3s", "5s"], defaultDuration: "3s" },

  // Wan
  "Wan 2.7": { durationRange: [2, 15], defaultDuration: "5s", ratios: RATIOS_WIDE_TALL },
  "Wan 2.6": { durationRange: [5, 15], defaultDuration: "5s", ratios: RATIOS_WIDE_TALL },
  "Wan 2.5": { durationOptions: ["5s", "10s"], defaultDuration: "5s", ratios: RATIOS_WIDE_TALL },
  "Wan 2.5 Fast": { durationOptions: ["5s", "10s"], defaultDuration: "5s", ratios: RATIOS_WIDE_TALL },
  "Wan 2.2": { durationOptions: ["5s"], defaultDuration: "5s", ratios: RATIOS_WIDE_TALL },
  "Wan 2.2 Fast": { durationOptions: ["5s"], defaultDuration: "5s", ratios: RATIOS_WIDE_TALL },

  // FLUX.3 — the only model with a 2:1 ratio
  "FLUX.3 Video": {
    durationRange: [5, 20],
    defaultDuration: "5s",
    ratios: ["Auto", "21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16"],
    audio: true,
  },

  // Grok — the only model with 3:2 and 2:3
  "Grok Imagine": {
    durationRange: [1, 15],
    defaultDuration: "5s",
    ratios: ["Auto", "16:9", "4:3", "1:1", "3:4", "9:16", "3:2", "2:3"],
  },
  "Grok Imagine 1.5": {
    durationRange: [1, 15],
    defaultDuration: "5s",
    ratios: ["Auto", "16:9", "4:3", "1:1", "3:4", "9:16", "3:2", "2:3"],
  },
  "Grok Imagine Edit": {},

  HappyHorse: {
    durationRange: [3, 15],
    defaultDuration: "5s",
    ratios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  },
};

/** Horizontal-equivalent quick-access list shown above the full tree. */
export const FEATURED_MODELS: AiVideoModel[] = [
  { id: "f-seedance-25", name: "Seedance 2.5", badges: ["New"], chips: ["1080p", "4s-30s"] },
  { id: "f-seedance-25-edit", name: "Seedance 2.5 Edit", badges: ["New"], chips: ["480p-720p", "Edit Video", "Audio"] },
  { id: "f-seedance-20", name: "Seedance 2.0", chips: ["4K", "4s-15s"] },
  { id: "f-seedance-20-fast", name: "Seedance 2.0 Fast", chips: ["720p", "4s-15s"] },
  { id: "f-seedance-20-mini", name: "Seedance 2.0 Mini", chips: ["720p", "4s-15s"] },
  { id: "f-minimax-h3", name: "MiniMax H3", badges: ["New"], chips: ["2K", "5s-15s"] },
  { id: "f-gemini-omni", name: "Gemini Omni Flash", chips: ["720p", "4s-10s"] },
  { id: "f-kling-30", name: "Kling 3.0", sound: true, chips: ["4K", "3s-15s"] },
  { id: "f-kling-30-mc", name: "Kling 3.0 Motion Control", chips: ["1080p", "3s-30s"] },
  { id: "f-flux-3", name: "FLUX.3 Video", sound: true, badges: ["New"], chips: ["1080p", "5s-20s"] },
  { id: "f-grok-15", name: "Grok Imagine 1.5", chips: ["720p", "1s-15s"] },
];

/** The full list. Cards with `submodels` open a family flyout on hover and
 *  are not selectable themselves; the rest select directly. */
export const ALL_MODELS: AiVideoFamily[] = [
  {
    id: "minimax-hailuo",
    name: "Minimax Hailuo",
    description: "High-dynamic, VFX-ready, fastest and most affordable",
    submodels: [
      { id: "minimax-h3", name: "MiniMax H3", badges: ["New"], chips: ["2K", "5s-15s"] },
      { id: "hailuo-23-fast", name: "Minimax Hailuo 2.3 Fast", chips: ["1080p", "6s-10s"] },
      { id: "hailuo-23", name: "Minimax Hailuo 2.3", badges: ["Premium"], chips: ["1080p", "6s-10s"] },
      { id: "hailuo-02-fast", name: "Minimax Hailuo 02 Fast", chips: ["512p", "6s-10s"] },
      { id: "hailuo-02", name: "Minimax Hailuo 02", badges: ["Premium"], chips: ["1080p", "6s-10s"] },
    ],
  },
  { id: "flux-3-video", name: "FLUX.3 Video", sound: true, badges: ["New"], chips: ["1080p", "5s-20s"] },
  {
    id: "kling",
    name: "Kling",
    description: "Perfect motion with advanced video control",
    submodels: [
      { id: "kling-30", name: "Kling 3.0", sound: true, chips: ["4K", "3s-15s"] },
      { id: "kling-30-turbo", name: "Kling 3.0 Turbo", sound: true, chips: ["1080p", "3s-15s"] },
      // The reference lists this model and "Kling O1 Video" twice each; those
      // are duplicates in its own data, so only one of each is carried here.
      { id: "kling-30-omni", name: "Kling 3.0 Omni", badges: ["Premium", "Exclusive"], chips: ["4K", "3s-15s"] },
      { id: "kling-30-omni-edit", name: "Kling 3.0 Omni Edit", badges: ["Exclusive"], chips: ["1080p", "3s-10s"] },
      { id: "kling-26", name: "Kling 2.6", sound: true, chips: ["1080p", "5s-10s"] },
      { id: "kling-o1", name: "Kling O1 Video", badges: ["Premium"], chips: ["1080p", "5s-10s"] },
      { id: "kling-o1-edit", name: "Kling O1 Video Edit", badges: ["Premium"], chips: ["1080p", "3s-10s", "Edit Video"] },
      { id: "kling-mc", name: "Kling Motion Control", chips: ["1080p", "3s-30s"] },
      { id: "kling-30-mc", name: "Kling 3.0 Motion Control", chips: ["1080p", "3s-30s"] },
      { id: "kling-25-turbo", name: "Kling 2.5 Turbo", chips: ["1080p", "5s-10s"] },
      { id: "kling-21", name: "Kling 2.1", badges: ["Premium"], chips: ["1080p", "5s-10s"] },
      { id: "kling-21-master", name: "Kling 2.1 Master", badges: ["Premium"], chips: ["1080p", "5s-10s"] },
    ],
  },
  {
    id: "openai-sora-2",
    name: "OpenAI Sora 2",
    description: "Multi-shot video with sound generation",
    submodels: [
      { id: "sora-2", name: "Sora 2", badges: ["Premium"], sound: true, chips: ["720p", "4s-12s"] },
      { id: "sora-2-pro", name: "Sora 2 Pro", badges: ["Premium"], sound: true, chips: ["1080p", "4s-12s"] },
      { id: "sora-2-max", name: "Sora 2 Max", badges: ["Premium"], sound: true, chips: ["1080p", "4s-12s"] },
      { id: "sora-2-pro-max", name: "Sora 2 Pro Max", badges: ["Premium"], sound: true, chips: ["1080p", "4s-12s"] },
    ],
  },
  {
    id: "google-veo",
    name: "Google Veo",
    description: "Precision video with sound control",
    submodels: [
      { id: "veo-31-lite", name: "Google Veo 3.1 Lite", sound: true, chips: ["1080p", "4s-8s"] },
      { id: "veo-31-fast", name: "Google Veo 3.1 Fast", badges: ["Premium"], sound: true, chips: ["1080p", "4s-8s"] },
      { id: "veo-31", name: "Google Veo 3.1", badges: ["Premium"], sound: true, chips: ["1080p", "4s-8s"] },
      { id: "veo-3-fast", name: "Google Veo 3 Fast", badges: ["Premium"], sound: true, chips: ["1080p", "8s"] },
      { id: "veo-3", name: "Google Veo 3", badges: ["Premium"], sound: true, chips: ["1080p", "8s"] },
    ],
  },
  { id: "gemini-omni-flash", name: "Gemini Omni Flash", chips: ["720p", "4s-10s"] },
  {
    id: "cinefield",
    name: "Cinefield",
    description: "Advanced camera controls and effect presets",
    submodels: [
      { id: "cinema-studio-40", name: "Cinema Studio 4.0 Video", badges: ["New"], chips: ["1080p", "4s-30s"] },
      { id: "cinefield-lite", name: "Cinefield Lite", badges: ["Premium"], chips: ["720p", "3s-5s"] },
      { id: "cinefield-standard", name: "Cinefield Standard", badges: ["Premium"], chips: ["720p", "3s-5s"] },
      { id: "cinefield-turbo", name: "Cinefield Turbo", badges: ["Premium"], chips: ["720p", "3s-5s"] },
    ],
  },
  {
    id: "wan",
    name: "Wan",
    description: "Camera-controlled video with sound, more freedom",
    submodels: [
      { id: "wan-27", name: "Wan 2.7", chips: ["1080p", "2s-15s"] },
      { id: "wan-26", name: "Wan 2.6", chips: ["1080p", "5s-15s"] },
      { id: "wan-25", name: "Wan 2.5", badges: ["Premium"], sound: true, chips: ["1080p", "5s-10s"] },
      { id: "wan-25-fast", name: "Wan 2.5 Fast", badges: ["Premium"], sound: true, chips: ["1080p", "5s-10s"] },
      { id: "wan-22", name: "Wan 2.2", badges: ["Premium"], chips: ["720p", "5s"] },
      { id: "wan-22-fast", name: "Wan 2.2 Fast", chips: ["720p", "5s"] },
    ],
  },
  {
    id: "seedance-20-unlimited",
    name: "Seedance 2.0 Unlimited Family",
    badges: ["Unlimited"],
    description: "Unlimited models for advanced generation",
    submodels: [
      { id: "enhanced-seedance-20-fast", name: "Enhanced Seedance 2.0 Fast", badges: ["Unlimited"], chips: ["720p", "4s-15s"] },
      { id: "u-seedance-20-mini", name: "Seedance 2.0 Mini", badges: ["Unlimited", "Exclusive"], chips: ["720p", "4s-15s"] },
      { id: "u-seedance-20", name: "Seedance 2.0", badges: ["Unlimited"], chips: ["1080p", "4s-15s"] },
    ],
  },
  {
    id: "seedance",
    name: "Seedance",
    description: "Cinematic, multi-shot video creation",
    submodels: [
      { id: "seedance-25", name: "Seedance 2.5", badges: ["New"], chips: ["1080p", "4s-30s"] },
      { id: "seedance-25-edit", name: "Seedance 2.5 Edit", badges: ["New"], chips: ["480p-720p", "Edit Video", "Audio"] },
      { id: "seedance-20-fast", name: "Seedance 2.0 Fast", chips: ["720p", "4s-15s"] },
      { id: "seedance-20-mini", name: "Seedance 2.0 Mini", badges: ["Exclusive"], chips: ["720p", "4s-15s"] },
      { id: "seedance-20", name: "Seedance 2.0", chips: ["4K", "4s-15s"] },
      { id: "seedance-15-pro", name: "Seedance 1.5 Pro", chips: ["720p", "4s-12s"] },
      { id: "seedance-pro", name: "Seedance Pro", badges: ["Premium"], chips: ["1080p", "5s-10s"] },
      { id: "seedance-pro-fast", name: "Seedance Pro Fast", badges: ["Premium"], chips: ["1080p", "5s-10s"] },
    ],
  },
  {
    id: "grok-imagine",
    name: "Grok Imagine",
    description: "Perfect motion with advanced video control",
    submodels: [
      { id: "grok", name: "Grok Imagine", chips: ["720p", "1s-15s"] },
      { id: "grok-15", name: "Grok Imagine 1.5", chips: ["720p", "1s-15s"] },
      { id: "grok-edit", name: "Grok Imagine Edit", description: "Edit videos with text prompts" },
    ],
  },
  { id: "happyhorse", name: "HappyHorse", sound: true, chips: ["1080p", "3s-15s"] },
];

export const AI_VIDEO_DEFAULT_MODEL = "Seedance 2.0";

/** Flat lookup of every selectable model name, used to resolve a search hit
 *  or a family submodel back to its control spec. */
export function getControlSpec(modelName: string): AiVideoControlSpec {
  return AI_VIDEO_CONTROLS[modelName] ?? {};
}
