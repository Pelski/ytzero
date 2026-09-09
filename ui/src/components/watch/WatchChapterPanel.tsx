import type { VideoChapter } from "../../api";
import { useI18n } from "../../i18n";
import { formatWatchTime } from "../../pages/watchRuntime";
import { WatchPanel } from "../WatchPanel";

export default function WatchChapterPanel({ chapters, disabled = false, onSeek }: {
  chapters: VideoChapter[];
  disabled?: boolean;
  onSeek: (seconds: number) => void;
}) {
  const { t } = useI18n();
  if (chapters.length === 0) return null;
  return <WatchPanel title={t("chaptersTitle")} className="sb-segments--chapters" ariaLabel={t("chaptersTitle")}>
    {chapters.map((chapter) => <button
      type="button"
      key={`${chapter.start}:${chapter.title}`}
      className="sb-segment-row sb-chapter-row"
      disabled={disabled}
      onClick={() => onSeek(chapter.start)}
    >
      <span className="sb-segment-name">{chapter.title}</span>
      <span className="sb-time">{formatWatchTime(chapter.start)}</span>
    </button>)}
  </WatchPanel>;
}
