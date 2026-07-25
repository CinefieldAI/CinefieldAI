import Link from "next/link";

/**
 * Dev hub — a single page linking to every main route so you can reach them
 * all from one place (http://localhost:3000/links). Fully self-contained:
 * no shared components, no shared state, touches nothing else in the app.
 */

interface HubLink {
  href: string;
  title: string;
  description: string;
}

const LINKS: HubLink[] = [
  { href: "/", title: "Ana Sayfa", description: "CINEFIELD landing / AppShell" },
  { href: "/audio/create", title: "Audio Create", description: "Voiceover · Change Voice · Translate composer" },
  { href: "/generate", title: "Cinema Studio", description: "Video generation (default Cinema 3.5)" },
  { href: "/generate?model=cinema-2.5", title: "Cinema Studio 2.5", description: "Director Panel + prompt bar" },
  { href: "/generate/image", title: "Image Generate", description: "20-model image generation" },
  { href: "/image/create", title: "Image Create", description: "Image creation workspace" },
  { href: "/video/create", title: "Video Create", description: "Video creation workspace" },
  { href: "/marketing-studio/product", title: "Marketing Studio", description: "Product → video ad composer" },
  { href: "/supercomputer", title: "Supercomputer", description: "DeepSeek beam composer" },
  { href: "/canvas", title: "Canvas", description: "Canvas workspace" },
];

export default function LinksHubPage() {
  return (
    <main className="min-h-screen w-full bg-[#0a0a0a] px-6 py-16 text-white">
      <div className="mx-auto w-full max-w-[1000px]">
        <header className="mb-10">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#00e5ff]">
            Dev Hub
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Tüm sayfalar</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Her route&apos;a tek yerden ulaş. Bu sayfa uygulamanın geri kalanından
            tamamen bağımsızdır.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-[#00e5ff]/40 hover:bg-white/[0.06]"
            >
              <span className="text-sm font-semibold text-white group-hover:text-[#00e5ff]">
                {link.title}
              </span>
              <span className="mt-1 text-xs text-zinc-500">{link.description}</span>
              <span className="mt-3 truncate text-[11px] font-mono text-zinc-600">
                {link.href}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
