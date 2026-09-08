export type TooltipSide = "left" | "right" | "top" | "bottom";

type AnchorRect = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;

function clampToViewport(value: number, size: number, viewportSize: number, margin: number) {
  const maximum = viewportSize - margin - size;
  if (maximum < margin) return margin;
  return Math.min(Math.max(value, margin), maximum);
}

export function getTooltipPosition({
  anchor,
  tooltipWidth,
  tooltipHeight,
  side,
  viewportWidth,
  viewportHeight,
  gap = 7,
  viewportMargin = 8,
}: {
  anchor: AnchorRect;
  tooltipWidth: number;
  tooltipHeight: number;
  side: TooltipSide;
  viewportWidth: number;
  viewportHeight: number;
  gap?: number;
  viewportMargin?: number;
}) {
  const centerX = anchor.left + anchor.width / 2;
  const centerY = anchor.top + anchor.height / 2;
  const raw = {
    left: { left: anchor.left - gap - tooltipWidth, top: centerY - tooltipHeight / 2 },
    right: { left: anchor.right + gap, top: centerY - tooltipHeight / 2 },
    top: { left: centerX - tooltipWidth / 2, top: anchor.top - gap - tooltipHeight },
    bottom: { left: centerX - tooltipWidth / 2, top: anchor.bottom + gap },
  }[side];

  return {
    left: clampToViewport(raw.left, tooltipWidth, viewportWidth, viewportMargin),
    top: clampToViewport(raw.top, tooltipHeight, viewportHeight, viewportMargin),
  };
}
