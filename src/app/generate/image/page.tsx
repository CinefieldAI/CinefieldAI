"use client";

import { Suspense, useState } from "react";
import ImageForm from "@/components/image-tools/ImageForm";
import HeroSection from "@/components/image-tools/HeroSection";
import NanoBananaProDrawWorkspace from "@/components/image-tools/NanoBananaProDrawWorkspace";
import { useSearchParams } from "next/navigation";

function GenerateImageContent() {
  const searchParams = useSearchParams();
  const modelParam = searchParams.get("model") || "nano-banana-pro";
  const [isDrawOpen, setIsDrawOpen] = useState(false);

  return (
    <div className="relative w-full min-h-screen bg-[#0a0a0a]">
      {/* Background grid */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <svg
          className="w-full h-full"
          xmlns="http://www.w3.org/2000/svg"
          style={{
            backgroundImage: `
              repeating-linear-gradient(
                0deg,
                rgba(255, 255, 255, 0.03) 0px,
                rgba(255, 255, 255, 0.03) 1px,
                transparent 1px,
                transparent 80px
              ),
              repeating-linear-gradient(
                90deg,
                rgba(255, 255, 255, 0.03) 0px,
                rgba(255, 255, 255, 0.03) 1px,
                transparent 1px,
                transparent 80px
              )
            `,
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col min-h-screen pb-44">
        {/* Hero section */}
        <HeroSection selectedModel={modelParam} />

        {/* Fixed bottom form */}
        <ImageForm isDrawOpen={isDrawOpen} onDrawOpen={setIsDrawOpen} />
      </div>

      {/* Draw Workspace Overlay */}
      {modelParam === "nano-banana-pro" && (
        <NanoBananaProDrawWorkspace isOpen={isDrawOpen} onClose={() => setIsDrawOpen(false)} />
      )}
    </div>
  );
}

export default function GenerateImagePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a]" />}>
      <GenerateImageContent />
    </Suspense>
  );
}
