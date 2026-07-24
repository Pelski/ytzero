import { useEffect, useRef, useState } from "react";
import "./TagFilterBar.css";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { Tag } from "../api";
import { useI18n } from "../i18n";

export default function TagFilterBar({
  tags,
  selected = [],
  onToggle,
  onClearAll,
  suffix,
  tristate = false,
  excludedIds = [],
  onCycle,
}: {
  tags: Tag[];
  /** Plain mode: currently included tag ids. */
  selected?: number[];
  /** Plain mode: toggle a tag in/out of `selected`. */
  onToggle?: (id: number) => void;
  onClearAll?: () => void;
  suffix?: ReactNode;
  /** Tri-state mode: chips cycle neutral → include → exclude → neutral instead of a plain toggle. */
  tristate?: boolean;
  /** Tri-state mode: currently excluded tag ids (selected doubles as "included" here). */
  excludedIds?: number[];
  /** Tri-state mode: called with the tag id on every click; the caller advances the cycle. */
  onCycle?: (id: number) => void;
}) {
  const { t } = useI18n();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [shadowLeft, setShadowLeft] = useState(false);
  const [shadowRight, setShadowRight] = useState(false);
  const activeCount = selected.length + excludedIds.length;

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const updateShadows = () => {
      const maxScrollLeft = el.scrollWidth - el.clientWidth;
      setShadowLeft(el.scrollLeft > 2);
      setShadowRight(maxScrollLeft - el.scrollLeft > 2);
    };

    updateShadows();
    el.addEventListener("scroll", updateShadows, { passive: true });
    window.addEventListener("resize", updateShadows);
    return () => {
      el.removeEventListener("scroll", updateShadows);
      window.removeEventListener("resize", updateShadows);
    };
  }, [tags.length, activeCount]);

  if (tags.length === 0 && !suffix) return null;
  return (
    <div className="chip-filter-row">
      {tags.length > 0 && (
        <div className={`chip-bar-wrap${shadowLeft ? " shadow-left" : ""}${shadowRight ? " shadow-right" : ""}`}>
          <div className="chip-bar" ref={scrollerRef}>
            {tags.map((tag) => {
              const included = selected.includes(tag.id);
              const excluded = tristate && excludedIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  className={`chip${included ? " active" : ""}${excluded ? " exclude" : ""}`}
                  title={excluded ? t("tagExcluded", { tag: tag.name }) : undefined}
                  onClick={() => (tristate ? onCycle?.(tag.id) : onToggle?.(tag.id))}
                >
                  {excluded && <X size={12} />}
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {activeCount > 0 && onClearAll && (
        <button className="chip chip-clear" onClick={onClearAll} title={t("clearFilters")}>
          <X size={13} />
          {t("clear")}
        </button>
      )}
      {suffix}
    </div>
  );
}
