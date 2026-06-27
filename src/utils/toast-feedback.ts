import { toast } from "sonner";

export type ToastTempo = "quick" | "default" | "long";

const TOAST_DURATION_BY_TEMPO: Record<ToastTempo, number> = {
  quick: 1600,
  default: 2800,
  long: 4200,
};

const resolveDuration = (tempo?: ToastTempo): number =>
  TOAST_DURATION_BY_TEMPO[tempo || "default"];

const SUCCESS_STYLE = {
  background: "var(--color-background-positive-faded)",
  color: "var(--color-foreground-positive)",
  borderColor: "var(--color-border-positive-faded)",
} as const;

const ERROR_STYLE = {
  background: "var(--color-background-danger-faded)",
  color: "var(--color-foreground-danger)",
  borderColor: "var(--color-border-danger-faded)",
} as const;

const LOADING_STYLE = {
  background: "var(--background-neutral)",
  color: "var(--foreground-secondary)",
  borderColor: "var(--border-neutral-faded)",
} as const;

export const resolveToastErrorMessage = (
  error: unknown,
  fallback = "Something went wrong."
): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
};

export const showLoadingToast = (message: string, tempo: ToastTempo = "default") =>
  toast.loading(message, {
    duration: resolveDuration(tempo),
    style: LOADING_STYLE,
  });

export const showSuccessToast = (
  message: string,
  options?: { id?: string | number; tempo?: ToastTempo }
) =>
  toast.success(message, {
    id: options?.id,
    duration: resolveDuration(options?.tempo),
    style: SUCCESS_STYLE,
  });

export const showErrorToast = (
  message: string,
  options?: { id?: string | number; tempo?: ToastTempo }
) =>
  toast.error(message, {
    id: options?.id,
    duration: resolveDuration(options?.tempo || "long"),
    style: ERROR_STYLE,
  });

export const withToast = async <T,>({
  loading,
  success,
  error,
  loadingTempo,
  successTempo,
  errorTempo,
  action,
}: {
  loading: string;
  success: string | ((value: T) => string);
  error?: string | ((reason: unknown) => string);
  loadingTempo?: ToastTempo;
  successTempo?: ToastTempo;
  errorTempo?: ToastTempo;
  action: () => Promise<T>;
}): Promise<T> => {
  const id = showLoadingToast(loading, loadingTempo);
  try {
    const value = await action();
    showSuccessToast(typeof success === "function" ? success(value) : success, {
      id,
      tempo: successTempo,
    });
    return value;
  } catch (reason) {
    const message =
      typeof error === "function"
        ? error(reason)
        : error || resolveToastErrorMessage(reason);
    showErrorToast(message, { id, tempo: errorTempo });
    throw reason;
  }
};
