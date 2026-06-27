import * as React from "react";
import { cn } from "@src/lib/utils";

/**
 * Shared building blocks for the Settings modal's right-hand content pane.
 * Layout contract (from the reference): a section title at the top, then a
 * vertical stack of rows separated by hairline dividers. Each row puts a
 * title + description on the left and an action on the right.
 */

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 pb-1">
      <div className="min-w-0">
        <h2 className="text-[19px] font-semibold leading-tight text-foreground-neutral">{title}</h2>
        {description && (
          <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-foreground-secondary">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** A labelled group of rows (e.g. the "GENERAL" / "CURATE" buckets). */
export function SettingGroup({
  label,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-2", className)}>
      {label && (
        <p className="px-0.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-tertiary">
          {label}
        </p>
      )}
      <div className="divide-y divide-border-neutral-faded">{children}</div>
    </section>
  );
}

/** A single setting row: title + description left, action right. */
export function SettingRow({
  title,
  description,
  children,
  htmlFor,
  align = "center",
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  htmlFor?: string;
  align?: "center" | "start";
  className?: string;
}) {
  const Label = htmlFor ? "label" : "div";
  return (
    <div
      className={cn(
        "flex justify-between gap-6 py-4",
        align === "center" ? "items-center" : "items-start",
        className
      )}
    >
      <Label htmlFor={htmlFor} className={cn("min-w-0", htmlFor && "cursor-pointer")}>
        <div className="text-[14px] font-medium leading-snug text-foreground-neutral">{title}</div>
        {description && (
          <div className="mt-0.5 text-[13px] leading-relaxed text-foreground-secondary">{description}</div>
        )}
      </Label>
      {children != null && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/** Small accessible on/off switch for boolean preferences. */
export function SettingSwitch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-border-neutral/80 focus-visible:ring-offset-1 disabled:opacity-50",
        checked ? "bg-accent" : "bg-gray-100"
      )}
    >
      <span
        className={cn(
          "inline-block size-4 transform rounded-full bg-white shadow-sm transition-transform duration-150",
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

/** Inline status line (success / error / info), with aria-live for SRs. */
export function SettingStatus({
  tone = "info",
  children,
}: {
  tone?: "info" | "success" | "danger" | "warning";
  children: React.ReactNode;
}) {
  if (!children) return null;
  return (
    <p
      aria-live="polite"
      className={cn(
        "mt-3 rounded-md px-3 py-2 text-[13px] leading-relaxed",
        tone === "success" && "bg-background-positive-faded text-foreground-positive",
        tone === "danger" && "bg-background-danger-faded text-foreground-danger",
        tone === "warning" && "bg-background-warning text-foreground-warning",
        tone === "info" && "bg-background-page-secondary text-foreground-secondary"
      )}
    >
      {children}
    </p>
  );
}
