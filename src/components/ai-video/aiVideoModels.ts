/**
 * AI Video model tree and per-model control shapes, transcribed from a live
 * audit of the reference site's own /ai-video landing-page prompt bar
 * (structure, control vocabulary and option sets only). Every "Higgsfield"
 * name is Cinefield's own here.
 *
 * Everything below is keyed by **model id**, not by name, because the
 * reference genuinely ships two different models called `Kling 3.0 Omni` and
 * two called `Kling O1 Video` — both pairs are shown in its Kling flyout, and
 * name-keying would collapse each pair into one row and light both up at once.
 *
 * Three things the audit settled that are easy to get wrong:
 *  - Duration is TWO different controls: a continuous slider for models with
 *    a range, and a fixed option list for models with discrete steps.
 *  - A control that is absent is absent for real. Kling 2.5 Turbo shows only
 *    the model pill and a duration; Kling Motion Control shows neither.
 *  - Ratio sets, duration sets and defaults are per model, not per family:
 *    Google Veo 3.1 Lite gets `Auto` while Veo 3.1 and 3.1 Fast do not, and
 *    Sora defaults to its longest duration rather than its shortest.
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

/** The reference marks New / Premium / Exclusive too; Cinefield deliberately
 *  shows none of those, so `Unlimited` is the only badge that survives. */
export type BadgeKind = "Unlimited";

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
  defaultRatio?: string;
  /** Whether the prompt bar gets the audio toggle. Note: several models show a
   *  speaker icon on their card but still have no toggle — sound is baked in
   *  and can't be switched off. */
  audio?: boolean;
}

/** Ratio sets, named where they repeat across models. */
const RATIOS_SEEDANCE_2 = ["Auto", "16:9", "9:16", "4:3", "3:4", "1:1", "21:9"];
const RATIOS_SEEDANCE_25 = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const RATIOS_WIDE_TALL = ["16:9", "9:16"];
const RATIOS_KLING = ["16:9", "9:16", "1:1"];
const RATIOS_KLING_SQUARE_FIRST = ["1:1", "16:9", "9:16"];

/** Every second between 3s and 10s — three Kling editing models offer this. */
const DURATIONS_3_TO_10 = ["3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s"];

export const AI_VIDEO_CONTROLS: Record<string, AiVideoControlSpec> = {
  /* -------------------------------------------------- Minimax Hailuo */
  minimax_h3: {
    durationRange: [5, 15],
    defaultDuration: "5s",
    ratios: ["Auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    defaultRatio: "Auto",
  },
  // The four Hailuo models below have no ratio control at all.
  "minimax-2.3-fast": { durationOptions: ["6s", "10s"], defaultDuration: "6s" },
  "minimax-2.3": { durationOptions: ["6s", "10s"], defaultDuration: "6s" },
  "minimax-fast": { durationOptions: ["6s", "10s"], defaultDuration: "6s" },
  minimax: { durationOptions: ["6s", "10s"], defaultDuration: "6s" },

  /* -------------------------------------------------- FLUX.3 */
  // The only model with a 2:1 ratio.
  flux_3_video: {
    durationRange: [5, 20],
    defaultDuration: "5s",
    ratios: ["Auto", "21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16"],
    defaultRatio: "Auto",
    audio: true,
  },

  /* -------------------------------------------------- Kling */
  kling3_0: { durationRange: [3, 15], defaultDuration: "5s", ratios: RATIOS_KLING, audio: true },
  kling3_0_turbo: { durationRange: [3, 15], defaultDuration: "5s", ratios: RATIOS_KLING },
  kling_o3_flf: {
    durationOptions: ["5s", "10s"],
    defaultDuration: "5s",
    ratios: RATIOS_KLING_SQUARE_FIRST,
    audio: true,
  },
  kling_o3_image_reference: {
    durationOptions: ["5s", "10s"],
    defaultDuration: "5s",
    ratios: RATIOS_KLING_SQUARE_FIRST,
    audio: true,
  },
  "kling-video-reference-o3": {
    durationOptions: DURATIONS_3_TO_10,
    defaultDuration: "5s",
    ratios: RATIOS_KLING_SQUARE_FIRST,
  },
  kling2_6: { durationOptions: ["5s", "10s"], defaultDuration: "5s", ratios: RATIOS_KLING, audio: true },
  "kling-omni-flf": {
    durationOptions: ["5s", "10s"],
    defaultDuration: "5s",
    ratios: RATIOS_KLING_SQUARE_FIRST,
  },
  "kling-omni-image-reference": {
    durationOptions: ["5s", "10s"],
    defaultDuration: "5s",
    ratios: RATIOS_KLING_SQUARE_FIRST,
  },
  "kling-video-edit": {
    durationOptions: DURATIONS_3_TO_10,
    defaultDuration: "5s",
    ratios: RATIOS_KLING_SQUARE_FIRST,
  },
  // Motion Control strips the row down to nothing but the model itself.
  "kling-2-6-motion-control": {},
  "kling-3-motion-control": {},
  // These three carry a duration and nothing else.
  "kling-v2-5-turbo": { durationOptions: ["5s", "10s"], defaultDuration: "5s" },
  "kling-v2-1": { durationOptions: ["5s", "10s"], defaultDuration: "5s" },
  "kling-v2-1-master": { durationOptions: ["5s", "10s"], defaultDuration: "5s" },

  /* -------------------------------------------------- OpenAI Sora 2 */
  // Sound is baked in, so no toggle despite the speaker icon. All four
  // default to their longest duration rather than their shortest.
  open_sora_video: {
    durationOptions: ["4s", "8s", "12s"],
    defaultDuration: "12s",
    ratios: RATIOS_WIDE_TALL,
  },
  "sora-pro": { durationOptions: ["4s", "8s", "12s"], defaultDuration: "12s", ratios: RATIOS_WIDE_TALL },
  "sora-2-max": { durationOptions: ["4s", "8s", "12s"], defaultDuration: "12s", ratios: RATIOS_WIDE_TALL },
  "sora-2-pro-max": { durationOptions: ["4s", "8s", "12s"], defaultDuration: "12s", ratios: RATIOS_WIDE_TALL },

  /* -------------------------------------------------- Google Veo */
  // Lite is the only Veo with an audio toggle and an `Auto` ratio.
  "veo-3-1-lite": {
    durationOptions: ["4s", "6s", "8s"],
    defaultDuration: "8s",
    ratios: ["Auto", "16:9", "9:16"],
    defaultRatio: "Auto",
    audio: true,
  },
  "veo-3-1-fast": { durationOptions: ["4s", "6s", "8s"], defaultDuration: "8s", ratios: RATIOS_WIDE_TALL },
  "veo-3-1-preview": { durationOptions: ["4s", "6s", "8s"], defaultDuration: "8s", ratios: RATIOS_WIDE_TALL },
  // Veo 3 is fixed at 8s, so it has no duration control at all.
  "veo-3-fast": { ratios: RATIOS_WIDE_TALL },
  "veo-3-preview": { ratios: RATIOS_WIDE_TALL },

  /* -------------------------------------------------- Gemini */
  "gemini-omni": {
    durationOptions: ["4s", "6s", "8s", "10s"],
    defaultDuration: "8s",
    ratios: RATIOS_WIDE_TALL,
  },

  /* -------------------------------------------------- Cinefield */
  cinematic_studio_video_4_0: {
    durationRange: [4, 30],
    defaultDuration: "5s",
    ratios: RATIOS_SEEDANCE_25,
    audio: true,
  },
  lite: { durationOptions: ["3s", "5s"], defaultDuration: "3s" },
  standard: { durationOptions: ["3s", "5s"], defaultDuration: "3s" },
  turbo: { durationOptions: ["3s", "5s"], defaultDuration: "3s" },

  /* -------------------------------------------------- Wan */
  wan2_7: {
    durationRange: [2, 15],
    defaultDuration: "5s",
    ratios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
  },
  wan2_6: { durationOptions: ["5s", "10s", "15s"], defaultDuration: "5s" },
  wan2_5_video: { durationOptions: ["5s", "10s"], defaultDuration: "5s", ratios: RATIOS_WIDE_TALL },
  "wan2_5_video-fast": { durationOptions: ["5s", "10s"], defaultDuration: "5s", ratios: RATIOS_WIDE_TALL },
  // Wan 2.2 offers 3s and 5s but opens on 5s; the Fast variant is fixed and
  // shows no control at all.
  wan: { durationOptions: ["3s", "5s"], defaultDuration: "5s" },
  wan_fast: {},

  /* -------------------------------------------------- Seedance Unlimited */
  seedance_unlimited: {
    durationRange: [4, 15],
    defaultDuration: "8s",
    ratios: RATIOS_SEEDANCE_2,
    defaultRatio: "Auto",
    audio: true,
  },
  seedance_mini_unlimited: {
    durationRange: [4, 15],
    defaultDuration: "8s",
    ratios: RATIOS_SEEDANCE_2,
    defaultRatio: "Auto",
    audio: true,
  },
  seedance_2_unlimited: {
    durationRange: [4, 15],
    defaultDuration: "8s",
    ratios: RATIOS_SEEDANCE_2,
    defaultRatio: "Auto",
    audio: true,
  },

  /* -------------------------------------------------- Seedance */
  seedance_2_5: {
    durationRange: [4, 30],
    defaultDuration: "5s",
    ratios: RATIOS_SEEDANCE_25,
    audio: true,
  },
  // Edit model: audio only, no duration or ratio at all.
  seedance_2_5_edit: { audio: true },
  seedance_2_0_fast: {
    durationRange: [4, 15],
    defaultDuration: "8s",
    ratios: RATIOS_SEEDANCE_2,
    defaultRatio: "Auto",
    audio: true,
  },
  seedance_2_0_mini: {
    durationRange: [4, 15],
    defaultDuration: "8s",
    ratios: RATIOS_SEEDANCE_2,
    defaultRatio: "Auto",
    audio: true,
  },
  seedance_2_0: {
    durationRange: [4, 15],
    defaultDuration: "8s",
    ratios: RATIOS_SEEDANCE_2,
    defaultRatio: "Auto",
    audio: true,
  },
  "seedance-1-5": {
    durationOptions: ["4s", "8s", "12s"],
    defaultDuration: "8s",
    ratios: ["Auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    defaultRatio: "Auto",
    audio: true,
  },
  seedance_pro: { durationOptions: ["5s", "10s"], defaultDuration: "5s" },
  seedance_pro_fast: { durationOptions: ["5s", "10s"], defaultDuration: "5s" },

  /* -------------------------------------------------- Grok */
  // The only models with 3:2 and 2:3. Plain Grok Imagine opens at its
  // maximum duration, the 1.5 revision at 5s.
  grok_video: {
    durationRange: [1, 15],
    defaultDuration: "15s",
    ratios: ["Auto", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "1:1"],
    defaultRatio: "Auto",
  },
  grok_video_v15: {
    durationRange: [1, 15],
    defaultDuration: "5s",
    ratios: ["Auto", "16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"],
    defaultRatio: "Auto",
  },
  "grok-video-edit": {},

  /* -------------------------------------------------- HappyHorse */
  "happy-horse": {
    durationRange: [3, 15],
    defaultDuration: "5s",
    ratios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  },
};

/** Horizontal-equivalent quick-access list shown above the full tree. */
export const FEATURED_MODELS: AiVideoModel[] = [
  { id: "seedance_2_5", name: "Seedance 2.5", chips: ["1080p", "4s-30s"] },
  { id: "seedance_2_5_edit", name: "Seedance 2.5 Edit", chips: ["480p-720p", "Edit Video", "Audio"] },
  { id: "seedance_2_0", name: "Seedance 2.0", chips: ["4K", "4s-15s"] },
  { id: "seedance_2_0_fast", name: "Seedance 2.0 Fast", chips: ["720p", "4s-15s"] },
  { id: "seedance_2_0_mini", name: "Seedance 2.0 Mini", chips: ["720p", "4s-15s"] },
  { id: "minimax_h3", name: "MiniMax H3", chips: ["2K", "5s-15s"] },
  { id: "gemini-omni", name: "Gemini Omni Flash", chips: ["720p", "4s-10s"] },
  { id: "kling3_0", name: "Kling 3.0", sound: true, chips: ["4K", "3s-15s"] },
  { id: "kling-3-motion-control", name: "Kling 3.0 Motion Control", chips: ["1080p", "3s-30s"] },
  { id: "flux_3_video", name: "FLUX.3 Video", sound: true, chips: ["1080p", "5s-20s"] },
  { id: "grok_video_v15", name: "Grok Imagine 1.5", chips: ["720p", "1s-15s"] },
];

/** The full list. Cards with `submodels` open a family flyout on hover and
 *  are not selectable themselves; the rest select directly. A family whose
 *  only child is the family itself (FLUX.3, Gemini, HappyHorse) is flattened
 *  into a plain selectable card, exactly as the reference renders it. */
export const ALL_MODELS: AiVideoFamily[] = [
  {
    id: "minimax-model",
    name: "Minimax Hailuo",
    description: "High-dynamic, VFX-ready, fastest and most affordable",
    submodels: [
      { id: "minimax_h3", name: "MiniMax H3", chips: ["2K", "5s-15s"] },
      { id: "minimax-2.3-fast", name: "Minimax Hailuo 2.3 Fast", chips: ["1080p", "6s-10s"] },
      { id: "minimax-2.3", name: "Minimax Hailuo 2.3", chips: ["1080p", "6s-10s"] },
      { id: "minimax-fast", name: "Minimax Hailuo 02 Fast", chips: ["512p", "6s-10s"] },
      { id: "minimax", name: "Minimax Hailuo 02", chips: ["1080p", "6s-10s"] },
    ],
  },
  { id: "flux_3_video", name: "FLUX.3 Video", sound: true, chips: ["1080p", "5s-20s"] },
  {
    id: "kling",
    name: "Kling",
    description: "Perfect motion with advanced video control",
    submodels: [
      { id: "kling3_0", name: "Kling 3.0", sound: true, chips: ["4K", "3s-15s"] },
      { id: "kling3_0_turbo", name: "Kling 3.0 Turbo", sound: true, chips: ["1080p", "3s-15s"] },
      // Two distinct models share the name `Kling 3.0 Omni`, and two more
      // share `Kling O1 Video`. The reference shows all four rows; they are
      // told apart by id, not by label.
      { id: "kling_o3_flf", name: "Kling 3.0 Omni", chips: ["4K", "3s-15s"] },
      { id: "kling_o3_image_reference", name: "Kling 3.0 Omni", chips: ["4K", "3s-15s"] },
      { id: "kling-video-reference-o3", name: "Kling 3.0 Omni Edit", chips: ["1080p", "3s-10s"] },
      { id: "kling2_6", name: "Kling 2.6", sound: true, chips: ["1080p", "5s-10s"] },
      { id: "kling-omni-flf", name: "Kling O1 Video", chips: ["1080p", "5s-10s"] },
      { id: "kling-omni-image-reference", name: "Kling O1 Video", chips: ["1080p", "5s-10s"] },
      { id: "kling-video-edit", name: "Kling O1 Video Edit", chips: ["1080p", "3s-10s", "Edit Video"] },
      { id: "kling-2-6-motion-control", name: "Kling Motion Control", chips: ["1080p", "3s-30s"] },
      { id: "kling-3-motion-control", name: "Kling 3.0 Motion Control", chips: ["1080p", "3s-30s"] },
      { id: "kling-v2-5-turbo", name: "Kling 2.5 Turbo", chips: ["1080p", "5s-10s"] },
      { id: "kling-v2-1", name: "Kling 2.1", chips: ["1080p", "5s-10s"] },
      { id: "kling-v2-1-master", name: "Kling 2.1 Master", chips: ["1080p", "5s-10s"] },
    ],
  },
  {
    id: "sora2-video",
    name: "OpenAI Sora 2",
    description: "Multi-shot video with sound generation",
    submodels: [
      { id: "open_sora_video", name: "Sora 2", sound: true, chips: ["720p", "4s-12s"] },
      { id: "sora-pro", name: "Sora 2 Pro", sound: true, chips: ["1080p", "4s-12s"] },
      { id: "sora-2-max", name: "Sora 2 Max", sound: true, chips: ["1080p", "4s-12s"] },
      { id: "sora-2-pro-max", name: "Sora 2 Pro Max", sound: true, chips: ["1080p", "4s-12s"] },
    ],
  },
  {
    id: "veo",
    name: "Google Veo",
    description: "Precision video with sound control",
    submodels: [
      { id: "veo-3-1-lite", name: "Google Veo 3.1 Lite", sound: true, chips: ["1080p", "4s-8s"] },
      { id: "veo-3-1-fast", name: "Google Veo 3.1 Fast", sound: true, chips: ["1080p", "4s-8s"] },
      { id: "veo-3-1-preview", name: "Google Veo 3.1", sound: true, chips: ["1080p", "4s-8s"] },
      { id: "veo-3-fast", name: "Google Veo 3 Fast", sound: true, chips: ["1080p", "8s"] },
      { id: "veo-3-preview", name: "Google Veo 3", sound: true, chips: ["1080p", "8s"] },
    ],
  },
  { id: "gemini-omni", name: "Gemini Omni Flash", chips: ["720p", "4s-10s"] },
  {
    id: "higgsfield",
    name: "Cinefield",
    description: "Advanced camera controls and effect presets",
    submodels: [
      { id: "cinematic_studio_video_4_0", name: "Cinema Studio 4.0 Video", chips: ["1080p", "4s-30s"] },
      { id: "lite", name: "Cinefield Lite", chips: ["720p", "3s-5s"] },
      { id: "standard", name: "Cinefield Standard", chips: ["720p", "3s-5s"] },
      { id: "turbo", name: "Cinefield Turbo", chips: ["720p", "3s-5s"] },
    ],
  },
  {
    id: "wan-2.2",
    name: "Wan",
    description: "Camera-controlled video with sound, more freedom",
    submodels: [
      { id: "wan2_7", name: "Wan 2.7", chips: ["1080p", "2s-15s"] },
      { id: "wan2_6", name: "Wan 2.6", chips: ["1080p", "5s-15s"] },
      { id: "wan2_5_video", name: "Wan 2.5", sound: true, chips: ["1080p", "5s-10s"] },
      { id: "wan2_5_video-fast", name: "Wan 2.5 Fast", sound: true, chips: ["1080p", "5s-10s"] },
      { id: "wan", name: "Wan 2.2", chips: ["720p", "5s"] },
      { id: "wan_fast", name: "Wan 2.2 Fast", chips: ["720p", "5s"] },
    ],
  },
  {
    id: "seedance-unlimited",
    name: "Seedance 2.0 Unlimited Family",
    badges: ["Unlimited"],
    description: "Unlimited models for advanced generation",
    submodels: [
      { id: "seedance_unlimited", name: "Enhanced Seedance 2.0 Fast", badges: ["Unlimited"], chips: ["720p", "4s-15s"] },
      { id: "seedance_mini_unlimited", name: "Seedance 2.0 Mini", badges: ["Unlimited"], chips: ["720p", "4s-15s"] },
      { id: "seedance_2_unlimited", name: "Seedance 2.0", badges: ["Unlimited"], chips: ["1080p", "4s-15s"] },
    ],
  },
  {
    id: "seedance",
    name: "Seedance",
    description: "Cinematic, multi-shot video creation",
    submodels: [
      { id: "seedance_2_5", name: "Seedance 2.5", chips: ["1080p", "4s-30s"] },
      { id: "seedance_2_5_edit", name: "Seedance 2.5 Edit", chips: ["480p-720p", "Edit Video", "Audio"] },
      { id: "seedance_2_0_fast", name: "Seedance 2.0 Fast", chips: ["720p", "4s-15s"] },
      { id: "seedance_2_0_mini", name: "Seedance 2.0 Mini", chips: ["720p", "4s-15s"] },
      { id: "seedance_2_0", name: "Seedance 2.0", chips: ["4K", "4s-15s"] },
      { id: "seedance-1-5", name: "Seedance 1.5 Pro", chips: ["720p", "4s-12s"] },
      { id: "seedance_pro", name: "Seedance Pro", chips: ["1080p", "5s-10s"] },
      { id: "seedance_pro_fast", name: "Seedance Pro Fast", chips: ["1080p", "5s-10s"] },
    ],
  },
  {
    id: "grok",
    name: "Grok Imagine",
    description: "Perfect motion with advanced video control",
    submodels: [
      { id: "grok_video", name: "Grok Imagine", chips: ["720p", "1s-15s"] },
      { id: "grok_video_v15", name: "Grok Imagine 1.5", chips: ["720p", "1s-15s"] },
      { id: "grok-video-edit", name: "Grok Imagine Edit", description: "Edit videos with text prompts" },
    ],
  },
  { id: "happy-horse", name: "HappyHorse", sound: true, chips: ["1080p", "3s-15s"] },
];

export const AI_VIDEO_DEFAULT_MODEL = "seedance_2_0";

/** Flat lookup of every selectable model, so a search hit, a family submodel
 *  or a stored id all resolve back to the same entry. */
const MODELS_BY_ID = new Map<string, AiVideoModel>();
for (const card of ALL_MODELS) {
  if (card.submodels) for (const sub of card.submodels) MODELS_BY_ID.set(sub.id, sub);
  else MODELS_BY_ID.set(card.id, card);
}

export function getModel(id: string): AiVideoModel | undefined {
  return MODELS_BY_ID.get(id);
}

/** Label for the prompt bar's model pill. */
export function getModelName(id: string): string {
  return MODELS_BY_ID.get(id)?.name ?? id;
}

export function getControlSpec(id: string): AiVideoControlSpec {
  return AI_VIDEO_CONTROLS[id] ?? {};
}
