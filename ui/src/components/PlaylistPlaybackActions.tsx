import { Play, SkipForward } from "lucide-react";
import type { Video } from "../api";
import { useI18n } from "../i18n";
import { playlistContinueTarget } from "../playlistPlayback";
import { Button } from "./ui";

export default function PlaylistPlaybackActions({ videos, disabled = false, onPlay }: {
  videos: readonly Video[];
  disabled?: boolean;
  onPlay: (video: Video) => void;
}) {
  const { t } = useI18n();
  const first = videos[0];
  const continuation = playlistContinueTarget(videos);
  if (!first) return null;

  return <>
    {continuation && (
      <Button
        variant="primary"
        disabled={disabled}
        leadingIcon={<SkipForward />}
        onClick={() => onPlay(continuation)}
      >
        {t("continueWatching")}
      </Button>
    )}
    <Button
      variant={continuation ? "default" : "primary"}
      disabled={disabled}
      leadingIcon={<Play />}
      onClick={() => onPlay(first)}
    >
      {t("playlistPlayAll")}
    </Button>
  </>;
}
