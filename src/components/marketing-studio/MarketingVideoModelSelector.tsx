"use client";

import { MODEL_CATEGORIES, type ModelInfo } from "@/components/cinema-studio/cinemaStudioData";
import MarketingModelSelector, {
  type MarketingModelCategory,
  type MarketingModelOption,
} from "./MarketingModelSelector";

function videoBadges(model: ModelInfo): string[] | undefined {
  const base = model.badges ? [...model.badges] : [];

  if (model.id === "kling-3.0-omni") base.push("PREMIUM", "EXCLUSIVE");
  if (model.id === "kling-3.0-mini" || model.id === "kling-3.0-omni-edit") base.push("EXCLUSIVE");
  if (model.id === "kling-2.6-max" || model.id === "kling-01-video") base.push("PREMIUM");

  return base.length ? Array.from(new Set(base)) : undefined;
}

function toMarketingVideoModel(model: ModelInfo): MarketingModelOption {
  const duration =
    model.durationLabel ??
    (model.durations.length > 1
      ? `${model.durations[0]}s-${model.durations[model.durations.length - 1]}s`
      : `${model.durations[0]}s`);

  return {
    id: model.id,
    name: model.name,
    description: model.description,
    icon: typeof model.icon === "string" || typeof model.icon === "function" ? model.icon : null,
    badges: videoBadges(model),
    meta: [model.resolution, duration],
    sound: model.sound,
    submodels: model.submodels?.map(toMarketingVideoModel),
  };
}

const VIDEO_MODEL_CATEGORIES: MarketingModelCategory[] = MODEL_CATEGORIES.map((category) => ({
  label: category.label,
  models: category.models.map(toMarketingVideoModel),
}));

const FALLBACK_MODEL = VIDEO_MODEL_CATEGORIES[0]?.models[0] ?? {
  id: "cinema-3.5",
  name: "Cinema Studio 3.5",
  description: "Camera selection and style presets",
  meta: ["4K", "4s-15s"],
};

export default function MarketingVideoModelSelector({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (name: string) => void;
}) {
  return (
    <MarketingModelSelector
      ariaLabel="Marketing Studio video models"
      selected={selected}
      fallback={FALLBACK_MODEL}
      categories={VIDEO_MODEL_CATEGORIES}
      onSelect={onSelect}
      triggerMinWidth="166px"
    />
  );
}
