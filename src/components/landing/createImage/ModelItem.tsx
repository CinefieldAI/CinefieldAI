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
      className="group w-full flex items-center px-1.5 py-1.5 pr-3 rounded-xl transition-colors cursor-pointer hover:bg-white/5 focus-visible:bg-white/5 text-start"
    >
      {model.icon ? (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/5 mr-2 shadow-[inset_0px_2px_3px_0px_rgba(255,255,255,0.03)]">
          <Image
            src={model.icon}
            alt={model.name}
            width={40}
            height={40}
            className="size-4 object-cover"
          />
        </span>
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/5 mr-2 text-xs font-medium text-icon-secondary shadow-[inset_0px_2px_3px_0px_rgba(255,255,255,0.03)]">
          {model.name.charAt(0)}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span
          className="model-title block truncate text-xs font-medium text-white"
          style={{
            fontSize: "12px",
            fontWeight: 500,
          }}
        >
          {model.name}
        </span>
        <span
          className="block truncate text-icon-secondary"
          style={{
            fontSize: "10px",
            fontWeight: 400,
          }}
        >
          {model.description}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {model.badge && (
          <Badge
            variant={model.badge === "TOP" ? "top" : "new"}
            style={{
              fontSize: "10px",
              fontWeight: 700,
              height: "16px",
              lineHeight: "16px",
              paddingLeft: "4px",
              paddingRight: "4px",
              borderRadius: "2px",
              textTransform: "uppercase",
            }}
          >
            {model.badge}
          </Badge>
        )}
        {isSelected && <Check className="h-4 w-4 text-white/80" />}
      </span>
    </button>
  );
}
