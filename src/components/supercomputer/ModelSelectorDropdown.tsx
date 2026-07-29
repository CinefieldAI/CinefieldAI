"use client";

import { useState, useRef, useEffect } from "react";

interface Model {
  id: string;
  name: string;
  description: string;
  icon: "sparkle" | "star" | "glm" | "claude" | "gemini" | "deepseek" | "kimi" | "gpt" | "grok";
  iconSrc?: string;
  locked?: boolean;
  info?: boolean;
  section: "mode" | "featured" | "all" | "smart";
}

const models: Model[] = [
  // Mode section
  { id: "smart", name: "Smart mode", description: "Deeper thinking, top quality", icon: "sparkle", locked: true, section: "mode" },
  { id: "efficient", name: "Efficient mode", description: "Quick results, lower credits", icon: "star", section: "mode" },

  // Featured
  { id: "glm", name: "GLM 5.2", description: "Open-weight intelligence for complex tasks", icon: "glm", locked: true, section: "featured" },
  { id: "claude-opus-48", name: "Claude Opus 4.8", description: "Best for complex, analytical work", icon: "claude", iconSrc: "/icons8-3d-claude-ai-logo-94.png", locked: true, info: true, section: "featured" },
  { id: "claude-opus-46", name: "Claude Opus 4.6", description: "Best for long-form creative work", icon: "claude", iconSrc: "/icons8-3d-claude-ai-logo-94.png", locked: true, info: true, section: "featured" },
  { id: "gemini-35", name: "Gemini 3.5 Flash", description: "Fast, high-quality responses", icon: "gemini", iconSrc: "/gemini-color.png", section: "featured" },
  { id: "gemini-31", name: "Gemini 3.1 Pro", description: "Powerful, well-rounded model", icon: "gemini", iconSrc: "/gemini-color.png", info: true, section: "featured" },

  // All models
  { id: "gemini-30", name: "Gemini 3.0 Flash", description: "Fast, lightweight everyday model", icon: "gemini", iconSrc: "/gemini-color.png", section: "all" },
  { id: "kimi", name: "Kimi K2.6", description: "Best for agentic coding and long builds", icon: "kimi", iconSrc: "/kimi.png", section: "all" },
  { id: "deepseek-flash", name: "DeepSeek V4 Flash", description: "Fastest and cheapest for high volume", icon: "deepseek", iconSrc: "/deepseek-color.png", section: "all" },
  { id: "deepseek-pro", name: "DeepSeek V4 Pro", description: "Top coding quality at low cost", icon: "deepseek", iconSrc: "/deepseek-color.png", section: "all" },

  // Smart mode only
  { id: "claude-sonnet", name: "Claude Sonnet 4.6", description: "Responsive everyday work", icon: "claude", iconSrc: "/icons8-3d-claude-ai-logo-94.png", locked: true, section: "smart" },
  { id: "gpt-55", name: "GPT-5.5", description: "Best for multi-step tasks", icon: "gpt", iconSrc: "/GPT_Image_-_OpenAI.png", locked: true, info: true, section: "smart" },
  { id: "grok", name: "Grok 4.3", description: "Best for research and analysis", icon: "grok", iconSrc: "/Grok_Imagine_1.5.png", locked: true, section: "smart" },
];

interface Props {
  onClose: () => void;
}

export default function ModelSelectorDropdown({ onClose }: Props) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("deepseek-pro");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredModels = models.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.description.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  const IconBox = ({ icon, src }: { icon: Model["icon"]; src?: string }) => {
    if (src) {
      return (
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/5 bg-white/5 shadow-[0_2px_1.5px_-0.5px_rgba(255,255,255,0.05),inset_0_2px_3px_0_rgba(255,255,255,0.15)] backdrop-blur-md">
          <img src={src} alt="model" className="size-6 object-contain" />
        </span>
      );
    }
    return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/5 bg-white/5 shadow-[0_2px_1.5px_-0.5px_rgba(255,255,255,0.05),inset_0_2px_3px_0_rgba(255,255,255,0.15)] backdrop-blur-md">
      <svg className="size-5 text-white/40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        {icon === "sparkle" && (
          <>
            <path fill="currentColor" stroke="currentColor" d="M16 6.5c.154 0 .293.095.349.24l1.125 2.925a1.5 1.5 0 0 0 .861.861l2.926 1.125a.374.374 0 0 1 0 .698l-2.926 1.125a1.5 1.5 0 0 0-.861.861l-1.125 2.926a.374.374 0 0 1-.698 0l-1.125-2.926a1.5 1.5 0 0 0-.861-.861l-2.926-1.125a.374.374 0 0 1 0-.698l2.926-1.125a1.5 1.5 0 0 0 .861-.861l1.125-2.926A.37.37 0 0 1 16 6.5Z"/>
            <path fill="currentColor" d="m7.24 6.185-.696-1.812a.582.582 0 0 0-1.088 0L4.76 6.185a1 1 0 0 1-.575.575l-1.812.696a.582.582 0 0 0 0 1.088l1.812.696a1 1 0 0 1 .575.575l.696 1.812a.582.582 0 0 0 1.088 0l.696-1.812a1 1 0 0 1 .575-.575l1.812-.696a.582.582 0 0 0 0-1.088L7.815 6.76a1 1 0 0 1-.575-.575M8.89 15.535l-.482-1.255a.437.437 0 0 0-.816 0l-.482 1.255a1 1 0 0 1-.575.575l-1.255.482a.437.437 0 0 0 0 .816l1.255.482a1 1 0 0 1 .575.575l.482 1.255a.437.437 0 0 0 .816 0l.482-1.255a1 1 0 0 1 .575-.575l1.255-.482a.437.437 0 0 0 0-.816l-1.255-.482a1 1 0 0 1-.575-.575"/>
          </>
        )}
        {icon === "star" && (
          <path fill="currentColor" d="M14.013 7a1 1 0 0 1 .934.641l1.344 3.494a1 1 0 0 0 .574.574l3.494 1.344a1 1 0 0 1 .641.934v.026a1 1 0 0 1-.641.934l-3.494 1.344a1 1 0 0 0-.574.574l-1.344 3.494a1 1 0 0 1-.934.641h-.026a1 1 0 0 1-.934-.641l-1.344-3.494a1 1 0 0 0-.574-.574l-3.494-1.344A1 1 0 0 1 7 14.013v-.026a1 1 0 0 1 .641-.934l3.494-1.344a1 1 0 0 0 .574-.574l1.344-3.494A1 1 0 0 1 13.987 7zM7 3c.241 0 .458.149.544.374l.697 1.81a1 1 0 0 0 .574.575l1.811.697a.583.583 0 0 1 0 1.088l-1.81.697a1 1 0 0 0-.575.574l-.697 1.811a.583.583 0 0 1-1.088 0l-.697-1.81a1 1 0 0 0-.574-.575l-1.811-.697a.583.583 0 0 1 0-1.088l1.81-.697a1 1 0 0 0 .575-.574l.697-1.811A.58.58 0 0 1 7 3"/>
        )}
        {icon === "claude" && (
          <path fill="currentColor" d="M5.92405 15.2962L9.85823 13.0903L9.92405 12.8981L9.85823 12.7918H9.66582L9.0076 12.7513L6.75949 12.6906L4.81013 12.6097L2.92152 12.5085L2.44557 12.4073L2 11.8204L2.04557 11.5269L2.44557 11.2588L3.01772 11.3094L4.28354 11.3954L6.18228 11.5269L7.55949 11.6079L9.6 11.8204H9.92405L9.96962 11.6888L9.85823 11.6079L9.77215 11.5269L7.8076 10.1963L5.68101 8.78978L4.56709 7.98027L3.96456 7.57045L3.66076 7.18594L3.52911 6.34607L4.07595 5.74399L4.81013 5.79459L4.99747 5.84518L5.74177 6.4169L7.33165 7.64635L9.4076 9.1743L9.71139 9.42727L9.83291 9.34126L9.8481 9.28055L9.71139 9.05287L8.58228 7.01391L7.37722 4.93954L6.84051 4.07943L6.69873 3.56337C6.6481 3.35087 6.61266 3.17379 6.61266 2.95624L7.23544 2.11131L7.57975 2L8.41013 2.11131L8.75949 2.41487L9.27595 3.59373L10.1114 5.45054L11.4076 7.97521L11.7873 8.72401L11.9899 9.41715L12.0658 9.62965H12.1975V9.50822L12.3038 8.08652L12.5013 6.34101L12.6937 4.09461L12.7595 3.46218L13.0734 2.70326L13.6962 2.29345L14.1823 2.52618L14.5823 3.0979L14.5266 3.46724L14.2886 5.01037L13.8228 7.42879L13.519 9.04781H13.6962L13.8987 8.84543L14.719 7.75765L16.0962 6.03744L16.7038 5.35441L17.4127 4.60056L17.8684 4.24134H18.7291L19.362 5.18239L19.0785 6.15381L18.1924 7.27701L17.4582 8.22818L16.4051 9.64483L15.7468 10.7781L15.8076 10.8692L15.9646 10.854L18.3443 10.3481L19.6304 10.1154L21.1646 9.85226L21.8582 10.1761L21.9342 10.5049L21.6608 11.1778L20.0203 11.5826L18.0962 11.9671L15.2304 12.6451L15.1949 12.6704L15.2354 12.721L16.5266 12.8424L17.0785 12.8728H18.4304L20.9468 13.06L21.6051 13.4951L22 14.0263L21.9342 14.4311L20.9215 14.9471L19.5544 14.6233L16.3646 13.8644L15.2709 13.5912H15.119V13.6823L16.0304 14.5727L17.7013 16.0804L19.7924 18.0233L19.8987 18.5039L19.6304 18.8834L19.3468 18.8429L17.5089 17.4617L16.8 16.8394L15.1949 15.4885H15.0886V15.6302L15.4582 16.1715L17.4127 19.106L17.5139 20.0066L17.3722 20.3L16.8658 20.4771L16.3089 20.3759L15.1646 18.7721L13.9848 16.9658L13.0329 15.3468L12.9165 15.4126L12.3544 21.4586L12.0911 21.7673L11.4835 22L10.9772 21.6155L10.7089 20.9932L10.9772 19.7637L11.3013 18.1599L11.5646 16.8849L11.8025 15.3013L11.9443 14.7751L11.9342 14.7397L11.8177 14.7549L10.6228 16.3941L8.80506 18.848L7.36709 20.386L7.02279 20.5226L6.42532 20.214L6.48101 19.6625L6.81519 19.1718L8.80506 16.642L10.0051 15.0736L10.7797 14.168L10.7747 14.0364H10.7291L5.44304 17.4667L4.50127 17.5882L4.0962 17.2087L4.14684 16.5864L4.33924 16.384L5.92911 15.2912L5.92405 15.2962Z" />
        )}
        {icon === "gemini" && (
          <svg viewBox="0 0 14.373 14.6667" className="size-5 text-white/40">
            <path d="M7.33333 0C9.30998 1.25859e-05 10.9702 0.726833 12.2402 1.91016L10.1367 4.01302C9.37675 3.28643 8.40993 2.91668 7.33333 2.91667C5.42333 2.91667 3.80648 4.20677 3.22982 5.9401L3.17773 6.10612C3.06351 6.49749 3 6.91037 3 7.33333C3 7.81661 3.08318 8.28661 3.22982 8.72656C3.80648 10.4599 5.42333 11.75 7.33333 11.75C8.31989 11.75 9.15978 11.49 9.81641 11.0501L9.95898 10.9492C10.6563 10.4321 11.1206 9.69597 11.2799 8.83659H7.33333V6H14.2402C14.3269 6.47999 14.373 6.98001 14.373 7.5C14.373 9.73327 13.5734 11.6133 12.1868 12.89L11.9538 13.0944C10.7644 14.0894 9.18956 14.6667 7.33333 14.6667C4.46674 14.6667 1.98665 13.0235 0.779948 10.627C0.283375 9.63703 7.19811e-06 8.51654 5.75303e-07 7.33333C-0.000452417 6.18974 0.266614 5.06162 0.779948 4.03971C1.98666 1.64317 4.46676 0 7.33333 0Z" fill="currentColor" />
          </svg>
        )}
        {icon === "deepseek" && (
          <svg viewBox="0 0 16 16" className="size-5 text-white/40">
            <path d="M14.8552 3.86851C14.706 3.79542 14.6481 3.93428 14.5616 4.00493C14.5318 4.02807 14.5068 4.05791 14.4818 4.0841C14.2644 4.31797 14.0111 4.47022 13.681 4.45195C13.1962 4.42515 12.7833 4.57802 12.4179 4.95013C12.3405 4.49093 12.0823 4.21748 11.6901 4.04147C11.4842 3.95011 11.2759 3.85876 11.1328 3.66022C11.0323 3.51953 11.0049 3.3618 10.9544 3.2071C10.9227 3.11392 10.8904 3.01831 10.7838 3.00186C10.6669 2.98359 10.6218 3.08104 10.5762 3.16325C10.3935 3.49822 10.3228 3.8685 10.3289 4.24245C10.3453 5.08412 10.6992 5.75405 11.402 6.23152C11.4824 6.28634 11.5031 6.34115 11.4775 6.42093C11.4294 6.58537 11.3728 6.74432 11.3222 6.90815C11.2905 7.01351 11.243 7.03665 11.131 6.99037C10.752 6.82728 10.4078 6.59305 10.117 6.30034C9.61755 5.81495 9.16505 5.27901 8.60109 4.85939C8.47051 4.76237 8.33643 4.67015 8.19913 4.58289C7.62421 4.02137 8.27526 3.56034 8.42569 3.50613C8.58343 3.4495 8.4805 3.25278 7.97075 3.25522C7.46221 3.25765 6.99631 3.42879 6.40312 3.65656C6.31603 3.69128 6.20457 3.74975 6.13149 3.73574C5.57673 3.6316 5.00941 3.61189 4.44876 3.67727C3.34886 3.8009 2.46942 4.32284 1.82386 5.21506C1.04735 6.28694 0.865251 7.50439 1.08876 8.77542C1.32324 10.1134 2.00352 11.2231 3.04982 12.0897C4.13389 12.9874 5.38239 13.4278 6.8069 13.3431C7.67172 13.2938 8.6358 13.1768 9.7217 12.2536C9.99576 12.39 10.2832 12.4442 10.7613 12.4856C11.1285 12.5203 11.4824 12.4673 11.7564 12.4107C12.1852 12.3193 12.1554 11.921 12.0001 11.8467C10.7424 11.2584 11.0183 11.4978 10.7674 11.3047C11.4069 10.5446 12.3703 9.75534 12.7467 7.19926C12.7766 6.99585 12.751 6.86856 12.7467 6.70352C12.7449 6.60425 12.7674 6.56466 12.8807 6.55309C13.1968 6.52008 13.5035 6.42553 13.7833 6.27476C14.5982 5.82774 14.9203 5.09386 14.9983 4.21321C15.0099 4.07923 14.9959 3.93915 14.8546 3.86911M7.7582 11.7925C6.53893 10.8303 5.94818 10.5136 5.70396 10.527C5.47557 10.5398 5.51638 10.8023 5.56693 10.9734C5.6193 11.1421 5.68751 11.2584 5.78374 11.4064C5.85012 11.5051 5.8958 11.6512 5.71796 11.7596C5.32514 12.0051 4.64243 11.678 4.60954 11.6622C3.81598 11.1933 3.15153 10.572 2.68319 9.72428C2.2319 8.90697 1.96941 8.03119 1.92617 7.09634C1.91399 6.86978 1.98099 6.79 2.20389 6.74919C2.49826 6.69291 2.79988 6.6853 3.09672 6.72666C4.34096 6.90937 5.40005 7.46845 6.28801 8.35276C6.79472 8.85764 7.17841 9.45936 7.57306 10.0477C7.99328 10.6731 8.44518 11.2682 9.02071 11.7554C9.22351 11.9265 9.38612 12.0568 9.54082 12.1531C9.07308 12.2048 8.29231 12.2164 7.7582 11.7925ZM8.34286 8.01719C8.34286 7.9697 8.36173 7.92415 8.39531 7.89058C8.42889 7.857 8.47443 7.83813 8.52192 7.83813C8.5694 7.83813 8.61495 7.857 8.64853 7.89058C8.68211 7.92415 8.70097 7.9697 8.70097 8.01719C8.70113 8.0409 8.69658 8.06442 8.68758 8.08636C8.67857 8.10831 8.6653 8.12825 8.64853 8.14502C8.63176 8.16179 8.61182 8.17506 8.58988 8.18406C8.56793 8.19307 8.54442 8.19762 8.5207 8.19746C8.49704 8.19771 8.47357 8.1932 8.45169 8.18421C8.42981 8.17521 8.40996 8.16191 8.39331 8.1451C8.37667 8.12828 8.36357 8.1083 8.3548 8.08632C8.34603 8.06435 8.34176 8.04084 8.34225 8.01719M10.1571 8.95326C10.0402 9.00076 9.92389 9.04217 9.81244 9.04705C9.64461 9.05231 9.48009 8.99962 9.34654 8.89784C9.18697 8.76385 9.07248 8.68894 9.02375 8.45325C9.00771 8.33861 9.011 8.22209 9.0335 8.10854C9.07491 7.9167 9.02863 7.79428 8.89464 7.68222C8.78502 7.59087 8.64616 7.56651 8.49268 7.56651C8.43998 7.56421 8.38877 7.54826 8.34408 7.52022C8.28013 7.48794 8.22776 7.40816 8.2777 7.31011C8.30948 7.26434 8.34739 7.22315 8.39037 7.18769C8.59744 7.06893 8.83739 7.10852 9.05908 7.19683C9.26432 7.28148 9.41962 7.43617 9.64313 7.65481C9.87152 7.91913 9.91232 7.99282 10.0427 8.19076C10.145 8.34667 10.2394 8.50623 10.3033 8.68894C10.3417 8.80222 10.2911 8.89601 10.1571 8.95326Z" fill="currentColor" />
          </svg>
        )}
        {icon === "kimi" && (
          <svg viewBox="0 0 16 16" className="size-5 text-white/40">
            <path d="M1.61361 10.8673L7.1781 12.3558C7.17061 12.7514 7.18229 13.1471 7.2131 13.5416L10.6874 14.4707C9.65692 14.896 8.53975 15.069 7.4289 14.9753C5.05525 14.7787 3.01428 13.2906 1.94792 11.0904C1.83085 10.8517 1.72596 10.6071 1.6336 10.3577L1.61361 10.8673ZM1.01861 7.48768L7.6412 9.25908C7.53031 9.64522 7.43901 10.0367 7.36765 10.4321L13.6775 12.1201C13.3641 12.5492 13.003 12.9416 12.6013 13.2895L1.38321 10.288C1.16957 9.39994 1.04321 8.4863 1.01861 7.48768ZM1.94792 4.48384L8.91761 6.34804C8.70236 6.70209 8.50571 7.06711 8.32846 7.44164L14.9173 9.20434C14.8355 9.67641 14.7049 10.1387 14.5276 10.5838L7.79 8.78143L1.07226 6.98499C1.27047 6.10954 1.56754 5.27038 1.94792 4.48384ZM4.53908 1.91745L11.122 3.6778C10.7747 3.99309 10.4459 4.32825 10.1374 4.68159L14.7008 5.90239C14.8591 6.40754 14.9595 6.92903 15 7.45684L2.22847 4.04114C2.92112 3.16244 3.6917 2.43002 4.53908 1.91745ZM8.00991 1.0005C9.99502 1.00057 11.8743 1.74018 13.299 3.04254C13.4334 3.16529 13.5631 3.29253 13.6878 3.42384L5.21278 1.5803C6.06175 1.20098 6.99964 1.0005 8.00991 1.0005Z" fill="currentColor" />
          </svg>
        )}
        {icon === "glm" && (
          <svg viewBox="0 0 24 24" className="size-5 text-white/40">
            <path fill="currentColor" d="M12.105 2L9.927 4.953H.653L2.83 2h9.276zM23.254 19.048L21.078 22h-9.242l2.174-2.952h9.244zM24 2L9.264 22H0L14.736 2H24z" />
          </svg>
        )}
        {icon === "gpt" && (
          <svg viewBox="0 0 24 24" className="size-5 text-white/40">
            <path d="M9.79648 9.34799V7.49548C9.79648 7.33946 9.85502 7.22239 9.99146 7.14447L13.7161 4.9995C14.2231 4.70702 14.8276 4.57058 15.4515 4.57058C17.7915 4.57058 19.2736 6.38413 19.2736 8.31455C19.2736 8.451 19.2736 8.60703 19.254 8.76305L15.393 6.501C15.159 6.36456 14.925 6.36456 14.691 6.501L9.79648 9.34799ZM18.4935 16.5631V12.1364C18.4935 11.8634 18.3764 11.6684 18.1425 11.5319L13.248 8.68494L14.847 7.76838C14.9834 7.69046 15.1005 7.69046 15.237 7.76838L18.9615 9.91336C20.0342 10.5374 20.7555 11.8634 20.7555 13.1503C20.7555 14.6322 19.8782 15.9973 18.4935 16.5628V16.5631ZM8.64599 12.663L7.04699 11.7271C6.91054 11.6492 6.85201 11.5321 6.85201 11.3761V7.08614C6.85201 4.99968 8.45101 3.42007 10.6156 3.42007C11.4346 3.42007 12.195 3.69316 12.8386 4.18061L8.99717 6.40369C8.76323 6.54015 8.64617 6.73513 8.64617 7.00822V12.6632L8.64599 12.663ZM12.0878 14.652L9.79648 13.3651V10.6351L12.0878 9.34818L14.3789 10.6351V13.3651L12.0878 14.652ZM13.56 20.5801C12.741 20.5801 11.9806 20.307 11.3369 19.8196L15.1784 17.5964C15.4123 17.46 15.5294 17.2651 15.5294 16.992V11.3369L17.148 12.2729C17.2845 12.3508 17.3429 12.4679 17.3429 12.6239V16.9139C17.3429 19.0003 15.7243 20.5801 13.56 20.5801ZM8.93846 16.2316L5.21387 14.0866C4.14128 13.4625 3.41989 12.1366 3.41989 10.8497C3.41989 9.34818 4.31688 8.00269 5.70131 7.43713V11.8831C5.70131 12.1562 5.81838 12.3512 6.05232 12.4876L10.9274 15.315L9.32842 16.2316C9.19196 16.3096 9.0749 16.3096 8.93846 16.2316ZM8.72408 19.4297C6.52057 19.4297 4.90201 17.772 4.90201 15.7246C4.90201 15.5685 4.92158 15.4125 4.94097 15.2565L8.78243 17.4796C9.01637 17.616 9.2505 17.616 9.48444 17.4796L14.3789 14.6522V16.5047C14.3789 16.6607 14.3204 16.7777 14.1839 16.8557L10.4593 19.0007C9.95233 19.2931 9.3478 19.4297 8.72391 19.4297H8.72408ZM13.56 21.75C15.9195 21.75 17.8889 20.073 18.3376 17.85C20.5215 17.2844 21.9256 15.2369 21.9256 13.1505C21.9256 11.7855 21.3406 10.4595 20.2876 9.50401C20.3851 9.09448 20.4437 8.68494 20.4437 8.27559C20.4437 5.48714 18.1816 3.4005 15.5686 3.4005C15.0422 3.4005 14.5351 3.47842 14.0281 3.65401C13.1505 2.79599 11.9415 2.25 10.6156 2.25C8.25602 2.25 6.28663 3.92691 5.83795 6.14999C3.65402 6.71555 2.25 8.76305 2.25 10.8495C2.25 12.2146 2.83494 13.5405 3.88796 14.496C3.79046 14.9055 3.73194 15.315 3.73194 15.7244C3.73194 18.5128 5.99397 20.5994 8.60703 20.5994C9.13344 20.5994 9.64047 20.5216 10.1475 20.346C11.0249 21.204 12.2339 21.75 13.56 21.75Z" fill="currentColor" />
          </svg>
        )}
        {icon === "grok" && (
          <svg viewBox="0 0 15.9504 15.7338" className="size-5 text-white/40">
            <path d="M6.13811 10.1253L11.5159 6.03026C11.7796 5.82951 12.1564 5.90781 12.282 6.21966C12.9432 7.86421 12.6478 9.84056 11.3323 11.1975C10.0169 12.5544 8.18654 12.852 6.51358 12.1743L4.68601 13.0471C7.30728 14.8953 10.4903 14.4382 12.4794 12.385C14.0571 10.7575 14.5458 8.53911 14.0889 6.53861L14.093 6.54286C13.4304 3.60401 14.2559 2.42932 15.9468 0.0272522C15.9593 0.00944241 15.9359 -0.00988427 15.9207 0.00574013L13.8418 2.15024V2.14312L6.13811 10.1253Z" fill="currentColor" />
            <path d="M5.08028 4.7431C3.47495 6.3976 3.15057 9.2667 5.03199 11.1206L5.03058 11.122L0.0320192 15.7281C0.0143923 15.7443 -0.0100177 15.7227 0.00433676 15.7035C0.304458 15.3021 0.658385 14.9183 1.01204 14.5348L1.03101 14.5143C2.16726 13.2824 3.29344 12.0615 2.60534 10.336C1.68327 8.0251 2.22022 5.3169 3.9277 3.55558C5.70281 1.72591 8.31719 1.26458 10.5009 2.19151C10.984 2.37662 11.405 2.64003 11.7335 2.88494L9.91007 3.7535C8.21227 3.01878 6.26736 3.51856 5.08028 4.7431Z" fill="currentColor" />
          </svg>
        )}
      </svg>
    </span>
    );
  };

  const LockIcon = () => (
    <svg className="size-5 text-white/30" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16.25 9.75V7.25C16.25 4.90279 14.3472 3 12 3C9.65279 3 7.75 4.90279 7.75 7.25V9.75M12 14V17M5.75 21.25H18.25C18.8023 21.25 19.25 20.8023 19.25 20.25V10.75C19.25 10.1977 18.8023 9.75 18.25 9.75H5.75C5.19772 9.75 4.75 10.1977 4.75 10.75V20.25C4.75 20.8023 5.19771 21.25 5.75 21.25Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  const CheckIcon = () => (
    <svg className="size-5 text-white" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6.75 13.0625L9.9 16.25L17.25 7.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  const InfoIcon = () => (
    <svg className="size-4 text-white/50" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 7.375V6.34722M12 16.625V17.6528M14.2257 8.91667C13.7814 8.30226 12.9511 7.88889 12 7.88889H11.7145C10.4531 7.88889 9.43056 8.70694 9.43056 9.71605V9.79449C9.43056 10.5163 9.94031 11.1761 10.7473 11.4989L13.2527 12.5011C14.0597 12.8239 14.5694 13.4837 14.5694 14.2055C14.5694 15.2579 13.503 16.1111 12.1874 16.1111H12C11.0489 16.1111 10.2186 15.6977 9.7743 15.0833M21.25 12C21.25 17.1086 17.1086 21.25 12 21.25C6.89137 21.25 2.75 17.1086 2.75 12C2.75 6.89137 6.89137 2.75 12 2.75C17.1086 2.75 21.25 6.89137 21.25 12Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  const renderSection = (section: string, title: string, icon?: React.ReactNode) => {
    const sectionModels = filteredModels.filter(m => m.section === section);
    if (sectionModels.length === 0) return null;

    if (section === "smart") {
      return (
        <div key={section} className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between gap-2 p-2 text-xs font-medium text-white/50">
            <span className="flex items-center gap-1.5">
              <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor">
                <path fill="currentColor" stroke="currentColor" d="M16 6.5c.154 0 .293.095.349.24l1.125 2.925a1.5 1.5 0 0 0 .861.861l2.926 1.125a.374.374 0 0 1 0 .698l-2.926 1.125a1.5 1.5 0 0 0-.861.861l-1.125 2.926a.374.374 0 0 1-.698 0l-1.125-2.926a1.5 1.5 0 0 0-.861-.861l-2.926-1.125a.374.374 0 0 1 0-.698l2.926-1.125a1.5 1.5 0 0 0 .861-.861l1.125-2.926A.37.37 0 0 1 16 6.5Z"/><path fill="currentColor" d="m7.24 6.185-.696-1.812a.582.582 0 0 0-1.088 0L4.76 6.185a1 1 0 0 1-.575.575l-1.812.696a.582.582 0 0 0 0 1.088l1.812.696a1 1 0 0 1 .575.575l.696 1.812a.582.582 0 0 0 1.088 0l.696-1.812a1 1 0 0 1 .575-.575l1.812-.696a.582.582 0 0 0 0-1.088L7.815 6.76a1 1 0 0 1-.575-.575M8.89 15.535l-.482-1.255a.437.437 0 0 0-.816 0l-.482 1.255a1 1 0 0 1-.575.575l-1.255.482a.437.437 0 0 0 0 .816l1.255.482a1 1 0 0 1 .575.575l.482 1.255a.437.437 0 0 0 .816 0l.482-1.255a1 1 0 0 1 .575-.575l1.255-.482a.437.437 0 0 0 0-.816l-1.255-.482a1 1 0 0 1-.575-.575"/>
              </svg>
              <span>Available in smart mode</span>
            </span>
            <button className="flex h-6 items-center gap-1 rounded-full bg-white px-2 text-[10px] font-medium text-black hover:opacity-90">
              <LockIcon />
              <span>Unlock</span>
            </button>
          </div>
          {sectionModels.map(m => (
            <ModelItem key={m.id} model={m} />
          ))}
        </div>
      );
    }

    return (
      <div key={section} className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2 p-2 text-xs font-medium leading-4 text-white/50">
          {icon}
          <span>{title}</span>
        </div>
        {sectionModels.map(m => (
          <ModelItem key={m.id} model={m} />
        ))}
      </div>
    );
  };

  const ModelItem = ({ model }: { model: Model }) => (
    <button
      onClick={() => {
        if (!model.locked) {
          setSelected(model.id);
        }
      }}
      disabled={model.locked}
      className={`flex h-14 w-full items-center justify-between gap-2 rounded-lg p-2 text-left transition-colors ${
        model.locked ? "" : "hover:bg-white/[0.03] active:bg-white/5"
      } ${model.locked ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span className="flex flex-1 items-center gap-2 min-w-0">
        <IconBox icon={model.icon} src={model.iconSrc} />
        <span className="flex flex-1 flex-col items-start gap-0.5 overflow-hidden min-w-0">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="model-title truncate">{model.name}</span>
            {model.info && <InfoIcon />}
          </span>
          <span className="truncate text-sm font-medium text-[#828282]">{model.description}</span>
        </span>
      </span>
      {model.locked ? <LockIcon /> : selected === model.id && <CheckIcon />}
    </button>
  );

  return (
    <div
      ref={dropdownRef}
      className="fixed z-50 animate-pop-in"
      style={{
        bottom: "auto",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="w-[360px] max-h-[600px] overflow-y-auto custom-scrollbar rounded-[20px] p-2 border border-white/[0.08] backdrop-blur-[20px]"
        style={{
          background: "rgba(30,30,32,0.95)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        {/* Mobile drag handle */}
        <div className="flex md:hidden items-center justify-center py-2">
          <div className="h-1 w-9 rounded-full bg-white/20"></div>
        </div>

        {/* Search bar */}
        <div className="flex h-8 items-center gap-2 rounded-xl p-1.5 text-white/50 mb-1" style={{ background: "rgba(255,255,255,0.05)" }}>
          <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 20L16.1265 16.1265M16.1265 16.1265C17.4385 14.8145 18.25 13.002 18.25 11C18.25 6.99594 15.0041 3.75 11 3.75C6.99594 3.75 3.75 6.99594 3.75 11C3.75 15.0041 6.99594 18.25 11 18.25C13.002 18.25 14.8145 17.4385 16.1265 16.1265Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <input
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/50"
          />
        </div>

        {/* Divider */}
        <div className="my-1 h-px bg-white/[0.06]"></div>

        {/* Sections */}
        <div className="flex flex-col gap-0.5">
          {renderSection("mode", "Mode")}
          {renderSection("featured", "Featured models", (
            <svg className="size-3.5" fill="currentColor" stroke="currentColor" viewBox="0 0 24 24">
              <path fill="currentColor" stroke="currentColor" d="M16 6.5c.154 0 .293.095.349.24l1.125 2.925a1.5 1.5 0 0 0 .861.861l2.926 1.125a.374.374 0 0 1 0 .698l-2.926 1.125a1.5 1.5 0 0 0-.861.861l-1.125 2.926a.374.374 0 0 1-.698 0l-1.125-2.926a1.5 1.5 0 0 0-.861-.861l-2.926-1.125a.374.374 0 0 1 0-.698l2.926-1.125a1.5 1.5 0 0 0 .861-.861l1.125-2.926A.37.37 0 0 1 16 6.5Z"/>
            </svg>
          ))}
          {renderSection("all", "All models")}
          {renderSection("smart", "")}
        </div>
      </div>
    </div>
  );
}
