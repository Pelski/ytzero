import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { cx } from "./utils";
import "./Button.css";

export type ButtonVariant = "default" | "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = "default",
  size = "md",
  iconOnly = false,
  leadingIcon,
  trailingIcon,
  className,
  children,
  type = "button",
  ...props
}, ref) {
  return (
    <button ref={ref} type={type} className={cx("ui-button", `ui-button--${variant}`, `ui-button--${size}`, iconOnly && "ui-button--icon", className)} {...props}>
      {leadingIcon && <span className="ui-button__icon">{leadingIcon}</span>}
      {children}
      {trailingIcon && <span className="ui-button__icon">{trailingIcon}</span>}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, "iconOnly" | "leadingIcon" | "trailingIcon"> {
  label: string;
  icon?: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, icon, children, title, ...props }, ref) {
  return <Button ref={ref} iconOnly aria-label={label} title={title ?? label} {...props}>{icon ?? children}</Button>;
});

export interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export function ButtonLink({ variant = "default", size = "md", leadingIcon, trailingIcon, className, children, ...props }: ButtonLinkProps) {
  return <Link className={cx("ui-button", `ui-button--${variant}`, `ui-button--${size}`, className)} {...props}>
    {leadingIcon && <span className="ui-button__icon">{leadingIcon}</span>}{children}{trailingIcon && <span className="ui-button__icon">{trailingIcon}</span>}
  </Link>;
}

export interface ButtonAnchorProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export function ButtonAnchor({ variant = "default", size = "md", leadingIcon, trailingIcon, className, children, ...props }: ButtonAnchorProps) {
  return <a className={cx("ui-button", `ui-button--${variant}`, `ui-button--${size}`, className)} {...props}>{leadingIcon && <span className="ui-button__icon">{leadingIcon}</span>}{children}{trailingIcon && <span className="ui-button__icon">{trailingIcon}</span>}</a>;
}
