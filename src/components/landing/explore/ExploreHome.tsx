import HeroCarousel from "./HeroCarousel";
import PromoBannerSection from "./PromoBannerSection";
import FilmFestivalBannerSection from "./FilmFestivalBannerSection";
import SeedanceShowcaseSection from "./SeedanceShowcaseSection";
import SeedanceCommunityShowcase from "./SeedanceCommunityShowcase";
import SupercomputerBannerSection from "./SupercomputerBannerSection";
import GptImage2CommunityShowcase from "./GptImage2CommunityShowcase";
import ExploreMoreFeaturesSection from "./ExploreMoreFeaturesSection";
import ExploreCameraFooterBanner from "./ExploreCameraFooterBanner";

export default function ExploreHome() {
  return (
    <div className="mx-auto max-w-[1400px] w-full px-4 pb-24 md:px-6">
      {/* Hero: 95 cards carousel */}
      <section className="pt-6">
        <HeroCarousel />
      </section>

      {/* Promo banner section: 1 big card + 6 small cards grid */}
      <PromoBannerSection />

      {/* Film Festival banner section: $1,000,000 festival banner with gold credits bar */}
      <FilmFestivalBannerSection />

      {/* Exclusive Access Seedance 2.5 Banner (blue glow banner) */}
      <SeedanceShowcaseSection />

      {/* Seedance 2.5 Community Showcase Grid (12 videos, gradient fade, floating view all button) */}
      <SeedanceCommunityShowcase />

      {/* Supercomputer Banner section (neon green border, grid pattern, logo & CTA) */}
      <SupercomputerBannerSection />

      {/* GPT Image 2 Community Showcase Grid (16 image cards, gradient fade, floating view all button) */}
      <GptImage2CommunityShowcase />

      {/* Browse-more tag cloud — inert pills, no routes (see component note) */}
      <ExploreMoreFeaturesSection />

      {/* Camera-control footer banner — orange/white clone of the reference's
          own footer, every item an inert button (see component note) */}
      <ExploreCameraFooterBanner />
    </div>
  );
}
