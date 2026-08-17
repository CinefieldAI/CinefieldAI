import HeroCarousel from "./HeroCarousel";

/**
 * Explore home. The hero row is `HeroCarousel` (real card titles, scroll-
 * arrow behavior matching the reference site's own mechanic). Everything
 * below the hero is still a placeholder skeleton — no scraped media, no
 * external URLs, no real usernames — and gets built piece by piece next.
 */

interface GallerySection {
  title: string;
  subtitle: string;
  count: number;
}

const GALLERY_SECTIONS: GallerySection[] = [
  { title: "Cinema Studio", subtitle: "Cinematic camera control, directed by prompt.", count: 8 },
  { title: "Marketing Studio", subtitle: "Ad-ready shorts and product creatives.", count: 8 },
  { title: "Create Image", subtitle: "Photoreal, illustrated, or stylized stills.", count: 8 },
  { title: "Create Video", subtitle: "Motion generation across every model.", count: 8 },
  { title: "Audio", subtitle: "Voiceover, change voice, translate.", count: 8 },
];

interface FooterColumn {
  heading: string;
  items: string[];
}

const FOOTER_COLUMNS: FooterColumn[] = [
  {
    heading: "Cinefield",
    items: ["About", "Pricing", "Supercomputer", "Explainer", "Community"],
  },
  {
    heading: "Image",
    items: ["Create Image", "Soul 2.0", "Nova XL", "Prism", "Lumen", "Image Upscale"],
  },
  {
    heading: "Video",
    items: [
      "Create Video",
      "Cinema Studio",
      "Seedance 2.0",
      "Kling 3.0",
      "Kling 3.0 Motion Control",
      "Video Upscale",
    ],
  },
  {
    heading: "Edit",
    items: ["Edit Image", "Marketing Studio", "Shorts Studio", "Canvas", "Moodboard"],
  },
];

function PlaceholderTile({ aspect }: { aspect: string }) {
  return (
    <div
      className={`relative w-full shrink-0 overflow-hidden rounded-xl border border-white/5 bg-gradient-to-br from-white/[0.06] to-white/[0.02] ${aspect}`}
    />
  );
}

export default function ExploreHome() {
  return (
    <div className="w-full pb-24">
      {/* Hero: real card names, scroll-arrow mechanic matching the reference site */}
      <section className="pt-6">
        <HeroCarousel />
      </section>

      {/* Gallery sections: empty card grids, section titles only */}
      {GALLERY_SECTIONS.map((section) => (
        <section key={section.title} className="container mx-auto max-w-7xl px-4 pt-12 md:px-6">
          <div className="mb-4 flex items-baseline justify-between">
            <div>
              <h2 className="font-grotesk text-lg font-bold uppercase text-[#D97757] md:text-xl">
                {section.title}
              </h2>
              <p className="text-sm text-white/50">{section.subtitle}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {Array.from({ length: section.count }, (_, i) => (
              <PlaceholderTile key={i} aspect="aspect-square" />
            ))}
          </div>
        </section>
      ))}

      {/* Footer mega-block — shell only, plain text, no links/routing yet */}
      <section className="mt-16 border-t border-white/10 bg-white/[0.02]">
        <div className="container mx-auto max-w-7xl px-4 py-10 md:px-6">
          <h2 className="max-w-md font-grotesk text-2xl font-bold uppercase leading-tight text-white/90 md:text-3xl">
            One camera. Every model. All in Cinefield.
          </h2>
          <div className="mt-10 grid grid-cols-2 gap-8 md:grid-cols-4">
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.heading}>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/40">
                  {col.heading}
                </h3>
                <ul className="space-y-2">
                  {col.items.map((item) => (
                    <li key={item} className="text-sm font-medium text-white/70">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
