import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "lucide-react";

import { cn } from "@src/lib/utils";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "inline-flex size-5 items-center justify-center rounded-xs border border-border-neutral bg-background-neutral text-foreground-neutral transition-all duration-200 hover:border-border-neutral-faded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-neutral/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background data-[state=checked]:border-foreground-neutral data-[state=checked]:bg-foreground-neutral data-[state=checked]:text-background-neutral disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="pointer-events-none flex items-center justify-center text-current"
      >
        <CheckIcon className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
