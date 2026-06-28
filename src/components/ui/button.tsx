import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@src/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap text-sm font-medium outline-none transition-[transform,background-color,border-color,box-shadow,color] duration-150 ease-out hover:shadow-md hover:shadow-platinum active:shadow-sm active:shadow-platinum focus-visible:ring-2 focus-visible:ring-border-neutral/80 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-border-danger",
  {
    variants: {
      variant: {
        default: "bg-accent text-white hover:bg-accent-secondary rounded-lg",
        destructive: "bg-background-danger text-white hover:bg-background-danger/90 rounded-lg",
        outline:
          "border border-border-neutral-faded/50 hover:border-border-neutral-faded/80 active:shadow-none bg-background-neutral-faded hover:bg-background-neutral hover:text-foreground-neutral rounded-lg",
        secondary:
          "bg-background-neutral-faded text-foreground-neutral hover:bg-background-neutral-faded/80 hover:shadow-md hover:shadow-platinum active:shadow-sm active:shadow-platinum rounded-lg",
        ghost:
          "shadow-none hover:shadow-none hover:bg-background-neutral-faded hover:text-foreground-neutral rounded-lg",
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
  static: isStatic = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    static?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }), !isStatic && "active:not-disabled:scale-[0.96]")}
      {...props}
    />
  );
}

export { Button, buttonVariants };
