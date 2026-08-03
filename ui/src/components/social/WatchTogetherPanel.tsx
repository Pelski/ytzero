import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type UIEvent } from "react";
import { Check, Copy, Crown, LoaderCircle, LogOut, MessageCircle, Send, Square } from "lucide-react";
import type { SocialWatchParty, SocialWatchPartyMessage } from "../../api";
import { formatTimeAgo, useI18n } from "../../i18n";
import { ProfileAvatar } from "../ProfileMenu";
import { Alert, Badge, Button, EmptyState, IconButton, ScrollArea, SectionHeader, Textarea } from "../ui";
import SocialCompactMessage from "./SocialCompactMessage";
import "./WatchTogetherPanel.css";

export interface WatchTogetherPanelProps {
  room: SocialWatchParty;
  selfId: number;
  connected: boolean;
  sending: boolean;
  error?: string | null;
  copied: boolean;
  onSend: (body: string) => void;
  onCopyInvite: () => void;
  onLeave: () => void;
  onEnd: () => void;
}

const BOTTOM_STICK_DISTANCE = 48;

/** Presentational room chat; transport and playback synchronization stay with its owner. */
export default function WatchTogetherPanel({
  room,
  selfId,
  connected,
  sending,
  error,
  copied,
  onSend,
  onCopyInvite,
  onLeave,
  onEnd,
}: WatchTogetherPanelProps) {
  const { t, language } = useI18n();
  const composerId = useId();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const refocusComposerAfterSendRef = useRef(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);
  const renderedRoomRef = useRef(room.id);
  const [body, setBody] = useState("");
  const isHost = room.host.id === selfId;
  const participants = useMemo(() => {
    const unique = new Map([[room.host.id, room.host]]);
    for (const participant of room.participants) unique.set(participant.id, participant);
    return [...unique.values()];
  }, [room.host, room.participants]);
  const messages = useMemo(
    () => [...room.messages].sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id)),
    [room.messages],
  );
  const messageGroups = useMemo(() => {
    const groups: Array<Array<{ message: SocialWatchPartyMessage; index: number }>> = [];
    messages.forEach((message, index) => {
      const currentGroup = groups[groups.length - 1];
      if (currentGroup?.[0].message.author.id === message.author.id) currentGroup.push({ message, index });
      else groups.push([{ message, index }]);
    });
    return groups;
  }, [messages]);
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    setBody("");
    refocusComposerAfterSendRef.current = false;
  }, [room.id]);

  useEffect(() => {
    if (sending || !connected || !refocusComposerAfterSendRef.current) return;
    refocusComposerAfterSendRef.current = false;
    composerRef.current?.focus();
  }, [connected, sending]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const keepPinnedAfterResize = () => {
      if (pinnedToBottomRef.current) viewport.scrollTop = viewport.scrollHeight;
    };
    const observer = new ResizeObserver(keepPinnedAfterResize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [room.id]);

  useLayoutEffect(() => {
    if (renderedRoomRef.current !== room.id) {
      renderedRoomRef.current = room.id;
      pinnedToBottomRef.current = true;
    }
    const viewport = viewportRef.current;
    if (!viewport || !pinnedToBottomRef.current) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [lastMessage?.id, lastMessage?.sequence, messages.length, room.id]);

  const trackScrollPosition = (event: UIEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget;
    const remaining = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    pinnedToBottomRef.current = remaining <= BOTTOM_STICK_DISTANCE;
  };

  const submit = (event?: FormEvent, refocusAfterSend = false) => {
    event?.preventDefault();
    const next = body.trim();
    if (!next || sending || !connected) return;
    pinnedToBottomRef.current = true;
    refocusComposerAfterSendRef.current = refocusAfterSend;
    onSend(next);
    setBody("");
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit(undefined, true);
  };

  return <section className="watch-together-panel" aria-label={t("watchTogetherTitle")} aria-busy={!connected}>
    <div className="watch-together-panel__header">
      <SectionHeader
        level={3}
        title={t("watchTogetherTitle")}
        description={!isHost ? t("watchTogetherHostControls") : undefined}
        actions={!connected ? <Badge variant="warning" aria-label={t("watchTogetherConnecting")}>
          <LoaderCircle className="spin" aria-hidden="true" /> {t("watchTogetherConnecting")}
        </Badge> : undefined}
      />

      <div className="watch-together-panel__participants">
        <span className="watch-together-panel__participants-label">{t("watchTogetherParticipants")}</span>
        <div className="watch-together-panel__participant-list" role="list" aria-label={t("watchTogetherParticipants")}>
          {participants.map((participant) => <span
            className={`watch-together-panel__participant${participant.id === selfId ? " is-self" : ""}`}
            title={participant.name}
            role="listitem"
            key={participant.id}
          >
            <ProfileAvatar profile={participant} size={24} />
            <span>{participant.name}</span>
            {participant.id === room.host.id && <Badge size="sm" aria-label={t("watchTogetherHost")} title={t("watchTogetherHost")}>
              <Crown aria-hidden="true" />
            </Badge>}
          </span>)}
        </div>
      </div>

      <div className="watch-together-panel__controls">
        <IconButton
          size="sm"
          variant={copied ? "secondary" : "ghost"}
          label={t(copied ? "watchTogetherCopied" : "watchTogetherCopyInvite")}
          icon={copied ? <Check /> : <Copy />}
          onClick={onCopyInvite}
        />
        <span className="sr-only" role="status" aria-live="polite">{copied ? t("watchTogetherCopied") : ""}</span>
        {isHost
          ? <Button size="sm" variant="ghost" leadingIcon={<Square />} onClick={onEnd}>{t("watchTogetherEnd")}</Button>
          : <Button size="sm" variant="ghost" leadingIcon={<LogOut />} onClick={onLeave}>{t("watchTogetherLeave")}</Button>}
      </div>

      {error && <Alert className="watch-together-panel__error" variant="danger">{error}</Alert>}
    </div>

    <ScrollArea
      ref={viewportRef}
      className="watch-together-panel__scroll"
      viewportClassName="watch-together-panel__viewport"
      onScroll={trackScrollPosition}
    >
      <div className="watch-together-panel__log" role="log" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 ? <EmptyState
          compact
          className="watch-together-panel__empty"
          icon={<MessageCircle />}
          title={t("watchTogetherEmptyChatTitle")}
          description={t("watchTogetherEmptyChatHint")}
        /> : messageGroups.map((group) => <div className="watch-together-panel__message-group" key={group[0].message.id}>
          {group.map(({ message, index }, groupIndex) => <SocialCompactMessage
            author={message.author}
            variant="chat"
            continuation={groupIndex > 0}
            time={formatTimeAgo(message.created_at, language)}
            dateTime={message.created_at}
            revealIndex={Math.min(index, 6)}
            key={message.id}
          >
            {message.body}
          </SocialCompactMessage>)}
        </div>)}
      </div>
    </ScrollArea>

    <form className="watch-together-panel__composer" onSubmit={submit}>
      <label className="sr-only" htmlFor={composerId}>{t("watchTogetherMessagePlaceholder")}</label>
      <Textarea
        ref={composerRef}
        id={composerId}
        rows={2}
        maxLength={500}
        value={body}
        disabled={!connected || sending}
        placeholder={connected ? t("watchTogetherMessagePlaceholder") : t("watchTogetherConnecting")}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleComposerKeyDown}
      />
      <IconButton
        type="submit"
        variant="primary"
        label={t("watchTogetherSend")}
        icon={sending ? <LoaderCircle className="spin" /> : <Send />}
        disabled={!connected || sending || !body.trim()}
      />
    </form>
  </section>;
}
