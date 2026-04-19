import * as React from "react";
import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  decoration?: "tape" | "tack";
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, decoration, children, style, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("relative bg-white border-2 border-[#2d2d2d]", className)}
      style={{ borderRadius: "var(--radius-wobbly-alt)", boxShadow: "var(--shadow-hard)", ...style }}
      {...props}
    >
      {decoration === "tape" && (
        <div
          className="absolute -top-4 left-1/2 z-10 h-7 w-20 pointer-events-none"
          style={{
            background: "rgba(200,200,200,0.55)",
            transform: "translateX(-50%) rotate(-1.5deg)",
            border: "1px solid rgba(150,150,150,0.3)",
            borderRadius: "2px",
          }}
        />
      )}
      {decoration === "tack" && (
        <div
          className="absolute -top-3.5 left-1/2 z-10 h-7 w-7 pointer-events-none"
          style={{
            background: "#ff4d4d",
            borderRadius: "50%",
            transform: "translateX(-50%)",
            border: "2px solid #2d2d2d",
            boxShadow: "2px 2px 0px rgba(0,0,0,0.2)",
          }}
        />
      )}
      {children}
    </div>
  ),
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("font-heading text-xl font-bold leading-tight", className)} {...props} />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-[#888888]", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
