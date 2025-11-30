import React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@src/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipArrow = ({ className }: { className?: string }) => {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g id=".Tooltip-arrow">
        <path
          d="M6.34255 8.36218L0 14H18L11.6575 8.36218C10.1419 7.01503 7.85809 7.01503 6.34255 8.36218Z"
          className={cn(
            "fill-background-inverse",
            className === "bg-background-neutral"
              ? "fill-background-neutral"
              : "fill-background-inverse"
          )}
        />
      </g>
    </svg>
  );
};

function getArrowClasses({ side = "top", align = "center" }) {
  // Base arrow positioning classes
  const baseClasses = "absolute block";

  // Position classes based on side and alignment
  const positionClasses = {
    "top-start": "-bottom-1 left-2",
    "top-center": "-bottom-1 left-1/2 -translate-x-1/2",
    "top-end": "-bottom-1 right-2",
    "bottom-start": "-top-1 left-2",
    "bottom-center": "-top-1 left-1/2 -translate-x-1/2",
    "bottom-end": "-top-1 right-2",
    "left-start": "-right-1 top-2",
    "left-center": "-right-1 top-1/2 -translate-y-1/2",
    "left-end": "-right-1 bottom-2",
    "right-start": "-left-1 top-2",
    "right-center": "-left-1 top-1/2 -translate-y-1/2",
    "right-end": "-left-1 bottom-2",
  };

  const key = `${side}-${align}` as keyof typeof positionClasses;
  return `${baseClasses} ${positionClasses[key] || positionClasses["top-center"]}`;
}

const TooltipContent = React.forwardRef(
  (
    {
      className,
      side = "top",
      align = "center",
      bgColor,
      sideOffset = 2,
      children,
      ...props
    }: {
      className?: string;
      side?: "top" | "right" | "bottom" | "left";
      align?: "start" | "center" | "end";
      bgColor?: string;
      sideOffset?: number;
    } & React.ComponentProps<typeof TooltipPrimitive.Content>,
    ref
  ) => {
    return (
      <TooltipPrimitive.Content
        ref={ref as React.Ref<HTMLDivElement>}
        sideOffset={sideOffset}
        className={cn(
          "relative z-50 overflow-hidden animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className
        )}
        {...{ align, side }}
        {...props}
      >
        <div
          className={cn(
            "text-background-neutral text-xs rounded-md px-1.5 py-0.5 shadow-md",
            bgColor ?? "bg-background-inverse/75"
          )}
        >
          {children}
        </div>
      </TooltipPrimitive.Content>
    );
  }
);

TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
