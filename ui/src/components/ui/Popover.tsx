import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { cx } from "./utils";

export function Popover({ trigger, children, title, align = "end", open, onOpenChange, className }: {
  trigger: ReactElement;
  children: ReactNode;
  title?: ReactNode;
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const actualOpen = open ?? internalOpen;
  const setOpen = (next: boolean) => { if (open === undefined) setInternalOpen(next); onOpenChange?.(next); };

  useEffect(() => {
    if (!actualOpen) return;
    const onPointerDown = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("mousedown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [actualOpen]);

  const triggerElement = isValidElement(trigger) ? cloneElement(trigger as ReactElement<Record<string, unknown>>, {
    "aria-expanded": actualOpen,
    onClick: (event: React.MouseEvent) => {
      const original = (trigger.props as { onClick?: (event: React.MouseEvent) => void }).onClick;
      original?.(event);
      if (!event.defaultPrevented) setOpen(!actualOpen);
    },
  }) : trigger;

  return <div className="ui-popover" ref={rootRef}>
    {triggerElement}
    {actualOpen && <div className={cx("ui-popover__content", `ui-popover__content--${align}`, className)} role="dialog">
      {title && <div className="ui-popover__title">{title}</div>}
      {children}
    </div>}
  </div>;
}
