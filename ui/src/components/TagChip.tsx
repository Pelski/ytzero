import { X } from "lucide-react";
import "./TagChip.css";
import type { Tag } from "../api";
import { useI18n, type I18nKey } from "../i18n";

const SOURCE_LABEL_KEY: Record<string, I18nKey> = {
  auto: "tagSourceAuto",
  channel: "tagSourceChannel",
  manual: "tagSourceManual",
};

function tagChipStyle(color: string) {
  const hex = color.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return { color, background: `${color}26` };
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (luminance < 0.22) {
    return { color: "#f1f1f1", background: `${color}80`, borderColor: `${color}cc` };
  }
  if (luminance > 0.82) {
    return { color: "#0f0f0f", background: `${color}d9`, borderColor: `${color}f2` };
  }
  return { color, background: `${color}26`, borderColor: `${color}40` };
}

/** Small tag pill shown on video cards and the watch page. */
export default function TagChip({
  tag,
  onClick,
  onRemove,
}: {
  tag: Tag;
  onClick?: () => void;
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  return (
    <span
      className={`tag-pill${onClick ? " clickable" : ""}`}
      onClick={onClick}
      title={tag.source && SOURCE_LABEL_KEY[tag.source] ? t(SOURCE_LABEL_KEY[tag.source]) : undefined}
      style={tagChipStyle(tag.color)}
    >
      {tag.name}
      {onRemove && (
        <span
          className="x"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X />
        </span>
      )}
    </span>
  );
}
