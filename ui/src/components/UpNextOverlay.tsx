import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Play, SkipForward, X } from "lucide-react";
import "./UpNextOverlay.css";
import type { Video } from "../api";
import { img } from "../img";
import { useI18n } from "../i18n";
import { Button, Switch } from "./ui";

const COUNTDOWN_SECONDS = 5;

export default function UpNextOverlay({ video, autoplayEnabled, loadingNext, onToggleAutoplay, onPlayNow, onSkip, onDismiss }: {
  video: Video;
  autoplayEnabled: boolean;
  loadingNext: boolean;
  onToggleAutoplay: (next: boolean) => void;
  onPlayNow: () => void;
  onSkip: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS);
  const onPlayNowRef = useRef(onPlayNow);
  onPlayNowRef.current = onPlayNow;

  // Countdown only runs (and only auto-advances) while autoplay is on. The
  // overlay itself always shows at the end of a feed video, regardless.
  useEffect(() => {
    if (!autoplayEnabled || loadingNext) return;
    setRemaining(COUNTDOWN_SECONDS);
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      const left = COUNTDOWN_SECONDS - (Date.now() - startedAt) / 1000;
      if (left <= 0) {
        window.clearInterval(interval);
        setRemaining(0);
        onPlayNowRef.current();
      } else {
        setRemaining(left);
      }
    }, 100);
    return () => window.clearInterval(interval);
  }, [video.video_id, autoplayEnabled, loadingNext]);

  const progress = 1 - Math.max(0, remaining) / COUNTDOWN_SECONDS;

  return (
    <div className={`up-next-overlay${loadingNext ? " is-skipping" : ""}`}>
      <div key={`bg-${video.video_id}`} className="up-next-bg" style={{ backgroundImage: `url(${img(video.thumbnail)})` }} aria-hidden="true" />
      <div className="up-next-scrim" aria-hidden="true" />
      <button type="button" className="up-next-close" onClick={onDismiss} aria-label={t("upNextDismiss")}>
        <X size={20} />
      </button>
      <div className="up-next-panel">
        <div className="up-next-eyebrow">{t("upNextLabel")}</div>
        <div key={video.video_id} className="up-next-content">
          <div className="up-next-thumb" onClick={onPlayNow} role="button" tabIndex={0}>
            <img src={img(video.thumbnail)} alt="" />
            <div className="up-next-play"><Play size={30} fill="currentColor" /></div>
            {autoplayEnabled && (
              <svg className="up-next-ring" viewBox="0 0 36 36" aria-hidden="true">
                <circle cx="18" cy="18" r="16" className="up-next-ring-track" />
                <circle
                  cx="18" cy="18" r="16" className="up-next-ring-fill"
                  style={{ strokeDashoffset: `${(1 - progress) * 2 * Math.PI * 16}` }}
                />
              </svg>
            )}
          </div>
          <div className="up-next-title">{video.title}</div>
          <div className="up-next-channel">{video.channel_title}</div>
        </div>

        <div className="up-next-actions">
          <Button variant="primary" className="up-next-play-button" onClick={onPlayNow}>
            <Play size={15} fill="currentColor" />
            {autoplayEnabled ? t("upNextPlayingIn", { n: Math.max(0, Math.ceil(remaining)) }) : t("upNextPlayNow")}
          </Button>
          <Button className="up-next-skip-button" onClick={onSkip} disabled={loadingNext} leadingIcon={loadingNext ? <LoaderCircle className="spin" /> : <SkipForward />}>
            {t("upNextSkip")}
          </Button>
        </div>

        <Switch
          className="up-next-autoplay-switch"
          checked={autoplayEnabled}
          onCheckedChange={onToggleAutoplay}
          label={t("feedAutoplay")}
        />
      </div>
    </div>
  );
}
