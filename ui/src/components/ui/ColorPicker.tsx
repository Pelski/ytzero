import { useEffect, useState, type CSSProperties, type PointerEvent } from "react";
import { Check } from "lucide-react";
import { FloatingPopover } from "./FloatingPopover";
import { Input } from "./Fields";
import { cx } from "./utils";
import "./ColorPicker.css";

const DEFAULT_COLORS = [
  "#f2293a", "#ff6b6b", "#e84393", "#9b59b6", "#7c5cff", "#3ea6ff",
  "#00b8d9", "#00b894", "#2ecc71", "#fdcb6e", "#e17055", "#636e72",
];

type Hsv = { h: number; s: number; v: number };

function validHex(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function hexToHsv(hex: string): Hsv {
  if (!validHex(hex)) return { h: 0, s: 0, v: 1 };
  const value = Number.parseInt(hex.slice(1), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return { h: h < 0 ? h + 360 : h, s: max ? delta / max : 0, v: max };
}

function hsvToHex({ h, s, v }: Hsv) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function ColorPicker({ value, onChange, label, colors = DEFAULT_COLORS, disabled, id, className, variant = "default" }: { value: string; onChange: (value: string) => void; label: string; colors?: readonly string[]; disabled?: boolean; id?: string; className?: string; variant?: "default" | "swatch" }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [hsv, setHsv] = useState(() => hexToHsv(value));

  useEffect(() => {
    setDraft(value);
    setHsv(hexToHsv(value));
  }, [value]);

  const choose = (next: Hsv) => {
    const hex = hsvToHex(next);
    setHsv(next);
    setDraft(hex);
    onChange(hex);
  };

  const chooseFromSpectrum = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    choose({
      h: hsv.h,
      s: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      v: 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    });
  };

  const commitHex = () => {
    if (!validHex(draft)) {
      setDraft(value);
      return;
    }
    const normalized = draft.toLowerCase();
    setHsv(hexToHsv(normalized));
    setDraft(normalized);
    onChange(normalized);
  };

  const pickerStyle = {
    "--ui-picker-hue": `${hsv.h}`,
    "--ui-picker-saturation": `${hsv.s * 100}%`,
    "--ui-picker-value": `${(1 - hsv.v) * 100}%`,
  } as CSSProperties;

  return <FloatingPopover
    open={open}
    onOpenChange={(next) => { if (!disabled) setOpen(next); }}
    align="start"
    className="ui-color-picker__popover"
    trigger={<button id={id} type="button" disabled={disabled} className={cx("ui-color-picker__trigger", variant === "swatch" && "ui-color-picker__trigger--swatch", className)} aria-label={label} title={label}><span style={{ background: value }} />{variant === "default" && <span className="ui-color-picker__value">{value.toUpperCase()}</span>}</button>}
  >
    <div className="ui-color-picker__spectrum" style={pickerStyle} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); chooseFromSpectrum(event); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) chooseFromSpectrum(event); }}>
      <span className="ui-color-picker__cursor" />
    </div>
    <input className="ui-color-picker__hue" style={pickerStyle} type="range" min={0} max={359} value={Math.round(hsv.h)} aria-label={`${label} hue`} onChange={(event) => choose({ ...hsv, h: Number(event.target.value) })} />
    <div className="ui-color-picker__grid" aria-label={label} role="listbox">
      {colors.map((color) => <button key={color} type="button" role="option" aria-selected={color.toLowerCase() === value.toLowerCase()} aria-label={color} title={color} className="ui-color-picker__swatch" style={{ background: color }} onClick={() => { const normalized = color.toLowerCase(); onChange(normalized); setDraft(normalized); setHsv(hexToHsv(normalized)); }}>{color.toLowerCase() === value.toLowerCase() && <Check />}</button>)}
    </div>
    <div className="ui-color-picker__hex"><Input size="sm" aria-label={`${label} HEX`} value={draft} maxLength={7} spellCheck={false} onChange={(event) => setDraft(event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`)} onBlur={commitHex} onKeyDown={(event) => { if (event.key === "Enter") commitHex(); }} /></div>
  </FloatingPopover>;
}
