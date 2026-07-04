export type PanelKey = "image" | "video" | "audio";
export type VideoView = "create" | "motion";
export type ActiveView =
  | "default"
  | "canvas"
  | "moodboard"
  | "character"
  | "createImage"
  | "createVideo"
  | "createAudio";

export interface VideoModel {
  name: string;
  description: string;
}

export const VIDEO_MODELS: VideoModel[] = [
  { name: "Seedance 2.0", description: "Native 4K cinematic generation" },
  { name: "Kling 3.0", description: "High-fidelity general motion" },
  { name: "Kling 3.0 Motion Control", description: "Pose & camera-driven motion" },
  { name: "HappyHorse", description: "Fast stylized motion drafts" },
];

export const VIDEO_DURATIONS = ["4s", "8s", "12s"] as const;
export const VIDEO_QUALITIES = ["702p", "1080p"] as const;

export interface ImageModel {
  name: string;
  description: string;
}

export const IMAGE_MODELS: ImageModel[] = [
  { name: "Soul 2.0", description: "Photoreal portraits & cinematic light" },
  { name: "Nova XL", description: "Hyper-detailed illustration engine" },
  { name: "Prism", description: "Stylized concept art & matte paint" },
  { name: "Lumen", description: "Fast drafts, high iteration speed" },
];
