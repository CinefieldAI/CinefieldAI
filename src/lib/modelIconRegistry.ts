import React from "react";
import { Wand2 } from "lucide-react";
import {
  FluxIcon,
  GoogleIcon,
  GrokIcon,
  HappyHorseIcon,
  KlingIcon,
  MinimaxIcon,
  MultiReferenceIcon,
  OpenAIIcon,
  RecraftIcon,
  SeedanceIcon,
  SeedreamIcon,
} from "@/components/cinema-studio/icons/ProviderIcons";
import WanIcon from "@/components/cinema-studio/icons/WanIcon";

/**
 * Blocked models carry a leading 🚫 marker in their display label (see
 * lib/blockedModels.ts). Stripping it here keeps icon lookup working off the
 * plain name, so the marker stays a pure presentation concern and every key
 * in the table below can remain marker-free.
 */
/**
 * The site's own mark for its own models — the white C on transparency
 * (public/cinefield-icon-exact.png), so inside the existing dark icon tiles it
 * reads as a white glyph on black, replacing the competitor squiggle the
 * Cinefield-branded models used to carry. Same tile, same sizing contract as
 * the SVG icons: the className passed in drives the dimensions.
 */
const CinefieldIcon: React.ComponentType<{
  className?: string;
  style?: React.CSSProperties;
}> = ({ className, style }) =>
  React.createElement("img", {
    src: "/cinefield-icon-exact.png",
    alt: "",
    className,
    // The C sits small inside the PNG's canvas, so at the size-4.5 the tiles
    // pass in it reads smaller than the sibling SVG glyphs. Scaling the image
    // up — rather than passing a bigger className — keeps every caller's
    // layout box identical to the other icons'.
    style: { ...style, objectFit: "contain", transform: "scale(1.4)" },
  });

export const normalizeModelName = (value: string): string =>
  value.replace(/^\s*🚫\s*/, "").trim().toLowerCase().replace(/\s+/g, " ");

export const MODEL_ICON_BY_NORMALIZED_NAME: Record<
  string,
  React.ComponentType<{ className?: string; style?: React.CSSProperties }>
> = {
  "auto": Wand2,
  "gpt image 2": OpenAIIcon,
  "gpt image 1.5": OpenAIIcon,
  "gpt image": OpenAIIcon,
  "seedream 5.0 pro": SeedreamIcon,
  "seedream 5.0 lite": SeedreamIcon,
  "seedream 4.5": SeedreamIcon,
  "seedream 4.0": SeedanceIcon,
  "nano banana pro": GoogleIcon,
  "nano banana 2": GoogleIcon,
  "nano banana 2 lite": GoogleIcon,
  "nano banana": GoogleIcon,
  "grok imagine": GrokIcon,
  "grok base": GrokIcon,
  "recraft v4.1": RecraftIcon,
  "recraft v4.1 utility": RecraftIcon,
  "z-image": WanIcon,
  "kling o1": KlingIcon,
  "flux.2 pro": FluxIcon,
  "flux.2 flex": FluxIcon,
  "flux.2 max": FluxIcon,
  "flux kontext max": FluxIcon,
  "wan 2.2": WanIcon,
  "wan 2.2 fast": WanIcon,
  "wan 2.5": WanIcon,
  "wan 2.5 fast": WanIcon,
  "wan 2.6": WanIcon,
  "wan 2.7": WanIcon,
  "cinefield soul 2.0": CinefieldIcon,
  "cinefield soul cinema": CinefieldIcon,
  "cinefield soul": CinefieldIcon,
  "cinefield face swap": CinefieldIcon,
  "cinefield character swap": CinefieldIcon,
  "cinefield lite": CinefieldIcon,
  "cinefield standard": CinefieldIcon,
  "cinefield turbo": CinefieldIcon,
  "happyhorse": HappyHorseIcon,
  "multi reference": MultiReferenceIcon,
  "seedance 2.0": SeedanceIcon,
  "seedance 2.0 mini": SeedanceIcon,
  "seedance 2.0 fast": SeedanceIcon,
  "seedance pro": SeedanceIcon,
  "seedance 1.5 pro": SeedanceIcon,
  "seedance pro fast": SeedanceIcon,
  "gemini omni flash": GoogleIcon,
  "cinema studio 3.5": SeedanceIcon,
  "cinema studio 3.0": SeedanceIcon,
  "cinema studio 2.5": SeedanceIcon,
  "kling 3.0": KlingIcon,
  "kling 3.0 turbo": KlingIcon,
  "kling 3.0 motion control": KlingIcon,
  "kling 3.0 omni edit": KlingIcon,
  "kling 3.0 omni": KlingIcon,
  "kling 3.0 mini": KlingIcon,
  "kling 2.6": KlingIcon,
  "kling 2.6 max": KlingIcon,
  "kling 01 video": KlingIcon,
  "kling o1 video edit": KlingIcon,
  "kling motion control": KlingIcon,
  "kling 2.5 turbo": KlingIcon,
  "kling 2.1": KlingIcon,
  "kling 2.1 master": KlingIcon,
  "veo 3.1 lite": GoogleIcon,
  "google veo 3.1 lite": GoogleIcon,
  "google veo": GoogleIcon,
  "sora 2": OpenAIIcon,
  "sora 2 pro": OpenAIIcon,
  "sora 2 max": OpenAIIcon,
  "sora 2 pro max": OpenAIIcon,
  "openai sora 2": OpenAIIcon,
  "minimax hailuo": MinimaxIcon,
  "minimax hailuo 2.3 fast": MinimaxIcon,
  "minimax hailuo 2.3": MinimaxIcon,
  "minimax hailuo 02 fast": MinimaxIcon,
  "minimax hailuo 02": MinimaxIcon,
  "minimax 2.3 fast": MinimaxIcon,
  "minimax 2.3": MinimaxIcon,
  "minimax 02 fast": MinimaxIcon,
  "minimax 02": MinimaxIcon,
};

export function getSharedModelIcon(
  modelName: string,
): React.ComponentType<{ className?: string; style?: React.CSSProperties }> | null {
  const normalized = normalizeModelName(modelName);
  return MODEL_ICON_BY_NORMALIZED_NAME[normalized] ?? null;
}
