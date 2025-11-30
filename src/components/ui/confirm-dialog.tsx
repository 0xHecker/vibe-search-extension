import { ReactNode, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import { Button } from "@components/ui/button";
import { cn } from "@src/lib/utils";
import type { LucideIcon } from "lucide-react";

export type ConfirmDialogVariant = "danger" | "warning" | "info";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmDialogVariant;
  icon?: LucideIcon | ReactNode;
  onConfirm: () => Promise<void> | void;
  isConfirmDisabled?: boolean;
  confirmButtonClassName?: string;
  cancelButtonClassName?: string;
}

// Map dialog tone to standard Button variant
const getConfirmButtonVariant = (variant: ConfirmDialogVariant): "destructive" | "default" =>
  variant === "danger" ? "destructive" : "default";

export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  icon,
  onConfirm,
  isConfirmDisabled = false,
  confirmButtonClassName,
  cancelButtonClassName,
}: ConfirmDialogProps) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const IconEl = useMemo(() => {
    if (!icon) return null;
    if (typeof icon === "function") {
      const Component = icon as LucideIcon;
      return <Component className="size-5" />;
    }
    return icon;
  }, [icon]);

  const handleOpenChange = (next: boolean) => {
    if (isConfirming) return;
    onOpenChange(next);
    if (!next) setError(null);
  };

  const handleConfirm = async () => {
    if (isConfirmDisabled) return;
    try {
      setError(null);
      setIsConfirming(true);
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
          ? err
          : "Something went wrong.";
      setError(message);
    } finally {
      setIsConfirming(false);
    }
  };

  const confirmVariant: "destructive" | "default" = getConfirmButtonVariant(variant);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn("sm:max-w-md")}
        onPointerDownOutside={(event) => {
          if (isConfirming) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (isConfirming) event.preventDefault();
        }}
      >
        <div className="flex flex-col gap-4">
          <DialogHeader className="text-left">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              {IconEl}
              {title}
            </DialogTitle>
            {description ? (
              <DialogDescription className="text-sm text-foreground-secondary">
                {description}
              </DialogDescription>
            ) : null}
          </DialogHeader>

          {error ? <p className="text-sm text-foreground-danger">{error}</p> : null}

          <DialogFooter className="gap-2 sm:justify-end">
            {cancelLabel ? (
              <Button
                type="button"
                variant="secondary"
                className={cn("w-full sm:w-auto", cancelButtonClassName)}
                disabled={isConfirming}
                onClick={() => handleOpenChange(false)}
              >
                {cancelLabel}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={confirmVariant}
              className={cn("w-full sm:w-auto", confirmButtonClassName)}
              disabled={isConfirming || isConfirmDisabled}
              onClick={handleConfirm}
            >
              {isConfirming ? "Processing…" : confirmLabel}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
