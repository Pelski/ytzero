import type { HTMLAttributes } from "react";
import { cx } from "./utils";
import "./Progress.css";

export function ProgressBar({ value, max = 100, label, className, ...props }: Omit<HTMLAttributes<HTMLDivElement>, "children"> & { value: number; max?: number; label: string }) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const safeValue = Number.isFinite(value) ? Math.min(safeMax, Math.max(0, value)) : 0;
  const percent = safeValue / safeMax * 100;

  return <div
    {...props}
    className={cx("ui-progress", className)}
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={safeMax}
    aria-valuenow={safeValue}
  >
    <span className="ui-progress__fill" style={{ width: `${percent}%` }} />
  </div>;
}
