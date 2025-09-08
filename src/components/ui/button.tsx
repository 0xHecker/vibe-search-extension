import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@src/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap shadow-sm shadow-foreground-muted/60 hover:shadow-md hover:shadow-foreground-muted/80 active:shadow-sm active:shadow-foreground-muted/60 duration-400 ease-in-out text-sm font-medium transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50 shrink-0 [&_svg]:shrink-0 outline-none aria-invalid:border-border-danger",
  {
    variants: {
      variant: {
        default: "bg-accent text-white hover:bg-accent-secondary rounded-md",
        destructive: "bg-background-danger text-white hover:bg-background-danger/90 rounded-md",
        outline:
          "border border-border-neutral-faded/50 hover:border-border-neutral-faded/80 active:shadow-none bg-background-neutral hover:bg-background-neutral hover:text-foreground-neutral rounded-md",
        secondary:
          "bg-background-neutral text-foreground-neutral hover:bg-background-neutral-faded rounded-md",
        ghost:
          "shadow-none hover:shadow-none hover:bg-background-neutral-faded hover:text-foreground-neutral rounded-md",
        link: "text-foreground-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 gap-1.5 px-3",
        lg: "h-10 px-6",
        icon: "p-1 h-8 w-8 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
