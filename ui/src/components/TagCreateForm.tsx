import { Button, ColorPicker, Input, Stack } from "./ui";
import "./TagCreateForm.css";

export default function TagCreateForm({ title, name, color, placeholder, submitLabel, disabled, onNameChange, onColorChange, onSubmit }: { title: string; name: string; color: string; placeholder: string; submitLabel: string; disabled?: boolean; onNameChange: (name: string) => void; onColorChange: (color: string) => void; onSubmit: () => void | Promise<void> }) {
  return <Stack as="form" gap={2} className="tag-create-form" onSubmit={(event) => { event.preventDefault(); void onSubmit(); }}>
    <div className="tag-create-form__title">{title}</div>
    <div className="tag-create-form__fields">
      <ColorPicker label={title} value={color} onChange={onColorChange} variant="swatch" />
      <Input size="sm" type="text" placeholder={placeholder} value={name} onChange={(event) => onNameChange(event.target.value)} />
    </div>
    <Button type="submit" size="sm" variant="primary" disabled={disabled || !name.trim()}>{submitLabel}</Button>
  </Stack>;
}
