import { useEffect, useRef, useState } from "react";
import "./TagFilterBar.css";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { Tag } from "../api";
import { useI18n } from "../i18n";

export default function TagFilterBar({
  tags,
  selected,
  onToggle,
  onClearAll,
  suffix,
}: {
  tags: Tag[];
  selected: number[];
  onToggle: (id: number) => void;
  onClearAll?: () => void;
  suffix?: ReactNode;
}) {
  const { t } = useI18n();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [shadowLeft, setShadowLeft] = useState(false);
  const [shadowRight, setShadowRight] = useState(false);

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
  }, [tags.length, selected.length]);

  if (tags.length === 0 && !suffix) return null;
  return (
    <div className="chip-filter-row">
      {tags.length > 0 && (
        <div className={`chip-bar-wrap${shadowLeft ? " shadow-left" : ""}${shadowRight ? " shadow-right" : ""}`}>
          <div className="chip-bar" ref={scrollerRef}>
            {tags.map((t) => {
              const active = selected.includes(t.id);
              return (
                <button
                  key={t.id}
                  className={`chip${active ? " active" : ""}`}
                  onClick={() => onToggle(t.id)}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {selected.length > 0 && onClearAll && (
        <button className="chip chip-clear" onClick={onClearAll} title={t("clearFilters")}>
          <X size={13} />
          {t("clear")}
        </button>
      )}
      {suffix}
    </div>
  );
}
