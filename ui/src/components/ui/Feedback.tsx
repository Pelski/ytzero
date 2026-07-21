import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./utils";

export function Alert({ variant = "info", icon, title, children, className, ...props }: HTMLAttributes<HTMLDivElement> & { variant?: "info" | "warning" | "danger" | "success"; icon?: ReactNode; title?: ReactNode }) {
  return <div {...props} className={cx("ui-alert", `ui-alert--${variant}`, className)} role={variant === "danger" ? "alert" : "status"}>
    {icon && <span className="ui-alert__icon">{icon}</span>}
    <div className="ui-alert__copy">{title && <strong>{title}</strong>}<div>{children}</div></div>
  </div>;
}

export function EmptyState({ icon, title, description, action, compact = false, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; compact?: boolean; className?: string }) {
  return <div className={cx("ui-empty-state", compact && "ui-empty-state--compact", className)}>
    {icon && <div className="ui-empty-state__icon">{icon}</div>}
    <div className="ui-empty-state__title">{title}</div>
    {description && <div className="ui-empty-state__description">{description}</div>}
    {action && <div className="ui-empty-state__action">{action}</div>}
  </div>;
}

export function Badge({ variant = "neutral", size = "md", className, ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: "neutral" | "accent" | "danger" | "success" | "warning"; size?: "sm" | "md" }) {
  return <span {...props} className={cx("ui-badge", `ui-badge--${variant}`, `ui-badge--${size}`, className)} />;
}

export function Toast({ message, variant = "default" }: { message: ReactNode; variant?: "default" | "scheduled" | "success" | "danger" }) {
  return <div className={cx("ui-toast", `ui-toast--${variant}`)} role="status" aria-live="polite">{message}</div>;
}
