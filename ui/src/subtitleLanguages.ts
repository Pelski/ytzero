// Subtitle languages YouTube serves captions in (yt-dlp --sub-langs codes),
// UI copy of app/src/subtitleLanguages.ts — keep the two lists in sync.
// labelled with their native names. Shared by the downloads plugin settings
// (multiselect options) and the on-demand subtitle endpoints.
export interface SubtitleLanguage {
  code: string;
  label: string;
}

export const SUBTITLE_LANGUAGES: SubtitleLanguage[] = [
  { code: "en", label: "English" },
  { code: "pl", label: "Polski" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "ru", label: "Русский" },
  { code: "uk", label: "Українська" },
  { code: "cs", label: "Čeština" },
  { code: "sk", label: "Slovenčina" },
  { code: "nl", label: "Nederlands" },
  { code: "sv", label: "Svenska" },
  { code: "no", label: "Norsk" },
  { code: "da", label: "Dansk" },
  { code: "fi", label: "Suomi" },
  { code: "hu", label: "Magyar" },
  { code: "ro", label: "Română" },
  { code: "bg", label: "Български" },
  { code: "el", label: "Ελληνικά" },
  { code: "tr", label: "Türkçe" },
  { code: "ar", label: "العربية" },
  { code: "he", label: "עברית" },
  { code: "hi", label: "हिन्दी" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "ms", label: "Bahasa Melayu" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "zh-Hans", label: "中文（简体）" },
  { code: "zh-Hant", label: "中文（繁體）" },
  { code: "th", label: "ไทย" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "fa", label: "فارسی" },
  { code: "ur", label: "اردو" },
  { code: "bn", label: "বাংলা" },
  { code: "ta", label: "தமிழ்" },
  { code: "te", label: "తెలుగు" },
  { code: "ml", label: "മലയാളം" },
  { code: "mr", label: "मराठी" },
  { code: "gu", label: "ગુજરાતી" },
  { code: "kn", label: "ಕನ್ನಡ" },
  { code: "pa", label: "ਪੰਜਾਬੀ" },
  { code: "fil", label: "Filipino" },
  { code: "sr", label: "Српски" },
  { code: "hr", label: "Hrvatski" },
  { code: "bs", label: "Bosanski" },
  { code: "sl", label: "Slovenščina" },
  { code: "mk", label: "Македонски" },
  { code: "sq", label: "Shqip" },
  { code: "lt", label: "Lietuvių" },
  { code: "lv", label: "Latviešu" },
  { code: "et", label: "Eesti" },
  { code: "ka", label: "ქართული" },
  { code: "hy", label: "Հայերեն" },
  { code: "az", label: "Azərbaycanca" },
  { code: "kk", label: "Қазақша" },
  { code: "uz", label: "Oʻzbekcha" },
  { code: "mn", label: "Монгол" },
  { code: "is", label: "Íslenska" },
  { code: "ga", label: "Gaeilge" },
  { code: "ca", label: "Català" },
  { code: "eu", label: "Euskara" },
  { code: "gl", label: "Galego" },
  { code: "af", label: "Afrikaans" },
  { code: "sw", label: "Kiswahili" },
  { code: "am", label: "አማርኛ" },
  { code: "ne", label: "नेपाली" },
  { code: "si", label: "සිංහල" },
  { code: "km", label: "ខ្មែរ" },
  { code: "lo", label: "ລາວ" },
  { code: "my", label: "မြန်မာ" },
];

export const SUBTITLE_LANGUAGE_CODES = new Set(SUBTITLE_LANGUAGES.map((l) => l.code));

const subtitleLanguageLabels = new Map(SUBTITLE_LANGUAGES.map((language) => [language.code, language.label]));

export function subtitleLanguageLabel(code: string): string {
  return subtitleLanguageLabels.get(code) ?? code;
}
