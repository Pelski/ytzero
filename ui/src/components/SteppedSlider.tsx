import type { KeyboardEvent } from "react";

type SteppedSliderProps = {
  value: number;
  steps: readonly number[];
  onChange: (value: number) => void;
  ariaLabel: string;
};

export default function SteppedSlider({ value, steps, onChange, ariaLabel }: SteppedSliderProps) {
  const min = steps[0];
  const max = steps[steps.length - 1];
  const nearestStep = (raw: number) => steps.reduce((best, step) => Math.abs(step - raw) < Math.abs(best - raw) ? step : best, steps[0]);
  const selected = nearestStep(value);
  const move = (direction: -1 | 1) => {
    const index = steps.indexOf(selected);
    onChange(steps[Math.min(steps.length - 1, Math.max(0, index + direction))]);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); move(-1); }
    if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); move(1); }
    if (event.key === "Home") { event.preventDefault(); onChange(min); }
    if (event.key === "End") { event.preventDefault(); onChange(max); }
  };
  const progress = ((selected - min) / (max - min)) * 100;

  return (
    <div className="stepped-slider" style={{ "--stepped-slider-progress": `${progress}%` } as React.CSSProperties}>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={selected}
        aria-label={ariaLabel}
        onChange={(event) => onChange(nearestStep(Number(event.target.value)))}
        onKeyDown={onKeyDown}
      />
      <div className="stepped-slider-ticks" aria-hidden="true">
        {steps.map((step) => <span key={step} style={{ left: `${((step - min) / (max - min)) * 100}%` }} />)}
      </div>
    </div>
  );
}
