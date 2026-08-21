import Link from "next/link";
import { FEATURE_LABELS, slugifyFeature } from "./exploreFeatureLabels";

/**
 * Structure/sizing cloned from the reference site's own "browse more" tag
 * cloud. Each pill routes to its own /features/<slug> page — same "real
 * link, own route, Coming soon placeholder" treatment already used for
 * Shorts Studio and Explainer in the navbar, rather than the reference
 * site's own deep links.
 */
export default function ExploreMoreFeaturesSection() {
  return (
    <section className="container mx-auto mb-10 max-w-7xl px-4 py-10 md:mb-16 md:px-6 md:py-20">
      <h2 className="mb-8 text-center font-grotesk text-2xl font-bold uppercase text-white md:text-4xl">
        Explore more AI features
      </h2>
      <div className="flex flex-wrap justify-center gap-2">
        {FEATURE_LABELS.map((label) => (
          <Link
            key={label}
            href={`/features/${slugifyFeature(label)}`}
            className="inline-grid h-8 items-center rounded-full bg-white/[0.06] px-3 font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white active:bg-white/[0.14] md:rounded-lg"
          >
            {label}
          </Link>
        ))}
      </div>
    </section>
  );
}
