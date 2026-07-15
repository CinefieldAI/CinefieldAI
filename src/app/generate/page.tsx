import { Suspense } from "react";
import CinemaStudioWorkspace from "@/components/cinema-studio/CinemaStudioWorkspace";

export default function GeneratePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <CinemaStudioWorkspace />
    </Suspense>
  );
}
