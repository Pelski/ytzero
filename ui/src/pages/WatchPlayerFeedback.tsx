import { AlertTriangle, Camera, Clapperboard, FastForward, Gauge, Rewind, Volume1, Volume2, VolumeX } from "lucide-react";
import { SB_CATEGORIES } from "../api";
import { useI18n } from "../i18n";
import type { WatchShortcutKind } from "./useYouTubeKeyboardShortcuts";
import "./WatchPlayerFeedback.css";

export default function WatchPlayerFeedback({
  feedback,
  keyboardSeekSeconds,
}: {
  feedback: { kind: WatchShortcutKind; id: number; seconds?: number; category?: string } | null;
  keyboardSeekSeconds: number;
}) {
  const { t } = useI18n();
  if (!feedback) return null;

  const Icon = feedback.kind === "back" ? Rewind
    : feedback.kind === "forward" ? FastForward
      : feedback.kind === "volumeUp" ? Volume2
        : feedback.kind === "volumeDown" ? Volume1
          : feedback.kind === "mute" ? VolumeX
            : feedback.kind === "unmute" ? Volume2
              : feedback.kind === "sponsorblock" ? FastForward
                : feedback.kind === "screenshot" ? Camera
                  : feedback.kind === "screenshotError" || feedback.kind === "screenshotUnsupported" ? AlertTriangle
                    : feedback.kind === "captionsOn" || feedback.kind === "captionsOff" ? Clapperboard : Gauge;
  const sponsorCategory = feedback.category ? SB_CATEGORIES.find((category) => category.id === feedback.category) : undefined;
  const label = feedback.kind === "back" ? `−${feedback.seconds ?? keyboardSeekSeconds} s`
    : feedback.kind === "forward" ? `+${feedback.seconds ?? keyboardSeekSeconds} s`
      : feedback.kind === "speed" ? `${feedback.seconds ?? 2}×`
        : feedback.kind === "mute" ? t("playerMute")
          : feedback.kind === "unmute" ? t("playerUnmute")
            : feedback.kind === "captionsOn" ? t("captionsOn")
              : feedback.kind === "captionsOff" ? t("captionsOff")
                : feedback.kind === "screenshot" ? t("playerScreenshotSaved")
                  : feedback.kind === "screenshotError" ? t("playerScreenshotError")
                    : feedback.kind === "screenshotUnsupported" ? t("playerScreenshotUnsupported")
                      : feedback.kind === "sponsorblock" ? t("sponsorblockSkipped", { category: sponsorCategory ? t(sponsorCategory.labelKey) : feedback.category ?? "SponsorBlock" }) : "";

  return <div className={`shortcut-feedback${feedback.kind === "sponsorblock" ? " shortcut-feedback--sponsorblock" : ""}`}>
    <Icon size={19} />
    {label && <span>{label}</span>}
  </div>;
}
