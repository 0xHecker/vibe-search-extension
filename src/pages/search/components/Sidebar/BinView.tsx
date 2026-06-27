import * as React from "react";
import { ArchiveRestore, Clock, Trash2 } from "lucide-react";
import { Button } from "@src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@src/components/ui/dialog";
import { formatBinRemainingLabel, type SidebarSpace } from "./sidebar-sort";

export interface BinViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaces: SidebarSpace[];
  now: number;
  onRestore: (space: SidebarSpace) => void;
  onRequestDelete: (space: SidebarSpace) => void;
}

/**
 * Windows-style recycle bin: a focused list of spaces the user moved to the
 * bin, each with how long until it's auto-purged, plus restore and
 * delete-forever actions. Empty state included.
 */
export function BinView({ open, onOpenChange, spaces, now, onRestore, onRequestDelete }: BinViewProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[520px] max-w-[calc(100vw-2rem)] sm:max-w-[520px] gap-0 p-0 overflow-hidden" showCloseButton>
        <DialogHeader className="border-b border-border-neutral-faded px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-[17px]">
            <Trash2 className="size-4 text-foreground-icon" />
            Bin
            {spaces.length > 0 && (
              <span className="rounded-full bg-background-page-secondary px-2 py-0.5 text-xs font-medium text-foreground-secondary">
                {spaces.length}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            Spaces you've moved to the bin are kept here until their countdown ends, then removed automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] min-h-[180px] overflow-y-auto scrollbar-subtle px-3 py-3">
          {spaces.length === 0 ? (
            <div className="flex h-[180px] flex-col items-center justify-center gap-2 text-center">
              <div className="grid size-11 place-items-center rounded-full bg-background-page-secondary">
                <Trash2 className="size-5 text-foreground-tertiary" />
              </div>
              <p className="text-sm font-medium text-foreground-neutral">The bin is empty</p>
              <p className="max-w-[280px] text-[13px] text-foreground-secondary">
                When you move a space to the bin, it shows up here so you can restore it.
              </p>
            </div>
          ) : (
            <ul className="space-y-1">
              {spaces.map((space) => (
                <li
                  key={space.id}
                  className="group flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-background-neutral-faded/60"
                >
                  <div className="grid size-8 shrink-0 place-items-center rounded-md bg-background-page-secondary">
                    <Trash2 className="size-4 text-foreground-tertiary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-foreground-neutral">{space.name}</div>
                    <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-foreground-tertiary">
                      <Clock className="size-3" />
                      {formatBinRemainingLabel(space.purgeAt, now)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => onRestore(space)}>
                      <ArchiveRestore className="size-4" />
                      Restore
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-foreground-tertiary hover:text-foreground-danger"
                      onClick={() => onRequestDelete(space)}
                      title="Delete permanently"
                      aria-label={`Delete ${space.name} permanently`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default BinView;
