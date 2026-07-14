const PREFIX = "__ytz:";

export const emit = (name: string) =>
  window.dispatchEvent(new CustomEvent(PREFIX + name));

export type ToastVariant = "default" | "scheduled";

export const emitToast = (message: string, variant: ToastVariant = "default") =>
  window.dispatchEvent(new CustomEvent(PREFIX + "toast", { detail: { message, variant } }));

export const subscribe = (name: string, fn: () => void): (() => void) => {
  const key = PREFIX + name;
  window.addEventListener(key, fn);
  return () => window.removeEventListener(key, fn);
};

export const subscribeToast = (fn: (message: string, variant: ToastVariant) => void): (() => void) => {
  const key = PREFIX + "toast";
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ message: string; variant: ToastVariant }>).detail;
    if (detail?.message) fn(detail.message, detail.variant ?? "default");
  };
  window.addEventListener(key, listener);
  return () => window.removeEventListener(key, listener);
};
