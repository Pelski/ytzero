import { Check } from "lucide-react";
import type { ReactNode } from "react";
import type { Tag } from "../api";
import { useI18n } from "../i18n";
import { Menu, MenuItem, MenuLoading, MenuStatus, ScrollArea } from "./ui";
import "./TagPickerMenu.css";

/** Reusable tag choices for channel surfaces. The create form is supplied by its owner. */
export default function TagPickerMenu({ tags, selectedTagIds, onToggle, children, loading = false }: {
  tags: Tag[];
  loading?: boolean;
  selectedTagIds: Iterable<Tag["id"]>;
  onToggle: (tag: Tag) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const selected = new Set(selectedTagIds);
  return <Menu className="tag-picker-menu">
    {loading ? <MenuLoading label={t("loading")} /> : <>
    <ScrollArea className="tag-picker-menu__options-wrap" viewportClassName="tag-picker-menu__options">
        {tags.map((tag) => {
          const isSelected = selected.has(tag.id);
          return <MenuItem
            key={tag.id}
            selected={isSelected}
            icon={<span className="tag-picker-color-dot" style={{ background: tag.color }} />}
            suffix={isSelected ? <MenuStatus><Check /></MenuStatus> : undefined}
            onClick={() => onToggle(tag)}
          >{tag.name}</MenuItem>;
        })}
    </ScrollArea>
    {children}
    </>}
  </Menu>;
}
