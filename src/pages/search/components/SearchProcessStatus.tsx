import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@src/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@src/components/ui/popover";
import { cn } from "@src/lib/utils";

export type SearchProcessRetryAction =
  | "RETRY_QUERY"
  | "TRIGGER_EMBEDDING"
  | "TRIGGER_OCR"
  | "REBUILD_INDEX"
  | "REBUILD_VECTORS"
  | "LOCK_PRIVATE_SPACE"
  | "RETRY_IMPORT";

export type SearchProcessStatusItem = {
  id: string;
  label: string;
  state: "processing" | "success" | "error";
  detail: string;
  updatedAt: number;
  retryAction?: SearchProcessRetryAction;
};

type SearchProcessStatusProps = {
  statuses: SearchProcessStatusItem[];
  retryingId?: string | null;
  onRetry: (status: SearchProcessStatusItem) => void;
};

const stateOrder: Record<SearchProcessStatusItem["state"], number> = {
  error: 0,
  processing: 1,
  success: 2,
};

const stateLabel: Record<SearchProcessStatusItem["state"], string> = {
  error: "Failed",
  processing: "Processing",
  success: "Ready",
};

const formatUpdatedAt = (updatedAt: number): string => {
  const delta = Date.now() - updatedAt;
  if (delta < 3_000) return "just now";
  if (delta < 60_000) return `${Math.max(1, Math.round(delta / 1_000))}s ago`;
  if (delta < 3_600_000) return `${Math.max(1, Math.round(delta / 60_000))}m ago`;
  return `${Math.max(1, Math.round(delta / 3_600_000))}h ago`;
};

export const SearchProcessStatus = ({
  statuses,
  retryingId = null,
  onRetry,
}: SearchProcessStatusProps) => {
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const sortedStatuses = useMemo(
    () =>
      [...statuses].sort((a, b) => {
        const byState = stateOrder[a.state] - stateOrder[b.state];
        if (byState !== 0) return byState;
        return b.updatedAt - a.updatedAt;
      }),
    [statuses]
  );

  const processingCount = sortedStatuses.filter((status) => status.state === "processing").length;
  const errorCount = sortedStatuses.filter((status) => status.state === "error").length;

  const summaryLabel =
    errorCount > 0
      ? `${errorCount} issue${errorCount > 1 ? "s" : ""}`
      : processingCount > 0
        ? `${processingCount} processing`
        : "All systems";

  const dotClassName =
    errorCount > 0
      ? "bg-background-danger"
      : processingCount > 0
        ? "bg-accent-secondary"
        : "bg-background-positive";

  const openPopover = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
  };

  const scheduleClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, 240);
  };

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-2 rounded-full border border-border-neutral-faded px-2.5 text-[11px] text-foreground-secondary transition-colors hover:bg-background-neutral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-neutral/80 focus-visible:ring-offset-1"
          onPointerEnter={openPopover}
          onPointerLeave={scheduleClose}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", dotClassName)} />
          <span>{summaryLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-[360px] p-2"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={openPopover}
        onPointerLeave={scheduleClose}
      >
        <div className="px-2 pt-1 pb-2">
          <div className="text-xs font-semibold text-foreground-neutral">System activity</div>
          <div className="text-[11px] text-foreground-tertiary">
            Background work and search pipeline status.
          </div>
        </div>
        <div className="max-h-[280px] space-y-1 overflow-y-auto pr-0.5">
          {sortedStatuses.length === 0 ? (
            <div className="rounded-lg border border-border-neutral-faded bg-background-page-secondary px-3 py-2 text-xs text-foreground-tertiary">
              No background tasks yet.
            </div>
          ) : (
            sortedStatuses.map((status) => {
              const canRetry = status.state === "error" && !!status.retryAction;
              return (
                <div
                  key={status.id}
                  className="rounded-lg border border-border-neutral-faded bg-background-page-secondary px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-foreground-neutral">
                        {status.label}
                      </div>
                      <div className="truncate text-[11px] text-foreground-secondary">
                        {status.detail}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px]",
                        status.state === "error" &&
                          "border-background-danger/30 bg-background-danger/10 text-background-danger",
                        status.state === "processing" &&
                          "border-accent-secondary/35 bg-accent-secondary/10 text-foreground-neutral",
                        status.state === "success" &&
                          "border-background-positive/30 bg-background-positive/10 text-foreground-neutral"
                      )}
                    >
                      {stateLabel[status.state]}
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <div className="text-[10px] text-foreground-tertiary">
                      Updated {formatUpdatedAt(status.updatedAt)}
                    </div>
                    {canRetry && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => onRetry(status)}
                        disabled={retryingId === status.id}
                      >
                        {retryingId === status.id ? "Retrying..." : "Retry"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
