import * as React from "react";

import { cn } from "@src/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-lg border border-border-neutral-faded bg-background-neutral-faded/60 px-3.5 py-2 text-sm text-foreground-neutral outline-none transition-[color,background-color,border-color,box-shadow] placeholder:text-foreground-secondary disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-accent/45 focus-visible:bg-background-neutral focus-visible:ring-[3px] focus-visible:ring-accent/15",
        "aria-invalid:border-border-danger aria-invalid:ring-background-danger/15",
        className
      )}
      {...props}
    />
  );
}

export { Input };
