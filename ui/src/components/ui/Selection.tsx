import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cx } from "./utils";
import { Button, type ButtonSize } from "./Button";
import { Menu, MenuItem } from "./Menu";
import { FloatingPopover } from "./FloatingPopover";
import { Popover } from "./Popover";
import { ScrollArea } from "./ScrollArea";
import "./Selection.css";

export function SelectMenu<T extends string | number>({ value, options, onChange, label, size = "md", disabled, searchable = false, searchPlaceholder = "Search…", emptyLabel = "—", className, floating = false }: { value: T; options: readonly { value: T; label: ReactNode; icon?: ReactNode; disabled?: boolean; searchText?: string }[]; onChange: (value: T) => void; label: string; size?: ButtonSize; disabled?: boolean; searchable?: boolean; searchPlaceholder?: string; emptyLabel?: ReactNode; className?: string; /** Render above clipping ancestors. */ floating?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleOptions = normalizedQuery ? options.filter((option) => (option.searchText ?? (typeof option.label === "string" ? option.label : String(option.value))).toLocaleLowerCase().includes(normalizedQuery)) : options;
  const onOpenChange = (next: boolean) => { setOpen(next); if (!next) setQuery(""); };
  const trigger = <Button type="button" size={size} variant="secondary" disabled={disabled} className={cx("ui-select-menu__trigger", className)} aria-label={label} trailingIcon={<ChevronDown />}><span className="ui-select-menu__value">{selected?.label ?? value}</span></Button>;
  const content = <>
    {searchable && <input className="ui-input ui-input--sm ui-select-menu__search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} autoFocus />}
    <ScrollArea viewportClassName="ui-select-menu__options">
      {visibleOptions.length > 0 ? <Menu>
        {visibleOptions.map((option) => <MenuItem key={option.value} icon={option.icon} selected={option.value === value} disabled={option.disabled} onClick={() => { onChange(option.value); setOpen(false); setQuery(""); }}>{option.label}</MenuItem>)}
      </Menu> : <div className="ui-select-menu__empty">{emptyLabel}</div>}
    </ScrollArea>
  </>;
  return floating
    ? <FloatingPopover open={open} onOpenChange={onOpenChange} align="end" className="ui-select-menu__popover" trigger={trigger}>{content}</FloatingPopover>
    : <Popover open={open} onOpenChange={onOpenChange} align="end" className="ui-select-menu__popover" trigger={trigger}>{content}</Popover>;
}

export function SegmentedControl<T extends string>({ value, options, onChange, label, className }: { value: T; options: readonly { value: T; label: ReactNode; icon?: ReactNode }[]; onChange: (value: T) => void; label: string; className?: string }) {
  return <div className={cx("ui-segmented", className)} role="radiogroup" aria-label={label}>{options.map((option) => <button type="button" role="radio" aria-checked={value === option.value} className={cx("ui-segmented__option", value === option.value && "ui-segmented__option--active")} key={option.value} onClick={() => onChange(option.value)}>{option.icon}{option.label}</button>)}</div>;
}

export function Tabs<T extends string>({ value, options, onChange, label, variant = "pill", className }: { value: T; options: readonly { value: T; label: ReactNode; icon?: ReactNode; count?: number }[]; onChange: (value: T) => void; label: string; variant?: "pill" | "settings" | "subtle"; className?: string }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [shadowLeft, setShadowLeft] = useState(false);
  const [shadowRight, setShadowRight] = useState(false);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const updateShadows = () => {
      const remaining = scroller.scrollWidth - scroller.clientWidth;
      setShadowLeft(scroller.scrollLeft > 2);
      setShadowRight(remaining - scroller.scrollLeft > 2);
    };
    updateShadows();
    const resizeObserver = new ResizeObserver(updateShadows);
    resizeObserver.observe(scroller);
    scroller.addEventListener("scroll", updateShadows, { passive: true });
    return () => {
      resizeObserver.disconnect();
      scroller.removeEventListener("scroll", updateShadows);
    };
  }, [options]);

  return <div className={cx("ui-tabs-wrap", `ui-tabs-wrap--${variant}`, shadowLeft && "ui-tabs-wrap--shadow-left", shadowRight && "ui-tabs-wrap--shadow-right", className)}><div ref={scrollerRef} className={cx("ui-tabs", `ui-tabs--${variant}`)} role="tablist" aria-label={label}>{options.map((option) => <button type="button" role="tab" aria-selected={value === option.value} className={cx("ui-tabs__tab", value === option.value && "ui-tabs__tab--active")} key={option.value} onClick={() => onChange(option.value)}>{option.icon}{option.label}{option.count != null && option.count > 0 && <span className="ui-tabs__count">{option.count}</span>}</button>)}</div></div>;
}

export function Chip({ active, children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button type="button" aria-pressed={active} className={cx("ui-chip", active && "ui-chip--active", className)} {...props}>{children}</button>;
}

export function OptionPicker<T extends string | number>({ value, options, onChange, columns = 1, label, className }: { value?: T | readonly T[]; options: readonly { value: T; label: ReactNode; icon?: ReactNode; description?: ReactNode; disabled?: boolean }[]; onChange: (value: T) => void; columns?: number; label: string; className?: string }) {
  const selected = (option: T) => Array.isArray(value) ? value.includes(option) : value === option;
  return <div className={cx("ui-option-picker", className)} role="listbox" aria-label={label} style={{ "--ui-picker-columns": columns } as React.CSSProperties}>{options.map((option) => <button type="button" role="option" aria-selected={selected(option.value)} disabled={option.disabled} className={cx("ui-option-picker__option", selected(option.value) && "ui-option-picker__option--selected")} key={option.value} onClick={() => onChange(option.value)}>{option.icon && <span className="ui-option-picker__icon">{option.icon}</span>}<span className="ui-option-picker__copy"><span>{option.label}</span>{option.description && <small>{option.description}</small>}</span>{selected(option.value) && <Check className="ui-option-picker__check" />}</button>)}</div>;
}

export function IconPicker<T extends string | number>({ value, options, onChange, columns = 8, label, className }: { value?: T; options: readonly { value: T; label: string; icon: ReactNode; disabled?: boolean }[]; onChange: (value: T) => void; columns?: number; label: string; className?: string }) {
  return <div className={cx("ui-icon-picker", className)} role="listbox" aria-label={label} style={{ "--ui-picker-columns": columns } as React.CSSProperties}>{options.map((option) => <button type="button" role="option" aria-selected={value === option.value} aria-label={option.label} title={option.label} disabled={option.disabled} className={cx("ui-icon-picker__option", value === option.value && "ui-icon-picker__option--selected")} key={option.value} onClick={() => onChange(option.value)}>{option.icon}</button>)}</div>;
}
