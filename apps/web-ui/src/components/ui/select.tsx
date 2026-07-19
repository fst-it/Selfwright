import * as React from "react";
import { cn } from "../../lib/utils.js";

// A native <select>, styled — shadcn/ui's own Select is a Radix wrapper, but
// a native element gives free keyboard/a11y support with zero extra
// dependency for the one place this cockpit needs a dropdown (status choice).
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-9 rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
          "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";
