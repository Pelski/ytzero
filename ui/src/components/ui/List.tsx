import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cx } from "./utils";

export function List({ divided = true, className, ...props }: HTMLAttributes<HTMLDivElement> & { divided?: boolean }) {
  return <div {...props} role="list" className={cx("ui-list", divided && "ui-list--divided", className)} />;
}

export function ListRow({ media, title, description, meta, actions, className, children, ...props }: Omit<HTMLAttributes<HTMLDivElement>, "title"> & { media?: ReactNode; title?: ReactNode; description?: ReactNode; meta?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return <div {...props} role="listitem" className={cx("ui-list-row", className)}>
    {media && <div className="ui-list-row__media">{media}</div>}
    <div className="ui-list-row__content">{title && <div className="ui-list-row__title">{title}</div>}{description && <div className="ui-list-row__description">{description}</div>}{children}</div>
    {meta && <div className="ui-list-row__meta">{meta}</div>}
    {actions && <ListActions>{actions}</ListActions>}
  </div>;
}

export function ListButton({ media, title, description, meta, className, children, type = "button", ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & { media?: ReactNode; title?: ReactNode; description?: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return <button {...props} type={type} role="listitem" className={cx("ui-list-row", "ui-list-row--button", className)}>
    {media && <span className="ui-list-row__media">{media}</span>}
    <span className="ui-list-row__content">{title && <span className="ui-list-row__title">{title}</span>}{description && <span className="ui-list-row__description">{description}</span>}{children}</span>
    {meta && <span className="ui-list-row__meta">{meta}</span>}
  </button>;
}

export function ListActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("ui-list-actions", className)} />;
}
