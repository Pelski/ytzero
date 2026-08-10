import { Monitor, Smartphone, Tablet } from "lucide-react";
import { useState } from "react";
import { api } from "../../api";
import { useI18n, type I18nKey } from "../../i18n";
import { scheduleSettingWrite } from "../../settingsWriteQueue";
import { parseVideoCardSwipeConfig, serializeVideoCardSwipeConfig, type VideoCardSwipeDevice } from "../../videoCardSwipeConfig";
import { applyVideoCardSwipeConfig, readVideoCardSwipeConfig } from "../../videoCardSwipeRuntime";
import { Chip, Inline, SettingRow } from "../ui";
import { VideoCardPreviewSetting } from "./VideoCardPreviewSetting";
import "./VideoCardSwipeSetting.css";

const DEVICE_OPTIONS: Array<{ value: VideoCardSwipeDevice; labelKey: I18nKey; icon: typeof Monitor }> = [
  { value: "desktop", labelKey: "videoCardSwipeDesktop", icon: Monitor },
  { value: "tablet", labelKey: "videoCardSwipeTablet", icon: Tablet },
  { value: "mobile", labelKey: "videoCardSwipeMobile", icon: Smartphone },
];

export function VideoCardSwipeSetting({ showToast }: { showToast: (message: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState<VideoCardSwipeDevice[]>(() => parseVideoCardSwipeConfig(readVideoCardSwipeConfig()).devices);
  const toggle = (device: VideoCardSwipeDevice) => {
    const next = DEVICE_OPTIONS.map(({ value: candidate }) => candidate).filter((candidate) => candidate === device ? !value.includes(candidate) : value.includes(candidate));
    const serialized = serializeVideoCardSwipeConfig({ version: 1, devices: next });
    setValue(next);
    applyVideoCardSwipeConfig(serialized);
    scheduleSettingWrite("video_card_swipe_devices", { video_card_swipe_devices: serialized }, {
      onSaved: () => showToast(t("displaySettingsSaved")),
      onError: async (error) => {
        const saved = await api.settings().then((result) => parseVideoCardSwipeConfig(result.settings.video_card_swipe_devices).devices).catch(() => value);
        setValue(saved);
        applyVideoCardSwipeConfig(serializeVideoCardSwipeConfig({ version: 1, devices: saved }));
        showToast(error instanceof Error ? error.message : t("error"));
      },
    });
  };
  return <>
    <SettingRow label={t("videoCardSwipeLabel")} description={t("videoCardSwipeHint")} align="start">
      <Inline gap={2} className="video-card-swipe-options" role="group" aria-label={t("videoCardSwipeLabel")}>
        {DEVICE_OPTIONS.map(({ value: device, labelKey, icon: Icon }) => <Chip key={device} className="video-card-swipe-chip" active={value.includes(device)} onClick={() => toggle(device)}><Icon size={14} />{t(labelKey)}</Chip>)}
      </Inline>
    </SettingRow>
    <VideoCardPreviewSetting showToast={showToast} />
  </>;
}
