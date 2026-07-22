import { useCallback, useEffect, useState } from "react";
import "./ChildNowWatching.css";
import { ChevronDown, Clock3, Play, ShieldBan } from "lucide-react";
import { Link } from "react-router-dom";
import { api, type ChildNowWatching as Watching, type Profile } from "../api";
import { img } from "../img";
import { useI18n } from "../i18n";
import { ProfileAvatar } from "./ProfileMenu";
import { VideoThumbnail } from "./VideoThumbnail";

export default function ChildNowWatching() {
  const { t } = useI18n();
  const [watching, setWatching] = useState<Watching[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const [stopped, setStopped] = useState<Set<number>>(new Set());

  const load = useCallback(() => {
    Promise.all([api.childNowWatching(), api.profiles()])
      .then(([watchingResponse, profilesResponse]) => {
        const activeIds = new Set(watchingResponse.watching.map((item) => item.user_id));
        setStopped((current) => new Set([...current].filter((id) => activeIds.has(id))));
        setWatching(watchingResponse.watching);
        setProfiles(profilesResponse.profiles);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 3_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const visible = watching.filter((item) => !stopped.has(item.user_id));
  const childProfiles = profiles.filter((profile) => profile.is_child);
  const lockedProfiles = childProfiles.filter((profile) => profile.pin_locked);
  const activeProfile = profiles.find((profile) => profile.active);
  if (activeProfile?.is_child || (profiles.length > 0 && childProfiles.length === 0)) return null;

  const stop = async (item: Watching) => {
    setStopped((current) => new Set(current).add(item.user_id));
    try {
      await api.stopChildWatching(item.user_id);
    } catch {
      setStopped((current) => {
        const next = new Set(current);
        next.delete(item.user_id);
        return next;
      });
    }
  };

  const timeLeft = (item: Pick<Watching, "remaining_seconds" | "unlimited_today">) => {
    if (item.unlimited_today || item.remaining_seconds == null) return t("childWatchingNoLimit");
    const minutes = Math.max(0, Math.ceil(item.remaining_seconds / 60));
    if (minutes < 60) return t("childWatchingMinutesLeft", { n: minutes });
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest
      ? t("childWatchingHoursMinutesLeft", { h: hours, m: rest })
      : t("childWatchingHoursLeft", { n: hours });
  };

  const unlock = async (profile: Profile) => {
    await api.unlockChildProfile(profile.id);
    load();
  };

  if (collapsed) {
    return (
      <button className="child-watching-collapsed" onClick={() => setCollapsed(false)} title={t("childWatchingExpand")}>
        <span className="child-watching-avatar-stack">
          {(visible.length > 0 ? visible : childProfiles).slice(0, 3).map((item) => (
            <ProfileAvatar key={"user_id" in item ? item.user_id : item.id} profile={item} size={30} />
          ))}
        </span>
        {visible.length > 0 && (
          <span className="child-watching-collapsed-copy">
            <strong>
              {visible.length === 1
                ? visible[0].name
                : t("childWatchingProfiles", { n: visible.length })}
            </strong>
            <small>{t("childWatchingNow")}</small>
          </span>
        )}
        <span className={`child-watching-pulse${visible.length === 0 ? " idle" : ""}`} />
      </button>
    );
  }

  return (
    <aside className="child-watching-monitor" aria-label={t("childWatchingTitle")}>
      <div className="child-watching-list">
        {visible.length === 0 && (
          childProfiles.filter((profile) => !profile.pin_locked).map((profile) => (
            <div className="child-watching-locked child-watching-idle-profile" key={profile.id}>
              <div className="child-watching-person">
                <ProfileAvatar profile={profile} size={32} />
                <span>
                  <strong>{profile.name}</strong>
                  <small>{t("childWatchingNotWatching")}</small>
                </span>
              </div>
              {profile.child_status && (
                <span className="child-watching-time">
                  <Clock3 />
                  {timeLeft(profile.child_status)}
                </span>
              )}
            </div>
          ))
        )}
        {visible.map((item) => (
          <article className="child-watching-card" key={item.user_id}>
            <div className="child-watching-card-head">
              <div className="child-watching-person">
                <ProfileAvatar profile={item} size={36} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{t("childWatchingNow")}</small>
                </span>
              </div>
              <span className="child-watching-time">
                <Clock3 />
                {timeLeft(item)}
              </span>
            </div>

            <Link className="child-watching-video" to={`/watch/${item.video_id}`} title={t("childWatchingPlay")}>
              <VideoThumbnail src={img(item.thumbnail)} watched={false} variant="childWatching" loading="lazy">
                <span className="child-watching-play"><Play fill="currentColor" /></span>
              </VideoThumbnail>
              <span className="child-watching-copy">
                <strong>{item.title}</strong>
                <span className="child-watching-author">
                  {item.channel_thumbnail && <img src={img(item.channel_thumbnail)} alt="" />}
                  {item.channel_title}
                </span>
              </span>
            </Link>

            <div className="child-watching-actions">
              <button className="child-watching-stop" onClick={() => stop(item)}>
                <ShieldBan /> {t("childWatchingStop")}
              </button>
            </div>
          </article>
        ))}
        {lockedProfiles.map((profile) => (
          <div className="child-watching-locked" key={profile.id}>
            <div className="child-watching-person">
              <ProfileAvatar profile={profile} size={32} />
              <span>
                <strong>{profile.name}</strong>
                <small>{t("childWatchingLocked")}</small>
              </span>
            </div>
            <button onClick={() => unlock(profile)}>{t("childUnlockProfile")}</button>
          </div>
        ))}
      </div>
      <button
        className="child-watching-collapse"
        onClick={() => setCollapsed(true)}
        title={t("childWatchingCollapse")}
        aria-label={t("childWatchingCollapse")}
      >
        <ChevronDown />
      </button>
    </aside>
  );
}
