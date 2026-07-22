import { cloneElement, isValidElement, useContext, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { cx } from "./utils";
import { isInPopoverBranch, PopoverBranchContext } from "./PopoverTree";
import "./Popover.css";

export function Popover({ trigger, children, title, align = "end", open, onOpenChange, className, rootClassName, surface = "default" }: {
  trigger: ReactElement;
  children: ReactNode;
  title?: ReactNode;
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  /** Class applied to the anchor wrapper; useful for a page's responsive layout. */
  rootClassName?: string;
  /** Menu surfaces retain the compact spacing of the former dropdowns. */
  surface?: "default" | "menu";
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const parentBranch = useContext(PopoverBranchContext);
  const popoverId = useId();
  const branch = [...parentBranch, popoverId];
  const actualOpen = open ?? internalOpen;
  const [present, setPresent] = useState(actualOpen);
  const [closing, setClosing] = useState(false);
  const setOpen = (next: boolean) => { if (open === undefined) setInternalOpen(next); onOpenChange?.(next); };

  useEffect(() => {
    if (actualOpen) {
      setPresent(true);
      setClosing(false);
      return;
    }
    if (!present) return;
    setClosing(true);
    const timer = window.setTimeout(() => setPresent(false), 160);
    return () => window.clearTimeout(timer);
  }, [actualOpen, present]);

  useEffect(() => {
    if (!actualOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !isInPopoverBranch(event.target, popoverId)) setOpen(false);
    };
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

  return <PopoverBranchContext.Provider value={branch}>
    <div className={cx("ui-popover", rootClassName)} ref={rootRef} data-popover-branch={branch.join(" ")}>
      {triggerElement}
      {present && <div className={cx("ui-popover__content", `ui-popover__content--${align}`, `ui-popover__content--${surface}`, className)} role="dialog" data-state={closing ? "closed" : "open"}>
        {title && <div className="ui-popover__title">{title}</div>}
        {children}
      </div>}
    </div>
  </PopoverBranchContext.Provider>;
}
