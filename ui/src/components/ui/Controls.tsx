import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cx } from "./utils";

export function Checkbox({ label, description, className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; description?: ReactNode }) {
  return <label className={cx("ui-checkbox", props.disabled && "ui-checkbox--disabled", className)}>
    <input type="checkbox" {...props} />
    <span className="ui-checkbox__control" aria-hidden="true"><Check /></span>
    <span className="ui-checkbox__copy"><span className="ui-checkbox__label">{label}</span>{description && <span className="ui-control-description">{description}</span>}</span>
  </label>;
}

export function Switch({ checked, onCheckedChange, label, description, disabled, className, ariaLabel }: { checked: boolean; onCheckedChange: (checked: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean; className?: string; ariaLabel?: string }) {
  const control = <button type="button" role="switch" aria-checked={checked} aria-label={ariaLabel} disabled={disabled} className={cx("ui-switch", !label && className, checked && "ui-switch--checked")} onClick={() => onCheckedChange(!checked)}><span className="ui-switch__thumb" /></button>;
  if (!label) return control;
  return <div className={cx("ui-labeled-control", className)}><span><span className="ui-control-label">{label}</span>{description && <span className="ui-control-description">{description}</span>}</span>{control}</div>;
}

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider({ value, min, max, onChange, className, style, ...props }, ref) {
  const progress = ((value - min) / Math.max(1, max - min)) * 100;
  return <input ref={ref} type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className={cx("ui-slider", className)} style={{ "--ui-slider-progress": `${progress}%`, ...style } as React.CSSProperties} {...props} />;
});
