import { useState } from "react";
import { Link } from "react-router-dom";
import type { VideoCreator } from "../api";
import { img } from "../img";
import { useI18n } from "../i18n";
import { FloatingPopover } from "./ui";
import "./VideoCreators.css";

function creatorListParts(length: number, locale: string) {
  const tokens = Array.from({ length }, (_, index) => `\u0000${index}\u0000`);
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).formatToParts(tokens);
}

export default function VideoCreators({ creators, linkChannels = true }: { creators: VideoCreator[]; linkChannels?: boolean }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  if (creators.length === 0) return null;

  const visibleAvatars = creators.slice(0, 3);
  const multiple = creators.length > 1;
  const triggerContent = <>
    <span className="video-creators-avatars" aria-hidden="true">
      {visibleAvatars.map((creator, index) => (
        <span
          className="video-creators-avatar-link"
          style={{ zIndex: visibleAvatars.length - index }}
          key={creator.channelId}
        >
          {creator.avatar ? <img className="watch-ch-avatar" src={img(creator.avatar)} alt="" /> : <span className="watch-ch-avatar video-creators-avatar-placeholder" />}
        </span>
      ))}
      {creators.length > visibleAvatars.length && (
        <span className="video-creators-avatar-more">+{creators.length - visibleAvatars.length}</span>
      )}
    </span>
    <span className="video-creators-copy">
      <span className="video-creators-names">
        {creatorListParts(creators.length, locale).map((part, index) => {
          const match = part.type === "element" ? /^\u0000(\d+)\u0000$/.exec(part.value) : null;
          return match
            ? <span key={creators[Number(match[1])].channelId} className="name channel-link">{creators[Number(match[1])].title}</span>
            : <span key={`literal-${index}`}>{part.value}</span>;
        })}
      </span>
      {multiple ? (
        <span className="sub">{t("videoCollaborators")}</span>
      ) : creators[0].subscriberCount ? (
        <span className="sub">{creators[0].subscriberCount} {t("subscribers")}</span>
      ) : null}
    </span>
  </>;

  if (!multiple) {
    return linkChannels
      ? <Link to={`/channel/${creators[0].channelId}`} className="watch-channel-top video-creators video-creators-trigger" aria-label={creators[0].title}>{triggerContent}</Link>
      : <div className="watch-channel-top video-creators" aria-label={creators[0].title}>{triggerContent}</div>;
  }

  return <FloatingPopover
    open={open}
    onOpenChange={setOpen}
    align="start"
    className="video-creators-popover"
    trigger={(
      <button type="button" className="watch-channel-top video-creators video-creators-trigger video-creators--multiple" aria-label={t("videoCreatorsTitle")}>
        {triggerContent}
      </button>
    )}
  >
    <>
      <div className="ui-popover__title">{t("videoCreatorsTitle")}</div>
      <div className="video-creators-list">
        {creators.map((creator) => {
          const content = <>
            {creator.avatar ? (
              <img className="video-creators-list-avatar" src={img(creator.avatar)} alt="" />
            ) : (
              <span className="video-creators-list-avatar video-creators-avatar-placeholder" />
            )}
            <span className="video-creators-list-copy">
              <strong>{creator.title}</strong>
              {(creator.handle || creator.subscriberCount) && (
                <span>{[creator.handle, creator.subscriberCount].filter(Boolean).join(" · ")}</span>
              )}
            </span>
          </>;
          return linkChannels
            ? <Link key={creator.channelId} to={`/channel/${creator.channelId}`} className="video-creators-list-item" onClick={() => setOpen(false)}>{content}</Link>
            : <div key={creator.channelId} className="video-creators-list-item">{content}</div>;
        })}
      </div>
    </>
  </FloatingPopover>;
}
