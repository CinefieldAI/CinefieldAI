"use client";

import Image from "next/image";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CreateImageModel } from "./createImageData";

interface ModelItemProps {
  model: CreateImageModel;
  isSelected: boolean;
  onSelect: (name: string) => void;
}

export default function ModelItem({ model, isSelected, onSelect }: ModelItemProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(model.name)}
      className={`group flex min-h-[48px] w-full items-center gap-3 rounded-[14px] border px-2.5 text-left transition-colors ${
        isSelected
          ? "border-[rgba(0,229,255,0.45)] bg-[rgba(0,229,255,0.12)]"
          : "border-transparent hover:bg-[rgba(255,255,255,0.065)]"
      }`}
    >
      {model.icon ? (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white">
          <Image
            src={model.icon}
            alt={model.name}
            width={28}
            height={28}
            className="h-full w-full object-cover"
          />
        </span>
      ) : (
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition-colors ${
            isSelected
              ? "bg-gradient-to-br from-magenta-500 to-magenta-600 text-white"
              : "bg-gradient-to-br from-zinc-700 to-zinc-900 text-zinc-300 group-hover:from-magenta-500/40 group-hover:to-magenta-600/40 group-hover:text-white"
          }`}
        >
          {model.name.charAt(0)}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="model-title block truncate">
          {model.name}
        </span>
        <span className="block truncate text-xs text-zinc-500">{model.description}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {model.badge && (
          <Badge variant={model.badge === "TOP" ? "top" : "new"}>{model.badge}</Badge>
        )}
        {isSelected && <Check className="h-4 w-4 text-magenta-400" />}
      </span>
    </button>
  );
}
