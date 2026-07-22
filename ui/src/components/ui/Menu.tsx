import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Check, ChevronLeft, LoaderCircle } from "lucide-react";
import { cx } from "./utils";
import "./Menu.css";

export function Menu({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("ui-menu", className)} role="menu">{children}</div>;
}

export function MenuItem({ icon, selected, suffix, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; selected?: boolean; suffix?: ReactNode }) {
  return <button type="button" role="menuitem" className={cx("ui-menu__item", selected && "ui-menu__item--selected", className)} {...props}>{icon && <span className="ui-menu__icon">{icon}</span>}<span className="ui-menu__label">{children}</span>{suffix ?? (selected && <Check className="ui-menu__check" />)}</button>;
}

export function MenuLabel({ children }: { children: ReactNode }) { return <div className="ui-menu__label-heading">{children}</div>; }
export function MenuSeparator({ className }: { className?: string } = {}) { return <div className={cx("ui-menu__separator", className)} role="separator" />; }
export function MenuHeader({ children, onBack, backLabel }: { children: ReactNode; onBack?: () => void; backLabel?: string }) { return <div className="ui-menu__header">{onBack && <button type="button" aria-label={backLabel} onClick={onBack}><ChevronLeft /></button>}<span>{children}</span></div>; }
export function MenuStatus({ children, className }: { children: ReactNode; className?: string }) { return <span className={cx("ui-menu__status", className)}>{children}</span>; }
export function MenuLoading({ label }: { label: string }) { return <div className="ui-menu__loading" role="status"><LoaderCircle className="spin" size={16} />{label}</div>; }
