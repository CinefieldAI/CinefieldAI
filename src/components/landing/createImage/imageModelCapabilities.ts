export interface AspectRatioChoice {
  value: string;
  width: number;
  height: number;
  description?: string;
  cinematic?: boolean;
}

export function getAspectRatioDescription(value: string): string {
  switch (value) {
    case "Auto":
    case "auto":
      return "Model default";
    case "1:1":
      return "Square";
    case "3:4":
    case "2:3":
      return "Portrait";
    case "9:16":
      return "Stories/Reels";
    case "4:3":
      return "Standard";
    case "16:9":
      return "Widescreen";
    case "21:9":
      return "Cinematic";
    case "3:2":
      return "Landscape";
    default:
      return "Custom";
  }
}

export interface ResolutionChoice {
  value: string;
  description: string;
}

export interface ImageModelCapabilities {
  /** Large 40px model-selector trigger (GPT Image 2) vs the 28px compact chip used by every other capability-driven model. */
  modelTriggerSize: "compact" | "large";
  quality: boolean;
  qualityOptions?: { value: string; description: string }[];
  defaultQuality?: string;
  resolution: "simple" | "detailed" | false;
  resolutionOptions?: ResolutionChoice[];
  defaultResolution?: string;
  aspectRatio: "simple" | "cinematic" | false;
  aspectRatioOptions?: AspectRatioChoice[];
  defaultAspectRatio?: string;
  batchSize: boolean;
  /** Per-model initial batch value — falls back to 1 when omitted. */
  defaultBatchSize?: number;
  /** Per-model batch ceiling — falls back to 4 when omitted (Cinematic Locations uses 10). */
  maxBatchSize?: number;
  gridGeneration: boolean;
  enhancementToggle: boolean;
  defaultEnhancement?: boolean;
  /** Flux.2 Flex's compact sliders/settings trigger + popover. */
  settingsTrigger: boolean;
  /** Recraft V4.1 Utility's Vector mode toggle. */
  vectorMode?: boolean;
  defaultVectorMode?: boolean;
  /** Recraft V4.1 Utility's Color transfer toggle. */
  colorTransfer?: boolean;
  defaultColorTransfer?: boolean;
  assetUpload: boolean;
  referenceSelection: boolean;
  /** Shows the compact @ button, opening the shared Assets Picker with its
   *  Elements tab active (separate from the plus button's image uploads). */
  elementReferences?: boolean;
  /** Renders the 80px Character + General cards beside Generate instead of
   *  a compact-row pill (Higgsfield Soul 2.0 only). */
  characterCards?: boolean;
  /** Nano Banana 2 Lite's Thinking (reasoning depth) selector. */
  thinkingOptions?: string[];
  defaultThinking?: string;
  /** Seedream 5.0 Pro's Unlimited switch, rendered right of the batch counter. */
  unlimited?: boolean;
  defaultUnlimited?: boolean;
  /** Nano Banana's Draw control — opens the existing draw mode. */
  drawTool?: boolean;
}

export const RECRAFT_QUALITY_OPTIONS: { value: string; description: string }[] = [
  { value: "Standard", description: "Balanced quality and speed" },
  { value: "Pro", description: "Higher fidelity, slower" },
];

/** Recraft V4.1 needs the 4:5 social ratio, which the shared standard set omits. */
export const RECRAFT_ASPECT_RATIOS: AspectRatioChoice[] = [
  { value: "1:1", width: 16, height: 16 },
  { value: "4:5", width: 16, height: 20 },
  { value: "3:4", width: 15, height: 20 },
  { value: "9:16", width: 12, height: 21 },
  { value: "4:3", width: 20, height: 15 },
  { value: "16:9", width: 21, height: 12 },
];

const CINEMATIC_RATIOS: AspectRatioChoice[] = [
  { value: "1:1", width: 16, height: 16 },
  { value: "3:4", width: 15, height: 20 },
  { value: "2:3", width: 14, height: 21 },
  { value: "9:16", width: 12, height: 21 },
  { value: "3:2", width: 21, height: 14 },
  { value: "4:3", width: 20, height: 15 },
  { value: "16:9", width: 21, height: 12, cinematic: true },
  { value: "21:9", width: 24, height: 10, cinematic: true },
];

const GPT_ASPECT_RATIOS: AspectRatioChoice[] = [
  { value: "Auto", width: 16, height: 16 },
  { value: "1:1", width: 16, height: 16 },
  { value: "3:4", width: 15, height: 20 },
  { value: "4:3", width: 20, height: 15 },
  { value: "9:16", width: 12, height: 21 },
  { value: "16:9", width: 21, height: 12 },
];

/** The 8-ratio cinematic set with no `cinematic` badge flag — used by the
 *  reference-style models (Multi Reference / Flux Kontext Max / FLUX.2 Max /
 *  WAN 2.2) which need the wider ratio range but never show the "Cinematic"
 *  badge (that badge is exclusive to Soul Cinema). */
const REFERENCE_MODEL_RATIOS: AspectRatioChoice[] = [
  { value: "1:1", width: 16, height: 16 },
  { value: "3:4", width: 15, height: 20 },
  { value: "2:3", width: 14, height: 21 },
  { value: "9:16", width: 12, height: 21 },
  { value: "3:2", width: 21, height: 14 },
  { value: "4:3", width: 20, height: 15 },
  { value: "16:9", width: 21, height: 12 },
  { value: "21:9", width: 24, height: 10 },
];

/** Compact 5-option set (Auto/1:1/3:4/4:3/16:9) used by Flux.2 Pro. */
const COMPACT_ASPECT_RATIOS: AspectRatioChoice[] = [
  { value: "Auto", width: 16, height: 16 },
  { value: "1:1", width: 16, height: 16 },
  { value: "3:4", width: 15, height: 20 },
  { value: "4:3", width: 20, height: 15 },
  { value: "16:9", width: 21, height: 12 },
];

/** The standard 7-option shared ratio list (Auto/1:1/3:4/9:16/4:3/16:9/21:9)
 *  used by every generic/legacy-tier model that doesn't have its own
 *  dedicated ratio set (Higgsfield Soul, Nano Banana family, Seedream
 *  family, Grok Imagine, Recraft V4.1, GPT Image / 1.5, etc). */
export const STANDARD_ASPECT_RATIOS: AspectRatioChoice[] = [
  { value: "Auto", width: 16, height: 16 },
  { value: "1:1", width: 16, height: 16 },
  { value: "3:4", width: 15, height: 20 },
  { value: "9:16", width: 12, height: 21 },
  { value: "4:3", width: 20, height: 15 },
  { value: "16:9", width: 21, height: 12 },
  { value: "21:9", width: 24, height: 10 },
];

export const GPT_QUALITY_OPTIONS: { value: string; description: string }[] = [
  { value: "Low", description: "Fastest and cheapest" },
  { value: "Medium", description: "Balanced visuals" },
  { value: "High", description: "Best visual fidelity" },
];

export const GPT_RESOLUTION_OPTIONS: ResolutionChoice[] = [
  { value: "1K", description: "1024px" },
  { value: "2K", description: "2048px" },
  { value: "4K", description: "4096px" },
];

export const SOUL_CINEMA_RESOLUTION_OPTIONS: ResolutionChoice[] = [
  { value: "1.5k", description: "" },
  { value: "2K", description: "" },
];

export const S35_RESOLUTION_OPTIONS: ResolutionChoice[] = [
  { value: "1K", description: "Fast · Quick generation, good resolution" },
  { value: "2K", description: "Balanced · Recommended for most use cases" },
  { value: "4K", description: "Ultra · Highest detail, longer processing" },
];

export const GRID_GENERATION_OPTIONS = ["1x1", "2x2", "3x3", "4x4"] as const;

const DEFAULT_CAPABILITIES: ImageModelCapabilities = {
  modelTriggerSize: "compact",
  quality: false,
  resolution: false,
  aspectRatio: false,
  batchSize: false,
  gridGeneration: false,
  enhancementToggle: false,
  settingsTrigger: false,
  assetUpload: true,
  referenceSelection: true,
};

/** Shared base for both "Recraft V4.1" and "Recraft V4.1 Utility" — same
 *  panel, same controls, same Color Transfer implementation. Recraft V4.1
 *  Utility keeps the plus button; Recraft V4.1 overrides it off below. */
const RECRAFT_CAPABILITIES: ImageModelCapabilities = {
  modelTriggerSize: "compact",
  quality: true,
  qualityOptions: RECRAFT_QUALITY_OPTIONS,
  defaultQuality: "Pro",
  resolution: false,
  aspectRatio: "simple",
  aspectRatioOptions: STANDARD_ASPECT_RATIOS,
  defaultAspectRatio: "4:3",
  batchSize: true,
  gridGeneration: false,
  enhancementToggle: false,
  settingsTrigger: false,
  vectorMode: true,
  defaultVectorMode: true,
  colorTransfer: true,
  defaultColorTransfer: false,
  assetUpload: true,
  referenceSelection: true,
};

/** Recraft V4.1 (non-Utility) — identical to Recraft V4.1 Utility except it
 *  has no plus/@ reference buttons. */
const RECRAFT_V4_1_CAPABILITIES: ImageModelCapabilities = {
  ...RECRAFT_CAPABILITIES,
  defaultQuality: "Standard",
  aspectRatioOptions: RECRAFT_ASPECT_RATIOS,
  defaultAspectRatio: "4:5",
  defaultVectorMode: false,
  assetUpload: false,
  referenceSelection: false,
};

/** Single-option "mode" popovers — reuse the Quality/Resolution popover
 *  mechanism for a one-choice display+control (never a decorative badge). */
export const GROK_MODE_OPTIONS: { value: string; description: string }[] = [
  { value: "Standard", description: "Standard generation mode" },
  { value: "Quality", description: "Quality generation mode" },
];
export const GROK_RESOLUTION_OPTIONS: ResolutionChoice[] = [
  { value: "1K", description: "1024px" },
];

/** Grok Imagine's wide ratio list — order is part of the spec, don't sort it. */
export const GROK_ASPECT_RATIOS: AspectRatioChoice[] = [
  { value: "Auto", width: 16, height: 16 },
  { value: "1:1", width: 16, height: 16 },
  { value: "16:9", width: 21, height: 12 },
  { value: "9:16", width: 12, height: 21 },
  { value: "4:3", width: 20, height: 15 },
  { value: "3:4", width: 15, height: 20 },
  { value: "3:2", width: 21, height: 14 },
  { value: "2:3", width: 14, height: 21 },
  { value: "2:1", width: 22, height: 11 },
  { value: "1:2", width: 11, height: 22 },
];

/** Nano Banana's own quality tiers — deliberately NOT the Low/Medium/High set
 *  that GPT Image 2 owns (GPT_QUALITY_OPTIONS). Do not merge the two. */
export const NANO_BANANA_QUALITY_OPTIONS: { value: string; description: string }[] = [
  { value: "Basic", description: "1k quality and fast generation speed" },
  { value: "High", description: "2k quality and fidelity, balanced speed" },
];

export const NANO_BANANA_ASPECT_RATIOS: AspectRatioChoice[] = [
  { value: "1:1", width: 16, height: 16 },
  { value: "2:3", width: 14, height: 21 },
  { value: "3:2", width: 21, height: 14 },
];
export const SEEDREAM_4_MODE_OPTIONS: { value: string; description: string }[] = [
  { value: "Basic", description: "Default generation mode" },
];
export const SEEDREAM_5_PRO_RESOLUTION_OPTIONS: ResolutionChoice[] = [
  { value: "2K", description: "2048px" },
  { value: "3K", description: "3072px" },
  { value: "4K", description: "4096px" },
];
export const SEEDREAM_5_LITE_RESOLUTION_OPTIONS: ResolutionChoice[] = [
  { value: "2K", description: "2048px" },
];
export const SEEDREAM_4_5_RESOLUTION_OPTIONS: ResolutionChoice[] = [
  { value: "2K", description: "2048px" },
  { value: "4K", description: "4096px" },
];
export const NANO_BANANA_2_LITE_QUALITY_OPTIONS: { value: string; description: string }[] = [
  { value: "High", description: "Best visual fidelity" },
];

/** Nano Banana 2 Lite's Thinking control — reasoning depth, not a quality tier. */
export const NANO_BANANA_2_LITE_THINKING_OPTIONS = ["High", "Minimal"];

export const MODEL_CAPABILITIES: Record<string, ImageModelCapabilities> = {
  Auto: {
    modelTriggerSize: "compact",
    quality: false,
    resolution: false,
    aspectRatio: "simple",
    aspectRatioOptions: STANDARD_ASPECT_RATIOS,
    defaultAspectRatio: "Auto",
    batchSize: true,
    defaultBatchSize: 1,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
  },
  "GPT Image 2": {
    modelTriggerSize: "large",
    quality: true,
    resolution: "simple",
    resolutionOptions: GPT_RESOLUTION_OPTIONS,
    defaultResolution: "4K",
    aspectRatio: "simple",
    aspectRatioOptions: GPT_ASPECT_RATIOS,
    defaultAspectRatio: "Auto",
    batchSize: true,
    defaultBatchSize: 4,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
    elementReferences: true,
  },
  "🚫 Cinefield Soul Cinema": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: "simple",
    resolutionOptions: SOUL_CINEMA_RESOLUTION_OPTIONS,
    defaultResolution: "2K",
    aspectRatio: "cinematic",
    aspectRatioOptions: CINEMATIC_RATIOS,
    defaultAspectRatio: "16:9",
    batchSize: true,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
  },
  // WAN 2.2's mode button — compact wand-icon selector, default Off (not a
  // switch; see EnhancementToggle's `icon` override).
  "WAN 2.2": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: false,
    aspectRatio: "simple",
    aspectRatioOptions: REFERENCE_MODEL_RATIOS,
    defaultAspectRatio: "3:4",
    batchSize: false,
    gridGeneration: false,
    enhancementToggle: true,
    defaultEnhancement: false,
    settingsTrigger: false,
    assetUpload: false,
    referenceSelection: false,
  },
  "Multi Reference": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: false,
    aspectRatio: "simple",
    aspectRatioOptions: REFERENCE_MODEL_RATIOS,
    defaultAspectRatio: "3:4",
    batchSize: true,
    gridGeneration: false,
    enhancementToggle: true,
    defaultEnhancement: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
  },
  "Flux Kontext Max": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: false,
    aspectRatio: "simple",
    aspectRatioOptions: REFERENCE_MODEL_RATIOS,
    defaultAspectRatio: "1:1",
    batchSize: true,
    gridGeneration: false,
    enhancementToggle: true,
    defaultEnhancement: true,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
  },
  "FLUX.2 Max": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: false,
    aspectRatio: "simple",
    aspectRatioOptions: REFERENCE_MODEL_RATIOS,
    defaultAspectRatio: "1:1",
    batchSize: true,
    gridGeneration: false,
    enhancementToggle: true,
    defaultEnhancement: true,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
  },
  "FLUX.2 Pro": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: "simple",
    resolutionOptions: GPT_RESOLUTION_OPTIONS,
    defaultResolution: "1K",
    aspectRatio: "simple",
    aspectRatioOptions: COMPACT_ASPECT_RATIOS,
    defaultAspectRatio: "Auto",
    batchSize: true,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
  },
  "FLUX.2 Flex": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: "simple",
    resolutionOptions: GPT_RESOLUTION_OPTIONS,
    defaultResolution: "1K",
    aspectRatio: "simple",
    aspectRatioOptions: STANDARD_ASPECT_RATIOS,
    defaultAspectRatio: "3:4",
    batchSize: true,
    defaultBatchSize: 1,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: true,
    assetUpload: false,
    referenceSelection: false,
  },
  // Recraft V4.1 and Recraft V4.1 Utility share one identical capability
  // set — the only differences between the two models are the name/id and
  // their own generation config, never the controls or panels they expose.
  "Recraft V4.1 Utility": RECRAFT_CAPABILITIES,
  "Recraft V4.1": RECRAFT_V4_1_CAPABILITIES,
  "Grok Imagine": {
    modelTriggerSize: "compact",
    quality: true,
    qualityOptions: GROK_MODE_OPTIONS,
    defaultQuality: "Standard",
    resolution: "simple",
    resolutionOptions: GROK_RESOLUTION_OPTIONS,
    defaultResolution: "1K",
    aspectRatio: "simple",
    aspectRatioOptions: GROK_ASPECT_RATIOS,
    defaultAspectRatio: "Auto",
    batchSize: true,
    defaultBatchSize: 4,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
  },
  // Seedream 4.0 — a real plus button (image references), no @ element
  // reference button. "Basic" is a generation-mode tier, not a resolution.
  "Seedream 4.0": {
    modelTriggerSize: "compact",
    quality: true,
    qualityOptions: SEEDREAM_4_MODE_OPTIONS,
    defaultQuality: "Basic",
    resolution: false,
    aspectRatio: "simple",
    aspectRatioOptions: STANDARD_ASPECT_RATIOS,
    defaultAspectRatio: "3:4",
    batchSize: true,
    defaultBatchSize: 1,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
  },
  // Seedream 4.5 — same pattern as 4.0 plus the @ element-reference button.
  // 2K/4K resolution trigger (no quality tier, no Basic).
  "Seedream 4.5": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: "simple",
    resolutionOptions: SEEDREAM_4_5_RESOLUTION_OPTIONS,
    defaultResolution: "2K",
    aspectRatio: "simple",
    aspectRatioOptions: STANDARD_ASPECT_RATIOS,
    defaultAspectRatio: "3:4",
    batchSize: true,
    defaultBatchSize: 1,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
    elementReferences: true,
  },
  // Seedream 5.0 Pro's resolution trigger doubles as its "QUALITY" popup —
  // three tiers instead of Seedream 4.5's single 2K value.
  "Seedream 5.0 Pro": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: "simple",
    resolutionOptions: SEEDREAM_5_PRO_RESOLUTION_OPTIONS,
    defaultResolution: "2K",
    aspectRatio: "simple",
    aspectRatioOptions: STANDARD_ASPECT_RATIOS,
    defaultAspectRatio: "3:4",
    batchSize: true,
    defaultBatchSize: 1,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
    elementReferences: false,
    unlimited: true,
    defaultUnlimited: false,
  },
  // Seedream 5.0 Lite — plus + @, single 2K resolution option, no Unlimited
  // anywhere (this model never had one; nothing to remove).
  "Seedream 5.0 Lite": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: "simple",
    resolutionOptions: SEEDREAM_5_LITE_RESOLUTION_OPTIONS,
    defaultResolution: "2K",
    aspectRatio: "simple",
    aspectRatioOptions: STANDARD_ASPECT_RATIOS,
    defaultAspectRatio: "3:4",
    batchSize: true,
    defaultBatchSize: 1,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
    elementReferences: true,
  },
  // Higgsfield Soul 2.0 — Assets Picker (+) for reference uploads, no @
  // (Character/General replace the element-reference concept for this
  // model). Character/General render as 80px cards beside Generate, never
  // inside the compact control row.
  "🚫 Cinefield Soul 2.0": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: "simple",
    resolutionOptions: SEEDREAM_5_LITE_RESOLUTION_OPTIONS,
    defaultResolution: "2K",
    aspectRatio: "simple",
    aspectRatioOptions: STANDARD_ASPECT_RATIOS,
    defaultAspectRatio: "3:4",
    batchSize: true,
    defaultBatchSize: 1,
    gridGeneration: false,
    enhancementToggle: true,
    defaultEnhancement: false,
    settingsTrigger: false,
    colorTransfer: true,
    defaultColorTransfer: false,
    assetUpload: true,
    referenceSelection: true,
    characterCards: true,
  },
  // Z-Image — no plus/upload, no quality or generation-mode row, no
  // color-transfer/enhance/magic-prompt extras: just model + aspect + batch.
  "Z-Image": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: false,
    aspectRatio: "simple",
    aspectRatioOptions: STANDARD_ASPECT_RATIOS,
    defaultAspectRatio: "Auto",
    batchSize: true,
    defaultBatchSize: 1,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: false,
    referenceSelection: false,
  },
  // Cinematic Locations — model + resolution (reuses S35's exact 1K/2K/4K
  // description set) + a wider batch range (1-10) + the shared Soul HEX
  // Color Transfer panel. No plus/aspect-ratio/quality/enhancement.
  "Cinematic Locations": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: "detailed",
    resolutionOptions: S35_RESOLUTION_OPTIONS,
    defaultResolution: "2K",
    aspectRatio: false,
    batchSize: true,
    defaultBatchSize: 1,
    maxBatchSize: 10,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    colorTransfer: true,
    defaultColorTransfer: false,
    assetUpload: false,
    referenceSelection: false,
  },
  // Nano Banana Pro / 2 / 2 Lite — previously legacy/generic models, now
  // moved onto the capability system solely to add the @ element-reference
  // button beside their existing plus button.
  "Nano Banana Pro": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: "simple",
    resolutionOptions: GPT_RESOLUTION_OPTIONS,
    defaultResolution: "1K",
    aspectRatio: "simple",
    aspectRatioOptions: STANDARD_ASPECT_RATIOS,
    defaultAspectRatio: "3:4",
    batchSize: true,
    defaultBatchSize: 1,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
    elementReferences: true,
  },
  "Nano Banana 2": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: "simple",
    resolutionOptions: GPT_RESOLUTION_OPTIONS,
    defaultResolution: "2K",
    aspectRatio: "simple",
    aspectRatioOptions: STANDARD_ASPECT_RATIOS,
    defaultAspectRatio: "3:4",
    batchSize: true,
    defaultBatchSize: 1,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
    elementReferences: true,
  },
  // Nano Banana 2 Lite keeps its existing "High" quality field (not a real
  // resolution) and renders it after batch, matching the supplied reference.
  "Nano Banana": {
    modelTriggerSize: "compact",
    quality: true,
    qualityOptions: NANO_BANANA_QUALITY_OPTIONS,
    defaultQuality: "Basic",
    resolution: false,
    aspectRatio: "simple",
    aspectRatioOptions: NANO_BANANA_ASPECT_RATIOS,
    defaultAspectRatio: "1:1",
    batchSize: true,
    defaultBatchSize: 1,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
    elementReferences: false,
    drawTool: true,
  },
  "🚫 Cinefield Soul": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: false,
    aspectRatio: "simple",
    aspectRatioOptions: STANDARD_ASPECT_RATIOS,
    defaultAspectRatio: "3:4",
    batchSize: true,
    defaultBatchSize: 1,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
  },
  "🚫 Cinefield Face Swap": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: false,
    aspectRatio: "simple",
    aspectRatioOptions: STANDARD_ASPECT_RATIOS,
    defaultAspectRatio: "1:1",
    batchSize: true,
    defaultBatchSize: 1,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
  },
  "🚫 Cinefield Character Swap": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: false,
    aspectRatio: "simple",
    aspectRatioOptions: STANDARD_ASPECT_RATIOS,
    defaultAspectRatio: "1:1",
    batchSize: true,
    defaultBatchSize: 1,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
  },
  "GPT Image 1.5": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: false,
    aspectRatio: "simple",
    aspectRatioOptions: GPT_ASPECT_RATIOS,
    defaultAspectRatio: "Auto",
    batchSize: true,
    defaultBatchSize: 1,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
  },
  "GPT Image": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: false,
    aspectRatio: "simple",
    aspectRatioOptions: GPT_ASPECT_RATIOS,
    defaultAspectRatio: "Auto",
    batchSize: true,
    defaultBatchSize: 1,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
  },
  "Kling O1": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: "simple",
    resolutionOptions: GPT_RESOLUTION_OPTIONS,
    defaultResolution: "1K",
    aspectRatio: "simple",
    aspectRatioOptions: STANDARD_ASPECT_RATIOS,
    defaultAspectRatio: "1:1",
    batchSize: true,
    defaultBatchSize: 1,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
  },
  "Nano Banana 2 Lite": {
    modelTriggerSize: "compact",
    quality: false,
    resolution: false,
    aspectRatio: "simple",
    aspectRatioOptions: STANDARD_ASPECT_RATIOS,
    defaultAspectRatio: "3:4",
    batchSize: true,
    defaultBatchSize: 1,
    gridGeneration: false,
    enhancementToggle: false,
    settingsTrigger: false,
    assetUpload: true,
    referenceSelection: true,
    elementReferences: false,
    thinkingOptions: NANO_BANANA_2_LITE_THINKING_OPTIONS,
    defaultThinking: "High",
  },
};

export const KLING_O1_RESOLUTION_OPTIONS = ["1K", "2K"] as const;

export function getCapabilities(modelName: string): ImageModelCapabilities | null {
  return MODEL_CAPABILITIES[modelName] ?? null;
}

export { DEFAULT_CAPABILITIES };
