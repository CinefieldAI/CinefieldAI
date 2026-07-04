import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none whitespace-nowrap transition-colors",
  {
    variants: {
      variant: {
        default: "border-white/10 bg-white/10 text-zinc-300",
        new: "border-transparent bg-magenta-500/15 text-magenta-400",
        pro: "border-transparent bg-gradient-to-r from-magenta-500 to-magenta-600 text-white",
        top: "border-transparent bg-white text-black",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
