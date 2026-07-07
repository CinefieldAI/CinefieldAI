"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ImageIcon,
  Sparkles,
  Wand2,
  Coins,
  Download,
  Trash2,
  History,
} from "lucide-react";

type ModelConfig = {
  id: string;
  label: string;
  description: string;
  cost: number;
  aspectRatios: string[];
  defaultAspectRatio: string;
  quantityMax: number;
};

type GeneratedAsset = {
  id: string;
  prompt: string;
  model: string;
  aspectRatio: string;
  quantity: number;
  createdAt: string;
  gradient: string;
};

const MODELS: ModelConfig[] = [
  {
    id: "nano-banana-pro",
    label: "Nano Banana Pro",
    description: "High quality image generation model",
    cost: 2,
    aspectRatios: ["1:1", "3:4", "4:3", "16:9", "9:16"],
    defaultAspectRatio: "3:4",
    quantityMax: 4,
  },
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    description: "Best for text rendering and clean concepts",
    cost: 4,
    aspectRatios: ["1:1", "4:3", "16:9"],
    defaultAspectRatio: "1:1",
    quantityMax: 4,
  },
  {
    id: "seedream-4-5",
    label: "Seedream 4.5",
    description: "Fast creative image generation",
    cost: 1,
    aspectRatios: ["1:1", "3:2", "2:3", "16:9"],
    defaultAspectRatio: "3:2",
    quantityMax: 4,
  },
  {
    id: "flux-2-pro",
    label: "FLUX.2 Pro",
    description: "Detailed product and commercial visuals",
    cost: 2,
    aspectRatios: ["1:1", "3:4", "16:9", "9:16"],
    defaultAspectRatio: "3:4",
    quantityMax: 2,
  },
];

const GRADIENTS = [
  "from-cyan-500 via-blue-500 to-purple-600",
  "from-fuchsia-500 via-rose-500 to-orange-400",
  "from-emerald-400 via-cyan-500 to-blue-600",
  "from-amber-300 via-orange-500 to-red-600",
  "from-violet-500 via-indigo-500 to-cyan-400",
];

const STORAGE_KEY = "local-mvp-generated-assets";
const CREDIT_KEY = "local-mvp-credits";

export default function ImageGeneratePage() {
  const [selectedModelId, setSelectedModelId] = useState(MODELS[0].id);
  const selectedModel = useMemo(
    () => MODELS.find((model) => model.id === selectedModelId) ?? MODELS[0],
    [selectedModelId],
  );

  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState(selectedModel.defaultAspectRatio);
  const [quantity, setQuantity] = useState(1);
  const [credits, setCredits] = useState(50);
  const [assets, setAssets] = useState<GeneratedAsset[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const savedAssets = window.localStorage.getItem(STORAGE_KEY);
    const savedCredits = window.localStorage.getItem(CREDIT_KEY);

    if (savedAssets) {
      setAssets(JSON.parse(savedAssets));
    }

    if (savedCredits) {
      setCredits(Number(savedCredits));
    }
  }, []);

  useEffect(() => {
    setAspectRatio(selectedModel.defaultAspectRatio);
    setQuantity(1);
  }, [selectedModel]);

  function persist(nextAssets: GeneratedAsset[], nextCredits: number) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextAssets));
    window.localStorage.setItem(CREDIT_KEY, String(nextCredits));
  }

  async function handleGenerate() {
    const cleanPrompt = prompt.trim();

    if (!cleanPrompt) {
      alert("Önce bir prompt yaz.");
      return;
    }

    const totalCost = selectedModel.cost * quantity;

    if (credits < totalCost) {
      alert("Yeterli kredin yok.");
      return;
    }

    setIsGenerating(true);

    await new Promise((resolve) => setTimeout(resolve, 900));

    const newAssets: GeneratedAsset[] = Array.from({ length: quantity }).map((_, index) => ({
      id: `${Date.now()}-${index}`,
      prompt: cleanPrompt,
      model: selectedModel.label,
      aspectRatio,
      quantity: 1,
      createdAt: new Date().toISOString(),
      gradient: GRADIENTS[(assets.length + index) % GRADIENTS.length],
    }));

    const nextAssets = [...newAssets, ...assets];
    const nextCredits = credits - totalCost;

    setAssets(nextAssets);
    setCredits(nextCredits);
    persist(nextAssets, nextCredits);
    setIsGenerating(false);
  }

  function handleDelete(id: string) {
    const nextAssets = assets.filter((asset) => asset.id !== id);
    setAssets(nextAssets);
    persist(nextAssets, credits);
  }

  function handleReset() {
    setCredits(50);
    setAssets([]);
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.setItem(CREDIT_KEY, "50");
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="flex min-h-screen">
        <aside className="hidden w-72 border-r border-white/10 bg-zinc-950/80 p-5 lg:block">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400 text-black">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold">AI Studio</div>
              <div className="text-xs text-zinc-500">Local MVP</div>
            </div>
          </div>

          <nav className="space-y-2 text-sm">
            <button className="flex w-full items-center gap-3 rounded-xl bg-white/10 px-3 py-2.5 text-left">
              <Wand2 className="h-4 w-4 text-cyan-300" />
              Generate
            </button>
            <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-zinc-400 hover:bg-white/5">
              <History className="h-4 w-4" />
              Library
            </button>
          </nav>
        </aside>

        <section className="flex-1">
          <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div>
              <h1 className="text-lg font-semibold">Generate</h1>
              <p className="text-sm text-zinc-500">
                Lokal MVP — gerçek API yok, mock sonuç üretir.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-sm text-cyan-200">
                <Coins className="h-4 w-4" />
                {credits} kredi
              </div>

              <button
                onClick={handleReset}
                className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/10"
              >
                Sıfırla
              </button>
            </div>
          </header>

          <div className="grid gap-6 p-5 xl:grid-cols-[320px_1fr]">
            <div className="space-y-4">
              <section className="rounded-3xl border border-white/10 bg-zinc-950 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-cyan-300" />
                  <h2 className="font-medium">Model seç</h2>
                </div>

                <div className="space-y-2">
                  {MODELS.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => setSelectedModelId(model.id)}
                      className={`w-full rounded-2xl border p-3 text-left transition ${
                        selectedModelId === model.id
                          ? "border-cyan-400/60 bg-cyan-400/10"
                          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">{model.label}</div>
                        <div className="text-xs text-cyan-300">{model.cost} kr</div>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        {model.description}
                      </p>
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-white/10 bg-zinc-950 p-4">
                <h2 className="mb-4 font-medium">Ayarlar</h2>

                <label className="mb-2 block text-xs text-zinc-500">Aspect ratio</label>
                <div className="mb-4 grid grid-cols-3 gap-2">
                  {selectedModel.aspectRatios.map((ratio) => (
                    <button
                      key={ratio}
                      onClick={() => setAspectRatio(ratio)}
                      className={`rounded-xl border px-3 py-2 text-sm ${
                        aspectRatio === ratio
                          ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                          : "border-white/10 bg-white/[0.03] text-zinc-400"
                      }`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>

                <label className="mb-2 block text-xs text-zinc-500">Quantity</label>
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: selectedModel.quantityMax }).map((_, index) => {
                    const value = index + 1;

                    return (
                      <button
                        key={value}
                        onClick={() => setQuantity(value)}
                        className={`rounded-xl border px-3 py-2 text-sm ${
                          quantity === value
                            ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                            : "border-white/10 bg-white/[0.03] text-zinc-400"
                        }`}
                      >
                        {value}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>

            <div className="space-y-5">
              <section className="rounded-3xl border border-white/10 bg-zinc-950 p-4">
                <label className="mb-3 block text-sm font-medium">Prompt</label>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Örn: Siyah arka planda lüks parfüm şişesi, sinematik ışık, premium reklam görseli..."
                  className="min-h-40 w-full resize-none rounded-2xl border border-white/10 bg-black/60 p-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-cyan-400/60"
                />

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-zinc-500">
                    Maliyet:{" "}
                    <span className="text-cyan-300">
                      {selectedModel.cost * quantity} kredi
                    </span>
                  </div>

                  <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-black transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Wand2 className="h-4 w-4" />
                    {isGenerating ? "Üretiliyor..." : "Generate"}
                  </button>
                </div>
              </section>

              <section className="rounded-3xl border border-white/10 bg-zinc-950 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="font-medium">Sonuçlar</h2>
                    <p className="text-sm text-zinc-500">
                      Mock sonuçlar localStorage içinde saklanır.
                    </p>
                  </div>
                </div>

                {assets.length === 0 ? (
                  <div className="flex min-h-72 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] text-center">
                    <div>
                      <Sparkles className="mx-auto mb-3 h-8 w-8 text-zinc-600" />
                      <p className="text-sm text-zinc-400">Henüz sonuç yok.</p>
                      <p className="mt-1 text-xs text-zinc-600">
                        Prompt yazıp Generate butonuna bas.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {assets.map((asset) => (
                      <article
                        key={asset.id}
                        className="overflow-hidden rounded-2xl border border-white/10 bg-black"
                      >
                        <div
                          className={`flex aspect-[4/3] items-center justify-center bg-gradient-to-br ${asset.gradient}`}
                        >
                          <div className="rounded-full bg-black/35 px-4 py-2 text-sm backdrop-blur">
                            Mock image
                          </div>
                        </div>

                        <div className="space-y-3 p-3">
                          <div>
                            <div className="text-sm font-medium">{asset.model}</div>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">
                              {asset.prompt}
                            </p>
                          </div>

                          <div className="flex items-center justify-between text-xs text-zinc-500">
                            <span>{asset.aspectRatio}</span>
                            <span>{new Date(asset.createdAt).toLocaleDateString("tr-TR")}</span>
                          </div>

                          <div className="flex gap-2">
                            <button className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/10">
                              <Download className="h-3.5 w-3.5" />
                              İndir
                            </button>
                            <button
                              onClick={() => handleDelete(asset.id)}
                              className="flex items-center justify-center rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-red-500/10 hover:text-red-300"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
