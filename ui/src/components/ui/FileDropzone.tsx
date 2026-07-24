import { useRef, useState, type ReactNode } from "react";
import { Button, type ButtonVariant } from "./Button";
import { Input } from "./Fields";
import { Text } from "./Layout";
import { cx } from "./utils";
import "./FileDropzone.css";

export interface FileDropzoneProps {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actionLabel: ReactNode;
  actionIcon?: ReactNode;
  actionVariant?: ButtonVariant;
  className?: string;
  onFiles(files: File[]): void;
}

export function FileDropzone({
  accept,
  multiple = false,
  disabled = false,
  icon,
  title,
  description,
  actionLabel,
  actionIcon,
  actionVariant = "primary",
  className,
  onFiles,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const submit = (files: File[]) => {
    if (!disabled && files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  };

  return <div
    className={cx("ui-file-dropzone", dragOver && "ui-file-dropzone--over", disabled && "ui-file-dropzone--disabled", className)}
    onDragEnter={(event) => { event.preventDefault(); if (!disabled) setDragOver(true); }}
    onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragOver(true); }}
    onDragLeave={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
    }}
    onDrop={(event) => {
      event.preventDefault();
      setDragOver(false);
      submit(Array.from(event.dataTransfer.files));
    }}
  >
    <span className="ui-file-dropzone__icon">{icon}</span>
    <Text as="div" size="lg">{title}</Text>
    {description && <Text as="div" tone="secondary">{description}</Text>}
    <Button variant={actionVariant} leadingIcon={actionIcon} disabled={disabled} onClick={() => inputRef.current?.click()}>{actionLabel}</Button>
    <Input
      ref={inputRef}
      type="file"
      accept={accept}
      multiple={multiple}
      hidden
      disabled={disabled}
      onChange={(event) => {
        submit(Array.from(event.target.files ?? []));
        event.target.value = "";
      }}
    />
  </div>;
}
