import { Suspense } from "react";
import AppShell from "@/components/landing/AppShell";

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <AppShell />
    </Suspense>
  );
}
