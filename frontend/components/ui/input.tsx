import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, style, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-12 w-full border-2 border-[#2d2d2d] bg-white px-4 py-2 text-base text-[#2d2d2d] placeholder:text-[#b0a898] focus-visible:outline-none focus-visible:border-[#2d5da1] focus-visible:ring-2 focus-visible:ring-[#2d5da1]/20 disabled:cursor-not-allowed disabled:opacity-40 transition-colors shadow-[2px_2px_0px_0px_#2d2d2d] focus-visible:shadow-[2px_2px_0px_0px_#2d5da1]",
        className,
      )}
      style={{
        fontFamily: "'Patrick Hand', system-ui, sans-serif",
        borderRadius: "var(--radius-wobbly-sm)",
        ...style,
      }}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
