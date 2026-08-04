import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { IconButton } from "./Button";
import { cx } from "./utils";
import "./Dialog.css";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function Dialog({ open, onOpenChange, title, children, footer, closeLabel, className, descriptionId, dismissible = true, busy = false }: { open: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; children: ReactNode; footer?: ReactNode; closeLabel: string; className?: string; descriptionId?: string; dismissible?: boolean; busy?: boolean }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  const dismissibleRef = useRef(dismissible);
  onOpenChangeRef.current = onOpenChange;
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const focusable = () => dialog ? [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.tabIndex >= 0) : [];
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (focusable()[0] ?? dialog)?.focus();
    const appRoot = document.getElementById("root");
    const rootWasInert = appRoot?.hasAttribute("inert") ?? false;
    const previousAriaHidden = appRoot?.getAttribute("aria-hidden") ?? null;
    appRoot?.setAttribute("inert", "");
    appRoot?.setAttribute("aria-hidden", "true");

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissibleRef.current) {
        event.preventDefault();
        onOpenChangeRef.current(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const elements = focusable();
      if (elements.length === 0) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && (document.activeElement === elements[0] || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        elements[elements.length - 1].focus();
      } else if (!event.shiftKey && (document.activeElement === elements[elements.length - 1] || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        elements[0].focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (appRoot) {
        if (!rootWasInert) appRoot.removeAttribute("inert");
        if (previousAriaHidden === null) appRoot.removeAttribute("aria-hidden");
        else appRoot.setAttribute("aria-hidden", previousAriaHidden);
      }
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(<div className="ui-dialog-backdrop" onMouseDown={() => { if (dismissible) onOpenChange(false); }}><section ref={dialogRef} className={cx("ui-dialog", className)} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}><header className="ui-dialog__header"><h2 id={titleId}>{title}</h2><IconButton variant="ghost" size="sm" label={closeLabel} icon={<X />} disabled={!dismissible} onClick={() => onOpenChange(false)} /></header><div className="ui-dialog__body">{children}</div>{footer && <footer className="ui-dialog__footer">{footer}</footer>}</section></div>, document.body);
}
