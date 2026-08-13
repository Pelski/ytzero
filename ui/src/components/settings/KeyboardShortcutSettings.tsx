import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { emit } from "../../events";
import { useI18n, type I18nKey } from "../../i18n";
import { DEFAULT_SHORTCUTS, resolveShortcutBindings, serializeShortcutBindings, SHORTCUT_ACTIONS, shortcutConflicts, type ShortcutAction, type ShortcutBindings, type ShortcutCategory } from "../../keyboardShortcuts";
import { Button, Divider, SectionHeader, SettingRow, ShortcutInput } from "../ui";
import "./KeyboardShortcutSettings.css";
import { scheduleSettingWrite } from "../../settingsWriteQueue";

const CATEGORY_KEYS: Record<ShortcutCategory, I18nKey> = { playback: "shortcutPlayback", subtitles: "shortcutSubtitles", general: "shortcutGeneral" };
const ACTION_KEYS: Record<ShortcutAction, I18nKey> = {
  togglePlay: "shortcutTogglePlay", temporaryBoost: "shortcutTemporaryBoost", seekBack10: "shortcutSeekBack10", seekForward10: "shortcutSeekForward10",
  previousVideo: "shortcutPreviousVideo", nextVideo: "shortcutNextVideo", previousFrame: "shortcutPreviousFrame", nextFrame: "shortcutNextFrame",
  speedDown: "shortcutSpeedDown", speedUp: "shortcutSpeedUp", seekPercent: "shortcutSeekPercent", previousChapter: "shortcutPreviousChapter", nextChapter: "shortcutNextChapter",
  seekBack: "shortcutSeekBack", seekForward: "shortcutSeekForward", volumeUp: "shortcutVolumeUp", volumeDown: "shortcutVolumeDown", toggleCaptions: "shortcutToggleCaptions",
  subtitleLarger: "shortcutSubtitleLarger", subtitleSmaller: "shortcutSubtitleSmaller", toggleFullscreen: "shortcutToggleFullscreen", toggleTheater: "shortcutToggleTheater",
  togglePictureInPicture: "shortcutTogglePictureInPicture", close: "shortcutClose", toggleMute: "shortcutToggleMute", screenshot: "shortcutScreenshot",
};

export function KeyboardShortcutSettings({ showToast }: { showToast: (message: string) => void }) {
  const { t } = useI18n();
  const [bindings, setBindings] = useState<ShortcutBindings>(DEFAULT_SHORTCUTS);
  const [ready, setReady] = useState(false);
  const conflicts = useMemo(() => shortcutConflicts(bindings), [bindings]);
  useEffect(() => { let active = true; api.settings().then(({ settings }) => { if (active) { setBindings(resolveShortcutBindings(settings.keyboard_shortcuts)); setReady(true); } }).catch(() => setReady(true)); return () => { active = false; }; }, []);
  const persist = (next: ShortcutBindings) => {
    setBindings(next);
    if (shortcutConflicts(next).size) return;
    scheduleSettingWrite("keyboard_shortcuts", { keyboard_shortcuts: serializeShortcutBindings(next) }, { onSaved: () => { emit("player-settings-changed"); showToast(t("playerSettingsSaved")); }, onError: () => showToast(t("shortcutSaveFailed")) });
  };
  return <div className="keyboard-shortcut-settings">
    <SectionHeader title={t("keyboardShortcuts")} description={t("keyboardShortcutsHint")} level={3} />
    {(["playback", "subtitles", "general"] as const).map((category) => <div className="keyboard-shortcut-settings__group" key={category}>
      <Divider label={t(CATEGORY_KEYS[category])} className="keyboard-shortcut-settings__category" />
      {SHORTCUT_ACTIONS.filter(([, actionCategory]) => actionCategory === category).map(([action, , , defaultValue]) => <SettingRow key={action} label={t(ACTION_KEYS[action])} description={conflicts.has(action) ? t("shortcutConflict") : undefined} className={conflicts.has(action) ? "keyboard-shortcut-settings__conflict" : undefined}>
        <ShortcutInput value={bindings[action]} defaultValue={defaultValue} label={t(ACTION_KEYS[action])} captureLabel={t("shortcutPressKeys")} clearLabel={t("shortcutClear")} resetLabel={t("shortcutReset")} invalid={conflicts.has(action)} disabled={!ready} digitFamily={action === "seekPercent"} onChange={(value) => persist({ ...bindings, [action]: value })} />
      </SettingRow>)}
    </div>)}
    <Button variant="secondary" disabled={!ready || Object.keys(bindings).every((action) => bindings[action as ShortcutAction] === DEFAULT_SHORTCUTS[action as ShortcutAction])} onClick={() => persist({ ...DEFAULT_SHORTCUTS })}>{t("shortcutResetAll")}</Button>
  </div>;
}
