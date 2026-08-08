import { Suspense } from "react";
import MarketingStudioProductWorkspace from "@/components/marketing-studio/MarketingStudioProductWorkspace";

export default function MarketingStudioProductPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <MarketingStudioProductWorkspace />
    </Suspense>
  );
}
