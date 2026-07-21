import { cloneElement, createElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./utils";

export function FloatingPopover({ trigger, children, open, onOpenChange, align = "start", className, gap = 8 }: { trigger: ReactElement; children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void; align?: "start" | "center" | "end"; className?: string; gap?: number }) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });

  const position = () => {
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    const content = contentRef.current;
    if (!triggerRect || !content) return;
    const margin = 8;
    const width = content.offsetWidth;
    const height = content.offsetHeight;
    const rawLeft = align === "end" ? triggerRect.right - width : align === "center" ? triggerRect.left + triggerRect.width / 2 - width / 2 : triggerRect.left;
    const left = Math.min(Math.max(margin, rawLeft), window.innerWidth - width - margin);
    const below = triggerRect.bottom + gap;
    const top = below + height <= window.innerHeight - margin ? below : Math.max(margin, triggerRect.top - gap - height);
    setStyle({ left, top, visibility: "visible" });
  };

  useLayoutEffect(position, [open, align, gap]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!triggerRef.current?.contains(event.target as Node) && !contentRef.current?.contains(event.target as Node)) onOpenChange(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onOpenChange(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [open, onOpenChange]);

  const triggerElement = isValidElement(trigger) ? cloneElement(trigger as ReactElement<Record<string, unknown>>, { "aria-expanded": open }) : createElement("span", null, trigger);
  return <><span className="ui-floating-popover__trigger" ref={triggerRef} onClick={() => onOpenChange(!open)}>{triggerElement}</span>{open && createPortal(<div ref={contentRef} className={cx("ui-floating-popover__content", className)} style={style} onMouseDown={(event) => event.stopPropagation()}>{children}</div>, document.body)}</>;
}
