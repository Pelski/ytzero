import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./Tooltip.css";

export default function Tooltip({ text, pos = "left", delay, className, portal = false, children }: {
  text: string;
  pos?: "left" | "right" | "top" | "bottom";
  /** Delay only the appearance; hiding remains immediate. */
  delay?: number;
  className?: string;
  /** Render above clipping and scrolling containers such as the sidebar. */
  portal?: boolean;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [portalStyle, setPortalStyle] = useState<CSSProperties | null>(null);

  const showPortal = () => {
    if (!portal || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const gap = 7;
    const positions: Record<NonNullable<typeof pos>, CSSProperties> = {
      left: { left: rect.left - gap, top: rect.top + rect.height / 2, transform: "translate(-100%, -50%)" },
      right: { left: rect.right + gap, top: rect.top + rect.height / 2, transform: "translateY(-50%)" },
      top: { left: rect.left + rect.width / 2, top: rect.top - gap, transform: "translate(-50%, -100%)" },
      bottom: { left: rect.left + rect.width / 2, top: rect.bottom + gap, transform: "translateX(-50%)" },
    };
    setPortalStyle(positions[pos]);
  };

  return (
    <span
      ref={anchorRef}
      className={`tooltip-wrap tooltip-wrap--${pos}${delay ? " tooltip-wrap--delayed" : ""}${className ? ` ${className}` : ""}`}
      style={delay ? ({ "--tooltip-delay": `${delay}ms` } as CSSProperties) : undefined}
      onMouseEnter={showPortal}
      onMouseLeave={() => portal && setPortalStyle(null)}
      onFocus={showPortal}
      onBlur={() => portal && setPortalStyle(null)}
    >
      {children}
      {!portal && <span className="tooltip-tip">{text}</span>}
      {portal && portalStyle && createPortal(
        <span className={`tooltip-tip tooltip-tip--portal${className ? ` ${className}-tip` : ""}`} style={portalStyle}>{text}</span>,
        document.body,
      )}
    </span>
  );
}
