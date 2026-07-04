/**
 * Hero banner cluster for the Cinema Studio page. Each banner uses its webp
 * source layered over a gradient, so the layout still reads if the asset is
 * missing (no broken-image icon).
 */

function Banner({
  src,
  fallback,
  className,
  style,
}: {
  src: string;
  fallback: string;
  className: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        ...style,
        background: `url(${src}) center / cover no-repeat, ${fallback}`,
      }}
    />
  );
}

export default function HeroBanner() {
  return (
    <div className="relative z-0 flex flex-col items-center">
      {/* Banner cluster */}
      <div className="relative mx-auto h-[112px] w-[459px] max-w-full">
        <Banner
          src="/generate-banner-left.webp"
          fallback="linear-gradient(135deg,#ff5f6d55,#0a0a0a)"
          className="absolute left-0 top-4 h-20 w-[188px] -rotate-[7deg] rounded-xl border-2 border-white/[0.04] shadow-2xl"
        />
        <Banner
          src="/generate-banner-right.webp"
          fallback="linear-gradient(135deg,#ffd16655,#0a0a0a)"
          className="absolute right-0 top-4 h-20 w-[188px] rotate-[7.25deg] rounded-xl border-2 border-white/[0.04] shadow-2xl"
        />
        <Banner
          src="/generate-banner-center.webp"
          fallback="linear-gradient(135deg,#00e5ff55,#0a0a0a)"
          className="absolute left-1/2 top-0 z-10 h-28 w-[264px] -translate-x-1/2 rounded-xl border-2 border-white/[0.16] shadow-2xl"
        />
      </div>

      {/* Titles */}
      <div className="mt-8 text-center">
        <h1 className="text-[28px] font-bold uppercase leading-tight text-white md:text-[36px]">
          Create your first project.
        </h1>
        <h1 className="text-[28px] font-bold uppercase leading-tight text-[#00e5ff] md:text-[36px]">
          Generate the impossible.
        </h1>
      </div>
    </div>
  );
}
