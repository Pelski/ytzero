import { useCallback, useEffect, useState } from "react";
import { api, type Video } from "../api";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { EmptyState, PageHeader } from "../components/ui";
import EmptyArt from "../components/illustrations/EmptyArt";
import type { PlayVideo, PlaybackQueueContext } from "../playbackQueue";

export default function ArchivePage({ onPlay }: { onPlay: PlayVideo }) {
  const { t } = useI18n();
  useDocumentTitle(t("navArchive"));
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api
      .archive()
      .then((r) => {
        setVideos(r.videos);
        setLoading(false);
      })
      .catch(console.error);
  }, []);

  useEffect(load, [load]);
  const playbackQueue: PlaybackQueueContext = { version: 1, kind: "archive" };

  return (
    <>
      <PageHeader title={t("navArchive")} />
      {loading && videos.length === 0 ? (
        <VideoGridSkeleton />
      ) : videos.length === 0 ? (
        <EmptyState art={<EmptyArt scene="archiveEmpty" />} title={t("archiveEmpty")} description={t("archiveEmptyHint")} />
      ) : (
        <div className="video-grid">
          {videos.map((v) => (
            <VideoCard key={v.video_id} video={v} onPlay={(video) => onPlay(video, playbackQueue)} onChanged={load} showRestore />
          ))}
        </div>
      )}
    </>
  );
}
