"use client";

import CapabilityCard from "./CapabilityCard";

const capabilities = [
  { id: "image", title: "Image Generation", description: "Create stunning images from text", icon: "🖼️" },
  { id: "video", title: "Video Generation", description: "Generate high-quality videos", icon: "🎥" },
  { id: "marketing", title: "Marketing Automation", description: "Automate campaigns", icon: "📊" },
  { id: "design", title: "Design Creation", description: "Professional designs instantly", icon: "🎨" },
  { id: "websites", title: "Web Generation", description: "Complete websites generated", icon: "🌐" },
  { id: "3d", title: "3D Generation", description: "Create 3D models and objects", icon: "🎭" },
];

export default function CapabilitiesSection() {
  return (
    <section className="w-full px-6 py-16 bg-[#0a0a0a]">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-2xl font-bold text-white uppercase tracking-tight mb-8">
          What Supercomputer Can Do
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {capabilities.map((cap) => (
            <CapabilityCard
              key={cap.id}
              id={cap.id}
              title={cap.title}
              description={cap.description}
              icon={cap.icon}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
