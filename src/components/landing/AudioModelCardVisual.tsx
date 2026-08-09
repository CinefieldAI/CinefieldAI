import { type AudioModel } from "./audioMenuData";

type AudioModelCardVariant = "navbar" | "selector" | "trigger";

interface AudioModelCardVisualProps {
  item: AudioModel;
  variant: AudioModelCardVariant;
  active?: boolean;
}

export default function AudioModelCardVisual({
  item,
  variant,
  active = false,
}: AudioModelCardVisualProps) {
  const Icon = item.icon;
  const isNavbar = variant === "navbar";
  const isTrigger = variant === "trigger";

  /**
   * The trigger reads like the video panel's model trigger: a "Model" caption
   * over the name, with a bare accent glyph trailing it — no metallic tile.
   * The tile stays for the list variants (navbar + selector), so the picker
   * row and the control that opens it are deliberately distinguishable, the
   * same way they are on the video side.
   */
  if (isTrigger) {
    return (
      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <span className="block text-left text-[10px] leading-4 text-zinc-500">
          Model
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-left text-sm font-semibold leading-5 text-white">
            {item.title === "Qwen Audio 3.0" ? "Qwen Audio 3.0 TTS" : item.title}
          </span>
          {item.iconSrc ? (
            <img
              src={item.iconSrc}
              alt=""
              aria-hidden="true"
              className="size-4 shrink-0 object-contain"
              style={{
                filter:
                  "brightness(0) saturate(100%) invert(56%) sepia(38%) saturate(1032%) hue-rotate(329deg) brightness(92%) contrast(88%)",
              }}
            />
          ) : (
            <Icon aria-hidden="true" className="size-4 shrink-0 text-[#D97757]" />
          )}
        </span>
      </span>
    );
  }

  return (
    <>
      <span
        className={`relative shrink-0 origin-center rounded-[13px] p-[1.5px] transition-all duration-300 ease-out group-hover:scale-[1.05] ${
          isNavbar ? "size-12" : "size-10"
        } ${
          active
            ? "shadow-[0_-4px_16px_rgba(255,255,255,0.75),0_6px_24px_rgba(217,119,87,0.95)]"
            : "shadow-[0_-2px_8px_rgba(255,255,255,0.40),0_4px_14px_rgba(217,119,87,0.60)] group-hover:shadow-[0_-4px_18px_rgba(255,255,255,0.65),0_6px_24px_rgba(217,119,87,0.82)]"
        }`}
        style={{
          background:
            "linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 50%, #D97757 50%, #D97757 100%)",
        }}
      >
        <span
          className="relative flex size-full items-center justify-center overflow-hidden rounded-[11px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),inset_0_-2px_4px_rgba(0,0,0,0.45)]"
          style={{
            background:
              "linear-gradient(180deg, #E6E6E6 0%, #A0A0A0 42%, #D97757 72%, #A8482A 100%)",
          }}
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-[48%] rounded-t-[11px] bg-gradient-to-b from-white/70 to-transparent" />
          {item.iconSrc ? (
            <img
              src={item.iconSrc}
              alt=""
              aria-hidden="true"
              className={`${isNavbar ? "size-6" : "size-5"} relative z-10 object-contain brightness-0 invert drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]`}
            />
          ) : (
            <Icon
              aria-hidden="true"
              className={`${isNavbar ? "size-6" : "size-5"} relative z-10 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]`}
            />
          )}
        </span>
      </span>

      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <span
          className={`block truncate text-left font-semibold text-white ${
            isNavbar ? "text-[16px] leading-5" : "text-sm leading-5"
          }`}
        >
          {item.title}
        </span>
        <span
          className={`block truncate text-left font-normal text-white/60 ${
            isNavbar ? "text-[13px] leading-[18px]" : "text-xs leading-4"
          }`}
        >
          {item.description}
        </span>
      </span>
    </>
  );
}
