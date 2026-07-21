import { useCallback, useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { Link } from "react-router-dom";
import { api, type Video } from "../api";
import { useI18n } from "../i18n";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { img } from "../img";
import { Badge, EmptyState, PageHeader, SectionHeader } from "../components/ui";

export default function LivePage({ onPlay }: { onPlay: (v: Video) => void }) {
  const { t } = useI18n();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api
      .live()
      .then((r) => setVideos(r.videos))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const live = videos.filter((v) => v.live_status === "live");
  const upcoming = videos.filter((v) => v.live_status !== "live");
  const liveByChannel = new Map<string, Video[]>();
  for (const video of live) {
    const group = liveByChannel.get(video.channel_id) ?? [];
    group.push(video);
    liveByChannel.set(video.channel_id, group);
  }
  const individualLive = [...liveByChannel.values()].filter((group) => group.length === 1).flat();
  const channelLiveGroups = [...liveByChannel.values()]
    .filter((group) => group.length > 1)
    .sort((a, b) => b.length - a.length);

  return (
    <>
      <PageHeader title={t("navLive")} />
      {loading && videos.length === 0 ? (
        <VideoGridSkeleton />
      ) : videos.length === 0 ? (
        <EmptyState icon={<Radio />} title={t("liveEmpty")} />
      ) : (
        <>
          {individualLive.length > 0 && (
            <>
              <SectionHeader title={t("liveNow")} variant="uppercase" />
              <div className="video-grid">
                {individualLive.map((v) => (
                  <VideoCard key={v.video_id} video={v} onPlay={onPlay} onChanged={load} />
                ))}
              </div>
            </>
          )}
          {channelLiveGroups.map((group) => {
            const channel = group[0];
            return (
              <section key={channel.channel_id} className="live-channel-group">
                <Link to={`/channel/${channel.channel_id}`} className="live-channel-group-header">
                  {channel.channel_thumbnail ? (
                    <img src={img(channel.channel_thumbnail)} alt="" />
                  ) : (
                    <span className="live-channel-group-avatar-placeholder" />
                  )}
                  <span>{channel.channel_title}</span>
                  <Badge variant="danger" size="sm" className="live-channel-group-count">{group.length} LIVE</Badge>
                </Link>
                <div className="video-grid live-channel-group-grid">
                  {group.map((v) => (
                    <VideoCard key={v.video_id} video={v} onPlay={onPlay} onChanged={load} />
                  ))}
                </div>
              </section>
            );
          })}
          {upcoming.length > 0 && (
            <>
              <SectionHeader title={t("upcoming")} variant="uppercase" className={live.length > 0 ? "live-upcoming-header" : undefined} />
              <div className="video-grid">
                {upcoming.map((v) => (
                  <VideoCard key={v.video_id} video={v} onPlay={onPlay} onChanged={load} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
