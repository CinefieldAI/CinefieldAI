"use client";

import Sidebar from "./Sidebar";
import Hero from "./Hero";

export default function Layout() {
  return (
    <div className="flex min-h-screen w-full bg-[#0a0a0a]">
      {/* Sidebar */}
      <Sidebar />

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-y-auto">
        {/* Hero - Full viewport */}
        <Hero />
      </main>
    </div>
  );
}
