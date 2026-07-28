import { useState, type ReactElement } from "react";
import { useI18n } from "../i18n";
import { Button, FloatingPopover, type ButtonVariant } from "./ui";

export default function Popconfirm({
  message,
  onConfirm,
  confirmLabel,
  confirmVariant = "danger",
  children,
}: {
  message: string;
  onConfirm: () => void;
  confirmLabel?: string;
  confirmVariant?: ButtonVariant;
  children: ReactElement;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <FloatingPopover
      open={open}
      onOpenChange={setOpen}
      align="center"
      className="popconfirm-popover"
      trigger={children}
    >
      <div className="popconfirm-msg">{message}</div>
      <div className="popconfirm-actions">
        <Button
          size="sm"
          variant={confirmVariant}
          onClick={(event) => {
            event.stopPropagation();
            onConfirm();
            setOpen(false);
          }}
        >
          {confirmLabel ?? t("yes")}
        </Button>
        <Button size="sm" onClick={(event) => { event.stopPropagation(); setOpen(false); }}>
          {t("cancel")}
        </Button>
      </div>
    </FloatingPopover>
  );
}
