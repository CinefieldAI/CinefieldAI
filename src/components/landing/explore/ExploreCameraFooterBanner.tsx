import { spaceGrotesk } from "@/lib/fonts/spaceGrotesk";

interface FooterColumn {
  heading: string;
  items: string[];
}

const FOOTER_COLUMNS: FooterColumn[] = [
  {
    heading: "Cinefield AI",
    items: [
      "About",
      "Trust",
      "Careers",
      "Contact",
      "Pricing",
      "Apps",
      "Supercomputer",
      "Cinema Studio",
      "Marketing Studio",
      "Cinefield Canvas",
      "Cinefield Collab",
      "Cinefield MCP",
      "Cinefield Games",
      "AI Influencer",
      "Community",
      "Enterprise",
      "Team",
      "AI Assist",
      "Reference Extension",
      "Blog",
      "Creator Hub",
      "Help center",
      "Contests",
      "Discord",
    ],
  },
  {
    heading: "Image",
    items: [
      "AI Image",
      "Soul ID Character",
      "Draw to Edit",
      "Fashion Factory",
      "Edit Image",
      "Image Upscale",
      "Photodump Studio",
      "Cinefield Popcorn",
      "Nano Banana",
      "Prompt Guide",
      "Flux 2",
      "Seedream 5",
      "GPT Image 2",
      "Inpaint",
      "Soul 2.0",
      "Soul Cinema",
      "Soul Cast",
    ],
  },
  {
    heading: "Video",
    items: [
      "AI Video",
      "Mixed media",
      "Sora 2 Introduction",
      "Veo 3.1 Introduction",
      "Create Video",
      "Lipsync Studio",
      "Talking Avatar",
      "Draw to Video",
      "UGC Factory",
      "Video Upscale",
      "Kling 3.0",
      "WAN 2.6",
      "Seedance 2.5",
      "Seedance 2.0",
      "Grok Imagine 1.5",
      "Gemini Omni Flash",
    ],
  },
  {
    heading: "Edit",
    items: ["Banana Placement", "Product Placement", "Edit Image", "Multi Reference", "Upscale", "Sora 2 Upscale"],
  },
];

const SOCIAL_LABELS = ["X / Twitter", "YouTube", "Instagram", "LinkedIn", "TikTok"];

/**
 * Structure cloned from the reference site's own footer banner (heading +
 * 4 columns + social row), Cinefield's own accent instead of the
 * reference's lime green, and every item rendered as an inert button — no
 * hrefs, no onClick, nothing navigates. The reference's real street address
 * was dropped rather than reproduced (it's Higgsfield's own office, not
 * Cinefield's) and every "Higgsfield X" product name became "Cinefield X".
 */
export default function ExploreCameraFooterBanner() {
  return (
    <section className="mt-16 rounded-3xl bg-[#D97757] px-6 py-10 text-white md:px-10 md:py-16">
      <div className="grid gap-10 xl:grid-cols-[auto_1fr] xl:items-start xl:gap-16">
        <h2
          className={`${spaceGrotesk.className} max-w-sm text-2xl uppercase leading-[1.05] md:text-4xl xl:max-w-96`}
        >
          The ultimate AI-powered camera control for filmmakers &amp; creators
        </h2>

        <div className="grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-4">
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.heading}>
              <h3 className="mb-3 text-sm font-medium text-white/60">{col.heading}</h3>
              <div className="flex flex-col items-start gap-2">
                {col.items.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="inline-grid h-8 appearance-none items-center rounded-full border-0 bg-white/10 px-3 text-left text-sm font-medium text-white shadow-none outline-none [-webkit-tap-highlight-color:transparent] focus:shadow-none focus:outline-none focus-visible:shadow-none focus-visible:outline-none active:shadow-none"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-10 flex flex-wrap justify-center gap-2 border-t border-white/15 pt-8 xl:justify-end">
        {SOCIAL_LABELS.map((label) => (
          <button
            key={label}
            type="button"
            className="inline-grid h-8 appearance-none items-center rounded-full border-0 bg-white/10 px-3 text-sm font-medium text-white shadow-none outline-none [-webkit-tap-highlight-color:transparent] focus:shadow-none focus:outline-none focus-visible:shadow-none focus-visible:outline-none active:shadow-none"
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
