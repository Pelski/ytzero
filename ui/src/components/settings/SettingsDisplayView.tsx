import { lazy, Suspense } from "react";
import { Check, Play } from "lucide-react";
import { PLAYBACK_SPEEDS, SB_CATEGORIES, type ShortsFeedMode } from "../../api";
import { emit } from "../../events";
import { formatAgeUnit, LANGUAGES, languageName } from "../../i18n";
import { DEFAULT_SCREENSHOT_FILENAME_TEMPLATE } from "../../playerScreenshot";
import { scheduleSettingWrite } from "../../settingsWriteQueue";
import "./SettingsDisplayView.css";
import { WATCHED_STYLES } from "../../watchedStyle";
import { VIDEO_CARD_ACTIONS_MODES, type VideoCardActionsMode } from "../../videoCardActionOptions";
import { useSettingsPageController } from "../../pages/useSettingsPageController";
import Popconfirm from "../Popconfirm";
import { Button, ColorPicker, Divider, Inline, Input, InputGroup, SelectMenu, SettingRow, SettingsSection, Slider, Switch, Text } from "../ui";
import { SidebarNavEditor, VideoCardActionEditor } from "./SettingsEditors"; import { KeyboardShortcutSettings } from "./KeyboardShortcutSettings";
const VideoCardSwipeSetting = lazy(() => import("./VideoCardSwipeSetting").then((module) => ({ default: module.VideoCardSwipeSetting })));
const TIME_ZONES = (() => {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  const supported = intl.supportedValuesOf?.("timeZone") ?? [
    "Europe/London", "Europe/Warsaw", "America/New_York", "America/Chicago",
    "America/Denver", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney",
  ];
  return [...new Set(["UTC", ...supported])];
})();

type FeedMaxAgeUnit = "days" | "weeks" | "months" | "years" | "off";
const FEED_MAX_AGE_UNITS: Exclude<FeedMaxAgeUnit, "off">[] = ["days", "weeks", "months", "years"];
const FEED_MAX_AGE_VALUES = Array.from({ length: 30 }, (_, index) => String(index + 1));

type SettingsController = ReturnType<typeof useSettingsPageController>;
export function SettingsDisplayView({ controller, showToast }: { controller: SettingsController; showToast: (message: string) => void }) {
  const {
    appIconColor,
    appName,
    appNameInput,
    autoFullscreen,
    canManageArea,
    changeDeArrowThumbnails,
    changeDeArrowTitles,
    changeFeedAutoplayBehavior,
    changeFeedAutoplayDirection,
    changeFeedMaxAge,
    changeShortsFeedMode,
    changeMembersOnlyVisibility,
    changeWatchedStyle,
    changeVideoCardActions, changeVideoCardActionConfig, channelPostsTab,
    deArrowThumbnailsEnabled,
    deArrowTitlesEnabled,
    displaySubTab,
    feedAutoplayBehavior,
    feedAutoplayDirection,
    feedAutoplayEnabled,
    feedMaxAgeUnit,
    feedMaxAgeValue,
    hideLiveFromFeed,
    isCurrentTabLocked,
    isPrimary,
    keyboardSeekSeconds,
    language,
    load,
    membersOnlyVisibility,
    navConfig,
    persistNavConfig,
    playerCc,
    playerHl,
    playerQuality,
    playerSpeed,
    plugins,
    resetNavConfig,
    saveAppIconColor,
    saveAppName,
    savePlayer,
    saveTimeZone,
    sbCategories,
    sbEnabled,
    screenshotFilename,
    screenshotFormat,
    screenshotQuality,
    setAppNameInput,
    setAutoFullscreen,
    setKeyboardSeekSeconds,
    setLanguage,
    setPlayerCc,
    setPlayerHl,
    setPlayerQuality,
    setPlayerSpeed,
    setScreenshotFilename,
    setScreenshotFormat,
    setScreenshotQuality,
    setSubBg,
    setSubColor,
    setSubSize,
    shortsFeedMode,
    showTopChannels,
    subBg,
    subColor,
    subSize,
    t,
    tab,
    timeZone, timeZoneLocked,
    toggleFeedAutoplay,
    toggleLiveFromFeed,
    toggleSb,
    toggleSbCategory,
    toggleTopChannels, toggleChannelPostsTab,
    toggleWatchComments,
    toggleWatchRelated,
    watchShowComments,
    watchShowRelated,
    watchedStyle,
    videoCardActions, videoCardActionConfig,
  } = controller;

  return (
    <>
      {!isCurrentTabLocked && tab === "display" && (
        <>
          <div className="settings-display-groups">

          {displaySubTab === "appearance" && canManageArea("appearance") && <SettingsSection title={t("displayAppearance")} className="settings-display-group">
          {isPrimary ? (
            <>
              <SettingRow label={t("appNameLabel")} htmlFor="app-name">
                <div style={{ display: "flex", gap: 8 }}>
                  <Input
                    id="app-name"
                    type="text"
                    className="form-input"
                    style={{ flex: 1 }}
                    value={appNameInput}
                    placeholder={t("appNamePlaceholder")}
                    onChange={(e) => setAppNameInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveAppName()}
                  />
                  <Button onClick={saveAppName} disabled={appNameInput.trim() === appName}>{t("save")}</Button>
                </div>
              </SettingRow>

              <SettingRow label={t("appIconColorLabel")} htmlFor="app-icon-color">
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="logo-mark" style={{ background: appIconColor }}>
                    <Play fill="currentColor" size={16} />
                  </span>
                  <ColorPicker
                    id="app-icon-color"
                    label={t("appIconColorLabel")}
                    value={appIconColor}
                    onChange={saveAppIconColor}
                  />
                </div>
              </SettingRow>

              <SettingRow label={t("timeZoneLabel")} description={timeZoneLocked ? t("timeZoneEnvHint") : t("timeZoneHint")}>
                <SelectMenu
                  searchable disabled={timeZoneLocked}
                  label={t("timeZoneLabel")}
                  value={timeZone}
                  options={[...new Set([timeZone, ...TIME_ZONES])].map((zone) => ({ value: zone, label: zone }))}
                  onChange={saveTimeZone}
                />
              </SettingRow>
            </>
          ) : (
            <Text tone="secondary">{t("primaryOnlyHint")}</Text>
          )}

          <SettingRow label={t("uiLanguage")}>
            <SelectMenu
              label={t("uiLanguage")}
              value={language}
              options={LANGUAGES.map((code) => ({ value: code, label: languageName(code) }))}
              onChange={(next) => {
                setLanguage(next).then(() => showToast(t("displaySettingsSaved"))).catch(console.error);
              }}
            />
          </SettingRow>

          <div className="watched-style-setting">
            <div>
              <div className="switch-label">{t("watchedStyleLabel")}</div>
              <div className="switch-sub">{t("watchedStyleHint")}</div>
            </div>
            <div className="watched-style-segmented" role="radiogroup" aria-label={t("watchedStyleLabel")}>
              {WATCHED_STYLES.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  role="radio"
                  aria-checked={watchedStyle === style.id}
                  className={`watched-style-option${watchedStyle === style.id ? " active" : ""}`}
                  title={t(style.labelKey)}
                  onClick={() => changeWatchedStyle(style.id)}
                >
                  <span className={`watched-style-preview watched-style-preview--${style.id}`} aria-hidden="true">
                    <span className="watched-style-preview-image" />
                    <span className="watched-style-preview-progress" />
                    <span className="watched-style-preview-check"><Check size={7} strokeWidth={3} /></span>
                  </span>
                  <span>{t(style.labelKey)}</span>
                </button>
              ))}
            </div>
          </div>
          </SettingsSection>
          }
          {displaySubTab === "feed" && canManageArea("feed") && <SettingsSection title={t("displayFeed")} className="settings-display-group">
          <SettingRow label={t("hideLiveFromFeed")} description={t("hideLiveFromFeedHint")}>
            <Switch checked={hideLiveFromFeed} onCheckedChange={() => toggleLiveFromFeed()} />
          </SettingRow>

          <SettingRow label={t("showShorts")} description={t("showShortsHint")}>
            <SelectMenu
              label={t("showShorts")}
              value={shortsFeedMode}
              onChange={(next: ShortsFeedMode) => changeShortsFeedMode(next)}
              options={[
                { value: "0", label: t("shortsFeedNone") },
                { value: "selected", label: t("shortsFeedSelected") },
                { value: "1", label: t("shortsFeedAll") },
              ]}
            />
          </SettingRow>
          <SettingRow label={t("channelPostsTab")} description={t("channelPostsTabHint")}><Switch checked={channelPostsTab} onCheckedChange={() => toggleChannelPostsTab()} /></SettingRow>

          <SettingRow label={t("feedMaxAge")} description={t("feedMaxAgeHint")}>
            <Inline gap={2} className="feed-max-age-control">
              <SelectMenu
                label={t("feedMaxAge")}
                value={feedMaxAgeValue}
                disabled={feedMaxAgeUnit === "off"}
                onChange={(next: string) => changeFeedMaxAge(next, feedMaxAgeUnit)}
                options={FEED_MAX_AGE_VALUES.map((value) => ({ value, label: value }))}
              />
              <SelectMenu
                label={t("feedMaxAge")}
                value={feedMaxAgeUnit}
                onChange={(next: FeedMaxAgeUnit) => changeFeedMaxAge(feedMaxAgeValue, next)}
                options={[
                  ...FEED_MAX_AGE_UNITS.map((unit) => ({
                    value: unit as FeedMaxAgeUnit,
                    label: formatAgeUnit(Number(feedMaxAgeValue) || 1, unit, language),
                  })),
                  { value: "off" as FeedMaxAgeUnit, label: t("feedMaxAgeOff") },
                ]}
              />
            </Inline>
          </SettingRow>

          <SettingRow label={t("membersOnlyVisibility")} description={t("membersOnlyVisibilityHint")}>
            <SelectMenu
              label={t("membersOnlyVisibility")}
              value={membersOnlyVisibility}
              onChange={changeMembersOnlyVisibility}
              options={[
                { value: "everywhere", label: t("channelMembersOnlyEverywhere") },
                { value: "channel", label: t("channelMembersOnlyChannelOnly") },
                { value: "hidden", label: t("channelMembersOnlyNowhere") },
              ]}
            />
          </SettingRow>

          </SettingsSection>
          }
          {displaySubTab === "playback" && canManageArea("playback") && <SettingsSection title={t("displayPlayback")} className="settings-display-group">
          <SettingRow label={t("videoCardActionsLabel")} description={t("videoCardActionsHint")}>
            <SelectMenu
              label={t("videoCardActionsLabel")}
              value={videoCardActions}
              options={VIDEO_CARD_ACTIONS_MODES.map((mode) => ({ value: mode.id, label: t(mode.labelKey) }))}
              onChange={(next: VideoCardActionsMode) => void changeVideoCardActions(next)}
            />
          </SettingRow>

          <SettingRow label={t("itemOrder")} description={t("itemOrderHint")} align="start" className="video-card-action-setting">
            <VideoCardActionEditor value={videoCardActionConfig} mode={videoCardActions} onChange={changeVideoCardActionConfig} />
          </SettingRow>
          <Suspense fallback={<SettingRow label={t("videoCardSwipeLabel")}><span /></SettingRow>}><VideoCardSwipeSetting showToast={showToast} /></Suspense>
          <SettingRow label={t("watchShowRelated")} description={t("watchShowRelatedHint")}>
            <Switch checked={watchShowRelated} onCheckedChange={() => toggleWatchRelated()} />
          </SettingRow>

          <SettingRow label={t("watchShowComments")} description={t("watchShowCommentsHint")}>
            <Switch checked={watchShowComments} onCheckedChange={() => toggleWatchComments()} />
          </SettingRow>

          <SettingRow label={t("feedAutoplay")} description={t("feedAutoplayHint")}>
            <Switch checked={feedAutoplayEnabled} onCheckedChange={() => toggleFeedAutoplay()} />
          </SettingRow>

          {feedAutoplayEnabled && (
            <>
              <SettingRow label={t("feedAutoplayBehavior")} description={t("feedAutoplayBehaviorHint")}>
                <SelectMenu
                  label={t("feedAutoplayBehavior")}
                  value={feedAutoplayBehavior}
                  onChange={changeFeedAutoplayBehavior}
                  options={[
                    { value: "autoplay", label: t("feedAutoplayBehaviorPlay") },
                    { value: "prompt", label: t("feedAutoplayBehaviorPrompt") },
                  ]}
                />
              </SettingRow>
              <SettingRow label={t("feedAutoplayDirection")} description={t("feedAutoplayDirectionHint")}>
                <SelectMenu
                  label={t("feedAutoplayDirection")}
                  value={feedAutoplayDirection}
                  onChange={changeFeedAutoplayDirection}
                  options={[
                    { value: "newest", label: t("feedAutoplayNewestFirst") },
                    { value: "oldest", label: t("feedAutoplayOldestFirst") },
                  ]}
                />
              </SettingRow>
            </>
          )}
          <SettingRow label={t("quality")} description={t("qualityHint")}>
            <SelectMenu
              label={t("quality")}
              value={playerQuality}
              options={[{ value: "auto", label: t("autoQuality") }, { value: "hd2160", label: "4K (2160p)" }, { value: "hd1440", label: "1440p" }, { value: "hd1080", label: "1080p" }, { value: "hd720", label: "720p" }, { value: "large", label: "480p" }, { value: "medium", label: "360p" }]}
              onChange={(next) => {
                setPlayerQuality(next);
                savePlayer({ player_quality: next });
              }}
            />
          </SettingRow>

          <SettingRow label={t("playbackSpeed")} description={t("playbackSpeedHint")}>
            <SelectMenu
              label={t("playbackSpeed")}
              value={playerSpeed}
              options={PLAYBACK_SPEEDS.map((speed) => ({ value: String(speed), label: `${speed}×` }))}
              onChange={(next) => {
                setPlayerSpeed(next);
                savePlayer({ player_speed: next });
              }}
            />
          </SettingRow>

          <SettingRow label={t("keyboardSeekSeconds")} description={t("keyboardSeekSecondsHint")}>
            <SelectMenu
              label={t("keyboardSeekSeconds")}
              value={keyboardSeekSeconds}
              options={[3, 5, 10, 15, 30].map((seconds) => ({ value: String(seconds), label: `${seconds} s` }))}
              onChange={(next) => {
                setKeyboardSeekSeconds(next);
                savePlayer({ keyboard_seek_seconds: next });
              }}
            />
          </SettingRow>

          <SettingRow
            label={t("autoFullscreenLandscape")}
            description={<>{t("autoFullscreenLandscapeHint")}<br />{t("autoFullscreenLandscapeCaveat")}</>}
          >
            <Switch
              checked={autoFullscreen}
              onCheckedChange={(next) => {
                setAutoFullscreen(next);
                savePlayer({ auto_fullscreen_landscape: next ? "1" : "0" });
              }}
            />
          </SettingRow>
          <KeyboardShortcutSettings showToast={showToast} /></SettingsSection>
          }

          {displaySubTab === "subtitles" && canManageArea("playback") && <SettingsSection title={t("subtitles")} className="settings-display-group">
          <SettingRow label={t("forceCaptions")} description={t("forceCaptionsHint")}>
            <Switch
              checked={playerCc}
              onCheckedChange={(next) => {
                setPlayerCc(next);
                savePlayer({ player_cc: next ? "1" : "0" });
              }}
            />
          </SettingRow>
          <SettingRow label={t("playerLanguage")}>
            <SelectMenu
              label={t("playerLanguage")}
              value={playerHl}
              options={[{ value: "pl", label: "polski" }, { value: "en", label: "English" }, { value: "de", label: "Deutsch" }, { value: "es", label: "español" }, { value: "fr", label: "français" }, { value: "uk", label: "українська" }, { value: "ja", label: "日本語" }]}
              onChange={(next) => {
                setPlayerHl(next);
                savePlayer({ player_hl: next, player_cc_lang: next });
              }}
            />
          </SettingRow>

          <div className="sub-style-panel">
            <div>
              <div className="switch-label">{t("subtitleStyleTitle")}</div>
              <div className="ui-control-description">{t("subtitleStyleHint")}</div>
            </div>
            <div className="sub-style-controls">
              <label className="sub-style-field">
                <span>{t("subtitleSize")}</span>
                <InputGroup suffix="px" className="sub-size-input">
                  <Input
                    type="number"
                    min={12}
                    max={48}
                    step={1}
                    value={subSize}
                    onChange={(e) => setSubSize(Math.min(48, Math.max(12, Number(e.target.value) || 12)))}
                    onBlur={() => savePlayer({ player_sub_size: String(subSize) })}
                  />
                </InputGroup>
              </label>
              <label className="sub-style-field">
                <span>{t("subtitleColor")}</span>
                <ColorPicker
                  label={t("subtitleColor")}
                  value={subColor}
                  onChange={(next) => {
                    setSubColor(next);
                    scheduleSettingWrite("player_sub_color", { player_sub_color: next }, {
                      onSaved: () => { emit("player-settings-changed"); showToast(t("playerSettingsSaved")); },
                      onError: (error) => { load(); showToast(error instanceof Error ? error.message : String(error)); },
                    });
                  }}
                />
              </label>
              <label className="sub-style-field sub-style-field--wide">
                <span>{t("subtitleBackground")} ({subBg}%)</span>
                <Slider
                  min={0}
                  max={100}
                  step={5}
                  value={subBg}
                  onChange={setSubBg}
                  onPointerUp={() => savePlayer({ player_sub_bg: String(subBg) })}
                />
              </label>
            </div>
            <div className="sub-style-preview">
              <span style={{ color: subColor, background: `rgba(0, 0, 0, ${subBg / 100})`, fontSize: `${subSize}px` }}>
                {t("subtitlePreviewLine")}
              </span>
            </div>
          </div>
          </SettingsSection>
          }

          {displaySubTab === "screenshots" && canManageArea("playback") && <SettingsSection title={t("playerScreenshots")} className="settings-display-group">
          <SettingRow label={t("playerScreenshotFormat")} description={t("playerScreenshotFormatHint")}>
            <SelectMenu
              label={t("playerScreenshotFormat")}
              value={screenshotFormat}
              options={([
                { value: "jpeg", label: "JPG" },
                { value: "png", label: "PNG" },
                { value: "webp", label: "WebP" },
              ] as const)}
              onChange={(next) => {
                setScreenshotFormat(next);
                savePlayer({ player_screenshot_format: next });
              }}
            />
          </SettingRow>

          <SettingRow label={t("playerScreenshotQuality")}>
            <Input
              aria-label={t("playerScreenshotQuality")}
              type="number"
              min={0.1}
              max={1}
              step={0.01}
              value={screenshotQuality}
              disabled={screenshotFormat === "png"}
              onChange={(event) => setScreenshotQuality(event.target.value)}
              onBlur={() => {
                const next = String(Math.min(1, Math.max(0.1, Number(screenshotQuality) || 0.92)));
                setScreenshotQuality(next);
                savePlayer({ player_screenshot_quality: next });
              }}
            />
          </SettingRow>

          <SettingRow label={t("playerScreenshotFilename")} description={t("playerScreenshotFilenameHint")}>
            <Input
              aria-label={t("playerScreenshotFilename")}
              value={screenshotFilename}
              placeholder={DEFAULT_SCREENSHOT_FILENAME_TEMPLATE}
              onChange={(event) => setScreenshotFilename(event.target.value)}
              onBlur={() => {
                const next = screenshotFilename.trim() || DEFAULT_SCREENSHOT_FILENAME_TEMPLATE;
                setScreenshotFilename(next);
                savePlayer({ player_screenshot_filename: next });
              }}
            />
          </SettingRow>

          </SettingsSection>
          }

          {displaySubTab === "privacy" && canManageArea("playback") && <>
          <SettingsSection title="DeArrow" className="settings-display-group">
          <SettingRow
            label={t("dearrowTitlesEnabled")}
            description={t("dearrowTitlesHint")}
          >
            <Switch checked={deArrowTitlesEnabled} onCheckedChange={(enabled) => void changeDeArrowTitles(enabled)} />
          </SettingRow>
          <SettingRow
            label={t("dearrowThumbnailsEnabled")}
            description={<>{t("dearrowThumbnailsHint")} <a href="https://sponsor.ajay.app/" target="_blank" rel="noreferrer">{t("dearrowAttribution")}</a></>}
          >
            <Switch checked={deArrowThumbnailsEnabled} onCheckedChange={(enabled) => void changeDeArrowThumbnails(enabled)} />
          </SettingRow>
          </SettingsSection>

          <SettingsSection title="SponsorBlock" className="settings-display-group">
          <SettingRow label={t("sponsorblockEnabled")} description={t("sponsorblockHint")}>
            <Switch checked={sbEnabled} onCheckedChange={() => toggleSb()} />
          </SettingRow>

          {sbEnabled && (
            <div className="sb-category-grid">
              <div className="ui-control-description" style={{ gridColumn: "1 / -1", marginBottom: 2 }}>{t("sponsorblockCategories")}</div>
              {SB_CATEGORIES.map((cat) => {
                const active = sbCategories.includes(cat.id);
                return (
                  <div key={cat.id} className="sb-category-row">
                    <span className="sb-category-dot" style={{ background: cat.color }} />
                    <span className="sb-category-name">{t(cat.labelKey)}</span>
                    <Switch checked={active} onCheckedChange={() => toggleSbCategory(cat.id)} />
                  </div>
                );
              })}
            </div>
          )}
          </SettingsSection>
          </>
          }

          {displaySubTab === "navigation" && canManageArea("navigation") && <SettingsSection title={t("displayNavigation")} className="settings-display-group">
          <SettingRow label={t("showTopChannels")} description={t("showTopChannelsHint")}>
            <Switch checked={showTopChannels} onCheckedChange={() => toggleTopChannels()} />
          </SettingRow>
          <Divider className="settings-navigation-divider" />

          <div className="sidebar-order-head">
            <div>
              <div className="switch-label">{t("itemOrder")}</div>
              <div className="ui-control-description">{t("itemOrderHint")}</div>
            </div>
            <Popconfirm message={t("resetOrderConfirm")} onConfirm={resetNavConfig}>
              <Button>{t("resetOrder")}</Button>
            </Popconfirm>
          </div>
          <SidebarNavEditor
            value={navConfig}
            onChange={persistNavConfig}
            excludedKeys={new Set(plugins.filter((plugin) => !plugin.enabled).flatMap((plugin) => plugin.route ? [plugin.route] : []))}
          />
          </SettingsSection>
          }
          </div>
        </>
      )}

    </>
  );
}
