import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { IconButton } from "./Button";
import { cx } from "./utils";
import "./Dialog.css";

export function Dialog({ open, onOpenChange, title, children, footer, closeLabel, className }: { open: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; children: ReactNode; footer?: ReactNode; closeLabel: string; className?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onOpenChange(false); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);
  if (!open) return null;
  return createPortal(<div className="ui-dialog-backdrop" onMouseDown={() => onOpenChange(false)}><section className={cx("ui-dialog", className)} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header className="ui-dialog__header"><h2>{title}</h2><IconButton variant="ghost" size="sm" label={closeLabel} icon={<X />} onClick={() => onOpenChange(false)} /></header><div className="ui-dialog__body">{children}</div>{footer && <footer className="ui-dialog__footer">{footer}</footer>}</section></div>, document.body);
}
