import { useState } from "react";
import { Link } from "react-router-dom";
import type { VideoCreator } from "../api";
import { img } from "../img";
import { useI18n } from "../i18n";
import { FloatingPopover } from "./ui";

function separator(index: number, length: number, language: "en" | "pl" | "de") {
  if (index === 0) return "";
  if (index < length - 1) return ", ";
  return language === "pl" ? " i " : language === "de" ? " und " : " and ";
}

export default function VideoCreators({ creators }: { creators: VideoCreator[] }) {
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);
  if (creators.length === 0) return null;

  const visibleAvatars = creators.slice(0, 3);
  const multiple = creators.length > 1;
  return <FloatingPopover
    open={open}
    onOpenChange={setOpen}
    align="start"
    className="video-creators-popover"
    trigger={(
      <button type="button" className={`watch-channel-top video-creators video-creators-trigger${multiple ? " video-creators--multiple" : ""}`} aria-label={t("videoCreatorsTitle")}>
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
            {creators.map((creator, index) => (
              <span key={creator.channelId}>
                {separator(index, creators.length, language)}
                <span className="name channel-link">{creator.title}</span>
              </span>
            ))}
          </span>
          {multiple ? (
            <span className="sub">{t("videoCollaborators")}</span>
          ) : creators[0].subscriberCount ? (
            <span className="sub">{creators[0].subscriberCount} {t("subscribers")}</span>
          ) : null}
        </span>
      </button>
    )}
  >
    <>
      <div className="ui-popover__title">{t("videoCreatorsTitle")}</div>
      <div className="video-creators-list">
        {creators.map((creator) => (
          <Link
            key={creator.channelId}
            to={`/channel/${creator.channelId}`}
            className="video-creators-list-item"
            onClick={() => setOpen(false)}
          >
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
          </Link>
        ))}
      </div>
    </>
  </FloatingPopover>;
}
