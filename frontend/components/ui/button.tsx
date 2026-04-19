import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap transition-all duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d5da1] disabled:pointer-events-none disabled:opacity-40 select-none border-[3px] border-[#2d2d2d] cursor-pointer text-base",
  {
    variants: {
      variant: {
        default:
          "bg-[#e5e0d8] text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d] hover:bg-[#2d2d2d] hover:text-white hover:shadow-[2px_2px_0px_0px_#2d2d2d] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-none active:translate-x-[4px] active:translate-y-[4px]",
        secondary:
          "bg-white text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d] hover:bg-[#2d5da1] hover:text-white hover:shadow-[2px_2px_0px_0px_#2d2d2d] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-none active:translate-x-[4px] active:translate-y-[4px]",
        destructive:
          "bg-white text-[#ff4d4d] border-[#ff4d4d] shadow-[4px_4px_0px_0px_#ff4d4d] hover:bg-[#ff4d4d] hover:text-white hover:shadow-[2px_2px_0px_0px_#ff4d4d] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-none",
        outline:
          "bg-white text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d] hover:bg-[#2d2d2d] hover:text-white hover:shadow-[2px_2px_0px_0px_#2d2d2d] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-none active:translate-x-[4px] active:translate-y-[4px]",
        ghost:
          "bg-transparent border-transparent text-[#888888] shadow-none hover:bg-[#e5e0d8] hover:text-[#2d2d2d] hover:border-[#2d2d2d]",
        link:
          "bg-transparent border-transparent text-[#2d5da1] underline-offset-4 hover:underline shadow-none",
      },
      size: {
        default: "h-12 px-6 py-2",
        sm:      "h-10 px-4 text-sm",
        lg:      "h-14 px-10 text-lg",
        icon:    "h-12 w-12",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, style, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        style={{ borderRadius: "var(--radius-wobbly-btn)", ...style }}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
