import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "./utils";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "sm" | "md";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, size = "md", ...props }, ref) {
  return <input ref={ref} className={cx("ui-input", size === "sm" && "ui-input--sm", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cx("ui-input", "ui-textarea", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={cx("ui-select", className)} {...props} />;
});

export function Field({ label, hint, error, htmlFor, children, className }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return <div className={cx("ui-field", className)}>
    {label && <label className="ui-field__label" htmlFor={htmlFor}>{label}</label>}
    {children}
    {(error || hint) && <div className={cx("ui-field__hint", Boolean(error) && "ui-field__hint--error")}>{error ?? hint}</div>}
  </div>;
}

export function InputGroup({ prefix, suffix, children, className }: { prefix?: ReactNode; suffix?: ReactNode; children: ReactNode; className?: string }) {
  return <div className={cx("ui-input-group", className)}>
    {prefix && <span className="ui-input-group__affix">{prefix}</span>}
    {children}
    {suffix && <span className="ui-input-group__affix">{suffix}</span>}
  </div>;
}
