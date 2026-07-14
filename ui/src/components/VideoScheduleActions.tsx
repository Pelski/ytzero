import { CalendarDays, Coffee, Moon, Sun } from "lucide-react";
import type { MouseEvent } from "react";
import type { Bucket, Video } from "../api";
import { useI18n, type I18nKey } from "../i18n";
import Tooltip from "./Tooltip";

export const BUCKET_ICONS: Record<Bucket, typeof CalendarDays> = {
  today: Sun,
  tonight: Moon,
  tomorrow: Sun,
  tomorrow_evening: Moon,
  weekend: Coffee,
};

const BUCKET_GROUPS: { labelKey: I18nKey; buckets: Bucket[] }[] = [
  { labelKey: "groupToday", buckets: ["today", "tonight"] },
  { labelKey: "groupTomorrow", buckets: ["tomorrow", "tomorrow_evening"] },
  { labelKey: "groupWeekend", buckets: ["weekend"] },
];

export function VideoScheduleActions({
  video,
  variant,
  onToggle,
}: {
  video: Pick<Video, "bucket">;
  variant: "overlay" | "compact";
  onToggle: (event: MouseEvent<HTMLButtonElement>, bucket: Bucket, active: boolean) => void;
}) {
  const { t, bucketLabel } = useI18n();
  return (
    <div className={variant === "overlay" ? "thumb-actions-row thumb-actions-row--schedule" : "related-schedule-actions"}>
      {BUCKET_GROUPS.map((group) => (
        <div
          key={group.labelKey}
          className={`schedule-action-group${group.buckets.length === 1 ? " schedule-action-group--single" : ""}`}
        >
          <div className="schedule-action-label">{t(group.labelKey)}</div>
          <div className="schedule-action-segment">
            {group.buckets.map((bucket) => {
              const Icon = BUCKET_ICONS[bucket];
              const active = video.bucket === bucket;
              return (
                <Tooltip key={bucket} text={active ? t("removeFromQueue") : bucketLabel(bucket)}>
                  <button
                    type="button"
                    className={`action-btn${active ? " active" : ""}`}
                    aria-pressed={active}
                    onClick={(event) => onToggle(event, bucket, active)}
                  >
                    <Icon />
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
