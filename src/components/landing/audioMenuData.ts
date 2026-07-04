import {
  AudioLines,
  Languages,
  Mic,
  Mic2,
  Music2,
  Repeat,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export interface AudioFeature {
  title: string;
  description: string;
  icon: LucideIcon;
  badge?: "NEW";
}

export const AUDIO_FEATURES: AudioFeature[] = [
  { title: "Voiceover", description: "Generate speech from text", icon: Mic },
  { title: "Change Voice", description: "Swap voices in any video", icon: Repeat },
  {
    title: "Translation",
    description: "Translate speech in any video",
    icon: Languages,
  },
];

export const AUDIO_MODELS: AudioFeature[] = [
  {
    title: "Eleven v3",
    description: "Expressive AI voice with emotion control",
    icon: AudioLines,
  },
  {
    title: "MiniMax Speech 2.8 HD",
    description: "Studio-quality text-to-speech",
    icon: Mic2,
  },
  {
    title: "Seed Speech",
    description: "ByteDance multilingual text-to-speech",
    icon: Sparkles,
    badge: "NEW",
  },
  {
    title: "VibeVoice",
    description: "Long-form expressive voice synthesis",
    icon: Music2,
  },
];
