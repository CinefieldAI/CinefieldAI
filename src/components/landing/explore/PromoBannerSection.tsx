export default function PromoBannerSection() {
  return (
    <section className="mx-auto mb-6 flex max-w-[1400px] flex-col items-stretch gap-3 px-4 pt-4 lg:flex-row lg:gap-5">
      {/* Left Big Promo Card */}
      <div className="grid w-full transition-[height,opacity] duration-200 ease-out lg:min-h-[264px] lg:w-[48%] lg:max-w-[40rem] lg:shrink-0 motion-reduce:transition-none">
        <a
          href="/ai/video?model=seedance_2_5&resolution=1080p"
          className="relative isolate block aspect-[351/197] w-full overflow-hidden rounded-lg bg-[#1c1e21] text-left ring-1 ring-inset ring-white/20 transition-opacity hover:opacity-95 lg:aspect-auto lg:self-stretch lg:min-h-[264px] md:rounded-[20px]"
        >
          <video
            src="https://static.higgsfield.ai/promotions/exlusive_seedance_2_5_1080p_explore_image.mp4#t=0.001"
            aria-hidden="true"
            playsInline
            disablePictureInPicture
            preload="metadata"
            className="pointer-events-none absolute inset-0 size-full object-cover"
          />
          <video
            autoPlay
            loop
            muted
            playsInline
            disablePictureInPicture
            preload="metadata"
            aria-hidden="true"
            src="https://static.higgsfield.ai/promotions/exlusive_seedance_2_5_1080p_explore_image.mp4"
            className="pointer-events-none absolute inset-0 size-full object-cover"
          >
            Your browser does not support the video.
          </video>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(90deg, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.7) 38%, rgba(0, 0, 0, 0.25) 70%, rgba(0, 0, 0, 0.15) 100%)",
            }}
          />
          <div className="relative z-[2] flex min-h-[inherit] w-full flex-col items-start gap-1 p-3 max-lg:min-h-full min-[700px]:px-6 min-[700px]:pt-6 lg:gap-3 lg:px-[22px] lg:pb-[22px] lg:pt-[22px]">
            <h3 className="max-w-[34rem] font-grotesk text-[20px] font-bold uppercase leading-[27px] tracking-[-0.04em] text-balance min-[480px]:whitespace-nowrap min-[480px]:text-[28px] min-[480px]:leading-8 lg:text-[2.25rem] lg:leading-10">
              <span
                className="block"
                style={{
                  backgroundImage: "linear-gradient(90deg, rgb(209, 254, 23) 0%, rgba(209, 254, 23, 0.8) 100%)",
                  WebkitBackgroundClip: "text",
                  color: "transparent",
                }}
              >
                Exclusive Seedance 2.5
              </span>
              <span
                className="block"
                style={{
                  backgroundImage: "linear-gradient(rgb(255, 255, 255) 0%, rgb(153, 153, 153) 100%)",
                  WebkitBackgroundClip: "text",
                  color: "transparent",
                }}
              >
                at 1080p with 30% OFF
              </span>
            </h3>
            <div className="max-w-[34rem] text-xs font-medium leading-5 tracking-[0.1px] text-white/60 md:text-sm">
              The most advanced model at 1080p with an exclusive access
            </div>
            <div className="mt-auto w-full pt-2 min-[430px]:w-fit min-[430px]:max-w-full">
              <span className="relative inline-block w-full min-[430px]:w-auto">
                <span
                  className="relative inline-flex h-10 w-full items-center justify-center overflow-hidden rounded-[10px] px-3 pb-3.5 pt-2.5 shadow-[inset_0_-3px_0_0_#829b19,0_6px_4px_0_rgba(0,0,0,0.25),0_32px_24px_0_rgba(0,0,0,0.15)] min-[430px]:w-auto min-[430px]:min-w-[258px] lg:h-12 lg:px-4 lg:pb-4 lg:pt-3"
                  style={{
                    backgroundImage:
                      "linear-gradient(rgba(255, 255, 20, 0) 0%, rgb(255, 255, 20) 100%), linear-gradient(90deg, rgb(209, 254, 23) 0%, rgb(209, 254, 23) 100%)",
                  }}
                >
                  <span className="relative truncate whitespace-nowrap px-1.5 text-sm font-semibold leading-5 text-[#1a1a1a] lg:text-base">
                    Get Seedance 2.5 at 1080p with 30% OFF
                  </span>
                </span>
              </span>
            </div>
          </div>
        </a>
      </div>

      {/* Right 6 Cards Grid */}
      <div className="grid flex-1 min-w-0 auto-rows-fr grid-cols-2 gap-2 lg:grid-cols-3 lg:gap-3">
        {/* Card 1 */}
        <a
          href="/ai/video?model=seedance_2_5&resolution=1080p"
          className="relative flex flex-col min-h-[126px] overflow-hidden rounded-2xl bg-black border border-[rgba(217,217,217,0.04)] p-4 lg:p-5 gap-3 transition hover:brightness-125 active:brightness-100 md:items-start md:justify-between"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[inherit]"
            style={{
              backgroundImage:
                "radial-gradient(72px 48px at 0% 0%, rgba(120, 235, 255, 0.16) 0%, rgba(120, 235, 255, 0) 100%), radial-gradient(72px 48px at 100% 0%, rgba(120, 235, 255, 0.16) 0%, rgba(120, 235, 255, 0) 100%), radial-gradient(72px 48px at 0% 100%, rgba(120, 235, 255, 0.16) 0%, rgba(120, 235, 255, 0) 100%), radial-gradient(72px 48px at 100% 100%, rgba(120, 235, 255, 0.16) 0%, rgba(120, 235, 255, 0) 100%), linear-gradient(rgba(0, 161, 255, 0.56) 0px, rgba(0, 92, 255, 0.31) 20px, rgba(0, 0, 255, 0.145) 36px, rgba(0, 0, 255, 0) 52px), linear-gradient(to top, rgba(0, 178, 255, 0.63) 0px, rgba(0, 96, 255, 0.34) 20px, rgba(0, 0, 255, 0.16) 36px, rgba(0, 0, 255, 0) 54px), linear-gradient(to right, rgba(0, 130, 255, 0.42) 0px, rgba(0, 97, 255, 0.32) 12px, rgba(0, 0, 255, 0.19) 24px, rgba(0, 0, 255, 0.04) 48px, rgba(0, 0, 255, 0) 60px), linear-gradient(to left, rgba(0, 130, 255, 0.42) 0px, rgba(0, 97, 255, 0.32) 12px, rgba(0, 0, 255, 0.19) 24px, rgba(0, 0, 255, 0.04) 48px, rgba(0, 0, 255, 0) 60px)",
            }}
          />
          <div className="relative flex w-full items-center justify-between">
            <img
              alt=""
              aria-hidden="true"
              className="relative size-5 drop-shadow-[0px_3px_2px_rgba(0,0,0,0.15)]"
              src="https://static.higgsfield.ai/explore/image-generate-block/seedance-logo.png"
            />
          </div>
          <div className="relative flex w-full flex-col gap-1">
            <div className="flex min-w-0 items-center gap-1.5 text-base font-semibold leading-6 text-white tracking-[-0.16px]">
              <span className="truncate">Seedance 2.5</span>
            </div>
            <p className="text-sm font-normal leading-5 text-[#898a8b] lg:text-xs lg:leading-[18px]">
              The most advanced video model
            </p>
          </div>
          <p className="pointer-events-none absolute right-3 top-3 inline-block whitespace-nowrap rounded-sm bg-[#FF005B] px-1.5 font-grotesk text-xs font-bold uppercase text-white -skew-x-12 [background-image:radial-gradient(39.71%_136.54%_at_51.64%_117.31%,#F920D1_0%,#ED1572_100%)]">
            Exclusive 1080p
          </p>
        </a>

        {/* Card 2 */}
        <a
          href="/academy"
          className="relative flex flex-col min-h-[126px] overflow-hidden rounded-2xl bg-[#1c1e20] border border-white/5 p-4 lg:p-5 gap-3 transition hover:bg-[#23252a] active:bg-[#1c1e20] md:items-start md:justify-between"
        >
          <div className="relative flex w-full items-center justify-between">
            <svg
              className="relative size-5 text-white drop-shadow-[0px_3px_2px_rgba(0,0,0,0.15)]"
              aria-hidden="true"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 7.75C12 6.09315 13.3431 4.75 15 4.75H21.25C21.8023 4.75 22.25 5.19772 22.25 5.75V18.25C22.25 18.8023 21.8023 19.25 21.25 19.25H15.277C14.5966 19.25 13.9296 19.4142 13.3508 19.7719C12.772 20.1296 12.3043 20.6414 12 21.25M12 7.75C12 6.09315 10.6569 4.75 9 4.75H2.75C2.19772 4.75 1.75 5.19772 1.75 5.75V18.25C1.75 18.8023 2.19772 19.25 2.75 19.25H8.723C9.40341 19.25 10.0704 19.4142 10.6492 19.7719C11.228 20.1296 11.6957 20.6414 12 21.25M12 7.75V21.25"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="relative flex w-full flex-col gap-1">
            <div className="flex min-w-0 items-center gap-1.5 text-base font-semibold leading-6 text-white tracking-[-0.16px]">
              <span className="truncate max-lg:hidden">Higgsfield Academy</span>
              <span className="truncate lg:hidden">Academy</span>
            </div>
            <p className="text-sm font-normal leading-5 text-[#898a8b] lg:text-xs lg:leading-[18px]">
              Learn how to use Higgsfield
            </p>
          </div>
        </a>

        {/* Card 3 */}
        <a
          href="/ai/video?model=seedance_2_0"
          className="relative flex flex-col min-h-[126px] overflow-hidden rounded-2xl bg-[#1c1e20] border border-white/5 p-4 lg:p-5 gap-3 transition hover:bg-[#23252a] active:bg-[#1c1e20] md:items-start md:justify-between"
        >
          <div className="relative flex w-full items-center justify-between">
            <img
              alt=""
              aria-hidden="true"
              className="relative size-5 drop-shadow-[0px_3px_2px_rgba(0,0,0,0.15)]"
              src="https://static.higgsfield.ai/explore/image-generate-block/seedance-logo.png"
            />
          </div>
          <div className="relative flex w-full flex-col gap-1">
            <div className="flex min-w-0 items-center gap-1.5 text-base font-semibold leading-6 text-white tracking-[-0.16px]">
              <span className="truncate">Seedance 2.0</span>
            </div>
            <p className="text-sm font-normal leading-5 text-[#898a8b] lg:text-xs lg:leading-[18px]">
              Create high-quality videos
            </p>
          </div>
          <span className="absolute right-3 top-3 grid grid-flow-col items-center gap-1 rounded-full bg-white/5 px-2 py-1.5 text-[11px] font-medium leading-[18px] text-white/80 backdrop-blur-[8px]">
            <svg
              className="size-3.5"
              aria-hidden="true"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M2 5.75C2 4.7835 2.7835 4 3.75 4H14.25C15.2165 4 16 4.7835 16 5.75V8.78669L20.191 6.6912C21.0221 6.27563 22 6.88 22 7.80923V16.1912C22 17.1204 21.0221 17.7248 20.191 17.3092L16 15.2137V18.25C16 19.2165 15.2165 20 14.25 20H3.75C2.7835 20 2 19.2165 2 18.25V5.75ZM16 13.5367L20.5 15.7867V8.21374L16 10.4637V13.5367Z"
                fill="currentColor"
              />
            </svg>
            Video
          </span>
        </a>

        {/* Card 4 */}
        <a
          href="/supercomputer"
          className="relative flex flex-col min-h-[126px] overflow-hidden rounded-2xl bg-[#1c1e20] border border-white/5 p-4 lg:p-5 gap-3 transition hover:bg-[#23252a] active:bg-[#1c1e20] md:items-start md:justify-between"
        >
          <div className="relative flex w-full items-center justify-between">
            <img
              alt=""
              aria-hidden="true"
              className="relative size-5 drop-shadow-[0px_3px_2px_rgba(0,0,0,0.15)]"
              src="https://static.higgsfield.ai/explore-image/spc-explore-icon.png"
            />
          </div>
          <div className="relative flex w-full flex-col gap-1">
            <div className="flex min-w-0 items-center gap-1.5 text-base font-semibold leading-6 text-white tracking-[-0.16px]">
              <span className="truncate">Supercomputer</span>
            </div>
            <p className="text-sm font-normal leading-5 text-[#898a8b] lg:text-xs lg:leading-[18px]">
              Automation, skills, apps and more
            </p>
          </div>
        </a>

        {/* Card 5 */}
        <a
          href="/mcp"
          className="relative flex flex-col min-h-[126px] overflow-hidden rounded-2xl bg-[#1c1e20] border border-white/5 p-4 lg:p-5 gap-3 transition hover:bg-[#23252a] active:bg-[#1c1e20] md:items-start md:justify-between hidden lg:flex"
        >
          <div className="relative flex w-full items-center justify-between">
            <img
              alt=""
              aria-hidden="true"
              className="relative size-5 drop-shadow-[0px_3px_2px_rgba(0,0,0,0.15)]"
              src="https://static.higgsfield.ai/explore/image-generate-block/claude-logo.png"
            />
          </div>
          <div className="relative flex w-full flex-col gap-1">
            <div className="flex min-w-0 items-center gap-1.5 text-base font-semibold leading-6 text-white tracking-[-0.16px]">
              <span className="truncate">MCP &amp; CLI</span>
            </div>
            <p className="text-sm font-normal leading-5 text-[#898a8b] lg:text-xs lg:leading-[18px]">
              Turn Claude into a creative engine
            </p>
          </div>
        </a>

        {/* Card 6 */}
        <a
          href="/generate"
          className="relative flex flex-col min-h-[126px] overflow-hidden rounded-2xl bg-[#1c1e20] border border-white/5 p-4 lg:p-5 gap-3 transition hover:bg-[#23252a] active:bg-[#1c1e20] md:items-start md:justify-between hidden lg:flex"
        >
          <div className="relative flex w-full items-center justify-between">
            <img
              alt=""
              aria-hidden="true"
              className="relative size-5 drop-shadow-[0px_3px_2px_rgba(0,0,0,0.15)]"
              src="https://static.higgsfield.ai/explore/image-generate-block/cinema-studio.png"
            />
          </div>
          <div className="relative flex w-full flex-col gap-1">
            <div className="flex min-w-0 items-center gap-1.5 text-base font-semibold leading-6 text-white tracking-[-0.16px]">
              <span className="truncate">Cinema Studio 4.0</span>
              <p className="pointer-events-none shrink-0 inline-block whitespace-nowrap rounded-sm bg-white px-1.5 font-grotesk text-[10px] font-bold uppercase text-black -skew-x-12">
                New
              </p>
            </div>
            <p className="text-sm font-normal leading-5 text-[#898a8b] lg:text-xs lg:leading-[18px]">
              Create cinematic scenes effortlessly
            </p>
          </div>
        </a>
      </div>
    </section>
  );
}
