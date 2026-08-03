import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { SocialProfileRef } from "../../api";
import "./SocialCompactMessage.css";

export type SocialCompactMessageVariant = "preview" | "chat";

export interface SocialCompactMessageProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  author: SocialProfileRef;
  children: ReactNode;
  variant?: SocialCompactMessageVariant;
  /** Optional visible timestamp for chat messages. */
  time?: ReactNode;
  dateTime?: string;
  /** Visually joins a consecutive chat message from the same author. */
  continuation?: boolean;
  /** Staggers the lightweight reveal used by compact message lists. */
  revealIndex?: number;
}

/** Compact profile message shared by Social previews and adjacent chat surfaces. */
export default function SocialCompactMessage({
  author,
  children,
  variant = "preview",
  time,
  dateTime,
  continuation = false,
  revealIndex = 0,
  className,
  style,
  ...props
}: SocialCompactMessageProps) {
  const initial = author.name.trim()[0]?.toUpperCase() ?? "?";
  const messageStyle = {
    ...style,
    "--social-compact-message-index": revealIndex,
  } as CSSProperties;

  return <article
    {...props}
    className={`social-compact-message social-compact-message--${variant}${continuation ? " social-compact-message--continuation" : ""}${className ? ` ${className}` : ""}`}
    style={messageStyle}
  >
    {(!continuation || variant === "preview") && (author.avatar
      ? <img className="social-compact-message__avatar" src={author.avatar} alt="" decoding="async" />
      : <span className="social-compact-message__avatar social-compact-message__avatar--fallback" style={{ background: author.avatar_color }}>{initial}</span>)}
    {variant === "preview" ? <>
      <strong className="social-compact-message__author">{author.name}</strong>
      <span className="social-compact-message__text">{children}</span>
    </> : <div className="social-compact-message__body">
      {!continuation && <header className="social-compact-message__header">
        <strong className="social-compact-message__author">{author.name}</strong>
        {time != null && <time dateTime={dateTime}>{time}</time>}
      </header>}
      {continuation && <span className="sr-only">{author.name}: </span>}
      <div className="social-compact-message__text">
        {children}
        {continuation && time != null && <time className="social-compact-message__inline-meta" dateTime={dateTime}>{time}</time>}
      </div>
    </div>}
  </article>;
}
