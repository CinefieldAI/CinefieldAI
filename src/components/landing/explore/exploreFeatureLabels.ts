export const FEATURE_LABELS: string[] = [
  "Cinema Studio",
  "Visual Effects",
  "Cinefield Soul",
  "Kling 2.1 Master",
  "Camera Controls",
  "Viral",
  "Action movements",
  "Commercial",
  "MiniMax Hailuo 02",
  "Seedance Pro",
  "Community",
  "Wan 2.2 Image",
  "Seedream 4.0",
  "Nano Banana",
  "Flux Kontext",
  "GPT Image",
  "Topaz",
  "Google Veo3",
  "Kling 2.5 Turbo",
  "Kling Avatars 2.0",
  "Claude MCP",
  "Wan 2.5",
  "Sora 2",
  "Sora 2 Presets",
  "Banana Placement",
  "Edit Image",
  "Multi Reference",
  "Upscale",
  "Assists",
  "YouTube",
  "TikTok",
  "Instagram Reels",
  "YouTube Shorts",
  "Nano Banana Pro",
  "Kling o1",
  "Mixed Media Community",
  "Soul Presets",
  "Visual Effects Collection",
];

export function slugifyFeature(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
