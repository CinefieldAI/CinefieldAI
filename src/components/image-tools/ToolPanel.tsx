"use client";

interface ToolInfo {
  title: string;
  description: string;
  features: string[];
  titleColor: string;
  dotColor: string;
}

const TOOL_INFO: Record<string, ToolInfo> = {
  "create-image": {
    title: "Image Generation",
    description: "Generate stunning images from text descriptions",
    features: ["Text-to-image", "Custom styles", "High quality output"],
    titleColor: "#E61E8F",
    dotColor: "#E61E8F",
  },
  "nano-banana-pro": {
    title: "Nano Banana Pro",
    description: "Start creating with Nano Banana Pro",
    features: ["Fast generation", "Realistic results", "Optimized quality"],
    titleColor: "#E61E8F",
    dotColor: "#E61E8F",
  },
  "seedream-5-lite": {
    title: "Seedream 5.0 Lite",
    description: "Intelligent visual reasoning and generation",
    features: ["Smart composition", "Visual intelligence", "Advanced rendering"],
    titleColor: "#00F0FF",
    dotColor: "#00F0FF",
  },
  "character-consistency": {
    title: "Character Consistency",
    description: "Keep characters consistent across generations",
    features: ["Character memory", "Style consistency", "Multiple poses"],
    titleColor: "#E61E8F",
    dotColor: "#E61E8F",
  },
  "face-swap": {
    title: "Face Swap",
    description: "Seamless face swapping technology",
    features: ["Realistic blending", "Expression preservation", "Quality output"],
    titleColor: "#00F0FF",
    dotColor: "#00F0FF",
  },
  "character-swap": {
    title: "Character Swap",
    description: "Seamless character swapping",
    features: ["Full body swap", "Clothing transfer", "Natural blending"],
    titleColor: "#E61E8F",
    dotColor: "#E61E8F",
  },
  "upscale": {
    title: "Image Upscale",
    description: "Increase image resolution and quality",
    features: ["4x upscaling", "Detail enhancement", "Artifact removal"],
    titleColor: "#00F0FF",
    dotColor: "#00F0FF",
  },
  "image-prompt": {
    title: "Image Prompt",
    description: "Generate prompts from uploaded images",
    features: ["Image analysis", "Prompt generation", "Style extraction"],
    titleColor: "#E61E8F",
    dotColor: "#E61E8F",
  },
  "multi-reference": {
    title: "Multi Reference",
    description: "Multiple edits in one shot",
    features: ["Batch editing", "Consistent style", "Fast processing"],
    titleColor: "#00F0FF",
    dotColor: "#00F0FF",
  },
  "gpt-image": {
    title: "GPT Image",
    description: "Versatile text-to-image AI",
    features: ["Flexible generation", "Creative control", "Wide style range"],
    titleColor: "#E61E8F",
    dotColor: "#E61E8F",
  },
  "flux-2-pro": {
    title: "FLUX.2 Pro",
    description: "Speed-optimized detail with exceptional quality",
    features: ["Ultra-fast generation", "High detail", "Optimized rendering"],
    titleColor: "#00F0FF",
    dotColor: "#00F0FF",
  },
  "recraft-v4-1": {
    title: "Recraft V4.1",
    description: "Photorealistic and expressive image generation",
    features: ["Photorealism", "Expressive output", "Professional quality"],
    titleColor: "#E61E8F",
    dotColor: "#E61E8F",
  },
};

interface ToolPanelProps {
  selectedTool: string | null;
}

export default function ToolPanel({ selectedTool }: ToolPanelProps) {
  const toolKey = selectedTool || "create-image";
  const tool = TOOL_INFO[toolKey];

  if (!tool) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-12">
        <p className="text-zinc-400">Select a tool to get started</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-12">
      <div className="w-full max-w-2xl">
        {/* Main heading */}
        <h1 className="text-5xl font-bold tracking-tight">
          START CREATING WITH{" "}
          <span style={{ color: tool.titleColor }}>
            {tool.title.toUpperCase()}
          </span>
        </h1>

        {/* Description */}
        <p className="mt-6 text-lg text-zinc-400">{tool.description}</p>

        {/* Features */}
        <div className="mt-8 space-y-3">
          {tool.features.map((feature, idx) => (
            <div key={idx} className="flex items-center gap-3">
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: tool.dotColor }}
              />
              <span className="text-sm text-zinc-300">{feature}</span>
            </div>
          ))}
        </div>

        {/* Visual placeholder */}
        <div className="mt-12 aspect-video rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/2 backdrop-blur-sm" />
      </div>
    </div>
  );
}
