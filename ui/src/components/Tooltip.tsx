import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getTooltipPosition, type TooltipSide } from "./tooltipPosition";
import "./Tooltip.css";

export default function Tooltip({ text, pos = "left", delay, className, portal = false, open, children }: {
  text: string;
  pos?: TooltipSide;
  /** Delay only the appearance; hiding remains immediate. */
  delay?: number;
  className?: string;
  /** Render above clipping and scrolling containers such as the sidebar. */
  portal?: boolean;
  /** Controlled visibility. Omit to retain the default hover/focus behavior. */
  open?: boolean;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [portalStyle, setPortalStyle] = useState<CSSProperties | null>(null);
  const controlled = open !== undefined;

  const positionPortal = useCallback(() => {
    if (!portal || !anchorRef.current || !tooltipRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const tooltip = tooltipRef.current.getBoundingClientRect();
    const next = getTooltipPosition({
      anchor,
      tooltipWidth: tooltip.width,
      tooltipHeight: tooltip.height,
      side: pos,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setPortalStyle((current) => current?.left === next.left && current.top === next.top && current.visibility === "visible"
      ? current
      : { ...next, visibility: "visible" });
  }, [portal, pos]);

  const showPortal = useCallback(() => {
    if (portal) setPortalStyle({ visibility: "hidden" });
  }, [portal]);

  const portalVisible = portalStyle !== null;

  useLayoutEffect(() => {
    if (portalVisible) positionPortal();
  }, [portalVisible, positionPortal, text]);

  useLayoutEffect(() => {
    if (!portal || !controlled) return;
    if (open === true) showPortal();
    else setPortalStyle(null);
  }, [controlled, open, portal, showPortal]);

  useLayoutEffect(() => {
    if (!portalVisible) return;
    window.addEventListener("resize", positionPortal);
    window.addEventListener("scroll", positionPortal, true);
    return () => {
      window.removeEventListener("resize", positionPortal);
      window.removeEventListener("scroll", positionPortal, true);
    };
  }, [portalVisible, positionPortal]);

  return (
    <span
      ref={anchorRef}
      className={`tooltip-wrap tooltip-wrap--${pos}${controlled ? ` tooltip-wrap--controlled${open ? " tooltip-wrap--open" : ""}` : ""}${delay ? " tooltip-wrap--delayed" : ""}${className ? ` ${className}` : ""}`}
      style={delay ? ({ "--tooltip-delay": `${delay}ms` } as CSSProperties) : undefined}
      onMouseEnter={controlled ? undefined : showPortal}
      onMouseLeave={controlled ? undefined : () => portal && setPortalStyle(null)}
      onFocus={controlled ? undefined : showPortal}
      onBlur={controlled ? undefined : () => portal && setPortalStyle(null)}
    >
      {children}
      {!portal && open !== false && <span className="tooltip-tip">{text}</span>}
      {portal && open !== false && portalStyle && createPortal(
        <span ref={tooltipRef} className={`tooltip-tip tooltip-tip--portal${className ? ` ${className}-tip` : ""}`} style={portalStyle}>{text}</span>,
        document.body,
      )}
    </span>
  );
}
