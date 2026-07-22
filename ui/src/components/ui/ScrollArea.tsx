import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./utils";
import "./ScrollArea.css";

/** Scrollable viewport with edge shadows that reflect the current scroll position. */
export function ScrollArea({ children, className, viewportClassName }: {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [shadowTop, setShadowTop] = useState(false);
  const [shadowBottom, setShadowBottom] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      const remaining = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      setShadowTop(viewport.scrollTop > 2);
      setShadowBottom(remaining > 2);
    };
    update();
    const resizeObserver = new ResizeObserver(update);
    const mutationObserver = new MutationObserver(update);
    resizeObserver.observe(viewport);
    mutationObserver.observe(viewport, { childList: true, subtree: true });
    viewport.addEventListener("scroll", update, { passive: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return <div className={cx("ui-scroll-area", shadowTop && "ui-scroll-area--shadow-top", shadowBottom && "ui-scroll-area--shadow-bottom", className)}>
    <div ref={viewportRef} className={cx("ui-scroll-area__viewport", viewportClassName)}>{children}</div>
  </div>;
}
