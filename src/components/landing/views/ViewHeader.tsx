import { ArrowLeft } from "lucide-react";

interface ViewHeaderProps {
  badge: string;
  title: string;
  description: string;
  onBack: () => void;
}

export default function ViewHeader({
  badge,
  title,
  description,
  onBack,
}: ViewHeaderProps) {
  return (
    <div className="border-b border-white/10 px-6 py-8">
      <button
        type="button"
        onClick={onBack}
        className="mb-5 flex items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Explore
      </button>
      <span className="inline-flex items-center rounded-full bg-magenta-500/10 px-3 py-1 text-xs font-semibold text-magenta-400">
        {badge}
      </span>
      <h1 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
        {title}
      </h1>
      <p className="mt-2 max-w-xl text-sm text-zinc-400">{description}</p>
    </div>
  );
}
