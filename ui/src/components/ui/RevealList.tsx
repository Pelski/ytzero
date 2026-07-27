import { useState, type ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./utils";
import "./RevealList.css";

export interface RevealListProps<T> {
  items: readonly T[];
  renderRow: (item: T, index: number) => ReactNode;
  listClassName?: string;
  className?: string;
  previewCount?: number;
  showMore: ReactNode;
  showLess: ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
  busy?: boolean;
}

/** Shows a short preview and smoothly reveals the remaining rows on demand. */
export function RevealList<T>({
  items,
  renderRow,
  listClassName,
  className,
  previewCount = 3,
  showMore,
  showLess,
  expanded: controlledExpanded,
  onToggle,
  busy = false,
}: RevealListProps<T>) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = controlledExpanded ?? internalExpanded;
  const toggle = onToggle ?? (() => setInternalExpanded((value) => !value));
  const visible = items.slice(0, previewCount);
  const hidden = items.slice(previewCount);

  return (
    <div className={cx("ui-reveal-list", className)}>
      <div className={listClassName}>{visible.map(renderRow)}</div>
      {(hidden.length > 0 || (expanded && busy)) && (
        <>
          <div className={cx("ui-reveal-more", expanded && "ui-reveal-more--open")}>
            <div className={cx("ui-reveal-more__inner", listClassName)}>{hidden.map((item, index) => renderRow(item, index + previewCount))}</div>
          </div>
          <div className="ui-reveal-toggle">
            <Button size="sm" onClick={toggle} disabled={busy} aria-expanded={expanded}>
              {expanded ? showLess : showMore}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
