import {
  AudioLines,
  AudioWaveform,
  Languages,
  Mic,
  Mic2,
  Music2,
  Repeat,
  Sparkles,
  Waves,
  type LucideIcon,
} from "lucide-react";

/**
 * Single source of truth for the active Audio creation mode. Shared between
 * the top-nav Audio mega-dropdown (feature column) and the bottom rotary
 * selector on /audio/create — both read/write the same state, they never
 * hold independent copies.
 */
export type AudioMode = "voiceover" | "change-voice" | "translation";

/** Rotary selector position (0/1/2) <-> AudioMode, in display order. */
export const AUDIO_MODE_ORDER: AudioMode[] = [
  "voiceover",
  "change-voice",
  "translation",
];

export interface AudioFeature {
  mode: AudioMode;
  title: string;
  description: string;
  icon: LucideIcon;
  badge?: "NEW";
}

export interface AudioModel {
  title: string;
  description: string;
  icon: LucideIcon;
  badge?: "NEW";
}

/**
 * Feature titles intentionally differ slightly from their AudioMode label —
 * the rotary control shows "Translate" while this panel shows "Translation".
 * Do not rename either; both map to the same "translation" mode.
 */
export const AUDIO_FEATURES: AudioFeature[] = [
  { mode: "voiceover", title: "Voiceover", description: "Generate speech from text", icon: Mic },
  { mode: "change-voice", title: "Change Voice", description: "Swap voices in any video", icon: Repeat },
  { mode: "translation", title: "Translation", description: "Translate speech in any video", icon: Languages },
];

/**
 * Order matches VOICEOVER_MODEL_ORDER in voiceoverModelConfig.ts — the two
 * arrays are index-aligned so the shared numeric model index (used by the
 * top-nav Audio dropdown) maps 1:1 onto a VoiceoverModel id.
 */
export const AUDIO_MODELS: AudioModel[] = [
  {
    title: "Seed Audio 1.0",
    description: "Multi-speaker scenes with speech and ambience",
    icon: Waves,
  },
  {
    title: "Eleven v3",
    description: "Emotion and delivery control via inline tags",
    icon: AudioLines,
  },
  {
    title: "Qwen Audio 3.0",
    description: "Natural speech with voice, style, and emotion control",
    icon: AudioWaveform,
  },
  {
    title: "MiniMax Speech 2.8 HD",
    description: "High-fidelity single-voice narration",
    icon: Mic2,
  },
  {
    title: "Seed Speech",
    description: "Multilingual speech across 30+ languages",
    icon: Sparkles,
    badge: "NEW",
  },
  {
    title: "VibeVoice",
    description: "Long-form narration for audiobooks and podcasts",
    icon: Music2,
  },
];
