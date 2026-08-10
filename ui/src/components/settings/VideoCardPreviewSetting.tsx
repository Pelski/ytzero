import { useState } from "react";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { scheduleSettingWrite } from "../../settingsWriteQueue";
import { applyVideoCardPreviewMode, parseVideoCardPreviewMode, readVideoCardPreviewMode, type VideoCardPreviewMode } from "../../videoCardPreview";
import { SelectMenu, SettingRow } from "../ui";

export function VideoCardPreviewSetting({ showToast }: { showToast: (message: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState<VideoCardPreviewMode>(() => readVideoCardPreviewMode());
  const change = (next: VideoCardPreviewMode) => {
    setValue(next);
    applyVideoCardPreviewMode(next);
    scheduleSettingWrite("video_card_preview", { video_card_preview: next }, {
      onSaved: () => showToast(t("displaySettingsSaved")),
      onError: async (error) => {
        const saved = await api.settings().then((result) => parseVideoCardPreviewMode(result.settings.video_card_preview)).catch(() => value);
        setValue(saved);
        applyVideoCardPreviewMode(saved);
        showToast(error instanceof Error ? error.message : t("error"));
      },
    });
  };
  return <SettingRow label={t("videoCardPreviewLabel")} description={t("videoCardPreviewHint")}>
    <SelectMenu
      label={t("videoCardPreviewLabel")}
      value={value}
      onChange={change}
      options={[
        { value: "off", label: t("videoCardActionsOff") },
        { value: "downloaded", label: t("downloaded") },
        { value: "all", label: t("cleanupStatusAll") },
      ]}
    />
  </SettingRow>;
}
