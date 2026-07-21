import { useState, type ReactElement } from "react";
import { useI18n } from "../i18n";
import { Button, FloatingPopover } from "./ui";

export default function Popconfirm({
  message,
  onConfirm,
  children,
}: {
  message: string;
  onConfirm: () => void;
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
          variant="danger"
          onClick={(event) => {
            event.stopPropagation();
            onConfirm();
            setOpen(false);
          }}
        >
          {t("yes")}
        </Button>
        <Button size="sm" onClick={(event) => { event.stopPropagation(); setOpen(false); }}>
          {t("cancel")}
        </Button>
      </div>
    </FloatingPopover>
  );
}
