import { useMemo, useRef, useState } from "react";
import type { SocialProfileRef } from "../../api";
import { ProfileAvatar } from "../ProfileMenu";
import { FloatingPopover, List, ListButton, Textarea } from "../ui";
import "./ProfileMentionInput.css";

const ACTIVE_MENTION = /(^|\s)@([\p{L}\p{N}_]*)$/u;

export default function ProfileMentionInput({
  value,
  onChange,
  profiles,
  placeholder,
  rows = 3,
  disabled = false,
  maxLength = 2_000,
  className,
  textareaClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  profiles: SocialProfileRef[];
  placeholder: string;
  rows?: number;
  disabled?: boolean;
  maxLength?: number;
  className?: string;
  textareaClassName?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(null);
  const suggestions = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.toLocaleLowerCase();
    return profiles.filter((profile) =>
      profile.username.toLocaleLowerCase().includes(query) || profile.name.toLocaleLowerCase().includes(query)
    ).slice(0, 8);
  }, [mention, profiles]);

  const inspect = (next: string, caret: number) => {
    const match = next.slice(0, caret).match(ACTIVE_MENTION);
    if (!match) {
      setMention(null);
      return;
    }
    const tokenStart = caret - match[2].length - 1;
    setMention({ start: tokenStart, end: caret, query: match[2] });
  };

  const select = (profile: SocialProfileRef) => {
    if (!mention) return;
    const inserted = `@${profile.username}`;
    const next = `${value.slice(0, mention.start)}${inserted} ${value.slice(mention.end)}`;
    const caret = mention.start + inserted.length + 1;
    onChange(next);
    setMention(null);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(caret, caret);
    });
  };

  return <FloatingPopover
    open={Boolean(mention && suggestions.length)}
    onOpenChange={(open) => { if (!open) setMention(null); }}
    align="start"
    triggerClassName={`social-mention-input${className ? ` ${className}` : ""}`}
    className="social-mention-input__popover"
    toggleOnTriggerClick={false}
    trigger={<Textarea
      ref={ref}
      value={value}
      rows={rows}
      maxLength={maxLength}
      disabled={disabled}
      className={textareaClassName}
      placeholder={placeholder}
      onChange={(event) => {
        onChange(event.target.value);
        inspect(event.target.value, event.target.selectionStart);
      }}
      onKeyUp={(event) => inspect(event.currentTarget.value, event.currentTarget.selectionStart)}
    />}
  >
    <List divided={false}>
      {suggestions.map((profile) => <ListButton
        key={profile.id}
        media={<ProfileAvatar profile={profile} size={28} />}
        title={profile.name}
        description={`@${profile.username}`}
        onClick={() => select(profile)}
      />)}
    </List>
  </FloatingPopover>;
}
