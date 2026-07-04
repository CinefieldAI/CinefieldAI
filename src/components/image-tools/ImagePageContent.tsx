"use client";

import { useSearchParams } from "next/navigation";
import ImageHeroEmptyState from "./ImageHeroEmptyState";
import ImageGenerationForm from "./ImageGenerationForm";

export default function ImagePageContent() {
  const searchParams = useSearchParams();
  const modelParam = searchParams.get("model") || searchParams.get("tool");
  const selectedModel = modelParam || "nano-banana-pro";

  return (
    <div className="flex h-screen w-full flex-col bg-[#0F1113]">
      {/* Main centered hero area */}
      <ImageHeroEmptyState selectedModel={selectedModel} />

      {/* Fixed bottom form */}
      <ImageGenerationForm selectedModel={selectedModel} />
    </div>
  );
}
