import { Captions, Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { VideoSubtitle } from "../api";
import { useI18n } from "../i18n";
import { SUBTITLE_LANGUAGES, subtitleLanguageLabel } from "../subtitleLanguages";

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
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

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
    <div className="lp-sub-menu-wrap" ref={rootRef}>
      <button
        className={`lp-btn${selectedLanguage ? " active" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-label={t("subtitles")}
        aria-pressed={Boolean(selectedLanguage)}
        title={t("subtitles")}
      >
        {loadingLanguage ? <LoaderCircle className="spin" size={19} /> : <Captions size={20} />}
      </button>
      {open && (
        <div className="lp-sub-menu">
          <div className="lp-sub-toggle">
            <span>{t("subtitles")}</span>
            <button
              className={`switch${selectedLanguage ? " on" : ""}`}
              role="switch"
              aria-checked={Boolean(selectedLanguage)}
              onClick={toggle}
            />
          </div>
          <div className="lp-sub-menu-list">
            {preferred.map((language) => (
              <button
                key={language}
                className={`lp-sub-option${selectedLanguage === language ? " is-selected" : ""}`}
                disabled={loadingLanguage != null}
                onClick={() => select(language)}
              >
                <span>{subtitleLanguageLabel(language)}</span>
                {status(language)}
              </button>
            ))}
            {preferred.length > 0 && (downloaded.length > 0 || remaining.length > 0) && <div className="lp-sub-separator" />}
            {downloaded.map((subtitle) => (
              <button
                key={subtitle.lang}
                className={`lp-sub-option${selectedLanguage === subtitle.lang ? " is-selected" : ""}`}
                onClick={() => select(subtitle.lang)}
              >
                <span>{subtitleLanguageLabel(subtitle.lang)}</span>
                {status(subtitle.lang)}
              </button>
            ))}
            {remaining.map((language) => (
              <button
                className="lp-sub-option"
                key={language.code}
                disabled={loadingLanguage != null}
                onClick={() => select(language.code)}
              >
                <span>{language.label}</span>
                {status(language.code)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
