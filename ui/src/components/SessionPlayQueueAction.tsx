import { ListMinus, ListPlus } from "lucide-react";
import type { MouseEvent } from "react";
import { api, type Video } from "../api";
import { emitToast } from "../events";
import { useI18n } from "../i18n";
import { addToSessionPlayQueue, removeFromSessionPlayQueue, useSessionPlayQueue } from "../sessionPlayQueue";
import Tooltip from "./Tooltip";

export function SessionPlayQueueAction({ video, compact = false }: { video: Pick<Video, "video_id" | "title" | "thumbnail" | "channel_title">; compact?: boolean }) {
  const { t } = useI18n();
  const queued = useSessionPlayQueue().some((item) => item.video_id === video.video_id);
  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault(); event.stopPropagation();
    if (queued) { removeFromSessionPlayQueue(video.video_id); emitToast(t("sessionQueueRemoved")); return; }
    if (!addToSessionPlayQueue(video)) return;
    emitToast(t("sessionQueueAdded"));
    void api.importVideo(video.video_id).catch(() => { removeFromSessionPlayQueue(video.video_id); emitToast(t("sessionQueueImportFailed"), "danger"); });
  };
  const label = t(queued ? "sessionQueueRemove" : "sessionQueueAdd");
  const button = <button type="button" className={`action-btn${queued ? " active" : ""}`} aria-label={label} title={label} onClick={toggle}>{queued ? <ListMinus /> : <ListPlus />}</button>;
  return compact ? button : <Tooltip text={label}>{button}</Tooltip>;
}
