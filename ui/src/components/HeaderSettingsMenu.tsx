import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { IconButton, Menu, MenuSeparator, MenuStatus, Popover, ScrollArea } from "./ui";
import Tooltip from "./Tooltip";
import "./HeaderSettingsMenu.css";

export function HeaderSettingsPopover({ open, onOpenChange, label, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  children: ReactNode;
}) {
  return <Popover
    align="end"
    surface="menu"
    open={open}
    onOpenChange={onOpenChange}
    className="header-settings-popover"
    trigger={<IconButton variant={open ? "secondary" : "default"} label={label}><SlidersHorizontal /></IconButton>}
  >
    <Menu className="header-settings-menu">{children}</Menu>
  </Popover>;
}

export function HeaderSettingsItem({ icon, label, status, hasNext = true, disabledReason, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: ReactNode;
  label: ReactNode;
  status?: ReactNode;
  hasNext?: boolean;
  disabledReason?: string;
}) {
  const button = <button type="button" className="header-settings-item" {...props}>
    {icon}<span>{label}</span>{status != null && <MenuStatus>{status}</MenuStatus>}{hasNext && <ChevronRight />}
  </button>;
  return disabledReason
    ? <Tooltip text={disabledReason} pos="left" portal className="header-settings-item-tooltip">{button}</Tooltip>
    : button;
}

export function HeaderSettingsSectionLabel({ children }: { children: ReactNode }) {
  return <div className="header-settings-section-label">{children}</div>;
}

export function HeaderSettingsHeader({ children, onBack, backLabel }: { children: ReactNode; onBack: () => void; backLabel: string }) {
  return <div className="header-settings-header"><button type="button" aria-label={backLabel} onClick={onBack}><ChevronLeft /></button>{children}</div>;
}

export function HeaderSettingsOption({ selected = false, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return <button type="button" className={selected ? "is-selected" : undefined} {...props}>
    {children}{selected && <MenuStatus><Check /></MenuStatus>}
  </button>;
}

export function HeaderSettingsSeparator({ spacer = false }: { spacer?: boolean }) {
  return <MenuSeparator className={spacer ? "header-settings-spacer" : undefined} />;
}

export function HeaderSettingsScroll({ children }: { children: ReactNode }) {
  return <ScrollArea viewportClassName="header-settings-scroll">{children}</ScrollArea>;
}
