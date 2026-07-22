import type { CSSProperties, KeyboardEvent } from "react";
import "./SteppedSlider.css";

export interface SteppedSliderProps {
  value: number;
  steps: readonly number[];
  onChange: (value: number) => void;
  ariaLabel: string;
  showTicks?: boolean;
}

export default function SteppedSlider({ value, steps, onChange, ariaLabel, showTicks = true }: SteppedSliderProps) {
  if (steps.length < 2) throw new Error("SteppedSlider requires at least two steps");
  const orderedSteps = [...steps].sort((a, b) => a - b);
  const min = orderedSteps[0];
  const max = orderedSteps[orderedSteps.length - 1];
  const nearestStep = (raw: number) => orderedSteps.reduce((best, step) => Math.abs(step - raw) < Math.abs(best - raw) ? step : best, orderedSteps[0]);
  const selected = nearestStep(value);
  const move = (direction: -1 | 1) => {
    const index = orderedSteps.indexOf(selected);
    onChange(orderedSteps[Math.min(orderedSteps.length - 1, Math.max(0, index + direction))]);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); move(-1); }
    if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); move(1); }
    if (event.key === "Home") { event.preventDefault(); onChange(min); }
    if (event.key === "End") { event.preventDefault(); onChange(max); }
  };
  const progress = ((selected - min) / (max - min)) * 100;

  return (
    <div className="stepped-slider" style={{ "--stepped-slider-progress": `${progress}%` } as CSSProperties}>
      <input type="range" min={min} max={max} step={1} value={selected} aria-label={ariaLabel} onChange={(event) => onChange(nearestStep(Number(event.target.value)))} onKeyDown={onKeyDown} />
      {showTicks && <div className="stepped-slider-ticks" aria-hidden="true">{orderedSteps.map((step) => <span key={step} className={step <= selected ? "is-active" : undefined} style={{ left: `${((step - min) / (max - min)) * 100}%` }} />)}</div>}
    </div>
  );
}
