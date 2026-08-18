import HeroCarousel from "./HeroCarousel";
import PromoBannerSection from "./PromoBannerSection";
import FilmFestivalBannerSection from "./FilmFestivalBannerSection";
import SeedanceShowcaseSection from "./SeedanceShowcaseSection";

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

export default function ExploreHome() {
  return (
    <div className="w-full pb-24">
      {/* Hero: 95 cards carousel */}
      <section className="pt-6">
        <HeroCarousel />
      </section>

      {/* Promo banner section: 1 big card + 6 small cards grid */}
      <PromoBannerSection />

      {/* Film Festival banner section: $1,000,000 festival banner with gold credits bar */}
      <FilmFestivalBannerSection />

      {/* Seedance 2.5 Showcase section: cyan glow showcase with 12 community videos */}
      <SeedanceShowcaseSection />

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
