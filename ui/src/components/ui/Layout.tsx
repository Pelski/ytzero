import { createElement, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./utils";
import "./Layout.css";

type Gap = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export function PageHeader({ title, description, icon, actions, className }: { title: ReactNode; description?: ReactNode; icon?: ReactNode; actions?: ReactNode; className?: string }) {
  return <header className={cx("ui-page-header", className)}>
    <div className="ui-page-header__identity">{icon && <div className="ui-page-header__icon">{icon}</div>}<div className="ui-page-header__copy"><h1>{title}</h1>{description && <Text tone="secondary">{description}</Text>}</div></div>
    {actions && <div className="ui-page-header__actions">{actions}</div>}
  </header>;
}

export function SectionHeader({ title, description, icon, actions, level = 2, variant = "default", className }: { title: ReactNode; description?: ReactNode; icon?: ReactNode; actions?: ReactNode; level?: 2 | 3 | 4; variant?: "default" | "subtle" | "uppercase"; className?: string }) {
  return <header className={cx("ui-section-header", `ui-section-header--${variant}`, className)}>
    <div className="ui-section-header__copy">
      {createElement(`h${level}`, {}, <>{icon && <span className="ui-section-header__icon">{icon}</span>}{title}</>)}
      {description && <Text tone="secondary" size="sm">{description}</Text>}
    </div>
    {actions && <div className="ui-section-header__actions">{actions}</div>}
  </header>;
}

export function Text({ as = "p", tone = "default", size = "md", className, ...props }: HTMLAttributes<HTMLElement> & { as?: "p" | "span" | "div"; tone?: "default" | "secondary" | "muted" | "danger" | "success"; size?: "sm" | "md" | "lg" }) {
  return createElement(as, { ...props, className: cx("ui-text", `ui-text--${tone}`, `ui-text--${size}`, className) });
}

export function Divider({ label, inset = false, className }: { label?: ReactNode; inset?: boolean; className?: string }) {
  return <div className={cx("ui-divider", inset && "ui-divider--inset", Boolean(label) && "ui-divider--labeled", className)} role="separator">{label && <span>{label}</span>}</div>;
}

export function Stack({ as = "div", gap = 3, className, style, ...props }: HTMLAttributes<HTMLElement> & { as?: "div" | "form" | "section"; gap?: Gap }) {
  return createElement(as, { ...props, className: cx("ui-stack", className), style: { "--ui-layout-gap": `var(--space-${gap})`, ...style } as CSSProperties });
}

export function Inline({ gap = 2, align = "center", justify = "start", wrap = true, className, style, ...props }: HTMLAttributes<HTMLDivElement> & { gap?: Gap; align?: "start" | "center" | "end" | "stretch"; justify?: "start" | "center" | "end" | "between"; wrap?: boolean }) {
  return <div {...props} className={cx("ui-inline", `ui-inline--align-${align}`, `ui-inline--justify-${justify}`, !wrap && "ui-inline--nowrap", className)} style={{ "--ui-layout-gap": `var(--space-${gap})`, ...style } as CSSProperties} />;
}
