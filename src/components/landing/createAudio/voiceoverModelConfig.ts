/**
 * Per-model capability map for Voiceover mode. Index-aligned with
 * AUDIO_MODELS in ../audioMenuData.ts — VOICEOVER_MODEL_ORDER[i] is the
 * stable id for AUDIO_MODELS[i]. Controls in AudioComposer read a model's
 * capabilities from here instead of one shared hardcoded control set, so
 * switching models never shows a control the model doesn't support.
 */

export type VoiceoverModel =
  | "seed-audio-1"
  | "eleven-v3"
  | "qwen-audio-3"
  | "minimax-speech-2-8-hd"
  | "seed-speech"
  | "vibevoice";

/** Must stay index-aligned with AUDIO_MODELS in audioMenuData.ts. */
export const VOICEOVER_MODEL_ORDER: VoiceoverModel[] = [
  "seed-audio-1",
  "eleven-v3",
  "qwen-audio-3",
  "minimax-speech-2-8-hd",
  "seed-speech",
  "vibevoice",
];

interface Range {
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface VoiceoverModelCapabilities {
  supportsLanguage: boolean;
  supportsReferences: boolean;
  supportsSampleRate: boolean;
  supportsSpeed: boolean;
  supportsVolume: boolean;
  supportsPitch: boolean;
  supportsOutputFormat: boolean;
  /** Every current model supports the compact Voice Preset card. */
  supportsVoicePreset: boolean;
  speedRange?: Range;
  volumeRange?: Range;
  pitchRange?: Range;
}

const NONE: VoiceoverModelCapabilities = {
  supportsLanguage: false,
  supportsReferences: false,
  supportsSampleRate: false,
  supportsSpeed: false,
  supportsVolume: false,
  supportsPitch: false,
  supportsOutputFormat: false,
  supportsVoicePreset: true,
};

export const VOICEOVER_CAPABILITIES: Record<VoiceoverModel, VoiceoverModelCapabilities> = {
  "seed-audio-1": {
    ...NONE,
    supportsReferences: true,
    supportsSampleRate: true,
    supportsSpeed: true,
    supportsVolume: true,
    supportsPitch: true,
    supportsOutputFormat: true,
    speedRange: { min: 0.5, max: 2, step: 0.01, default: 1 },
    volumeRange: { min: 0.5, max: 2, step: 0.01, default: 1 },
    pitchRange: { min: -12, max: 12, step: 1, default: 0 },
  },
  // Only the model button + prompt editor were supplied for these — no
  // invented controls.
  "eleven-v3": { ...NONE },
  "qwen-audio-3": {
    ...NONE,
    supportsLanguage: true,
    supportsSpeed: true,
    supportsVolume: true,
    supportsPitch: true,
    supportsOutputFormat: true,
    speedRange: { min: 0.5, max: 2, step: 0.1, default: 1 },
    volumeRange: { min: 0, max: 100, step: 1, default: 50 },
    pitchRange: { min: 0.5, max: 2, step: 0.1, default: 1 },
  },
  "minimax-speech-2-8-hd": { ...NONE },
  "seed-speech": { ...NONE },
  "vibevoice": { ...NONE },
};

export const QWEN_LANGUAGES = [
  "Auto detect",
  "Chinese",
  "English",
  "French",
  "German",
  "Japanese",
  "Korean",
  "Russian",
  "Portuguese",
  "Thai",
  "Indonesian",
  "Vietnamese",
  "Italian",
  "Malay",
];

export interface SeedAudioSettings {
  audioReferences: string[];
  imageReference: string | null;
  sampleRate: number;
  speed: number;
  volume: number;
  pitch: number;
  outputFormat: string;
}

export const DEFAULT_SEED_AUDIO_SETTINGS: SeedAudioSettings = {
  audioReferences: [],
  imageReference: null,
  sampleRate: 24000,
  speed: 1,
  volume: 1,
  pitch: 0,
  outputFormat: "mp3",
};

export interface QwenSettings {
  language: string;
  speed: number;
  volume: number;
  pitch: number;
  outputFormat: string;
}

export const DEFAULT_QWEN_SETTINGS: QwenSettings = {
  language: "Auto detect",
  speed: 1,
  volume: 50,
  pitch: 1,
  outputFormat: "mp3",
};
