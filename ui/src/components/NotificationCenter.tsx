import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ListVideo, Sparkles } from "lucide-react";
import { api, type AppNotification } from "../api";
import { subscribe } from "../events";
import { useI18n } from "../i18n";
import { img } from "../img";
import { Button, EmptyState, IconButton, List, ListButton, Popover } from "./ui";

function notificationTime(value: string, locale: string, justNow: string): string {
  const date = new Date(`${value.replace(" ", "T")}Z`);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  if (Math.abs(seconds) < 60) return justNow;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (Math.abs(seconds) < 86_400) return formatter.format(Math.round(seconds / 3600), "hour");
  if (Math.abs(seconds) < 604_800) return formatter.format(Math.round(seconds / 86_400), "day");
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" }).format(date);
}

export default function NotificationCenter() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(() => {
    api.notifications().then((result) => {
      setNotifications(result.notifications);
      setUnread(result.unread);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => subscribe("notifications-changed", load), [load]);

  const select = async (notification: AppNotification) => {
    if (!notification.read_at) {
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item));
      setUnread((count) => Math.max(0, count - 1));
      await api.readNotification(notification.id).catch(load);
    }
    setOpen(false);
    if (notification.target) navigate(notification.target);
  };

  const readAll = async () => {
    const now = new Date().toISOString();
    setNotifications((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? now })));
    setUnread(0);
    await api.readAllNotifications().catch(load);
  };

  return <div className="profile-notifications-wrap">
    <Popover
      open={open}
      onOpenChange={(next) => { setOpen(next); if (next) load(); }}
      align="end"
      title={t("notifications")}
      className="profile-notifications-popover"
      trigger={<IconButton variant="ghost" size="sm" className="profile-notifications-trigger" label={t("notifications")} icon={<><Bell />{unread > 0 && <span className="profile-notifications-count">{unread > 9 ? "9+" : unread}</span>}</>} />}
    >
      {notifications.length === 0 ? (
        <EmptyState compact title={t("notificationsEmpty")} className="profile-notifications-empty" />
      ) : (
        <>
          <List divided={false} className="profile-notifications-list">
            {notifications.map((notification) => {
              const playlistVideo = notification.kind === "playlist_video";
              const media = playlistVideo
                ? notification.payload.channelThumbnail
                  ? <img className="profile-notification-avatar" src={img(notification.payload.channelThumbnail)} alt="" />
                  : <span className="profile-notification-icon"><ListVideo /></span>
                : <span className="profile-notification-icon"><Sparkles /></span>;
              return <ListButton
                  className={`profile-notification profile-notification--${playlistVideo ? "playlist" : "update"}${notification.read_at ? " is-read" : " is-unread"}`}
                  key={notification.id}
                  onClick={() => void select(notification)}
                  media={media}
                  title={playlistVideo ? notification.payload.videoTitle || t("playlistVideoNotificationTitle") : t("updateNotificationTitle")}
                  description={playlistVideo ? t("playlistVideoNotificationDescription", { playlist: notification.payload.playlistTitle || "" }) : t("updateNotificationDescription", { version: notification.payload.version ?? "" })}
                  meta={playlistVideo && notification.payload.thumbnail ? <img className="profile-notification-thumbnail" src={img(notification.payload.thumbnail)} alt="" /> : undefined}
                >
                  <time>{notificationTime(notification.created_at, locale, t("notificationJustNow"))}</time>
                </ListButton>;
            })}
          </List>
          {unread > 0 && <Button type="button" size="sm" variant="ghost" className="profile-notifications-read-all" onClick={() => void readAll()}>{t("markAllNotificationsRead")}</Button>}
        </>
      )}
    </Popover>
  </div>;
}
