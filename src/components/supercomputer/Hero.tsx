"use client";

import { useState, useEffect } from "react";
import { Plus, ChevronDown } from "lucide-react";
import ModelSelectorDropdown from "./ModelSelectorDropdown";

const PLACEHOLDERS = [
  "Make product shots for my campaign",
  "Generate a short video ad from my idea",
  "Turn my podcast into 9:16 Reels",
  "Turn my script into motion graphics",
  "Create a brand identity in minutes",
];

export default function Hero() {
  const [placeholder, setPlaceholder] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);

  useEffect(() => {
    let phIndex = 0;
    let charIndex = 0;
    let isDeleting = false;

    const typewriter = () => {
      if (inputValue.length > 0) {
        setPlaceholder("");
        setTimeout(() => typewriter(), 200);
        return;
      }

      const current = PLACEHOLDERS[phIndex];

      if (!isDeleting) {
        setPlaceholder(current.substring(0, charIndex + 1));
        charIndex++;
        if (charIndex === current.length) {
          isDeleting = true;
          setTimeout(() => typewriter(), 2000);
          return;
        }
        setTimeout(() => typewriter(), 50);
      } else {
        setPlaceholder(current.substring(0, charIndex - 1));
        charIndex--;
        if (charIndex === 0) {
          isDeleting = false;
          phIndex = (phIndex + 1) % PLACEHOLDERS.length;
          setTimeout(() => typewriter(), 300);
          return;
        }
        setTimeout(() => typewriter(), 30);
      }
    };

    typewriter();
  }, [inputValue]);

  return (
    <div className="relative w-full px-4 bg-[#0a0a0a] pt-16" style={{
      backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)",
      backgroundSize: "24px 24px",
    }}>
      {modelSelectorOpen && (
        <ModelSelectorDropdown onClose={() => setModelSelectorOpen(false)} />
      )}

      <style>{`
        @property --beam-angle {
          syntax: "<angle>";
          initial-value: 0deg;
          inherits: true;
        }
        @property --beam-opacity {
          syntax: "<number>";
          initial-value: 0;
          inherits: true;
        }

        .composer-beam {
          position: relative;
          border-radius: 24px;
          overflow: hidden;
          animation: beam-spin 2.94s linear infinite, beam-fade-in 0.6s ease forwards;
        }

        .composer-beam::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 23px;
          padding: 1px;
          clip-path: inset(0 round 24px);
          background:
            conic-gradient(from var(--beam-angle),
              transparent 0%, transparent 54%,
              rgba(255,255,255,0.1) 57%,
              rgba(255,255,255,0.3) 60%,
              rgba(255,255,255,0.6) 63%,
              rgba(255,255,255,0.75) 66%,
              rgba(255,255,255,0.6) 69%,
              rgba(255,255,255,0.3) 72%,
              rgba(255,255,255,0.1) 75%,
              transparent 78%, transparent 100%),
            radial-gradient(ellipse 70px 40px at 33% -7.4%, rgb(133,240,45), transparent),
            radial-gradient(ellipse 60px 35px at 12% -5%, rgb(96,226,72), transparent),
            radial-gradient(ellipse 40px 70px at 2.1% 68.3%, rgb(64,210,96), transparent),
            radial-gradient(ellipse 20px 35px at 2.1% 68.3%, rgb(150,246,56), transparent),
            radial-gradient(ellipse 180px 32px at 74.4% 100%, rgb(112,232,60), transparent),
            radial-gradient(ellipse 85px 26px at 55% 100%, rgb(80,220,84), transparent),
            radial-gradient(ellipse 74px 32px at 93.9% 0%, rgb(170,250,70), transparent),
            radial-gradient(ellipse 26px 42px at 100% 27.1%, rgb(56,206,110), transparent),
            radial-gradient(ellipse 52px 48px at 100% 27.1%, rgb(120,234,52), transparent);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
          z-index: 2;
          opacity: calc(var(--beam-opacity) * 0.26);
          animation: beam-hue-shift 12s ease-in-out infinite;
        }

        .composer-beam::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 24px;
          background:
            radial-gradient(ellipse 63px 36px at 33% -7.4%, rgba(133,240,45,0.45), transparent),
            radial-gradient(ellipse 54px 32px at 12% -5%, rgba(96,226,72,0.45), transparent),
            radial-gradient(ellipse 36px 63px at 2.1% 68.3%, rgba(64,210,96,0.45), transparent),
            radial-gradient(ellipse 162px 29px at 74.4% 100%, rgba(112,232,60,0.45), transparent),
            radial-gradient(ellipse 67px 29px at 93.9% 0%, rgba(170,250,70,0.45), transparent);
          box-shadow: inset 0 0 9px 1px rgba(255,255,255,0.27);
          pointer-events: none;
          z-index: 1;
          opacity: calc(var(--beam-opacity) * 0.42);
          animation: beam-hue-shift 12s ease-in-out infinite;
        }

        @keyframes beam-spin { to { --beam-angle: 360deg; } }
        @keyframes beam-fade-in { to { --beam-opacity: 1; } }
        @keyframes beam-hue-shift {
          0%, 100% { filter: hue-rotate(-30deg) brightness(1.30) saturate(1.20); }
          50% { filter: hue-rotate(30deg) brightness(1.30) saturate(1.20); }
        }
      `}</style>

      <div className="flex flex-col items-center gap-1">
        {/* Logo */}
        <img
          src="/10d90591-1bbe-4cf6-9753-aa2faa93afbf.png"
          alt="Higgsfield"
          className="w-[3.3125rem] h-[3.3125rem] rounded-md object-cover drop-shadow-[0_0_12px_rgba(0,229,255,0.6)]"
        />

        {/* Title */}
        <h2 className="text-center font-bold text-white uppercase max-w-full" style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: "1.75rem",
          lineHeight: "2.5rem",
          letterSpacing: "-0.05rem",
        }}>
          What are we creating today?
        </h2>

        {/* Composer */}
        <div className="w-full max-w-[39.1875rem] mt-1">
          <div className="composer-beam">
            <div
              className="relative bg-[rgba(35,38,42,0.75)] backdrop-blur-[20px] rounded-[24px] p-3 border border-[rgba(255,255,255,0.05)] flex min-h-[84px] flex-col gap-1"
              style={{
                boxShadow: "0 2px 4px -0.5px rgba(0,0,0,0.12), inset 0 2px 3px 0 rgba(255,255,255,0.05)",
              }}
            >
              {/* Input + Placeholder */}
              <div className="relative flex w-full flex-1 items-start px-1 pt-1">
                <div
                  contentEditable
                  role="textbox"
                  spellCheck="true"
                  aria-label="Compose your prompt"
                  className="w-full min-h-10 text-sm leading-5 text-white outline-none break-all overflow-x-hidden overflow-y-auto"
                  style={{
                    maxHeight: "min(10em, 20dvh)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    caretColor: "white",
                  }}
                  onInput={(e) => setInputValue((e.target as HTMLDivElement).textContent || "")}
                />
                <div className="pointer-events-none absolute inset-x-1 top-1 flex h-5 items-center overflow-hidden text-left select-none">
                  <span className="block w-full truncate pr-1 text-sm leading-5 text-white/50">
                    {placeholder}
                  </span>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1">
                  <button className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/90 hover:bg-white/[0.08] transition-colors">
                    <Plus className="size-4" />
                  </button>
                  <button onClick={() => setModelSelectorOpen(true)} className="flex h-8 items-center gap-2 rounded-full px-2 py-1 text-xs font-medium text-white/90 hover:bg-white/[0.04] transition-colors">
                    <svg className="size-4 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M14.8552 3.86851C14.706 3.79542 14.6481 3.93428 14.5616 4.00493C14.5318 4.02807 14.5068 4.05791 14.4818 4.0841C14.2644 4.31797 14.0111 4.47022 13.681 4.45195C13.1962 4.42515 12.7833 4.57802 12.4179 4.95013C12.3405 4.49093 12.0823 4.21748 11.6901 4.04147C11.4842 3.95011 11.2759 3.85876 11.1328 3.66022C11.0323 3.51953 11.0049 3.3618 10.9544 3.2071C10.9227 3.11392 10.8904 3.01831 10.7838 3.00186C10.6669 2.98359 10.6218 3.08104 10.5762 3.16325C10.3935 3.49822 10.3228 3.8685 10.3289 4.24245C10.3453 5.08412 10.6992 5.75405 11.402 6.23152C11.4824 6.28634 11.5031 6.34115 11.4775 6.42093C11.4294 6.58537 11.3728 6.74432 11.3222 6.90815C11.2905 7.01351 11.243 7.03665 11.131 6.99037C10.752 6.82728 10.4078 6.59305 10.117 6.30034C9.61755 5.81495 9.16505 5.27901 8.60109 4.85939C8.47051 4.76237 8.33643 4.67015 8.19913 4.58289C7.62421 4.02137 8.27526 3.56034 8.42569 3.50613C8.58343 3.4495 8.4805 3.25278 7.97075 3.25522C7.46221 3.25765 6.99631 3.42879 6.40312 3.65656C6.31603 3.69128 6.20457 3.74975 6.13149 3.73574C5.57673 3.6316 5.00941 3.61189 4.44876 3.67727C3.34886 3.8009 2.46942 4.32284 1.82386 5.21506C1.04735 6.28694 0.865251 7.50439 1.08876 8.77542C1.32324 10.1134 2.00352 11.2231 3.04982 12.0897C4.13389 12.9874 5.38239 13.4278 6.8069 13.3431C7.67172 13.2938 8.6358 13.1768 9.7217 12.2536C9.99576 12.39 10.2832 12.4442 10.7613 12.4856C11.1285 12.5203 11.4824 12.4673 11.7564 12.4107C12.1852 12.3193 12.1554 11.921 12.0001 11.8467C10.7424 11.2584 11.0183 11.4978 10.7674 11.3047C11.4069 10.5446 12.3703 9.75534 12.7467 7.19926C12.7766 6.99585 12.751 6.86856 12.7467 6.70352C12.7449 6.60425 12.7674 6.56466 12.8807 6.55309C13.1968 6.52008 13.5035 6.42553 13.7833 6.27476C14.5982 5.82774 14.9203 5.09386 14.9983 4.21321C15.0099 4.07923 14.9959 3.93915 14.8546 3.86911M7.7582 11.7925C6.53893 10.8303 5.94818 10.5136 5.70396 10.527C5.47557 10.5398 5.51638 10.8023 5.56693 10.9734C5.6193 11.1421 5.68751 11.2584 5.78374 11.4064C5.85012 11.5051 5.8958 11.6512 5.71796 11.7596C5.32514 12.0051 4.64243 11.678 4.60954 11.6622C3.81598 11.1933 3.15153 10.572 2.68319 9.72428C2.2319 8.90697 1.96941 8.03119 1.92617 7.09634C1.91399 6.86978 1.98099 6.79 2.20389 6.74919C2.49826 6.69291 2.79988 6.6853 3.09672 6.72666C4.34096 6.90937 5.40005 7.46845 6.28801 8.35276C6.79472 8.85764 7.17841 9.45936 7.57306 10.0477C7.99328 10.6731 8.44518 11.2682 9.02071 11.7554C9.22351 11.9265 9.38612 12.0568 9.54082 12.1531C9.07308 12.2048 8.29231 12.2164 7.7582 11.7925ZM8.34286 8.01719C8.34286 7.9697 8.36173 7.92415 8.39531 7.89058C8.42889 7.857 8.47443 7.83813 8.52192 7.83813C8.5694 7.83813 8.61495 7.857 8.64853 7.89058C8.68211 7.92415 8.70097 7.9697 8.70097 8.01719C8.70113 8.0409 8.69658 8.06442 8.68758 8.08636C8.67857 8.10831 8.6653 8.12825 8.64853 8.14502C8.63176 8.16179 8.61182 8.17506 8.58988 8.18406C8.56793 8.19307 8.54442 8.19762 8.5207 8.19746C8.49704 8.19771 8.47357 8.1932 8.45169 8.18421C8.42981 8.17521 8.40996 8.16191 8.39331 8.1451C8.37667 8.12828 8.36357 8.1083 8.3548 8.08632C8.34603 8.06435 8.34176 8.04084 8.34225 8.01719M10.1571 8.95326C10.0402 9.00076 9.92389 9.04217 9.81244 9.04705C9.64461 9.05231 9.48009 8.99962 9.34654 8.89784C9.18697 8.76385 9.07248 8.68894 9.02375 8.45325C9.00771 8.33861 9.011 8.22209 9.0335 8.10854C9.07491 7.9167 9.02863 7.79428 8.89464 7.68222C8.78502 7.59087 8.64616 7.56651 8.49268 7.56651C8.43998 7.56421 8.38877 7.54826 8.34408 7.52022C8.28013 7.48794 8.22776 7.40816 8.2777 7.31011C8.30948 7.26434 8.34739 7.22315 8.39037 7.18769C8.59744 7.06893 8.83739 7.10852 9.05908 7.19683C9.26432 7.28148 9.41962 7.43617 9.64313 7.65481C9.87152 7.91913 9.91232 7.99282 10.0427 8.19076C10.145 8.34667 10.2394 8.50623 10.3033 8.68894C10.3417 8.80222 10.2911 8.89601 10.1571 8.95326Z" />
                    </svg>
                    <span className="flex items-center gap-1 text-[11px]">
                      <span className="shrink-0">DeepSeek</span>
                      <span className="text-white/50 truncate">V4 Pro</span>
                    </span>
                    <ChevronDown className="size-3" />
                  </button>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <button className="flex h-8 items-center gap-0.5 rounded-full pl-3 pr-2 py-1 text-xs font-medium text-white/90 hover:bg-white/[0.04] transition-colors">
                    <span className="truncate">Ask</span>
                    <ChevronDown className="size-4" />
                  </button>

                  <button disabled={!inputValue} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/20 hover:bg-white/30 disabled:bg-white/10 disabled:opacity-50 transition-opacity">
                    <svg className="size-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path fillRule="evenodd" clipRule="evenodd" d="M12 3C12.3315 3 12.6494 3.1317 12.8839 3.36612L18.6339 9.11612C19.122 9.60427 19.122 10.3957 18.6339 10.8839C18.1457 11.372 17.3543 11.372 16.8661 10.8839L13.25 7.26776V19.75C13.25 20.4404 12.6903 21 12 21C11.3096 21 10.75 20.4404 10.75 19.75V7.26777L7.13388 10.8839C6.64573 11.372 5.85427 11.372 5.36612 10.8839C4.87796 10.3957 4.87796 9.60427 5.36612 9.11612L11.1161 3.36612C11.3505 3.1317 11.6685 3 12 3Z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex w-full justify-center overflow-x-auto px-2 mt-2">
          <div className="flex items-center gap-2 p-0.5">
            {[
              { label: "Image", icon: "🖼️" },
              { label: "Video", icon: "🎥" },
              { label: "Run marketing", icon: "📊", badge: "HOT" },
              { label: "Create a design", icon: "🎨" },
              { label: "Build websites", icon: "🌐" },
            ].map((btn) => (
              <button
                key={btn.label}
                className="flex items-center gap-2 h-9 px-3 py-2 rounded-full bg-[#23262a] border border-[rgba(255,255,255,0.05)] text-white text-sm font-semibold hover:bg-[rgba(255,255,255,0.05)] transition-colors flex-shrink-0"
              >
                <span>{btn.icon}</span>
                <span>{btn.label}</span>
                {btn.badge && (
                  <span style={{
                    transform: "scaleY(0.98) skewX(-10.89deg)",
                    background: "linear-gradient(90deg, #ED1572 0%, #EE4596 100%)",
                    padding: "0 4px",
                    borderRadius: "2px",
                    fontWeight: 700,
                    fontSize: "10px",
                    color: "white",
                    marginLeft: "4px",
                  }}>
                    {btn.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
