import { RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatShortcutChord, shortcutChordFromEvent } from "../../keyboardShortcuts";
import { Button, IconButton } from "./Button";
import { cx } from "./utils";
import "./ShortcutInput.css";

export function ShortcutInput({ value, defaultValue, label, captureLabel, clearLabel, resetLabel, invalid, disabled, digitFamily = false, onChange }: {
  value: string | null; defaultValue: string; label: string; captureLabel: string; clearLabel: string; resetLabel: string;
  invalid?: boolean; disabled?: boolean; digitFamily?: boolean; onChange: (value: string | null) => void;
}) {
  const [recording, setRecording] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!recording) return;
    const stopOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setRecording(false); };
    window.addEventListener("pointerdown", stopOutside); return () => window.removeEventListener("pointerdown", stopOutside);
  }, [recording]);
  const record = (event: React.KeyboardEvent) => {
    if (!recording) return;
    event.preventDefault(); event.stopPropagation();
    if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
    const chord = shortcutChordFromEvent(event.nativeEvent);
    if (!chord) return;
    onChange(digitFamily && /^Digit[0-9]$/.test(event.code) ? chord.replace(/Digit[0-9]$/, "Digit0-9") : chord);
    setRecording(false);
  };
  return <div ref={rootRef} className={cx("ui-shortcut-input", recording && "is-recording", invalid && "is-invalid")} onKeyDown={record}>
    <Button className="ui-shortcut-input__capture" size="sm" aria-label={label} aria-pressed={recording} disabled={disabled} onClick={() => setRecording(true)}>
      {recording ? captureLabel : formatShortcutChord(value)}
    </Button>
    <IconButton size="sm" variant="ghost" label={clearLabel} icon={<X />} disabled={disabled || value === null} onClick={() => onChange(null)} />
    <IconButton size="sm" variant="ghost" label={resetLabel} icon={<RotateCcw />} disabled={disabled || value === defaultValue} onClick={() => onChange(defaultValue)} />
  </div>;
}
