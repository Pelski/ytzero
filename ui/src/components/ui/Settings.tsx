import type { ReactNode } from "react";
import { cx } from "./utils";
import { SectionHeader, Text } from "./Layout";
import "./Settings.css";

export function SettingsSection({ title, description, children, className }: { title?: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={cx("ui-settings-section", className)}>{title ? <SectionHeader title={title} description={description} /> : description ? <Text tone="secondary" className="ui-settings-section__description">{description}</Text> : null}<div className="ui-settings-section__body">{children}</div></section>;
}

export function SettingRow({ label, description, children, htmlFor, align = "center", className }: { label: ReactNode; description?: ReactNode; children: ReactNode; htmlFor?: string; align?: "center" | "start"; className?: string }) {
  const Label = htmlFor ? "label" : "div";
  return <div className={cx("ui-setting-row", `ui-setting-row--${align}`, className)}><div className="ui-setting-row__copy"><Label className="ui-control-label" {...(htmlFor ? { htmlFor } : {})}>{label}</Label>{description && <div className="ui-control-description">{description}</div>}</div><div className="ui-setting-row__control">{children}</div></div>;
}

export function FormActions({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end" | "between"; className?: string }) {
  return <div className={cx("ui-form-actions", `ui-form-actions--${align}`, className)}>{children}</div>;
}
