import type { CSSProperties, ReactNode } from "react";

export default function Tooltip({ text, pos = "left", delay, className, children }: {
  text: string;
  pos?: "left" | "right" | "top" | "bottom";
  /** Delay only the appearance; hiding remains immediate. */
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`tooltip-wrap tooltip-wrap--${pos}${delay ? " tooltip-wrap--delayed" : ""}${className ? ` ${className}` : ""}`}
      style={delay ? ({ "--tooltip-delay": `${delay}ms` } as CSSProperties) : undefined}
    >
      {children}
      <span className="tooltip-tip">{text}</span>
    </span>
  );
}
