import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { IconButton } from "./Button";
import { cx } from "./utils";
import "./OrderEditor.css";

export function OrderEditor<T extends { id: string }>({
  items,
  onChange,
  renderItem,
  moveUpLabel,
  moveDownLabel,
  className,
}: {
  items: readonly T[];
  onChange: (items: T[]) => void;
  renderItem: (item: T, index: number) => ReactNode;
  moveUpLabel: string;
  moveDownLabel: string;
  className?: string;
}) {
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <div className={cx("ui-order-editor", className)}>
      {items.map((item, index) => (
        <div className="ui-order-editor__item" key={item.id}>
          <div className="ui-order-editor__controls">
            <IconButton size="sm" variant="ghost" label={moveUpLabel} icon={<ChevronUp />} disabled={index === 0} onClick={() => move(index, -1)} />
            <IconButton size="sm" variant="ghost" label={moveDownLabel} icon={<ChevronDown />} disabled={index === items.length - 1} onClick={() => move(index, 1)} />
          </div>
          <div className="ui-order-editor__content">{renderItem(item, index)}</div>
        </div>
      ))}
    </div>
  );
}
