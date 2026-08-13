import { lazy, Suspense, useState, type CSSProperties } from "react";
import "./WatchPage.css";
import { emitToast } from "../events";
import { Link } from "react-router-dom";
import {
  Archive,
  AlertTriangle,
  ArrowDownToLine,
  BookmarkPlus,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Clapperboard,
  Copy,
  Captions,
  EllipsisVertical,
  ExternalLink,
  Eye,
  Gauge,
  HardDrive,
  LoaderCircle,
  MonitorPlay,
  Pause,
  Play,
  Share2,
  SkipForward,
  ThumbsUp,
  Trash2,
  Undo2,
  UsersRound,
} from "lucide-react";
import { api, SB_CATEGORIES, PLAYBACK_SPEEDS } from "../api";
import { compactNumber, formatPlaylistVideoCount, formatTimeAgo, formatViewsCount } from "../i18n";
import { formatAppDate } from "../dateTime";
import TagChip from "../components/TagChip";
import LocalPlayer from "../components/LocalPlayer";
import Popconfirm from "../components/Popconfirm";
import PlaylistPicker from "../components/PlaylistPicker";
import { formatVideoDuration } from "../components/VideoCard";
import { VideoThumbnail, watchProgress } from "../components/VideoThumbnail";
import { SchedulePicker, VideoScheduleActions } from "../components/VideoScheduleActions";
import UpNextOverlay from "../components/UpNextOverlay";
import { img } from "../img";
import { Alert, Button, ButtonAnchor, Checkbox, IconButton, LocalToast, Menu, MenuItem, MenuSeparator, MenuStatus, Popover, ScrollArea, Switch } from "../components/ui";
import { WatchPanel } from "../components/WatchPanel";
import VideoCreators from "../components/VideoCreators";
import Tooltip from "../components/Tooltip";
import { markYouTubeUrl } from "../youtubeUrl";
import VideoComments from "../components/VideoComments";
import SocialShareDialog from "../components/social/SocialShareDialog";
import { getWatchTogetherLabels, WatchTogetherJoinStatus, WatchTogetherPanelSlot } from "../components/social/WatchTogetherWatchUi";
import WatchDescription from "../components/watch/WatchDescription";
import WatchPlaylistPanel from "../components/watch/WatchPlaylistPanel";
import WatchPlayerModeToggle from "../components/watch/WatchPlayerModeToggle";
import WatchRestrictedPlayer from "../components/watch/WatchRestrictedPlayer";
import { colonDurationToSeconds, formatWatchTime } from "./watchRuntime";
import { useWatchPageController } from "./useWatchPageController";
import WatchPlayerFeedback from "./WatchPlayerFeedback";
import { useProfileAudioMode } from "../audioModePreference";
const TranscriptDialog = lazy(() => import("../components/TranscriptDialog"));
const AudioModePlayer = lazy(() => import("../components/AudioModePlayer"));

export default function WatchPage() {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [audioMode, setAudioMode] = useProfileAudioMode();
  // The controller derives the effective active state from video/profile/room
  // eligibility before it decides whether to mount the iframe.
  const controller = useWatchPageController(audioMode);
  if (!controller) return null;
  const {
    activePlaylistItemRef,
    audioActive,
    audioModeAvailable,
    appUrl,
    backgroundDownload,
    cancelOrRemoveDownload,
    canPlayNextVideo,
    captionsDefaultLang,
    captionsDefaultOn,
    capturePlaybackPosition,
    changeSpeed,
    changeSubtitleSize,
    chapters,
    childDownloadsOnly,
    chooseYouTube,
    cinemaMode,
    cinemaVisible,
    copyKey,
    copyShareLink,
    createPlaylist,
    creatorHandles,
    descExpandable,
    descOpen,
    descriptionRef,
    disabledSegs,
    downloadFeedbackKind,
    downloadFeedbackVisible,
    downloadRequestError,
    downloadStatus,
    downloadSubtitleLanguages,
    downloadsEnabled,
    dismissUpNextVideo,
    exitStreaming,
    goToUpNextVideo,
    handleEnded,
    id,
    isChildProfile,
    keyboardSeekSeconds,
    language,
    likeButtonRef,
    locale,
    membersOnlyNotice,
    moreOpen,
    moreView,
    newPlaylistIcon,
    newPlaylistName,
    openPlaylistMenu,
    playerKind,
    playerRef,
    playerWrapRef,
    playNextVideo,
    playlistId,
    playlistIndex,
    playlistItemsRef,
    playlistOpen,
    playbackStartSeconds,
    playlistSort,
    playlistVideos,
    playlists,
    playlistsLoading,
    privateVideoNotice,
    queue,
    related,
    reload,
    reloadDownloadedPlayer,
    requestDownload,
    requestYouTubePlayback,
    sbPaused,
    sbSegments,
    scheduleOpen,
    scheduleToast,
    screenshotFilenameTemplate,
    screenshotFormat,
    screenshotQuality,
    setCinemaMode,
    setDescOpen,
    setDesktopPlaylistOpen,
    setDisabledSegs,
    setMoreOpen,
    setMoreView,
    setNewPlaylistIcon,
    setNewPlaylistName,
    setSbPaused,
    setScheduleOpen,
    setShareOpen,
    setShareWithTimestamp,
    setSocialShareOpen,
    setSourceChoice,
    setSpeedOpen,
    settings,
    shareLink,
    shareOpen,
    shareWithTimestamp,
    sharedStartSeconds,
    shortcutFeedback,
    showComments,
    showRelated,
    showShortcutFeedback,
    skipUpNextVideo,
    socialEnabled,
    socialShareOpen,
    speed,
    speedOpen,
    subtitleSize,
    t,
    timeZone,
    toggleFeedAutoplay,
    toggleLiked,
    togglePlaylist,
    toggleRelatedSchedule,
    upNextVideo,
    upNextLoadingNext,
    usingLocal,
    video,
    videoCreators,
    videoInfo,
    videoMissing,
    videoPlaylists,
    waitError,
    waitProgress,
    watchTogether,
    watchTogetherEnabled,
    watchTogetherRoomId,
    watchTogetherTransportLocked,
    youtubeAutoplayBlocked,
    youtubeError,
    ytWrapRef,
  } = controller;

  const { errorText: watchTogetherError, transportLockLabel: watchTogetherTransportLockLabel } = getWatchTogetherLabels(watchTogether, t);
  return (
    <div className={`watch-layout${cinemaMode ? " theater" : ""}${watchTogether.room ? " together" : ""}`}>
      <div>
        <div className={`watch-player-stage${watchTogether.room ? " watch-player-stage--together" : ""}`}>
          <div className="cinema-player-wrap">
          {video && (
            <div
              className="player-glow"
              style={{ backgroundImage: `url(${img(video.thumbnail)})`, opacity: cinemaVisible ? 0.6 : 0 }}
            />
          )}
          <div className="watch-player-shell">
            <WatchPlayerModeToggle
              active={audioActive}
              available={audioModeAvailable}
              audioLabel={t("playerAudioMode")}
              videoLabel={t("playerAudioModeExit")}
              onToggle={(active) => { capturePlaybackPosition(); setAudioMode(active); }}
            />
            <div
              ref={playerWrapRef}
              className={`watch-player${audioActive ? " watch-player--audio" : ""}${usingLocal ? " watch-player--local" : ""}${watchTogetherTransportLocked ? " watch-player--transport-locked" : ""}`}
            >
              {audioActive && video ? (
                <Suspense fallback={null}>
                  <AudioModePlayer
                    key={`${video.video_id}-${video.live_status}-audio-${sharedStartSeconds}`}
                    ref={playerRef}
                    src={video.live_status === "live" ? api.liveAudioUrl(video.video_id) : api.audioUrl(video.video_id)}
                    live={video.live_status === "live"} videoId={video.video_id}
                    title={video.title} channelTitle={video.channel_title}
                    artworkUrl={img(video.thumbnail)}
                    startSeconds={video.live_status === "live" ? 0 : playbackStartSeconds}
                    playbackRate={video.live_status === "live" ? 1 : Number(speed)}
                    keyboardSeekSeconds={keyboardSeekSeconds}
                    onEnded={video.live_status === "live" ? undefined : handleEnded} onReload={reload}
                  />
                </Suspense>
              ) : (privateVideoNotice || membersOnlyNotice) && video ? (
                <WatchRestrictedPlayer
                  kind={privateVideoNotice ? "private" : "members"}
                  thumbnailUrl={img(video.thumbnail)}
                  title={t(privateVideoNotice ? "privateVideoWatchTitle" : "membersOnlyWatchTitle")}
                  description={t(privateVideoNotice ? "privateVideoWatchDescription" : "membersOnlyWatchDescription")}
                  actionHref={membersOnlyNotice ? markYouTubeUrl(`https://www.youtube.com/watch?v=${video.video_id}`) : undefined}
                  actionLabel={membersOnlyNotice ? t("membersOnlyWatchAction") : undefined}
                />
              ) : playerKind === "stream" && video ? (
                <LocalPlayer
                  key={`${video.video_id}-stream-${sharedStartSeconds}`}
                  ref={playerRef}
                  live
                  liveLabel={t("watchStreamingBadge")}
                  durationSeconds={colonDurationToSeconds(video.duration)}
                  onExitStreaming={watchTogetherTransportLocked ? undefined : exitStreaming}
                  exitStreamingLabel={t("watchExitStreaming")}
                  src={api.hlsUrl(video.video_id)}
                  poster={img(video.thumbnail)}
                  autoplay={!watchTogetherRoomId}
                  transportLocked={watchTogetherTransportLocked}
                  startSeconds={playbackStartSeconds}
                  playbackRate={Number(speed)}
                  title={video.title}
                  channelTitle={video.channel_title}
                  artworkUrl={img(video.thumbnail)}
                  cinemaMode={cinemaMode}
                  onToggleCinema={() => setCinemaMode((mode) => !mode)}
                  onEnded={watchTogetherTransportLocked ? undefined : handleEnded}
                  keyboardSeekSeconds={keyboardSeekSeconds} keyboardShortcuts={settings?.keyboard_shortcuts} frameRate={Number(settings?.enhance_frame_fps) || 30}
                  onShortcut={showShortcutFeedback}
                  screenshotFormat={screenshotFormat}
                  screenshotQuality={screenshotQuality}
                  screenshotFilenameTemplate={screenshotFilenameTemplate}
                  videoId={video.video_id}
                  ccDefaultOn={captionsDefaultOn}
                  ccDefaultLang={captionsDefaultLang}
                  preferredSubtitleLanguages={[captionsDefaultLang, ...downloadSubtitleLanguages]}
                  subtitleStyle={{
                    size: subtitleSize,
                    color: settings?.player_sub_color || "#ffffff",
                    bg: Number(settings?.player_sub_bg ?? 75),
                  }}
                  onSubtitleSizeChange={changeSubtitleSize}
                />
              ) : playerKind === "local" && video ? (
                <LocalPlayer
                  key={`${video.video_id}-local-${sharedStartSeconds}`}
                  ref={playerRef}
                  src={api.streamUrl(video.video_id)}
                  poster={img(video.thumbnail)}
                  autoplay={!watchTogetherRoomId}
                  transportLocked={watchTogetherTransportLocked}
                  startSeconds={playbackStartSeconds}
                  playbackRate={Number(speed)}
                  title={video.title}
                  channelTitle={video.channel_title}
                  artworkUrl={img(video.thumbnail)}
                  chapters={chapters}
                  sbSegments={sbSegments}
                  cinemaMode={cinemaMode}
                  onToggleCinema={() => setCinemaMode((mode) => !mode)}
                  onEnded={watchTogetherTransportLocked ? undefined : handleEnded}
                  keyboardSeekSeconds={keyboardSeekSeconds} keyboardShortcuts={settings?.keyboard_shortcuts} frameRate={Number(settings?.enhance_frame_fps) || 30}
                  onShortcut={showShortcutFeedback}
                  screenshotFormat={screenshotFormat}
                  screenshotQuality={screenshotQuality}
                  screenshotFilenameTemplate={screenshotFilenameTemplate}
                  videoId={video.video_id}
                  ccDefaultOn={captionsDefaultOn}
                  ccDefaultLang={captionsDefaultLang}
                  preferredSubtitleLanguages={[captionsDefaultLang, ...downloadSubtitleLanguages]}
                  subtitleStyle={{
                    size: subtitleSize,
                    color: settings?.player_sub_color || "#ffffff",
                    bg: Number(settings?.player_sub_bg ?? 75),
                  }}
                  onSubtitleSizeChange={changeSubtitleSize}
                />
              ) : playerKind === "youtube" ? (
                <div ref={ytWrapRef} className="watch-player-yt" />
              ) : video && (
                <div className="wp-panel" style={{ backgroundImage: `url(${img(video.thumbnail)})` }}>
                  <div className="wp-panel-scrim" />
                  {playerKind === "blocked" && (
                    <div className="wp-panel-content">
                      <ArrowDownToLine size={34} />
                      <h3>{t("watchChildDownloadsOnly")}</h3>
                      {(downloadStatus === "queued" || downloadStatus === "downloading") && (
                        <p className="wp-panel-sub">
                          <LoaderCircle className="spin" size={14} />{" "}
                          {downloadStatus === "queued" ? t("downloadQueued") : t("downloading")}
                        </p>
                      )}
                    </div>
                  )}
                  {playerKind === "loading" && (
                    <div className="wp-panel-content" aria-busy="true">
                      <LoaderCircle className="spin" size={30} />
                    </div>
                  )}
                  {playerKind === "choice" && (
                    <div className="wp-panel-content">
                      <h3>{t("watchChoiceTitle")}</h3>
                      <div className="wp-choice-buttons">
                        <Button variant="primary" onClick={() => setSourceChoice("wait")}>
                          <ArrowDownToLine size={15} /> {t("watchChoiceWait")}
                        </Button>
                        <Button onClick={chooseYouTube}>
                          <MonitorPlay size={15} /> {t("watchChoiceYouTube")}
                        </Button>
                      </div>
                    </div>
                  )}
                  {playerKind === "waiting" && (
                    <div className="wp-panel-content">
                      {waitError ? (
                        <>
                          <h3>{t("downloadError")}</h3>
                          <p className="wp-panel-sub wp-panel-error">{waitError}</p>
                        </>
                      ) : (
                        <>
                          <LoaderCircle className="spin" size={30} />
                          <h3>{t("watchWaitingTitle")}</h3>
                          <div className="wp-wait-bar">
                            <div className="wp-wait-fill" style={{ width: `${waitProgress?.percent ?? 0}%` }} />
                          </div>
                          <p className="wp-panel-sub">
                            {waitProgress
                              ? `${Math.floor(waitProgress.percent)}%${waitProgress.speed ? ` · ${waitProgress.speed}` : ""}`
                              : t("downloadQueued")}
                          </p>
                          <p className="wp-panel-hint">{t("watchWaitingHint")}</p>
                        </>
                      )}
                      <Button onClick={chooseYouTube}>
                        <MonitorPlay size={15} /> {t("watchChoiceYouTube")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {shortcutFeedback && <WatchPlayerFeedback key={shortcutFeedback.id} feedback={shortcutFeedback} keyboardSeekSeconds={keyboardSeekSeconds} />}
              {playerKind === "youtube" && !audioActive && youtubeAutoplayBlocked && (
                <div className="wp-autoplay-blocked">
                  <Button variant="primary" onClick={requestYouTubePlayback}>
                    <Play size={16} /> {t("playerPlay")}
                  </Button>
                </div>
              )}
              {upNextVideo && (
                <UpNextOverlay
                  video={upNextVideo}
                  autoplayEnabled={settings?.feed_autoplay_behavior !== "prompt"}
                  loadingNext={upNextLoadingNext}
                  onToggleAutoplay={toggleFeedAutoplay}
                  onPlayNow={goToUpNextVideo}
                  onSkip={skipUpNextVideo}
                  onDismiss={dismissUpNextVideo}
                />
              )}
            </div>
          </div>
          </div>
          <WatchTogetherPanelSlot controller={watchTogether} errorText={watchTogetherError} />
        </div>
        <WatchTogetherJoinStatus controller={watchTogether} errorText={watchTogetherError} roomId={watchTogetherRoomId} />
        {playerKind === "youtube" && !audioActive && youtubeError === 153 && (
          <Alert className="youtube-referrer-alert-layout" variant="warning" icon={<AlertTriangle />} title={t("youtubeReferrerErrorTitle")}>{t("youtubeReferrerErrorHint")}</Alert>
        )}
        {(video ?? videoInfo) && (
          <div className="watch-title-row">
            <h1 className="watch-title">{video?.title ?? videoInfo?.title}</h1>
            {playerKind === "local" && !audioActive && (
              <Tooltip text={t("watchLocalPlaybackTooltip")} pos="top" className="watch-local-source-tooltip">
                <span className="watch-local-source-icon" aria-label={t("watchLocalPlaybackTooltip")} tabIndex={0}>
                  <HardDrive size={15} aria-hidden="true" />
                </span>
              </Tooltip>
            )}
            {canPlayNextVideo && !upNextVideo && (
              <Tooltip text={t("nextVideo")} pos="top">
                <IconButton
                  variant="ghost"
                  size="sm"
                  className="watch-next-video"
                  label={t("nextVideo")}
                  icon={<SkipForward />}
                  onClick={playNextVideo}
                />
              </Tooltip>
            )}
          </div>
        )}
        {videoMissing && videoInfo && (
          <div className="watch-row">
            <div className="watch-channel">
              <div className="watch-channel-top">
                <div>
                  <Link to={`/channel/${videoInfo.channelId}`} className="name channel-link">
                    {videoInfo.channelTitle}
                  </Link>
                </div>
              </div>
            </div>
            {!isChildProfile && (
              <ButtonAnchor
                href={markYouTubeUrl(`https://www.youtube.com/watch?v=${videoInfo.videoId}`)}
                target="_blank"
                rel="noreferrer"
                leadingIcon={<ExternalLink size={15} />}
              >YouTube</ButtonAnchor>
            )}
          </div>
        )}
        {videoMissing && videoInfo && (
          <div
            ref={descriptionRef}
            className={`watch-desc${descExpandable && !descOpen ? " clamped" : ""}`}
            onClick={() => descExpandable && !descOpen && setDescOpen(true)}
          >
            <div className="watch-desc-stats">
              {videoInfo.viewCount != null && (
                <span className="stat"><Eye /> {formatViewsCount(videoInfo.viewCount, language)}</span>
              )}
              {videoInfo.publishedAt && (
                <span className="stat"><CalendarDays /> {formatAppDate(videoInfo.publishedAt, locale, timeZone)}</span>
              )}
            </div>
            {videoInfo.description && (
              <>
                <div className="watch-desc-sep" />
                <WatchDescription text={videoInfo.description} baseUrl={appUrl} channelHandles={creatorHandles} />
              </>
            )}
          </div>
        )}
        {videoMissing && videoInfo?.description && descExpandable && (
          <button className="watch-desc-toggle" onClick={() => setDescOpen((o) => !o)}>
            {descOpen ? t("showLess") : t("showMore")}
          </button>
        )}
        {video && <div className="watch-row">
          <div className="watch-channel">
            <VideoCreators creators={videoCreators.length > 0 ? videoCreators : [{
              channelId: video.channel_id,
              title: video.channel_title,
              avatar: video.channel_thumbnail ?? "",
              subscriberCount: video.channel_subscriber_count ?? "",
              handle: "",
              isOwner: true,
            }]} />
          </div>
          <div className="watch-actions">
            <Button
              ref={likeButtonRef}
              className={`like-btn${video.liked === 1 ? " like-active" : ""}`}
              title={video.liked === 1 ? t("unlike") : t("like")}
              aria-pressed={video.liked === 1}
              onClick={toggleLiked}
            >
              <ThumbsUp fill={video.liked === 1 ? "currentColor" : "none"} />
              <span className="btn-label">{t("like")}</span>
            </Button>
            <WatchPlayerModeToggle placement="actions" active={audioActive} available={audioModeAvailable} audioLabel={t("playerAudioMode")} videoLabel={t("playerAudioModeExit")} onToggle={(active) => { capturePlaybackPosition(); setAudioMode(active); }} />
            <div className="watch-action-group watch-action-group--playback">
            <IconButton
              className="watch-action-desktop watch-action-medium"
              variant={cinemaMode ? "secondary" : "default"}
              label={t("cinemaMode")}
              onClick={() => setCinemaMode((m) => !m)}
              aria-pressed={cinemaMode}
            >
              <Clapperboard size={15} />
            </IconButton>
            <Popover
              rootClassName="watch-action-desktop watch-action-medium"
              align="end"
              surface="menu"
              open={speedOpen}
              onOpenChange={(open) => { if (!watchTogetherTransportLocked) setSpeedOpen(open); }}
              className="watch-speed-popover"
              trigger={<Button disabled={watchTogetherTransportLocked} variant={speed !== "1" ? "secondary" : "default"} title={watchTogetherTransportLocked ? watchTogetherTransportLockLabel : t("playbackSpeed")}>
                <Gauge size={15} /> {speed}×
              </Button>}
            >
                <Menu className="watch-speed-menu">
                  {PLAYBACK_SPEEDS.map((s) => (
                    <MenuItem key={s} selected={speed === s} onClick={() => changeSpeed(s)}>
                      {s === "1" ? "1×" : `${s}×`}
                    </MenuItem>
                  ))}
                  {video.channel_playback_speed != null && (
                    <MenuItem onClick={() => changeSpeed(null)}>{t("speedDefault")}</MenuItem>
                  )}
                </Menu>
            </Popover>
            </div>
            <div className="watch-action-group watch-action-group--organize watch-action-desktop">
            <div className="watch-action-desktop watch-action-medium watch-schedule-anchor">
              <Popover
                align="start"
                surface="menu"
                open={scheduleOpen}
                onOpenChange={setScheduleOpen}
                className="watch-schedule-popover"
                trigger={<Button>
                <Clock /> {t("watchLater")}
                </Button>}
              >
                  <SchedulePicker onSelect={(bucket) => void queue(bucket, "desktop")} activeBucket={video.bucket} />
              </Popover>
              {scheduleToast?.anchor === "desktop" && <LocalToast key={scheduleToast.id} variant={scheduleToast.variant}>{scheduleToast.message}</LocalToast>}
            </div>
            <Popover
              rootClassName="watch-action-desktop watch-action-wide"
              align="end"
              surface="menu"
              open={playlistOpen}
              onOpenChange={(open) => void setDesktopPlaylistOpen(open)}
              trigger={<Button title={t("addToPlaylist")}>
                <BookmarkPlus /> {t("addToPlaylist")}
              </Button>}
            >
              <PlaylistPicker playlists={playlists} loading={playlistsLoading} name={newPlaylistName} icon={newPlaylistIcon} onNameChange={setNewPlaylistName} onIconChange={setNewPlaylistIcon} onToggle={togglePlaylist} onCreate={createPlaylist} />
            </Popover>
            </div>
            <div className="watch-action-group watch-action-group--utility">
            {watchTogetherEnabled && video.is_private !== 1 && video.members_only !== 1 && video.live_status !== "live" && video.live_status !== "upcoming" && <IconButton
              variant={watchTogether.room ? "secondary" : "default"}
              label={t("watchTogetherAction")}
              aria-pressed={Boolean(watchTogether.room)}
              disabled={watchTogether.starting}
              onClick={() => void (watchTogether.room ? watchTogether.copyInvite() : watchTogether.start())}
            >
              {watchTogether.starting ? <LoaderCircle className="spin" /> : <UsersRound />}
            </IconButton>}
            <div className="share-btn-wrap">
              <Popover
                align="end"
                surface="menu"
                open={shareOpen}
                onOpenChange={setShareOpen}
                className="watch-share-popover"
                trigger={<IconButton variant={shareOpen ? "secondary" : "default"} label={t("share")}>
                <Share2 />
                </IconButton>}
              >
                <div className="share-menu">
                  <div className="share-menu-title">{t("share")}</div>
                  {socialEnabled && video && <Menu className="watch-share-destinations">
                    <MenuItem
                      className="watch-share-social"
                      icon={<UsersRound />}
                      suffix={<ChevronRight aria-hidden="true" />}
                      onClick={() => { setShareOpen(false); setSocialShareOpen(true); }}
                    >{t("socialShareInSocial")}</MenuItem>
                  </Menu>}
                  <label className="share-link-label">{settings?.app_name || "YT Zero"}</label>
                  <div className="share-link-field">
                    <input readOnly value={shareLink("webpage") ?? ""} aria-label={settings?.app_name || "YT Zero"} />
                    <IconButton variant="ghost" label={t("copyLink")} onClick={() => copyShareLink("webpage")}><Copy /></IconButton>
                  </div>
                  <label className="share-link-label">YouTube</label>
                  <div className="share-link-field">
                    <input readOnly value={shareLink("youtube") ?? ""} aria-label="YouTube" />
                    <IconButton variant="ghost" label={t("copyLink")} onClick={() => copyShareLink("youtube")}><Copy /></IconButton>
                  </div>
                  <Checkbox className="share-timestamp-option" label={t("includeCurrentTime")} checked={shareWithTimestamp} onChange={(event) => setShareWithTimestamp(event.target.checked)} />
                </div>
              </Popover>
              {copyKey > 0 && <LocalToast key={copyKey}>{t("copied")}</LocalToast>}
            </div>
            <Popover
              rootClassName="watch-action-overflow"
              align="end"
              surface="menu"
              open={moreOpen}
              onOpenChange={setMoreOpen}
              className="watch-more-popover"
              trigger={<IconButton variant={moreOpen ? "secondary" : "default"} label={t("moreActions")}>
                <EllipsisVertical />
              </IconButton>}
            >
              <ScrollArea viewportClassName="watch-more-scroll">
                <div className={`watch-more-menu more-menu--${moreView}`}>
                  {moreView === "root" && (
                    <>
                      <button className="more-item-medium" onClick={() => { setCinemaMode((m) => !m); setMoreOpen(false); }}>
                        <Clapperboard /> {t("cinemaMode")}
                        {cinemaMode && <MenuStatus><Check size={14} /></MenuStatus>}
                      </button>
                      <button className="more-item-medium" disabled={watchTogetherTransportLocked} onClick={() => setMoreView("speed")}>
                        <Gauge /> {t("channelSpeed")}
                        <MenuStatus>{speed}×</MenuStatus>
                      </button>
                      <button className="more-item-medium" onClick={() => setMoreView("watchlater")}>
                        <Clock /> {t("watchLater")}
                      </button>
                      <button className="more-item-wide" onClick={openPlaylistMenu}>
                        <BookmarkPlus /> {t("addToPlaylist")}
                      </button>
                      {video.status !== "archived" ? (
                        <button className="more-item-always" onClick={() => { api.archiveVideo(video.video_id).then(reload); setMoreOpen(false); }}>
                          <Archive /> {t("rejectVideo")}
                        </button>
                      ) : (
                        <button className="more-item-always" onClick={() => { api.restore(video.video_id).then(reload); setMoreOpen(false); }}>
                          <Undo2 /> {t("restoreRejectedVideo")}
                        </button>
                      )}
                      <div className="more-menu-section">
                        <MenuSeparator />
                        <button className="more-item-always" onClick={() => { setTranscriptOpen(true); setMoreOpen(false); }}>
                          <Captions /> {t("transcript")}
                        </button>
                      </div>
                      {downloadsEnabled && !isChildProfile && video.is_private !== 1 && video.live_status !== "live" && video.live_status !== "upcoming" && downloadStatus !== "done" && downloadStatus !== "queued" && downloadStatus !== "downloading" && (
                        <div className="more-menu-section">
                          <MenuSeparator />
                          <div className="more-menu-section-label">{t("localDownload")}</div>
                          <button className="more-item-always" onClick={() => { requestDownload(); setMoreOpen(false); }}>
                            <ArrowDownToLine /> {t("downloadLocally")}
                          </button>
                        </div>
                      )}
                      {downloadsEnabled && !isChildProfile && downloadStatus === "done" && (
                        <div className="more-menu-section">
                          <MenuSeparator />
                          <div className="more-menu-section-label">{t("downloadedVideo")}</div>
                          <a className="more-item-always" href={api.downloadFileUrl(video.video_id)} onClick={() => setMoreOpen(false)}>
                            <ArrowDownToLine /> {t("downloadFileToDevice")}
                          </a>
                          <Popconfirm message={t("removeLocalCopyConfirm")} onConfirm={cancelOrRemoveDownload}>
                            <button className="more-item-always">
                              <Trash2 /> {t("removeLocalCopy")}
                            </button>
                          </Popconfirm>
                        </div>
                      )}
                    </>
                  )}
                  {moreView === "speed" && (
                    <>
                      <div className="more-menu-header">
                        <button className="more-menu-back" title={t("back")} onClick={() => setMoreView("root")}>
                          <ChevronLeft />
                        </button>
                        {t("channelSpeed")}
                      </div>
                      {PLAYBACK_SPEEDS.map((s) => (
                        <button
                          key={s}
                          className={speed === s ? "is-selected" : undefined}
                          onClick={() => changeSpeed(s)}
                        >
                          {s === "1" ? "1×" : `${s}×`}
                          {speed === s && <MenuStatus><Check size={14} /></MenuStatus>}
                        </button>
                      ))}
                      {video?.channel_playback_speed != null && (
                        <button onClick={() => changeSpeed(null)}>{t("speedDefault")}</button>
                      )}
                    </>
                  )}
                  {moreView === "watchlater" && (
                    <>
                      <div className="more-menu-header">
                        <button className="more-menu-back" title={t("back")} onClick={() => setMoreView("root")}>
                          <ChevronLeft />
                        </button>
                        {t("watchLater")}
                      </div>
                      <SchedulePicker onSelect={(bucket) => void queue(bucket, "overflow")} activeBucket={video?.bucket} />
                    </>
                  )}
                  {moreView === "playlist" && (
                    <>
                      <div className="more-menu-header">
                        <button className="more-menu-back" title={t("back")} onClick={() => setMoreView("root")}>
                          <ChevronLeft />
                        </button>
                        {t("addToPlaylist")}
                      </div>
                      <PlaylistPicker playlists={playlists} loading={playlistsLoading} name={newPlaylistName} icon={newPlaylistIcon} onNameChange={setNewPlaylistName} onIconChange={setNewPlaylistIcon} onToggle={togglePlaylist} onCreate={createPlaylist} />
                    </>
                  )}
                </div>
              </ScrollArea>
            </Popover>
              {scheduleToast?.anchor === "overflow" && <LocalToast key={scheduleToast.id} variant={scheduleToast.variant}>{scheduleToast.message}</LocalToast>}
            </div>
            </div>
          </div>
        }
        {video && (video.live_status === "live" || video.tags.length > 0) && (
          <div className="watch-tags">
            {video.live_status === "live" && (
              <span className="watch-queue-tag live">{t("liveStream")}</span>
            )}
            {video.tags.map((t) => (
              <TagChip key={`${t.id}-${t.source}`} tag={t} />
            ))}
          </div>
        )}
        {video && transcriptOpen && <Suspense fallback={null}><TranscriptDialog
          videoId={video.video_id}
          title={video.title}
          languages={[...new Set([captionsDefaultLang, ...downloadSubtitleLanguages])]}
          onClose={() => setTranscriptOpen(false)}
        /></Suspense>}
        {video && <div className={`watch-download-feedback-region${downloadFeedbackVisible ? " is-open" : ""}`} aria-hidden={!downloadFeedbackVisible}>
          <div className="watch-download-feedback-region-inner">
            <div className={`watch-download-feedback watch-download-feedback--${downloadFeedbackKind}`} role={downloadFeedbackVisible ? "status" : undefined} aria-live={downloadFeedbackVisible ? "polite" : undefined}>
              <div className="watch-download-feedback-icon">
                {downloadFeedbackKind === "ready" ? <Check /> : downloadFeedbackKind === "downloading" ? <LoaderCircle className="spin" /> : downloadFeedbackKind === "queued" ? <ArrowDownToLine /> : <AlertTriangle />}
              </div>
              <div className="watch-download-feedback-copy">
                <strong>{downloadFeedbackKind === "ready" ? t("watchDownloadReady") : downloadFeedbackKind === "error" ? t("downloadError") : downloadFeedbackKind === "downloading" ? t("downloading") : t("downloadQueued")}</strong>
                {downloadFeedbackKind !== "downloading" && <span>{downloadFeedbackKind === "ready" ? t("watchDownloadReadyHint") : downloadRequestError ? t("watchDownloadRequestFailed") : downloadFeedbackKind === "error" ? (backgroundDownload.error || t("downloadFailedNotificationDescription")) : t("watchDownloadQueuedHint")}</span>}
                {downloadFeedbackKind === "downloading" && <div className="watch-download-feedback-progress"><div style={{ width: `${backgroundDownload.percent ?? 0}%` }} /></div>}
              </div>
              <div className="watch-download-feedback-meta">
                {downloadFeedbackKind === "downloading" && backgroundDownload.percent != null && <span>{Math.floor(backgroundDownload.percent)}%{backgroundDownload.speed ? ` · ${backgroundDownload.speed}` : ""}</span>}
                {downloadFeedbackVisible && (downloadFeedbackKind === "ready"
                  ? <Button size="sm" onClick={reloadDownloadedPlayer}>{t("watchReloadPlayer")}</Button>
                  : downloadFeedbackKind === "error"
                    ? <Button size="sm" onClick={requestDownload}>{t("downloadRetry")}</Button>
                    : <Button size="sm" onClick={cancelOrRemoveDownload}>{t("cancelDownload")}</Button>)}
              </div>
            </div>
          </div>
        </div>}
        {video && (
          <div
            ref={descriptionRef}
            className={`watch-desc${descExpandable && !descOpen ? " clamped" : ""}`}
            onClick={() => descExpandable && !descOpen && setDescOpen(true)}
          >
            <div className="watch-desc-stats">
              {video.views != null && (
                <span className="stat"><Eye /> {formatViewsCount(video.views, language)}</span>
              )}
              {video.likes != null && (
                <span className="stat"><ThumbsUp /> {compactNumber(video.likes, language)}</span>
              )}
              {video.published_at && (
                <span className="stat"><CalendarDays /> {formatAppDate(video.published_at, locale, timeZone)}</span>
              )}
              {!isChildProfile && (
                <a
                  className="watch-youtube-link"
                  href={markYouTubeUrl(`https://www.youtube.com/watch?v=${video.video_id}`)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink /> YouTube
                </a>
              )}
            </div>
            {video.description && (
              <>
                <div className="watch-desc-sep" />
                <WatchDescription text={video.description} baseUrl={appUrl} channelHandles={creatorHandles} />
              </>
            )}
          </div>
        )}
        {video?.description && descExpandable && (
          <button className="watch-desc-toggle" onClick={() => setDescOpen((o) => !o)}>
            {descOpen ? t("showLess") : t("showMore")}
          </button>
        )}
        {(chapters.length > 0 || sbSegments.length > 0 || videoPlaylists.length > 0) && (
          <div className="watch-panels">
            {chapters.length > 0 && (
              <WatchPanel title={t("chaptersTitle")} className="sb-segments--chapters" ariaLabel={t("chaptersTitle")}>
                {chapters.map((ch) => (
                  <button
                    type="button"
                    key={ch.start}
                    className="sb-segment-row sb-chapter-row"
                    disabled={watchTogetherTransportLocked}
                    onClick={() => playerRef.current?.seekTo(ch.start, true)}
                  >
                    <span className="sb-segment-name">{ch.title}</span>
                    <span className="sb-time">{formatWatchTime(ch.start)}</span>
                  </button>
                ))}
              </WatchPanel>
            )}
            {sbSegments.length > 0 && (
              <WatchPanel
                title={t("sbSegmentsTitle").replace(/:$/, "")}
                className={`sb-segments--sponsor${sbPaused ? " sb-paused" : ""}`}
                ariaLabel={t("sbSegmentsTitle")}
                action={
                  <Button
                    size="sm"
                    variant={sbPaused ? "secondary" : "ghost"}
                    className="sb-pause-btn"
                    leadingIcon={sbPaused ? <Play /> : <Pause />}
                    onClick={() => setSbPaused((p) => !p)}
                    title={sbPaused ? t("sbResume") : t("sbPause")}
                  >
                    {sbPaused ? t("sbResume") : t("sbPause")}
                  </Button>
                }
              >
                {[...sbSegments].sort((a, b) => a.segment[0] - b.segment[0]).map((seg) => {
                  const cat = SB_CATEGORIES.find((c) => c.id === seg.category);
                  const off = disabledSegs.has(seg.UUID);
                  return (
                    <div
                      key={seg.UUID}
                      className={`sb-segment-row${off ? " disabled" : ""}`}
                      style={{ "--sb-color": cat?.color ?? "#888" } as CSSProperties}
                    >
                      <button type="button" className="sb-segment-seek" disabled={watchTogetherTransportLocked} onClick={() => playerRef.current?.seekTo(seg.segment[0], true)}>
                        <span className="sb-dot" aria-hidden="true" />
                        <span className="sb-segment-name">{cat ? t(cat.labelKey) : seg.category}</span>
                        <span className="sb-time">{formatWatchTime(seg.segment[0])} → {formatWatchTime(seg.segment[1])}</span>
                      </button>
                      <span className="sb-seg-toggle">
                        <Switch
                          checked={!sbPaused && !off}
                          disabled={sbPaused}
                          ariaLabel={off ? t("sbSegEnable") : t("sbSegDisable")}
                          onCheckedChange={() => {
                            setDisabledSegs((prev) => {
                              const next = new Set(prev);
                              if (next.has(seg.UUID)) next.delete(seg.UUID);
                              else next.add(seg.UUID);
                              return next;
                            });
                          }}
                        />
                      </span>
                    </div>
                  );
                })}
              </WatchPanel>
            )}
            {videoPlaylists.length > 0 && (
              <WatchPanel title={t("videoPlaylistsTitle")} className="sb-segments--playlists" ariaLabel={t("videoPlaylistsTitle")}>
                {videoPlaylists.map((playlist) => (
                  <Link
                    key={playlist.playlistId}
                    className="watch-playlist-membership-row"
                    to={`/watch/${id}/playlist/${playlist.playlistId}`}
                  >
                    <VideoThumbnail
                      src={img(playlist.thumbnail)}
                      watched={video?.watched === 1}
                      progress={watchProgress(video?.watch_position, video?.watch_duration)}
                      variant="playlist"
                      loading="lazy"
                    />
                    <span className="watch-playlist-membership-copy">
                      <span className="sb-segment-name">{playlist.title}</span>
                      <span className="watch-playlist-membership-channel">{playlist.channelTitle}</span>
                    </span>
                    {playlist.videoCount && (
                      <span className="sb-time">{formatPlaylistVideoCount(playlist.videoCount, language)}</span>
                    )}
                  </Link>
                ))}
              </WatchPanel>
            )}
          </div>
        )}
        {showComments && video && !(isChildProfile && childDownloadsOnly) && (
          <VideoComments
            key={video.video_id}
            videoId={video.video_id}
            creatorAvatar={video.channel_thumbnail}
            cinemaMode={cinemaMode}
            seekDisabled={watchTogetherTransportLocked}
            onSeek={(seconds) => {
              if (watchTogetherTransportLocked) return;
              playerRef.current?.seekTo(seconds, true);
              playerRef.current?.playVideo?.();
            }}
          />
        )}
      </div>
      <aside>
        {playlistId && playlistVideos.length > 0 && (
          <WatchPlaylistPanel
            activeItemRef={activePlaylistItemRef}
            currentVideoId={id}
            itemsRef={playlistItemsRef}
            playlistId={playlistId}
            playlistIndex={playlistIndex}
            sort={playlistSort}
            videos={playlistVideos}
          />
        )}
        {showRelated && <>
        <h2 className="related-title">{t("moreLikeThis")}</h2>
        {related.filter((v) => v.is_short === 0 && v.watched !== 1).map((v) => (
          <div key={v.video_id} className="related-item">
            <div className="related-thumb-shell">
              <Link className="related-thumb-link" to={`/watch/${v.video_id}`} aria-label={v.title} title={v.title}>
                <VideoThumbnail src={img(v.thumbnail)} watched={v.watched === 1} progress={watchProgress(v.watch_position, v.watch_duration)} variant="related" loading="lazy">
                  {v.live_status === "live" && (
                    <span className="live-badge">
                      <span className="pulse" /> {t("liveBadge")}
                    </span>
                  )}
                  {v.duration && v.is_short !== 1 && (
                    <span className="duration-badge">{formatVideoDuration(v.duration)}</span>
                  )}
                </VideoThumbnail>
              </Link>
              <VideoScheduleActions
                video={v}
                variant="compact"
                onToggle={(event, bucket, active) => {
                  event.preventDefault();
                  event.stopPropagation();
                  toggleRelatedSchedule(v, bucket, active).catch(console.error);
                }}
              />
            </div>
            <div className="related-item-info">
              <Link className="r-title" to={`/watch/${v.video_id}`} title={v.title}>{v.title}</Link>
              <div className="r-meta">
                {v.channel_title}
                <br />
                {v.views != null && `${formatViewsCount(v.views, language)} · `}
                {formatTimeAgo(v.published_at, language)}
              </div>
            </div>
          </div>
        ))}
        </>}
      </aside>
      {video && <SocialShareDialog
        open={socialShareOpen}
        video={video}
        onOpenChange={setSocialShareOpen}
        onResult={(success) => emitToast(t(success ? "socialShareSuccess" : "socialActionError"), success ? "success" : "danger")}
      />}
    </div>
  );
}
