import { Captions, Check, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { VideoSubtitle } from "../api";
import { useI18n } from "../i18n";
import { SUBTITLE_LANGUAGES, subtitleLanguageLabel } from "../subtitleLanguages";
import { FloatingPopover, Menu, MenuItem, MenuSeparator, ScrollArea, Switch } from "./ui";

interface SubtitlePickerProps {
  videoId?: string;
  subtitles: VideoSubtitle[];
  selectedLanguage: string | null;
  preferredLanguages: string[];
  loadingLanguage: string | null;
  errorLanguage: string | null;
  onSelect: (language: string | null) => void;
  onToggle: () => void;
}

export default function SubtitlePicker({
  videoId,
  subtitles,
  selectedLanguage,
  preferredLanguages,
  loadingLanguage,
  errorLanguage,
  onSelect,
  onToggle,
}: SubtitlePickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  if (!videoId) return null;

  const downloadedLanguages = new Set(subtitles.map((subtitle) => subtitle.lang));
  const preferred = [...new Set(preferredLanguages.filter(Boolean))];
  const preferredSet = new Set(preferred);
  const downloaded = subtitles.filter((subtitle) => !preferredSet.has(subtitle.lang));
  const remaining = SUBTITLE_LANGUAGES.filter((language) =>
    !downloadedLanguages.has(language.code) && !preferredSet.has(language.code));
  const select = (language: string) => {
    setOpen(false);
    onSelect(language);
  };
  const toggle = () => {
    setOpen(false);
    onToggle();
  };

  const status = (language: string) => (
    <span className="lp-sub-option-status">
      {selectedLanguage === language && <Check size={14} />}
      {loadingLanguage === language && <LoaderCircle className="spin" size={13} />}
      {errorLanguage === language && <span className="lp-sub-error">{t("subtitlesUnavailable")}</span>}
    </span>
  );

  return (
    <div className="lp-sub-menu-wrap">
      <FloatingPopover
        open={open}
        onOpenChange={setOpen}
        align="end"
        className="lp-sub-menu"
        trigger={
          <button
            className={`lp-btn${selectedLanguage ? " active" : ""}`}
            aria-label={t("subtitles")}
            aria-pressed={Boolean(selectedLanguage)}
            title={t("subtitles")}
          >
            {loadingLanguage ? <LoaderCircle className="spin" size={19} /> : <Captions size={20} />}
          </button>
        }
      >
          <div className="lp-sub-toggle">
            <span>{t("subtitles")}</span>
            <Switch checked={Boolean(selectedLanguage)} onCheckedChange={toggle} />
          </div>
          <ScrollArea className="lp-sub-menu-list-wrap" viewportClassName="lp-sub-menu-list">
          <Menu>
            {preferred.map((language) => (
              <MenuItem
                key={language}
                selected={selectedLanguage === language}
                disabled={loadingLanguage != null}
                onClick={() => select(language)}
                suffix={status(language)}
              >
                {subtitleLanguageLabel(language)}
              </MenuItem>
            ))}
            {preferred.length > 0 && (downloaded.length > 0 || remaining.length > 0) && <MenuSeparator />}
            {downloaded.map((subtitle) => (
              <MenuItem
                key={subtitle.lang}
                selected={selectedLanguage === subtitle.lang}
                onClick={() => select(subtitle.lang)}
                suffix={status(subtitle.lang)}
              >
                {subtitleLanguageLabel(subtitle.lang)}
              </MenuItem>
            ))}
            {remaining.map((language) => (
              <MenuItem
                key={language.code}
                disabled={loadingLanguage != null}
                onClick={() => select(language.code)}
                suffix={status(language.code)}
              >
                {language.label}
              </MenuItem>
            ))}
          </Menu>
          </ScrollArea>
      </FloatingPopover>
    </div>
  );
}
