import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Bell, ListVideo, MessageCircle, Sparkles, UsersRound } from "lucide-react";
import { api, type AppNotification } from "../api";
import { subscribe } from "../events";
import { useI18n } from "../i18n";
import { img } from "../img";
import { Button, EmptyState, FloatingPopover, IconButton, List, ListButton, ScrollArea } from "./ui";
import "./NotificationCenter.css";
import { formatAppDate, parseAppTimestamp } from "../dateTime";
import { subscribeServerEvent } from "../serverEvents";

function notificationTime(value: string, locale: string, timeZone: string, justNow: string): string {
  const date = parseAppTimestamp(value);
  if (!Number.isFinite(date.getTime())) return "";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  if (Math.abs(seconds) < 60) return justNow;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (Math.abs(seconds) < 86_400) return formatter.format(Math.round(seconds / 3600), "hour");
  if (Math.abs(seconds) < 604_800) return formatter.format(Math.round(seconds / 86_400), "day");
  return formatAppDate(date, locale, timeZone, { day: "2-digit", month: "short" });
}

export default function NotificationCenter() {
  const { t, locale, timeZone } = useI18n();
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
    return subscribeServerEvent("notifications", load);
  }, [load]);
  useEffect(() => subscribe("notifications-changed", load), [load]);

  const select = async (notification: AppNotification) => {
    if (!notification.read_at) {
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item));
      setUnread((count) => Math.max(0, count - 1));
      await api.readNotification(notification.id).catch(load);
    }
    setOpen(false);
    const socialPostTarget = notification.kind.startsWith("social_") && notification.payload.postId
      ? `/social/${encodeURIComponent(notification.payload.postId)}`
      : notification.target;
    if (socialPostTarget) navigate(socialPostTarget);
  };

  const readAll = async () => {
    const now = new Date().toISOString();
    setNotifications((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? now })));
    setUnread(0);
    await api.readAllNotifications().catch(load);
  };

  return <div className="profile-notifications-wrap">
    <FloatingPopover
      open={open}
      onOpenChange={(next) => { setOpen(next); if (next) load(); }}
      align="end"
      className="profile-notifications-popover"
      trigger={<IconButton variant="ghost" size="sm" className="profile-notifications-trigger" label={t("notifications")} icon={<><Bell />{unread > 0 && <span className="profile-notifications-count">{unread > 9 ? "9+" : unread}</span>}</>} />}
    >
      <div className="profile-notifications-panel" role="dialog" aria-label={t("notifications")}>
      <div className="ui-popover__title">{t("notifications")}</div>
      {notifications.length === 0 ? (
        <EmptyState compact title={t("notificationsEmpty")} className="profile-notifications-empty" />
      ) : (
        <>
          <ScrollArea viewportClassName="profile-notifications-list">
          <List divided={false}>
            {notifications.map((notification) => {
              const playlistVideo = notification.kind === "playlist_video";
              const downloadFailed = notification.kind === "download_failed";
              const social = notification.kind.startsWith("social_");
              const media = social && notification.payload.actor
                ? notification.payload.actor.avatar
                  ? <img className="profile-notification-avatar" src={notification.payload.actor.avatar} alt="" decoding="async" />
                  : <span className="profile-notification-avatar profile-notification-avatar--fallback" style={{ background: notification.payload.actor.avatar_color }}>{notification.payload.actor.name.trim()[0]?.toUpperCase() ?? "?"}</span>
                : downloadFailed
                ? <span className="profile-notification-icon profile-notification-icon--danger"><AlertTriangle /></span>
                : playlistVideo
                  ? notification.payload.channelThumbnail
                    ? <img className="profile-notification-avatar" src={img(notification.payload.channelThumbnail)} alt="" />
                    : <span className="profile-notification-icon"><ListVideo /></span>
                  : social ? <span className="profile-notification-icon">{notification.kind === "social_post" ? <UsersRound /> : <MessageCircle />}</span>
                  : <span className="profile-notification-icon"><Sparkles /></span>;
              const socialActor = notification.payload.actor?.name ?? t("socialNotificationSomeone");
              const title = social
                ? t(notification.kind === "social_post" ? "socialNotificationNewPost" : notification.kind === "social_comment" ? "socialNotificationComment" : notification.kind === "social_mention" ? "socialNotificationMention" : notification.kind === "social_comment_like" ? "socialNotificationCommentLike" : "socialNotificationReaction", { profile: socialActor })
                : downloadFailed
                ? notification.payload.videoTitle || t("downloadFailedNotificationTitle")
                : playlistVideo ? notification.payload.videoTitle || t("playlistVideoNotificationTitle") : t("updateNotificationTitle");
              const description = social
                ? notification.payload.commentBody || notification.payload.postBody
                  ? <span className="profile-notification-comment-quote">“{notification.payload.commentBody || notification.payload.postBody}”</span>
                  : t("socialNotificationOpen")
                : downloadFailed
                ? t("downloadFailedNotificationDescription")
                : playlistVideo ? t("playlistVideoNotificationDescription", { playlist: notification.payload.playlistTitle || "" }) : t("updateNotificationDescription", { version: notification.payload.version ?? "" });
              return <ListButton
                  className={`profile-notification profile-notification--${social ? "social" : downloadFailed ? "download-failed" : playlistVideo ? "playlist" : "update"}${notification.read_at ? " is-read" : " is-unread"}`}
                  key={notification.id}
                  onClick={() => void select(notification)}
                  media={media}
                  title={title}
                  description={description}
                  meta={(playlistVideo || downloadFailed) && notification.payload.thumbnail ? <img className="profile-notification-thumbnail" src={img(notification.payload.thumbnail)} alt="" /> : undefined}
                >
                  <time>{notificationTime(notification.created_at, locale, timeZone, t("notificationJustNow"))}</time>
                </ListButton>;
            })}
          </List>
          </ScrollArea>
          {unread > 0 && <Button type="button" size="sm" variant="ghost" className="profile-notifications-read-all" onClick={() => void readAll()}>{t("markAllNotificationsRead")}</Button>}
        </>
      )}
      </div>
    </FloatingPopover>
  </div>;
}
