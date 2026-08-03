"use client";

import { useEffect, useState } from "react";

const BACKGROUNDS = [
  "/JUU36OQ7k76nKTiwQh9fa49_GrMWqPew68Ruy_kmeX0n7lCHU9hr5Lpawl6ScsFzRZbDguHa0W0dC8Ew0VVCXaaneJxcXSDgxBkxalWhPLQw5fioQHkYbClrRA2F8e23g7hu6R8Wb7OaZqro6jpfEd7qtok7u840oy0OMSDSc-GwE4oHv870h0JCzahF-18h.jpg",
  "/ewvdQLNUkUStuLzM0TqzY7MhUMSgXxVgHgr2pSugeXSmloRcwjFcEicd80JN5wHnwQ31yIUZsIrMdg8riK_CSuPUCdpXiztTWNvZUjrZqMbzpl6ggs_ThUv1sMRTzBTdioZGsMfW1eSJk2pfjktjNWnUtGK_pRlKo3rxYqQtBbhdH126zFEmAutlGKmnY9lF.jpg",
  "/S_IInroxd9V7zx_PkQXe3MqHwurUDjtwLvdYyJOXd2QMaBNGPGwXVVQnzRTOf9T80Bvhpn9UbzmfavJnYz2a_IItPobr5cmp3PNRGwqJKz9HZSePKrBo7ImQrp4Dr3539NTwvbPjFYhurYvfroNk7Q96SUh2D606iDQDlCDaMq1MdbpoB0TMISY8puRCbx5y.jpg",
] as const;

export default function ImageAtmosphereBackground() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % BACKGROUNDS.length);
    }, 8000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-black" aria-hidden="true">
      {BACKGROUNDS.map((src, index) => {
        const active = index === activeIndex;

        return (
          <img
            key={src}
            src={src}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-[3200ms] ease-in-out motion-reduce:transform-none motion-reduce:transition-none ${
              active
                ? "translate-y-0 scale-[1.045] opacity-100"
                : "translate-y-2 scale-100 opacity-0"
            }`}
          />
        );
      })}

      <div className="absolute inset-0 bg-black/60" />
      <div className="absolute inset-x-0 bottom-0 h-[36%] bg-black/35" />
    </div>
  );
}
