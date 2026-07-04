import { Aperture, Move3d, Orbit, ScanEye } from "lucide-react";

const CONTROLS = [
  { icon: Orbit, label: "Orbit" },
  { icon: Move3d, label: "Dolly" },
  { icon: Aperture, label: "Focus pull" },
  { icon: ScanEye, label: "Tracking shot" },
];

export default function CameraControl() {
  return (
    <section className="relative overflow-hidden border-b border-white/10">
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 h-[600px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-emerald-500/15 via-lime-500/10 to-transparent blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-6 py-24 text-center">
        <h2 className="mx-auto max-w-3xl text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
          THE ULTIMATE AI-POWERED
          <br />
          <span className="text-zinc-500">CAMERA CONTROL FOR FILMMAKERS</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-zinc-400">
          Direct your shot like a cinematographer pan, dolly, orbit, and
          rack focus with natural-language precision.
        </p>

        <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {CONTROLS.map((control) => {
            const Icon = control.icon;
            return (
              <div
                key={control.label}
                className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-7 transition-colors hover:bg-white/[0.06]"
              >
                <Icon className="mx-auto h-6 w-6 text-lime-300" />
                <p className="mt-3 text-sm font-medium text-zinc-200">
                  {control.label}
                </p>
              </div>
            );
          })}
        </div>

        <div className="relative mx-auto mt-14 aspect-video max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-900 via-black to-zinc-950">
          <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(190,242,100,0.1),transparent_45%)]" />
          <div className="absolute inset-6 rounded-xl border border-dashed border-white/15" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Aperture className="h-10 w-10 text-white/20" />
          </div>
        </div>
      </div>
    </section>
  );
}
