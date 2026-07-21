import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const MASONRY_GAP = 14;

interface WatchPanelProps {
  title: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  ariaLabel?: string;
}

/** Shared shell for the compact informational panels below the watch view. */
export function WatchPanel({ title, children, action, className = "", ariaLabel }: WatchPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const [rowSpan, setRowSpan] = useState(1);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const measure = () => setRowSpan(Math.max(1, Math.ceil(panel.getBoundingClientRect().height + MASONRY_GAP)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={panelRef}
      className={`watch-panel sb-segments${className ? ` ${className}` : ""}`}
      aria-label={ariaLabel}
      style={{ gridRowEnd: `span ${rowSpan}` }}
    >
      <header className="sb-segments-head">
        <div className="sb-segments-heading">
          <span className="sb-segments-label">{title}</span>
        </div>
        {action}
      </header>
      <div className="sb-segments-list">{children}</div>
    </section>
  );
}
