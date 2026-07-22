import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button, type ButtonProps } from "./Button";
import { FloatingPopover } from "./FloatingPopover";
import { Menu } from "./Menu";
import "./SplitButton.css";

export interface SplitButtonProps extends Omit<ButtonProps, "trailingIcon"> {
  menu: ReactNode;
  menuLabel: string;
  align?: "start" | "center" | "end";
}

export function SplitButton({ menu, menuLabel, align = "end", className, children, ...props }: SplitButtonProps) {
  const [open, setOpen] = useState(false);
  return <div className={`ui-split-button${className ? ` ${className}` : ""}`}>
    <Button className="ui-split-button__main" {...props}>{children}</Button>
    <FloatingPopover
      open={open}
      onOpenChange={setOpen}
      align={align}
      trigger={<Button className="ui-split-button__toggle" variant={props.variant} size={props.size} iconOnly aria-label={menuLabel}><ChevronDown /></Button>}
    >
      <Menu>{menu}</Menu>
    </FloatingPopover>
  </div>;
}
