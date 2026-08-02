import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeToast, type ToastVariant } from "../events";

export function useAppToast() {
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const showToast = useCallback((message: string, variant: ToastVariant = "default") => {
    if (toastTimeoutRef.current != null) window.clearTimeout(toastTimeoutRef.current);
    setToast({ message, variant });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 3500);
  }, []);

  useEffect(() => subscribeToast(showToast), [showToast]);
  useEffect(() => () => {
    if (toastTimeoutRef.current != null) window.clearTimeout(toastTimeoutRef.current);
  }, []);

  return { showToast, toast };
}
