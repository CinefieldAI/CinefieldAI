import { Sparkles } from "lucide-react";

const COLUMNS: { title: string; links: string[] }[] = [
  {
    title: "Product",
    links: ["Image", "Video", "Audio", "Canvas", "Apps", "Supercomputer"],
  },
  {
    title: "Studios",
    links: ["Marketing Studio", "Cinema Studio", "AI Influencer", "Soul 2.0"],
  },
  {
    title: "Company",
    links: ["About", "Careers", "Contact", "Trust & Safety"],
  },
  {
    title: "Resources",
    links: ["Community", "Pricing", "MCP & CLI", "Plugins", "Collab"],
  },
  {
    title: "Enterprise",
    links: ["Enterprise", "Security", "API", "Status"],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-black">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 md:grid-cols-5">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {col.title}
              </h4>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link}>
                    <a
                      href="#"
                      className="text-sm text-zinc-400 transition-colors hover:text-white"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-magenta-500/15">
              <Sparkles className="h-3.5 w-3.5 text-magenta-500" strokeWidth={2.5} />
            </span>
            <span className="text-sm font-semibold text-white">
              CINEFIELD
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            © {new Date().getFullYear()} CINEFIELD. All rights reserved.
          </p>
          <div className="flex items-center gap-5">
            <a
              href="#"
              className="text-xs text-zinc-500 transition-colors hover:text-white"
            >
              Privacy
            </a>
            <a
              href="#"
              className="text-xs text-zinc-500 transition-colors hover:text-white"
            >
              Terms
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
