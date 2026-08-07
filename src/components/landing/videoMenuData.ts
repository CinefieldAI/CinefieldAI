import {
  Activity,
  Clapperboard,
  Layers,
  LayoutTemplate,
  Maximize2,
  Mic,
  PenLine,
  PenTool,
  Scissors,
  Shuffle,
  Sparkles,
  ShoppingBag,
  TrendingUp,
  Users,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import type { ElementType } from "react";
import {
  GoogleIcon,
  GrokIcon,
  HappyHorseIcon,
  KlingIcon,
  MinimaxIcon,
  OpenAISoraIcon,
  SeedanceIcon,
} from "@/components/cinema-studio/icons/ProviderIcons";
import WanIcon from "@/components/cinema-studio/icons/WanIcon";

export interface VideoFeature {
  title: string;
  description: string;
  icon: LucideIcon;
  badge?: "TOP" | "NEW";
}

export const VIDEO_FEATURES: VideoFeature[] = [
  { title: "Create Video", description: "Generate AI videos", icon: Wand2 },
  {
    title: "Cinema Studio 4K",
    description: "Cinematic video with AI director",
    icon: Clapperboard,
    badge: "TOP",
  },
  {
    title: "Canvas",
    description: "Visual ideation meets repeatable AI workflows.",
    icon: LayoutTemplate,
    badge: "NEW",
  },
  { title: "Mixed Media", description: "Create mixed media projects", icon: Layers },
  { title: "Edit Video", description: "Edit scenes, shots, elements", icon: Scissors },
  {
    title: "Click to Ad",
    description: "Turn product URLs into video ads",
    icon: ShoppingBag,
  },
  {
    title: "Sora 2 Trends",
    description: "Turn ideas into viral videos",
    icon: TrendingUp,
  },
  { title: "Lipsync Studio", description: "Create Talking Clips", icon: Mic },
  { title: "Draw to Video", description: "Sketch turns into a cinema", icon: PenLine },
  {
    title: "Sketch to Video",
    description: "From sketch to video with Sora 2",
    icon: PenTool,
  },
  { title: "UGC Factory", description: "Build UGC video with avatar", icon: Users },
  { title: "Video Upscale", description: "Enhance video quality", icon: Maximize2 },
  {
    title: "🚫 Cinefield Animate",
    description: "Video smart replacement",
    icon: Sparkles,
  },
  {
    title: "Vibe Motion",
    description: "Create professional motion graphics",
    icon: Activity,
  },
  {
    title: "Recast Studio",
    description: "Swap characters in videos",
    icon: Shuffle,
  },
];

export interface VideoModel {
  name: string;
  meta: string;
  icon: ElementType;
  badge?: "TOP" | "NEW";
}

export const VIDEO_DROPDOWN_MODELS: VideoModel[] = [
  {
    name: "Seedance 2.0 4K",
    meta: "Native 4K video generation",
    icon: SeedanceIcon,
    badge: "TOP",
  },
  {
    name: "Kling 3.0",
    meta: "Cinematic videos with audio",
    icon: KlingIcon,
    badge: "TOP",
  },
  {
    name: "Kling 3.0 Turbo",
    meta: "Faster 3.0 generation with native audio",
    icon: KlingIcon,
    badge: "NEW",
  },
  {
    name: "Kling 3.0 Motion Control",
    meta: "Transfer motion from video to image",
    icon: KlingIcon,
  },
  { name: "Kling 01 Edit", meta: "Advanced video editing", icon: KlingIcon },
  {
    name: "Sora 2",
    meta: "OpenAI's most advanced video model",
    icon: OpenAISoraIcon,
  },
  {
    name: "Google Veo 3.1 Lite",
    meta: "Fast video generation by Google",
    icon: GoogleIcon,
  },
  {
    name: "Google Veo 3.1",
    meta: "Advanced AI video with sound",
    icon: GoogleIcon,
  },
  {
    name: "HappyHorse",
    meta: "Alibaba's #1 ranked video and audio model",
    icon: HappyHorseIcon,
  },
  {
    name: "Grok Imagine 1.5",
    meta: "Cinematic videos with synchronized audio",
    icon: GrokIcon,
    badge: "NEW",
  },
  {
    name: "Wan 2.7",
    meta: "AI video generation with first and end frame control",
    icon: WanIcon,
  },
  {
    name: "Minimax Hailuo 2.3",
    meta: "Fastest high-dynamic video",
    icon: MinimaxIcon,
  },
  {
    name: "Seedance 1.5 Pro",
    meta: "Pro-grade audio-visual sync",
    icon: SeedanceIcon,
  },
  {
    name: "🚫 Cinefield DOP",
    meta: "VFX and camera control",
    icon: Clapperboard,
  },
];
