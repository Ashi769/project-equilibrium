import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center border-2 border-[#2d2d2d] px-3 py-1 text-sm font-medium transition-colors",
  {
    variants: {
      variant: {
        default:     "bg-[#fff9c4] text-[#2d2d2d]",
        secondary:   "bg-[#e5e0d8] text-[#2d2d2d]",
        success:     "bg-white text-[#2d5da1] border-[#2d5da1]",
        destructive: "bg-white text-[#ff4d4d] border-[#ff4d4d]",
        outline:     "bg-transparent text-[#2d2d2d]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, style, ...props }: BadgeProps) {
  return (
    <div
      className={cn(badgeVariants({ variant }), className)}
      style={{ borderRadius: "var(--radius-wobbly-sm)", ...style }}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
