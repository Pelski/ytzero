import { database } from "./database";
import { getSetting, reloadSettingCache } from "./db";
import { classifyIsShort, fetchChannelAbout, fetchVideoInfo, searchYouTube, type SearchResult, type VideoInfo } from "./youtube";
import { buildKeywordPlan, tokenizeDiscoveryText, type KeywordSeed } from "./discoveryKeywords";
import { DL_DEFAULTS, resetDownloadsState } from "./downloader";
import { SUBTITLE_LANGUAGES } from "./subtitleLanguages";
import { maintenanceActive } from "./maintenance";
import { log } from "./logger";
import { storedUtcTimestampMs, zonedDayHour } from "./timeZone";
import { listDownloadRules, restoreDownloadRules } from "./downloadRules";
import { effectiveVideoTagsCte } from "./insightTags";
import { followedExists, followedPlaylistExists } from "./feedQueryFragments";
import {
  diversifyRecommendations,
  isEligibleRecommendation,
  recommendationHoursNear,
  recommendationProgress,
  recommendationTimeOfDay,
  scoreRecommendationCandidate,
  type RecommendationTimeOfDay,
} from "./recommendationRanking";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  route: string;
  icon: string;
  permissions: string[];
  // "user" (default): settings live per profile in plugin_settings.
  // "global": settings are app-wide, stored in the settings table — used by
  // plugins that manage shared resources (e.g. one downloads directory).
  settingsScope?: "user" | "global";
}

type PluginLanguage = "en" | "pl" | "de";
type LocalizedText = Record<PluginLanguage, string>;

export type PluginSettingType = "slider" | "select" | "toggle" | "text" | "multiselect";

export interface PluginSettingOption {
  value: string;
  label: string;
}

export interface PluginSettingDef {
  key: string;
  label: string;
  description: string;
  type: PluginSettingType;
  min?: number;
  max?: number;
  step?: number;
  options?: PluginSettingOption[];
  defaultValue: number | string;
}

export type PluginSettingValue = number | string;

export interface PluginTermState {
  lastTerms: string[];
  blockedTerms: string[];
}

type PluginSettingSource = Omit<PluginSettingDef, "label" | "description" | "type" | "options"> & {
  label: LocalizedText;
  description: LocalizedText;
  type?: PluginSettingType;
  options?: { value: string; label: LocalizedText }[];
};

const DISCOVERY_SETTINGS: PluginSettingSource[] = [
  { key: "total_limit", label: { en: "Number of suggestions", pl: "Liczba propozycji", de: "Anzahl der Vorschläge" }, description: { en: "How many videos Recommendations should prepare at once.", pl: "Ile filmów Rekomendacje mają przygotować naraz.", de: "Wie viele Videos Empfehlungen auf einmal vorbereiten soll." }, min: 8, max: 80, step: 1, defaultValue: 32 },
  { key: "per_channel_limit", label: { en: "Videos from one channel", pl: "Filmy z jednego kanału", de: "Videos von einem Kanal" }, description: { en: "Prevents one channel from taking over the whole list.", pl: "Pilnuje, żeby jeden kanał nie zajął całej listy.", de: "Verhindert, dass ein Kanal die ganze Liste dominiert." }, min: 1, max: 20, step: 1, defaultValue: 5 },
  { key: "shared_tag_points", label: { en: "Shared tags", pl: "Wspólne tagi", de: "Gemeinsame Tags" }, description: { en: "Fallback tag affinity used after Pulse has matched tags and channels for the current hour.", pl: "Ogólne dopasowanie tagów używane po godzinowym dopasowaniu Pulse dla tagów i kanałów.", de: "Allgemeine Tag-Affinität nach dem stündlichen Pulse-Abgleich für Tags und Kanäle." }, min: 0, max: 80, step: 1, defaultValue: 25 },
  { key: "tag_history_points", label: { en: "Watched tags", pl: "Oglądane tagi", de: "Angesehene Tags" }, description: { en: "Adds weight for tags that appear often in your watch history.", pl: "Dodaje wagę tagom, które często pojawiają się w Twojej historii.", de: "Gewichtet Tags höher, die oft in deinem Verlauf vorkommen." }, min: 0, max: 20, step: 1, defaultValue: 3 },
  { key: "tag_history_cap", label: { en: "Watched tag limit", pl: "Limit oglądanych tagów", de: "Limit für angesehene Tags" }, description: { en: "Caps how much watched tags can influence one video.", pl: "Ogranicza, jak mocno oglądane tagi mogą podbić jeden film.", de: "Begrenzt, wie stark angesehene Tags ein Video anheben können." }, min: 0, max: 120, step: 1, defaultValue: 36 },
  { key: "watched_channel_points", label: { en: "Known channels", pl: "Znane kanały", de: "Bekannte Kanäle" }, description: { en: "General channel affinity used after current-hour Pulse matches.", pl: "Ogólne dopasowanie kanałów używane po godzinowych dopasowaniach Pulse.", de: "Allgemeine Kanal-Affinität nach den Pulse-Treffern der aktuellen Stunde." }, min: 0, max: 30, step: 1, defaultValue: 8 },
  { key: "watched_channel_cap", label: { en: "Known channel limit", pl: "Limit znanych kanałów", de: "Limit für bekannte Kanäle" }, description: { en: "Caps how much channel history can influence one video.", pl: "Ogranicza wpływ historii kanału na jeden film.", de: "Begrenzt den Einfluss der Kanalhistorie auf ein Video." }, min: 0, max: 120, step: 1, defaultValue: 40 },
  { key: "playlist_points", label: { en: "Your playlists", pl: "Twoje playlisty", de: "Deine Playlists" }, description: { en: "Raises videos that are already saved in your playlists.", pl: "Podbija filmy zapisane już na Twoich playlistach.", de: "Hebt Videos an, die bereits in deinen Playlists liegen." }, min: 0, max: 80, step: 1, defaultValue: 20 },
  { key: "liked_points", label: { en: "Liked videos", pl: "Polubione filmy", de: "Favorisierte Videos" }, description: { en: "Raises videos you marked as liked.", pl: "Podbija filmy oznaczone jako polubione.", de: "Hebt Videos an, die du favorisiert hast." }, min: 0, max: 100, step: 1, defaultValue: 35 },
  { key: "already_watched_points", label: { en: "Opened before", pl: "Wcześniej otwarte", de: "Zuvor geöffnet" }, description: { en: "Gives a small boost to videos you opened but did not complete.", pl: "Lekko podbija filmy otwarte wcześniej, ale niedokończone.", de: "Gewichtet zuvor geöffnete, aber nicht beendete Videos leicht höher." }, min: 0, max: 50, step: 1, defaultValue: 10 },
  { key: "started_points", label: { en: "Started videos", pl: "Rozpoczęte filmy", de: "Begonnene Videos" }, description: { en: "Raises videos where you watched part of the material.", pl: "Podbija filmy, które były już częściowo oglądane.", de: "Hebt Videos an, von denen du bereits einen Teil gesehen hast." }, min: 0, max: 80, step: 1, defaultValue: 15 },
  { key: "external_adjustment", label: { en: "Temporary videos", pl: "Filmy tymczasowe", de: "Temporäre Videos" }, description: { en: "Adjusts how strongly videos from outside your subscriptions are promoted.", pl: "Reguluje, jak mocno promowane są filmy spoza subskrypcji.", de: "Steuert, wie stark Videos außerhalb deiner Abos gewichtet werden." }, min: -50, max: 50, step: 1, defaultValue: -5 },
  { key: "recency_points", label: { en: "Freshness", pl: "Świeżość", de: "Aktualität" }, description: { en: "Raises newer videos so the list does not feel stale.", pl: "Podbija nowsze filmy, żeby lista nie była zbyt stara.", de: "Hebt neuere Videos an, damit die Liste aktuell bleibt." }, min: 0, max: 60, step: 1, defaultValue: 18 },
  { key: "outside_base_points", label: { en: "Outside suggestions", pl: "Propozycje z zewnątrz", de: "Externe Vorschläge" }, description: { en: "Base weight for videos discovered outside your saved channels.", pl: "Bazowa waga filmów znalezionych poza zapisanymi kanałami.", de: "Grundgewicht für Videos außerhalb deiner gespeicherten Kanäle." }, min: 0, max: 100, step: 1, defaultValue: 35 },
  { key: "outside_exact_match_points", label: { en: "Exact topic match", pl: "Dokładne dopasowanie tematu", de: "Genaue Themenübereinstimmung" }, description: { en: "Raises outside videos whose titles use topics from your library.", pl: "Podbija filmy z zewnątrz, których tytuły używają tematów z Twojej biblioteki.", de: "Hebt externe Videos an, deren Titel Themen aus deiner Bibliothek enthalten." }, min: 0, max: 40, step: 1, defaultValue: 12 },
  { key: "outside_partial_match_points", label: { en: "Loose topic match", pl: "Luźne dopasowanie tematu", de: "Lockere Themenübereinstimmung" }, description: { en: "Raises outside videos with titles loosely related to your library.", pl: "Podbija filmy z zewnątrz luźno powiązane tytułem z Twoją biblioteką.", de: "Hebt externe Videos an, deren Titel grob zu deiner Bibliothek passen." }, min: 0, max: 30, step: 1, defaultValue: 5 },
  { key: "early_external_count", label: { en: "Early outside videos", pl: "Wczesne filmy z zewnątrz", de: "Frühe externe Videos" }, description: { en: "How many outside videos may appear near the beginning.", pl: "Ile filmów z zewnątrz może trafić blisko początku listy.", de: "Wie viele externe Videos früh in der Liste erscheinen dürfen." }, min: 0, max: 8, step: 1, defaultValue: 2 },
  { key: "random_pick_count", label: { en: "Variety near the top", pl: "Różnorodność na początku", de: "Abwechslung am Anfang" }, description: { en: "Mixes in a few strong suggestions so the list changes between reloads.", pl: "Miesza kilka mocnych propozycji, żeby lista zmieniała się po przeładowaniu.", de: "Mischt starke Vorschläge ein, damit die Liste beim Neuladen variiert." }, min: 0, max: 10, step: 1, defaultValue: 3 },
  { key: "high_pick_count", label: { en: "Top matches after variety", pl: "Najlepsze po miksie", de: "Beste Treffer nach dem Mix" }, description: { en: "How many strongest matches should follow the first mixed items.", pl: "Ile najmocniejszych dopasowań ma iść po pierwszych wymieszanych pozycjach.", de: "Wie viele stärkste Treffer nach den gemischten Einträgen folgen." }, min: 0, max: 20, step: 1, defaultValue: 6 },
];

const DOWNLOADS_SETTINGS: PluginSettingSource[] = [
  {
    key: "quality",
    type: "select",
    label: { en: "Video quality", pl: "Jakość wideo", de: "Videoqualität" },
    description: { en: "Maximum resolution to download. Prefers h264 so files play everywhere.", pl: "Maksymalna pobierana rozdzielczość. Preferuje h264, żeby pliki działały wszędzie.", de: "Maximale Auflösung beim Herunterladen. Bevorzugt h264 für maximale Kompatibilität." },
    options: [
      { value: "best", label: { en: "Best available", pl: "Najlepsza dostępna", de: "Beste verfügbare" } },
      { value: "1440", label: { en: "1440p", pl: "1440p", de: "1440p" } },
      { value: "1080", label: { en: "1080p", pl: "1080p", de: "1080p" } },
      { value: "720", label: { en: "720p", pl: "720p", de: "720p" } },
      { value: "480", label: { en: "480p", pl: "480p", de: "480p" } },
    ],
    defaultValue: DL_DEFAULTS.quality,
  },
  {
    key: "watch_source_mode",
    type: "select",
    label: { en: "Opening a video", pl: "Wejście na film", de: "Video öffnen" },
    description: { en: "What happens when you open a video that isn't downloaded yet.", pl: "Co ma się dziać, gdy otwierasz film, który nie jest jeszcze pobrany.", de: "Was passiert, wenn du ein noch nicht heruntergeladenes Video öffnest." },
    options: [
      { value: "youtube", label: { en: "Play from YouTube", pl: "Odtwarzaj z YouTube", de: "Von YouTube abspielen" } },
      { value: "ask", label: { en: "Ask every time", pl: "Daj wybór", de: "Jedes Mal fragen" } },
      { value: "download", label: { en: "Always wait for the download", pl: "Zawsze czekaj na pobranie", de: "Immer auf den Download warten" } },
    ],
    defaultValue: DL_DEFAULTS.watch_source_mode,
  },
  {
    key: "output_template",
    type: "text",
    label: { en: "Filename template", pl: "Szablon nazwy pliku", de: "Dateinamen-Vorlage" },
    description: {
      en: "Tokens: {channel} {title} {id} {date} {year} {month} {day} {channel_id} {playlist}. {playlist} is set only for downloads queued from a playlist. \"/\" creates folders, e.g. {playlist}/{date} - {title} [{id}].",
      pl: "Znaczniki: {channel} {title} {id} {date} {year} {month} {day} {channel_id} {playlist}. {playlist} jest ustawione tylko dla pobrań zakolejkowanych z playlisty. „/” tworzy foldery, np. {playlist}/{date} - {title} [{id}].",
      de: "Platzhalter: {channel} {title} {id} {date} {year} {month} {day} {channel_id} {playlist}. {playlist} wird nur bei Downloads aus einer Playlist gesetzt. „/“ erzeugt Ordner, z. B. {playlist}/{date} - {title} [{id}].",
    },
    defaultValue: DL_DEFAULTS.output_template,
  },
  {
    key: "write_thumbnail",
    type: "toggle",
    label: { en: "Save thumbnail", pl: "Zapisuj miniaturkę", de: "Vorschaubild speichern" },
    description: { en: "Stores the video thumbnail next to the file.", pl: "Zapisuje miniaturkę filmu obok pliku.", de: "Speichert das Vorschaubild neben der Datei." },
    defaultValue: DL_DEFAULTS.write_thumbnail,
  },
  {
    key: "embed_metadata",
    type: "toggle",
    label: { en: "Embed metadata", pl: "Osadzaj metadane", de: "Metadaten einbetten" },
    description: { en: "Writes title, chapters and description into the video file.", pl: "Wpisuje tytuł, rozdziały i opis do pliku wideo.", de: "Schreibt Titel, Kapitel und Beschreibung in die Videodatei." },
    defaultValue: DL_DEFAULTS.embed_metadata,
  },
  {
    key: "write_info_json",
    type: "toggle",
    label: { en: "Save info.json", pl: "Zapisuj info.json", de: "info.json speichern" },
    description: { en: "Stores yt-dlp's full metadata file next to the video.", pl: "Zapisuje pełny plik metadanych yt-dlp obok filmu.", de: "Speichert die vollständige yt-dlp-Metadatendatei neben dem Video." },
    defaultValue: DL_DEFAULTS.write_info_json,
  },
  {
    key: "write_nfo",
    type: "toggle",
    label: { en: "Save NFO file", pl: "Zapisuj plik NFO", de: "NFO-Datei speichern" },
    description: { en: "Kodi/Jellyfin-style metadata (title, plot, channel, date).", pl: "Metadane w stylu Kodi/Jellyfin (tytuł, opis, kanał, data).", de: "Metadaten im Kodi/Jellyfin-Stil (Titel, Handlung, Kanal, Datum)." },
    defaultValue: DL_DEFAULTS.write_nfo,
  },
  {
    key: "write_subs",
    type: "toggle",
    label: { en: "Download subtitles", pl: "Pobieraj napisy", de: "Untertitel laden" },
    description: { en: "Saves the video's subtitles next to the file.", pl: "Zapisuje napisy filmu obok pliku.", de: "Speichert die Untertitel des Videos neben der Datei." },
    defaultValue: DL_DEFAULTS.write_subs,
  },
  {
    key: "write_auto_subs",
    type: "toggle",
    label: { en: "Include auto-generated subtitles", pl: "Także napisy automatyczne", de: "Auch automatische Untertitel" },
    description: { en: "Also downloads YouTube's auto-generated captions.", pl: "Pobiera też napisy generowane automatycznie przez YouTube.", de: "Lädt auch automatisch generierte YouTube-Untertitel." },
    defaultValue: DL_DEFAULTS.write_auto_subs,
  },
  {
    key: "sub_langs",
    type: "multiselect",
    label: { en: "Subtitle languages", pl: "Języki napisów", de: "Untertitelsprachen" },
    description: { en: "Languages downloaded with every video (when subtitles are enabled).", pl: "Języki pobierane z każdym filmem (gdy napisy są włączone).", de: "Sprachen, die mit jedem Video geladen werden (wenn Untertitel aktiv sind)." },
    options: SUBTITLE_LANGUAGES.map((lang) => ({ value: lang.code, label: { en: lang.label, pl: lang.label, de: lang.label } })),
    defaultValue: DL_DEFAULTS.sub_langs,
  },
  {
    key: "thumb_progress",
    type: "toggle",
    label: { en: "Progress bar on thumbnails", pl: "Pasek pobierania na miniaturkach", de: "Fortschrittsbalken auf Vorschaubildern" },
    description: { en: "Shows a thin download progress bar on top of video thumbnails.", pl: "Pokazuje cienki pasek postępu pobierania na górze miniaturek.", de: "Zeigt einen dünnen Download-Fortschrittsbalken oben auf Vorschaubildern." },
    defaultValue: DL_DEFAULTS.thumb_progress,
  },
  {
    key: "download_scheduled",
    type: "toggle",
    label: { en: "Download scheduled videos", pl: "Pobieraj zaplanowane", de: "Geplante Videos laden" },
    description: { en: "Videos placed on a watch-later bucket are fetched automatically.", pl: "Filmy dodane do „Do obejrzenia” pobierają się automatycznie.", de: "Videos auf einem Später-ansehen-Slot werden automatisch geladen." },
    defaultValue: DL_DEFAULTS.download_scheduled,
  },
  {
    key: "download_feed",
    type: "toggle",
    label: { en: "Download new uploads", pl: "Pobieraj nowe z subskrypcji", de: "Neue Uploads laden" },
    description: { en: "Fresh videos from followed channels are fetched as they appear.", pl: "Świeże filmy z obserwowanych kanałów pobierają się od razu po publikacji.", de: "Frische Videos abonnierter Kanäle werden direkt nach Erscheinen geladen." },
    defaultValue: DL_DEFAULTS.download_feed,
  },
  {
    key: "feed_max_age_hours",
    type: "slider",
    label: { en: "New upload window (hours)", pl: "Okno nowości (godziny)", de: "Zeitfenster für Neues (Stunden)" },
    description: { en: "Only uploads younger than this are auto-downloaded from the feed.", pl: "Z feedu pobierają się tylko filmy młodsze niż tyle godzin.", de: "Nur Uploads, die jünger sind, werden automatisch geladen." },
    min: 6, max: 168, step: 6,
    defaultValue: DL_DEFAULTS.feed_max_age_hours,
  },
  {
    key: "feed_min_duration_minutes",
    type: "slider",
    label: { en: "Minimum length for new uploads (minutes)", pl: "Minimalna długość nowych filmów (minuty)", de: "Mindestlänge neuer Uploads (Minuten)" },
    description: { en: "Skips shorter videos when automatically downloading new uploads. Set to 0 to disable the global threshold; a channel can override it.", pl: "Pomija krótsze filmy przy automatycznym pobieraniu nowych materiałów. Ustaw 0, aby wyłączyć globalny próg; kanał może go nadpisać.", de: "Überspringt kürzere Videos beim automatischen Herunterladen neuer Uploads. Bei 0 ist der globale Schwellenwert aus; Kanäle können ihn überschreiben." },
    min: 0, max: 60, step: 1,
    defaultValue: DL_DEFAULTS.feed_min_duration_minutes,
  },
  {
    key: "download_shorts",
    type: "toggle",
    label: { en: "Include Shorts", pl: "Pobieraj Shorts", de: "Shorts einschließen" },
    description: { en: "Also auto-download Shorts from the feed. Scheduled Shorts download regardless.", pl: "Pobieraj też Shorts z feedu. Zaplanowane Shorts pobierają się niezależnie od tego.", de: "Auch Shorts aus dem Feed laden. Geplante Shorts werden unabhängig davon geladen." },
    defaultValue: DL_DEFAULTS.download_shorts,
  },
  {
    key: "retention_days",
    type: "slider",
    label: { en: "Keep files for (days)", pl: "Przechowuj pliki (dni)", de: "Dateien behalten (Tage)" },
    description: { en: "Downloads are removed this many days after they finished.", pl: "Pobrane pliki są usuwane po tylu dniach od pobrania.", de: "Downloads werden so viele Tage nach Abschluss entfernt." },
    min: 1, max: 90, step: 1,
    defaultValue: DL_DEFAULTS.retention_days,
  },
  {
    key: "delete_watched",
    type: "toggle",
    label: { en: "Remove after watching", pl: "Usuwaj obejrzane", de: "Nach dem Ansehen entfernen" },
    description: { en: "Once watched, the file is removed after a grace period.", pl: "Po obejrzeniu plik znika po okresie karencji.", de: "Nach dem Ansehen wird die Datei nach einer Schonfrist entfernt." },
    defaultValue: DL_DEFAULTS.delete_watched,
  },
  {
    key: "delete_watched_hours",
    type: "slider",
    label: { en: "Watched grace period (hours)", pl: "Karencja po obejrzeniu (godziny)", de: "Schonfrist nach dem Ansehen (Stunden)" },
    description: { en: "How long a watched file sticks around before removal.", pl: "Ile godzin obejrzany plik czeka, zanim zostanie usunięty.", de: "Wie lange eine angesehene Datei vor der Entfernung erhalten bleibt." },
    min: 1, max: 168, step: 1,
    defaultValue: DL_DEFAULTS.delete_watched_hours,
  },
  {
    key: "keep_liked",
    type: "toggle",
    label: { en: "Protect liked videos", pl: "Chroń polubione", de: "Favorisierte schützen" },
    description: { en: "Liked videos are never auto-removed by retention or the storage cap.", pl: "Polubione filmy nigdy nie są usuwane automatycznie — ani przez retencję, ani przez limit dysku.", de: "Favorisierte Videos werden nie automatisch entfernt — weder durch Aufbewahrung noch durch das Speicherlimit." },
    defaultValue: DL_DEFAULTS.keep_liked,
  },
  {
    key: "max_storage_gb",
    type: "slider",
    label: { en: "Storage cap (GB)", pl: "Limit dysku (GB)", de: "Speicherlimit (GB)" },
    description: { en: "Above this the oldest unprotected downloads are removed first.", pl: "Po przekroczeniu najstarsze niechronione pliki usuwane są w pierwszej kolejności.", de: "Darüber werden die ältesten ungeschützten Downloads zuerst entfernt." },
    min: 1, max: 500, step: 1,
    defaultValue: DL_DEFAULTS.max_storage_gb,
  },
  {
    key: "experimental_streaming",
    type: "toggle",
    label: { en: "Stream while downloading (experimental)", pl: "Streaming w trakcie pobierania (eksperymentalne)", de: "Streamen während des Downloads (experimentell)" },
    description: {
      en: "HIGHLY EXPERIMENTAL. Opening a not-yet-downloaded video plays it instantly via a live HLS stream while yt-dlp + ffmpeg download it in the background. You can seek anywhere already downloaded; seeking further ahead waits for the download to catch up. The finished stream is also saved as a normal download. Requires ffmpeg. H.264 only, so quality is capped at ~1080p.",
      pl: "MOCNO EKSPERYMENTALNE. Wejście na niepobrany film odtwarza go od razu przez strumień HLS na żywo, podczas gdy yt-dlp + ffmpeg pobierają go w tle. Możesz przewijać po wszystkim, co już pobrane; przewinięcie dalej czeka, aż pobieranie dogoni. Ukończony strumień zapisuje się też jako zwykłe pobranie. Wymaga ffmpeg. Tylko H.264, więc jakość ograniczona do ~1080p.",
      de: "HOCHEXPERIMENTELL. Beim Öffnen eines noch nicht heruntergeladenen Videos wird es sofort über einen Live-HLS-Stream abgespielt, während yt-dlp + ffmpeg es im Hintergrund laden. Du kannst überall im bereits Geladenen spulen; weiter nach vorne zu spulen wartet, bis der Download aufholt. Der fertige Stream wird zusätzlich als normaler Download gespeichert. Benötigt ffmpeg. Nur H.264, daher Qualität auf ~1080p begrenzt.",
    },
    defaultValue: DL_DEFAULTS.experimental_streaming,
  },
];

export const PLUGINS: PluginManifest[] = [
  {
    id: "discovery",
    name: "Extended recommendations",
    version: "0.1.0",
    description: "Adds suggestions from outside your library to the core recommendations view.",
    route: "/recommendations",
    icon: "Sparkles",
    permissions: ["read:library", "read:history", "network:video-search"],
  },
  {
    id: "downloads",
    name: "YT-DLP Integration",
    version: "0.1.0",
    description: "Downloads videos with yt-dlp for smooth local playback, with retention and storage limits.",
    route: "/downloads",
    icon: "Download",
    permissions: ["read:library", "network:video-download", "storage:local-files"],
    settingsScope: "global",
  },
];

const PLUGIN_TEXT: Record<string, { name: LocalizedText; description: LocalizedText; permissions: Record<string, LocalizedText> }> = {
  discovery: {
    name: { en: "Extended recommendations", pl: "Rozszerzone rekomendacje", de: "Erweiterte Empfehlungen" },
    description: {
      en: "Adds suggestions from outside your library to the core recommendations view.",
      pl: "Dodaje do podstawowych rekomendacji propozycje spoza Twojej biblioteki.",
      de: "Ergänzt die grundlegenden Empfehlungen um Vorschläge außerhalb deiner Bibliothek.",
    },
    permissions: {
      "read:library": { en: "reads your local library", pl: "czyta lokalną bibliotekę", de: "liest deine lokale Bibliothek" },
      "read:history": { en: "uses your watch history", pl: "używa historii oglądania", de: "nutzt deinen Verlauf" },
      "network:video-search": { en: "can search for new video ideas", pl: "może szukać nowych propozycji", de: "kann nach neuen Videovorschlägen suchen" },
    },
  },
  downloads: {
    name: { en: "YT-DLP Integration", pl: "Integracja YT-DLP", de: "YT-DLP-Integration" },
    description: {
      en: "Downloads videos with yt-dlp for smooth local playback, with retention and storage limits.",
      pl: "Pobiera filmy przez yt-dlp do płynnego lokalnego odtwarzania, z retencją i limitem miejsca.",
      de: "Lädt Videos mit yt-dlp für flüssige lokale Wiedergabe herunter, mit Aufbewahrung und Speicherlimit.",
    },
    permissions: {
      "read:library": { en: "reads your local library", pl: "czyta lokalną bibliotekę", de: "liest deine lokale Bibliothek" },
      "network:video-download": { en: "downloads videos from YouTube", pl: "pobiera filmy z YouTube", de: "lädt Videos von YouTube herunter" },
      "storage:local-files": { en: "stores video files on disk", pl: "zapisuje pliki wideo na dysku", de: "speichert Videodateien auf der Festplatte" },
    },
  },
};

for (const plugin of PLUGINS) {
  await database.prepare("INSERT OR IGNORE INTO plugins (id, enabled, version) VALUES (?, ?, ?)")
    .run(plugin.id, 0, plugin.version);
  await database.prepare("UPDATE plugins SET version = ? WHERE id = ?").run(plugin.version, plugin.id);
}

function normalizePluginLanguage(language: string | null | undefined): PluginLanguage {
  return language === "pl" || language === "de" || language === "en" ? language : "en";
}

function text(value: LocalizedText, language: string | null | undefined) {
  return value[normalizePluginLanguage(language)] ?? value.en;
}

function localizeSetting(def: PluginSettingSource, language: string | null | undefined): PluginSettingDef {
  return {
    ...def,
    type: def.type ?? "slider",
    label: text(def.label, language),
    description: text(def.description, language),
    options: def.options?.map((option) => ({ value: option.value, label: text(option.label, language) })),
  };
}

function localizePlugin(manifest: PluginManifest, language: string | null | undefined): PluginManifest {
  const copy = PLUGIN_TEXT[manifest.id];
  if (!copy) return manifest;
  return {
    ...manifest,
    name: text(copy.name, language),
    description: text(copy.description, language),
    permissions: manifest.permissions.map((permission) => text(copy.permissions[permission] ?? { en: permission, pl: permission, de: permission }, language)),
  };
}

export async function listPlugins(language?: string | null) {
  const states = await database.prepare("SELECT id, enabled, version FROM plugins").all() as { id: string; enabled: number; version: string }[];
  const byId = new Map(states.map((s) => [s.id, s]));
  return PLUGINS.filter((manifest) => manifest.id !== "downloads").map((manifest) => {
    const state = byId.get(manifest.id);
    return { ...localizePlugin(manifest, language), enabled: state?.enabled !== 0 };
  });
}

const pluginEnabledCache = new Map(
  (await database.prepare("SELECT id, enabled FROM plugins").all() as { id: string; enabled: number }[])
    .map((row) => [row.id, row.enabled !== 0]),
);

export function pluginEnabled(id: string) {
  return pluginEnabledCache.get(id) ?? true;
}

export async function setPluginEnabled(id: string, enabled: boolean) {
  const manifest = PLUGINS.find((p) => p.id === id);
  if (!manifest) throw new Error("plugin not found");
  await database.prepare(
    "INSERT INTO plugins (id, enabled, version, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, version = excluded.version, updated_at = excluded.updated_at"
  ).run(id, enabled ? 1 : 0, manifest.version);
  pluginEnabledCache.set(id, enabled);
}

function settingDefs(pluginId: string): PluginSettingSource[] {
  if (pluginId === "discovery") return DISCOVERY_SETTINGS;
  if (pluginId === "downloads") return DOWNLOADS_SETTINGS;
  return [];
}

// Coerce a stored/incoming raw value to something valid for the definition;
// anything unparseable falls back to the default.
function normalizeSettingValue(raw: string | null | undefined, def: PluginSettingSource): PluginSettingValue {
  const type = def.type ?? "slider";
  if (type === "select") {
    return def.options?.some((option) => option.value === raw) ? (raw as string) : (def.defaultValue as string);
  }
  if (type === "text") {
    const value = typeof raw === "string" ? raw.trim() : "";
    return value || (def.defaultValue as string);
  }
  if (type === "multiselect") {
    // Stored as a comma-separated list of option values (yt-dlp friendly).
    const valid = new Set((def.options ?? []).map((option) => option.value));
    const picked = typeof raw === "string"
      ? [...new Set(raw.split(",").map((item) => item.trim()).filter((item) => valid.has(item)))]
      : [];
    return picked.length > 0 ? picked.join(",") : (def.defaultValue as string);
  }
  const n = Number(raw);
  const value = raw != null && Number.isFinite(n) ? n : Number(def.defaultValue);
  if (type === "toggle") return value === 1 ? 1 : 0;
  return clampSetting(value, def);
}

export async function getPluginSettings(uid: number, pluginId: string, language?: string | null) {
  const manifest = PLUGINS.find((p) => p.id === pluginId);
  if (!manifest) throw new Error("plugin not found");
  const defs = settingDefs(pluginId);
  const values = new Map<string, string>();
  if (manifest.settingsScope === "global") {
    for (const def of defs) {
      const raw = getSetting(`plugin_${pluginId}_${def.key}`);
      if (raw != null) values.set(def.key, raw);
    }
  } else {
    const rows = await database.prepare("SELECT key, value FROM plugin_settings WHERE plugin_id = ? AND user_id = ?")
      .all(pluginId, uid) as { key: string; value: string }[];
    for (const row of rows) values.set(row.key, row.value);
  }
  const settings: Record<string, PluginSettingValue> = {};
  for (const def of defs) {
    settings[def.key] = normalizeSettingValue(values.get(def.key), def);
  }
  return {
    definitions: defs.map((def) => localizeSetting(def, language)),
    settings,
    terms: pluginId === "discovery" ? await discoveryTermState(uid) : undefined,
  };
}

export async function setPluginSettings(uid: number, pluginId: string, patch: Record<string, unknown>, language?: string | null) {
  const manifest = PLUGINS.find((p) => p.id === pluginId);
  if (!manifest) throw new Error("plugin not found");
  const defs = settingDefs(pluginId);
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const tx = database.transaction(async () => {
    for (const [key, value] of Object.entries(patch)) {
      const def = byKey.get(key);
      if (!def) continue;
      const normalized = normalizeSettingValue(value == null ? null : String(value), def);
      if (manifest.settingsScope === "global") {
        await database.prepare(
          "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ).run(`plugin_${pluginId}_${key}`, String(normalized));
      } else {
        await database.prepare(
          "INSERT INTO plugin_settings (plugin_id, user_id, key, value) VALUES (?, ?, ?, ?) ON CONFLICT(plugin_id, user_id, key) DO UPDATE SET value = excluded.value"
        ).run(pluginId, uid, key, String(normalized));
      }
    }
  });
  await tx();
  // Global plugin values are read through db.ts' synchronous settings cache.
  // Keep it aligned with the transaction before building the response; without
  // this, the UI receives the previous values and appears to undo the change.
  if (manifest.settingsScope === "global") await reloadSettingCache();
  if (pluginId === "discovery" && "blockedTerms" in patch) {
    await setDiscoveryBlockedTerms(uid, patch.blockedTerms);
  }
  if (pluginId === "discovery") {
    await invalidateDiscoveryRecommendations(uid);
    refreshDiscoveryInBackground(uid);
  }
  return getPluginSettings(uid, pluginId, language);
}

// Portable backup is adapter-driven: core never serializes plugin tables or
// opaque state. Each adapter exposes only values owned and validated by the
// current plugin implementation.
export interface PortablePluginBackupAdapter {
  id: string;
  scope: "instance" | "profile";
  schemaVersion: number;
  export(userId: number): Promise<unknown>;
  restore(userId: number, value: unknown): Promise<void>;
}

export const PLUGIN_BACKUP_ADAPTERS: readonly PortablePluginBackupAdapter[] = [
  {
    id: "discovery",
    scope: "profile",
    schemaVersion: 1,
    async export(userId) {
      const blocked = await database.prepare("SELECT value FROM plugin_state WHERE plugin_id='discovery' AND user_id=? AND key='blocked_terms'").get(userId) as { value: string } | null;
      let blockedTerms: string[] = [];
      try { blockedTerms = blocked ? JSON.parse(blocked.value) : []; } catch {}
      return { settings: (await getPluginSettings(userId, "discovery")).settings, blockedTerms };
    },
    async restore(userId, value) {
      const input = value && typeof value === "object" ? value as any : {};
      await setPluginSettings(userId, "discovery", { ...(input.settings ?? {}), blockedTerms: Array.isArray(input.blockedTerms) ? input.blockedTerms : [] });
    },
  },
  {
    id: "downloads",
    scope: "instance",
    schemaVersion: 2,
    async export(userId) {
      const rules = await listDownloadRules();
      const playlistIds = [...new Set(rules.flatMap((rule) => rule.playlist_ids))];
      const playlists = playlistIds.length
        ? await database.prepare(`SELECT playlist_id, channel_id, title, thumbnail, video_count FROM channel_playlists WHERE playlist_id IN (${playlistIds.map(() => "?").join(",")})`).all(...playlistIds)
        : [];
      return { settings: (await getPluginSettings(userId, "downloads")).settings, rules, playlists };
    },
    async restore(userId, value) {
      const input = value && typeof value === "object" ? value as any : {};
      await setPluginSettings(userId, "downloads", input.settings ?? {});
      for (const playlist of Array.isArray(input.playlists) ? input.playlists : []) {
        if (!playlist?.playlist_id || !playlist?.channel_id) continue;
        await database.prepare("INSERT INTO channels(channel_id,title,url,external) VALUES(?,?,?,1) ON CONFLICT(channel_id) DO NOTHING").run(playlist.channel_id, "", "");
        await database.prepare("INSERT INTO channel_playlists(playlist_id,channel_id,title,thumbnail,video_count) VALUES(?,?,?,?,?) ON CONFLICT(playlist_id) DO UPDATE SET title=excluded.title,thumbnail=excluded.thumbnail,video_count=excluded.video_count")
          .run(playlist.playlist_id, playlist.channel_id, String(playlist.title ?? ""), String(playlist.thumbnail ?? ""), String(playlist.video_count ?? ""));
      }
      await restoreDownloadRules(input.rules);
    },
  },
] as const;

export async function resetPluginState(uid: number, pluginId: string, language?: string | null) {
  if (!PLUGINS.some((plugin) => plugin.id === pluginId)) throw new Error("plugin not found");
  if (pluginId === "downloads") {
    await resetDownloadsState();
    await reloadSettingCache();
    return getPluginSettings(uid, pluginId, language);
  }
  if (pluginId === "discovery") {
    const timer = discoveryRefreshTimers.get(uid);
    if (timer) {
      clearTimeout(timer);
      discoveryRefreshTimers.delete(uid);
    }
    await discoveryRefreshInFlight.get(uid)?.catch(() => {});
  }

  const tx = database.transaction(async () => {
    if (pluginId === "discovery") {
      // Remove only temporary videos introduced by this profile's recommendations.
      // Anything watched, queued, liked or saved by any profile remains intact.
      await database.prepare(`
        DELETE FROM videos
        WHERE external = 1
          AND video_id IN (SELECT video_id FROM discovery_recommendations WHERE user_id = ?)
          AND NOT EXISTS (
            SELECT 1 FROM user_videos uv
            WHERE uv.video_id = videos.video_id
              AND (uv.status = 'queued' OR uv.liked = 1 OR uv.watch_position IS NOT NULL)
          )
          AND NOT EXISTS (SELECT 1 FROM user_playlist_videos upv WHERE upv.video_id = videos.video_id)
          AND NOT EXISTS (SELECT 1 FROM history h WHERE h.video_id = videos.video_id)
      `).run(uid);
      await database.prepare("DELETE FROM discovery_recommendations WHERE user_id = ?").run(uid);
      await database.prepare("DELETE FROM recommendation_feedback WHERE user_id = ?").run(uid);
      await database.prepare("DELETE FROM channels WHERE external = 1 AND channel_id NOT IN (SELECT DISTINCT channel_id FROM videos)").run();
    }
    await database.prepare("DELETE FROM plugin_settings WHERE plugin_id = ? AND user_id = ?").run(pluginId, uid);
    await database.prepare("DELETE FROM plugin_state WHERE plugin_id = ? AND user_id = ?").run(pluginId, uid);
  });
  await tx();
  return getPluginSettings(uid, pluginId, language);
}

async function discoverySettings(uid: number): Promise<Record<string, number>> {
  // Discovery definitions are all sliders, so the values are numbers.
  return (await getPluginSettings(uid, "discovery")).settings as Record<string, number>;
}

async function discoveryTermState(uid: number): Promise<PluginTermState> {
  return {
    lastTerms: await readDiscoveryTerms(uid, "last_terms"),
    blockedTerms: await readDiscoveryTerms(uid, "blocked_terms"),
  };
}

async function readDiscoveryTerms(uid: number, key: "last_terms" | "blocked_terms") {
  const row = await database.prepare("SELECT value FROM plugin_state WHERE plugin_id = 'discovery' AND user_id = ? AND key = ?")
    .get(uid, key) as { value: string } | null;
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.filter((term) => typeof term === "string") : [];
  } catch {
    return [];
  }
}

async function writeDiscoveryTerms(uid: number, key: "last_terms" | "blocked_terms", terms: string[]) {
  await database.prepare(`
    INSERT INTO plugin_state (plugin_id, user_id, key, value, updated_at)
    VALUES ('discovery', ?, ?, ?, datetime('now'))
    ON CONFLICT(plugin_id, user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(uid, key, JSON.stringify(terms));
}

async function setDiscoveryBlockedTerms(uid: number, value: unknown) {
  const raw = Array.isArray(value) ? value : [];
  const normalized = Array.from(new Set(raw.flatMap((term) => typeof term === "string" ? tokenizeDiscoveryText(term) : []))).sort();
  await writeDiscoveryTerms(uid, "blocked_terms", normalized);
}

function clampSetting(value: number, def: Pick<PluginSettingDef, "min" | "max" | "step">) {
  const step = def.step ?? 1;
  const stepped = Math.round(value / step) * step;
  return Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, stepped));
}

export interface DiscoveryRecommendation {
  kind: "local" | "external";
  score: number;
  reasons: string[];
  video?: any;
  result?: SearchResult;
  query?: string;
}

const DISCOVERY_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const discoveryRefreshInFlight = new Map<number, Promise<void>>();
const discoveryRefreshTimers = new Map<number, ReturnType<typeof setTimeout>>();

async function localRecommendations(
  uid: number,
  limit: number,
  settings: Record<string, number>,
  options: { allowExternal?: boolean; downloadsOnly?: boolean } = {},
): Promise<DiscoveryRecommendation[]> {
  const local = zonedDayHour();
  const nearbyHours = recommendationHoursNear(local.hour).join(",");
  // Candidate ownership is intentionally profile-scoped. Videos are global in
  // storage, so a plain scan would leak another profile's library and habits.
  const profileOwnsCandidate = `(
    ((${followedExists(uid)} AND v.external = 0) OR ${followedPlaylistExists(uid)})
    OR EXISTS (SELECT 1 FROM user_videos own_uv WHERE own_uv.user_id = ${uid} AND own_uv.video_id = v.video_id)
    OR EXISTS (SELECT 1 FROM history own_h WHERE own_h.user_id = ${uid} AND own_h.video_id = v.video_id)
    OR EXISTS (
      SELECT 1 FROM user_playlist_videos own_upv
      JOIN user_playlists own_up ON own_up.id = own_upv.playlist_id AND own_up.user_id = ${uid}
      WHERE own_upv.video_id = v.video_id
    )
    OR EXISTS (SELECT 1 FROM discovery_recommendations own_dr WHERE own_dr.user_id = ${uid} AND own_dr.video_id = v.video_id)
  )`;
  const externalWhere = options.allowExternal === false ? "AND v.external = 0" : "";
  const downloadsWhere = options.downloadsOnly
    ? "AND EXISTS (SELECT 1 FROM downloads allowed_download WHERE allowed_download.video_id = v.video_id AND allowed_download.status = 'done')"
    : "";

  const rows = await database.prepare(`${effectiveVideoTagsCte}
    SELECT v.video_id, v.channel_id, v.title, v.description, v.thumbnail, v.published_at,
           v.live_status, COALESCE(uv.status, 'inbox') AS status, uv.bucket, uv.show_from,
           v.is_short, v.is_private, v.views, v.likes, uv.liked, uv.watched,
           v.duration, uv.watch_position, uv.watch_duration, v.external,
           EXISTS(SELECT 1 FROM history h WHERE h.video_id = v.video_id AND h.user_id = ${uid}) AS in_history,
           COALESCE(c.custom_title, c.title) AS channel_title, c.thumbnail AS channel_thumbnail, c.subscriber_count AS channel_subscriber_count,
           COALESCE(chw.watch_count, 0) AS channel_watch_count,
           COALESCE(chtime.watch_seconds, 0) AS channel_watch_seconds,
           COALESCE(chtime.time_seconds, 0) AS channel_time_seconds,
           COALESCE(taghit.tag_hits, 0) AS tag_hits,
           COALESCE(tagwatch.tag_watch_count, 0) AS tag_watch_count,
           COALESCE(tagtime.time_seconds, 0) AS tag_time_seconds,
           COALESCE(plhit.playlist_hits, 0) AS playlist_hits
    FROM videos v
    JOIN channels c ON c.channel_id = v.channel_id
    LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ${uid}
    LEFT JOIN (
      SELECT v2.channel_id, count(DISTINCT h.video_id) AS watch_count
      FROM history h JOIN videos v2 ON v2.video_id = h.video_id
      WHERE h.user_id = ${uid}
      GROUP BY v2.channel_id
    ) chw ON chw.channel_id = v.channel_id
    LEFT JOIN (
      SELECT v2.channel_id, SUM(w.seconds) AS watch_seconds,
             SUM(CASE WHEN w.hour IN (${nearbyHours}) THEN w.seconds ELSE 0 END) AS time_seconds
      FROM watch_time_log w JOIN videos v2 ON v2.video_id = w.video_id
      WHERE w.user_id = ${uid}
      GROUP BY v2.channel_id
    ) chtime ON chtime.channel_id = v.channel_id
    LEFT JOIN (
      SELECT candidate.video_id, count(DISTINCT candidate.tag_id) AS tag_hits
      FROM effective_video_tags candidate
      JOIN (
        SELECT DISTINCT source.tag_id
        FROM effective_video_tags source
        LEFT JOIN user_videos suv ON suv.video_id = source.video_id AND suv.user_id = ${uid}
        WHERE source.user_id = ${uid}
          AND (suv.liked = 1 OR EXISTS (
            SELECT 1 FROM history h2 WHERE h2.video_id = source.video_id AND h2.user_id = ${uid}
          ))
      ) liked_tags ON liked_tags.tag_id = candidate.tag_id
      WHERE candidate.user_id = ${uid}
      GROUP BY candidate.video_id
    ) taghit ON taghit.video_id = v.video_id
    LEFT JOIN (
      SELECT upv.video_id, count(*) AS playlist_hits
      FROM user_playlist_videos upv JOIN user_playlists up ON up.id = upv.playlist_id
      WHERE up.user_id = ${uid}
      GROUP BY upv.video_id
    ) plhit ON plhit.video_id = v.video_id
    LEFT JOIN (
      SELECT candidate.video_id, sum(watched_tags.watch_count) AS tag_watch_count
      FROM effective_video_tags candidate
      JOIN (
        SELECT source.tag_id, count(DISTINCT source.video_id) AS watch_count
        FROM effective_video_tags source
        JOIN history h4 ON h4.video_id = source.video_id AND h4.user_id = ${uid}
        WHERE source.user_id = ${uid}
        GROUP BY source.tag_id
      ) watched_tags ON watched_tags.tag_id = candidate.tag_id
      WHERE candidate.user_id = ${uid}
      GROUP BY candidate.video_id
    ) tagwatch ON tagwatch.video_id = v.video_id
    LEFT JOIN (
      SELECT candidate.video_id, SUM(tag_clock.seconds) AS time_seconds
      FROM effective_video_tags candidate
      JOIN (
        SELECT tag_id, SUM(seconds) AS seconds
        FROM watch_tag_time_log
        WHERE user_id = ${uid} AND hour IN (${nearbyHours})
        GROUP BY tag_id
      ) tag_clock ON tag_clock.tag_id = candidate.tag_id
      WHERE candidate.user_id = ${uid}
      GROUP BY candidate.video_id
    ) tagtime ON tagtime.video_id = v.video_id
    WHERE v.is_short = 0
      AND v.live_status = 'none'
      AND COALESCE(v.is_private, 0) = 0
      AND v.published_at IS NOT NULL AND v.published_at != ''
      AND TRIM(v.title) != '' AND TRIM(v.thumbnail) != ''
      AND TRIM(COALESCE(c.custom_title, c.title)) != ''
      AND COALESCE(uv.status, 'inbox') != 'archived'
      AND COALESCE(uv.watched, 0) != 1
      AND (uv.watch_position IS NULL OR uv.watch_duration IS NULL OR uv.watch_duration <= 30
        OR uv.watch_position < 3 OR CAST(uv.watch_position AS REAL) / uv.watch_duration < 0.92)
      AND ${profileOwnsCandidate}
      ${externalWhere}
      ${downloadsWhere}
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_feedback rf
        WHERE rf.user_id = ${uid} AND rf.video_id = v.video_id AND rf.action = 'dismiss'
      )
    ORDER BY v.published_at DESC, v.video_id DESC
    LIMIT 300
  `).all() as any[];

  return rows
    .map((video) => scoreRecommendationCandidate(video, settings))
    .filter((recommendation): recommendation is DiscoveryRecommendation => recommendation != null)
    .sort((a, b) => b.score - a.score || String(a.video?.video_id).localeCompare(String(b.video?.video_id)))
    .slice(0, Math.max(0, Math.floor(limit)));
}

async function externalRecommendations(uid: number, limit: number, settings: Record<string, number>): Promise<DiscoveryRecommendation[]> {
  const seedRows = await database.prepare(`
    SELECT v.title AS text,
           CASE WHEN uv.liked = 1 THEN 6
                WHEN EXISTS (SELECT 1 FROM history h WHERE h.video_id = v.video_id AND h.user_id = ?) THEN 3
                ELSE 2 END AS weight,
           'title' AS kind
    FROM videos v
    LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ?
    WHERE uv.liked = 1
       OR EXISTS (SELECT 1 FROM history h WHERE h.video_id = v.video_id AND h.user_id = ?)
       OR uv.watch_position IS NOT NULL
    ORDER BY COALESCE(
      (SELECT MAX(h.watched_at) FROM history h WHERE h.video_id = v.video_id AND h.user_id = ?),
      v.published_at,
      v.created_at
    ) DESC
    LIMIT 80
  `).all(uid, uid, uid, uid) as KeywordSeed[];
  const tagRows = await database.prepare(`
    SELECT t.name AS text, 5 AS weight, 'tag' AS kind
    FROM tags t
    WHERE t.user_id = ? AND (
      EXISTS (SELECT 1 FROM video_tags vt JOIN user_videos uv ON uv.video_id = vt.video_id AND uv.user_id = ? WHERE vt.tag_id = t.id AND uv.liked = 1)
      OR EXISTS (SELECT 1 FROM channel_tags ct JOIN videos v ON v.channel_id = ct.channel_id JOIN history h ON h.video_id = v.video_id AND h.user_id = ? WHERE ct.tag_id = t.id)
    )
  `).all(uid, uid, uid) as KeywordSeed[];
  const blockedTerms = new Set(await readDiscoveryTerms(uid, "blocked_terms"));
  const keywordPlan = buildKeywordPlan([...tagRows, ...seedRows], blockedTerms, 24, 3);
  const foundTerms = keywordPlan.terms;
  await writeDiscoveryTerms(uid, "last_terms", foundTerms);
  const queries = keywordPlan.queries;

  const candidates: (SearchResult & { query: string; matchScore: number })[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    const queryTerms = new Set(tokenizeDiscoveryText(query));
    const search = await searchYouTube(query).catch(() => ({ results: [], channels: [] }));
    for (const result of search.results) {
      if (seen.has(result.videoId)) continue;
      if (await database.prepare("SELECT 1 FROM recommendation_feedback WHERE user_id = ? AND video_id = ? AND action = 'dismiss'").get(uid, result.videoId)) continue;
      seen.add(result.videoId);
      const matchScore = scoreSearchResult(result, queryTerms, settings);
      if (matchScore <= 0) continue;
      candidates.push({ ...result, query, matchScore });
    }
  }

  const imported: DiscoveryRecommendation[] = [];
  for (const candidate of candidates.sort((a, b) => b.matchScore - a.matchScore).slice(0, limit * 2)) {
    const info = await fetchVideoInfo(candidate.videoId).catch(() => null);
    if (!info) continue;
    if (info.liveStatus !== "none") continue;
    // A network error is `null`, not proof that this is a regular video.
    if (await classifyIsShort(info.videoId, info.title) !== false) continue;
    const about = await fetchChannelAbout(info.channelId).catch(() => null);
    await upsertExternalVideo(info, about?.avatar ?? "");
    const video = await selectVideo(uid, info.videoId);
    if (!video) continue;
    imported.push({
      kind: "local",
      score: settings.outside_base_points + candidate.matchScore,
      reasons: ["external search"],
      query: candidate.query,
      video,
    });
    if (imported.length >= limit) break;
  }
  return imported;
}

function scoreSearchResult(result: SearchResult, terms: Set<string>, settings: Record<string, number>) {
  const titleTokens = tokenizeDiscoveryText(`${result.title} ${result.channelTitle}`);
  let score = 0;
  for (const token of titleTokens) {
    if (terms.has(token)) score += settings.outside_exact_match_points;
    else {
      for (const term of terms) {
        if (token.includes(term) || term.includes(token)) {
          score += settings.outside_partial_match_points;
          break;
        }
      }
    }
  }
  if (result.viewCount != null && result.viewCount > 1000) score += 3;
  return score;
}

async function upsertExternalVideo(info: VideoInfo, channelThumbnail: string) {
  await database.prepare(`
    INSERT INTO channels (channel_id, title, url, thumbnail, followed, external)
    VALUES (?, ?, ?, ?, 0, 1)
    ON CONFLICT(channel_id) DO UPDATE SET
      title = CASE WHEN channels.title = '' OR channels.title IS NULL THEN excluded.title ELSE channels.title END,
      thumbnail = CASE WHEN channels.thumbnail = '' OR channels.thumbnail IS NULL THEN excluded.thumbnail ELSE channels.thumbnail END
  `).run(info.channelId, info.channelTitle, `https://www.youtube.com/channel/${info.channelId}`, channelThumbnail);

  await database.prepare(`
    INSERT INTO videos
      (video_id, channel_id, title, description, thumbnail, published_at, live_status, status, views, duration, is_short, external)
    VALUES (?, ?, ?, ?, ?, ?, 'none', 'inbox', ?, ?, 0, 1)
    ON CONFLICT(video_id) DO UPDATE SET
      title = CASE WHEN videos.title = '' OR videos.title IS NULL THEN excluded.title ELSE videos.title END,
      description = CASE WHEN videos.description = '' OR videos.description IS NULL THEN excluded.description ELSE videos.description END,
      thumbnail = CASE WHEN videos.thumbnail = '' OR videos.thumbnail IS NULL THEN excluded.thumbnail ELSE videos.thumbnail END,
      views = COALESCE(videos.views, excluded.views),
      duration = COALESCE(videos.duration, excluded.duration),
      live_status = CASE
        WHEN videos.live_status IN ('live', 'upcoming', 'was_live') THEN videos.live_status
        ELSE excluded.live_status
      END,
      is_short = CASE WHEN videos.is_short = 1 THEN 1 ELSE COALESCE(videos.is_short, excluded.is_short) END
  `).run(
    info.videoId,
    info.channelId,
    info.title,
    info.description,
    info.thumbnail,
    info.publishedAt,
    info.viewCount,
    info.duration,
  );
}

async function selectVideo(uid: number, videoId: string) {
  return await database.prepare(`
    SELECT v.video_id, v.channel_id, v.title, v.description, v.thumbnail,
           v.published_at, v.live_status, COALESCE(uv.status, 'inbox') AS status, uv.bucket, uv.show_from,
           v.is_short, v.is_private, v.views, v.likes, uv.liked, uv.watched,
           v.duration, uv.watch_position, uv.watch_duration, v.external,
           EXISTS(SELECT 1 FROM history h WHERE h.video_id = v.video_id AND h.user_id = ?) AS in_history,
           COALESCE(c.custom_title, c.title) AS channel_title, c.thumbnail AS channel_thumbnail, c.subscriber_count AS channel_subscriber_count
    FROM videos v JOIN channels c ON c.channel_id = v.channel_id
    LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ?
    WHERE v.video_id = ?
  `).get(uid, uid, videoId) as any | null;
}

export async function discoveryRecommendations(uid: number) {
  if (!pluginEnabled("discovery")) return { recommendations: [], enabled: false };
  const settings = await discoverySettings(uid);
  let recommendations = await readStoredDiscoveryRecommendations(uid, settings.total_limit);
  if (recommendations.length === 0) {
    await runDiscoveryRefresh(uid);
    recommendations = await readStoredDiscoveryRecommendations(uid, settings.total_limit);
  } else if (await storedDiscoveryAgeMs(uid) > DISCOVERY_REFRESH_INTERVAL_MS) {
    refreshDiscoveryInBackground(uid);
  }
  return { recommendations, enabled: true };
}

export async function refreshDiscoveryNow(uid: number) {
  if (!pluginEnabled("discovery")) return { recommendations: [], enabled: false };
  const timer = discoveryRefreshTimers.get(uid);
  if (timer) {
    clearTimeout(timer);
    discoveryRefreshTimers.delete(uid);
  }
  await runDiscoveryRefresh(uid);
  const settings = await discoverySettings(uid);
  return { recommendations: await readStoredDiscoveryRecommendations(uid, settings.total_limit), enabled: true };
}

export function refreshDiscoveryInBackground(uid: number) {
  if (!pluginEnabled("discovery") || discoveryRefreshInFlight.has(uid) || discoveryRefreshTimers.has(uid)) return;
  void storedDiscoveryAgeMs(uid).then((ageMs) => {
    if (discoveryRefreshInFlight.has(uid) || discoveryRefreshTimers.has(uid)) return;
    const delay = Math.max(0, DISCOVERY_REFRESH_INTERVAL_MS - ageMs);
    const timer = setTimeout(() => {
      discoveryRefreshTimers.delete(uid);
      runDiscoveryRefresh(uid).catch((error) => {
        log.warn("discovery.background_refresh_failed", { userId: uid, error: error instanceof Error ? error.message : String(error) });
      });
    }, delay);
    discoveryRefreshTimers.set(uid, timer);
  }).catch((error) => {
    log.warn("discovery.background_schedule_failed", { userId: uid, error: error instanceof Error ? error.message : String(error) });
  });
}

async function runDiscoveryRefresh(uid: number) {
  if (maintenanceActive()) return;
  const current = discoveryRefreshInFlight.get(uid);
  if (current) return current;
  const promise = rebuildDiscoveryRecommendations(uid).finally(() => discoveryRefreshInFlight.delete(uid));
  discoveryRefreshInFlight.set(uid, promise);
  return promise;
}

async function rebuildDiscoveryRecommendations(uid: number) {
  if (!pluginEnabled("discovery")) return;
  const startedAt = Date.now();
  const settings = await discoverySettings(uid);
  const totalLimit = settings.total_limit;
  const local = await localRecommendations(uid, Math.max(24, totalLimit), settings);
  const importedExternal = await externalRecommendations(uid, Math.max(settings.early_external_count, 8), settings);
  const recommendations = mixRecommendations([...local, ...importedExternal], totalLimit, settings);
  await persistDiscoveryRecommendations(uid, recommendations);
  log.info("discovery.refresh_complete", {
    userId: uid,
    localCandidates: local.length,
    externalCandidates: importedExternal.length,
    recommendations: recommendations.length,
    ms: Date.now() - startedAt,
  });
}

async function persistDiscoveryRecommendations(uid: number, recommendations: DiscoveryRecommendation[]) {
  const tx = database.transaction(async () => {
    await database.prepare("DELETE FROM discovery_recommendations WHERE user_id = ?").run(uid);
    const insert = database.prepare(`
      INSERT INTO discovery_recommendations (user_id, video_id, score, reasons_json, query, rank, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    for (const [index, recommendation] of recommendations.entries()) {
      const videoId = recommendation.video?.video_id;
      if (!videoId) continue;
      await insert.run(
        uid,
        videoId,
        recommendation.score,
        JSON.stringify(recommendation.reasons),
        recommendation.query ?? null,
        index,
      );
    }
    await setDiscoveryGeneratedAt(uid);
  });
  await tx();
}

async function invalidateDiscoveryRecommendations(uid: number) {
  const timer = discoveryRefreshTimers.get(uid);
  if (timer) {
    clearTimeout(timer);
    discoveryRefreshTimers.delete(uid);
  }
  await database.prepare("DELETE FROM discovery_recommendations WHERE user_id = ?").run(uid);
  await database.prepare("DELETE FROM plugin_state WHERE plugin_id = 'discovery' AND user_id = ? AND key = 'last_generated_at'").run(uid);
}

async function setDiscoveryGeneratedAt(uid: number) {
  await database.prepare(`
    INSERT INTO plugin_state (plugin_id, user_id, key, value, updated_at)
    VALUES ('discovery', ?, 'last_generated_at', datetime('now'), datetime('now'))
    ON CONFLICT(plugin_id, user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(uid);
}

async function readStoredDiscoveryRecommendations(uid: number, limit: number): Promise<DiscoveryRecommendation[]> {
  const rows = await database.prepare(`
    SELECT dr.video_id, dr.score, dr.reasons_json, dr.query
    FROM discovery_recommendations dr
    JOIN videos v ON v.video_id = dr.video_id
    JOIN channels c ON c.channel_id = v.channel_id
    LEFT JOIN user_videos uv ON uv.user_id = dr.user_id AND uv.video_id = dr.video_id
    WHERE dr.user_id = ?
      AND v.is_short = 0
      AND v.live_status = 'none'
      AND COALESCE(v.is_private, 0) = 0
      AND v.published_at IS NOT NULL AND v.published_at != ''
      AND TRIM(v.title) != '' AND TRIM(v.thumbnail) != ''
      AND TRIM(COALESCE(c.custom_title, c.title)) != ''
      AND COALESCE(uv.status, 'inbox') != 'archived'
      AND COALESCE(uv.watched, 0) != 1
      AND (uv.watch_position IS NULL OR uv.watch_duration IS NULL OR uv.watch_duration <= 30
        OR uv.watch_position < 3 OR CAST(uv.watch_position AS REAL) / uv.watch_duration < 0.92)
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_feedback rf
        WHERE rf.user_id = dr.user_id
          AND rf.video_id = dr.video_id
          AND rf.action = 'dismiss'
      )
    ORDER BY dr.rank ASC
    LIMIT ?
  `).all(uid, limit) as { video_id: string; score: number; reasons_json: string; query: string | null }[];
  const out: DiscoveryRecommendation[] = [];
  for (const row of rows) {
    const video = await selectVideo(uid, row.video_id);
    if (!video || !isEligibleRecommendation(video)) continue;
    out.push({
      kind: "local",
      score: Number(row.score),
      reasons: parseReasons(row.reasons_json),
      query: row.query ?? undefined,
      video,
    });
  }
  return out;
}

function parseReasons(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((reason) => typeof reason === "string") : [];
  } catch {
    return [];
  }
}

async function storedDiscoveryAgeMs(uid: number) {
  const state = await database.prepare("SELECT value AS generated_at FROM plugin_state WHERE plugin_id = 'discovery' AND user_id = ? AND key = 'last_generated_at'")
    .get(uid) as { generated_at: string | null } | null;
  const row = state?.generated_at
    ? state
    : await database.prepare("SELECT MAX(generated_at) AS generated_at FROM discovery_recommendations WHERE user_id = ?")
      .get(uid) as { generated_at: string | null } | null;
  if (!row?.generated_at) return DISCOVERY_REFRESH_INTERVAL_MS;
  const ts = storedUtcTimestampMs(row.generated_at);
  if (!Number.isFinite(ts)) return DISCOVERY_REFRESH_INTERVAL_MS;
  return Math.max(0, Date.now() - ts);
}

export interface RecommendationSummary {
  top_channels: { channel_id: string; title: string; count: number; seconds: number }[];
  top_tags: { id: number; name: string; color: string; count: number; seconds: number }[];
  time_of_day: RecommendationTimeOfDay | null;
  current_hour: number | null;
  watch_count: number;
  partial_count: number;
  based_on: ("watch_history" | "channels" | "tags" | "time_of_day" | "likes" | "unfinished")[];
}

async function recommendationSummary(uid: number): Promise<RecommendationSummary> {
  const local = zonedDayHour();
  const nearbyHours = recommendationHoursNear(local.hour);
  const nearbyHourPlaceholders = nearbyHours.map(() => "?").join(",");
  const stats = await database.prepare(`
    SELECT
      (SELECT COUNT(DISTINCT video_id) FROM history WHERE user_id = ?) AS watch_count,
      (SELECT COUNT(*)
       FROM user_videos partial_uv
       JOIN videos partial_v ON partial_v.video_id = partial_uv.video_id
       WHERE partial_uv.user_id = ? AND COALESCE(partial_uv.watched, 0) != 1
         AND COALESCE(partial_uv.status, 'inbox') != 'archived'
         AND partial_v.is_short = 0 AND partial_v.live_status = 'none'
         AND COALESCE(partial_v.is_private, 0) = 0
         AND partial_uv.watch_position IS NOT NULL AND partial_uv.watch_duration IS NOT NULL
         AND partial_uv.watch_duration > 30 AND partial_uv.watch_position >= 3
         AND CAST(partial_uv.watch_position AS REAL) / partial_uv.watch_duration < 0.92) AS partial_count,
      (SELECT COUNT(*) FROM user_videos WHERE user_id = ? AND liked = 1) AS liked_count
  `).get(uid, uid, uid) as { watch_count: number; partial_count: number; liked_count: number };

  const channelRows = await database.prepare(`
    WITH channel_signals AS (
      SELECT v.channel_id, COUNT(DISTINCT h.video_id) AS watch_count, 0.0 AS seconds
      FROM history h JOIN videos v ON v.video_id = h.video_id
      WHERE h.user_id = ?
      GROUP BY v.channel_id
      UNION ALL
      SELECT v.channel_id, 0 AS watch_count, SUM(w.seconds) AS seconds
      FROM watch_time_log w JOIN videos v ON v.video_id = w.video_id
      WHERE w.user_id = ? AND w.hour IN (${nearbyHourPlaceholders})
      GROUP BY v.channel_id
    )
    SELECT cs.channel_id, COALESCE(c.custom_title, c.title) AS title,
           SUM(cs.watch_count) AS watch_count, SUM(cs.seconds) AS seconds
    FROM channel_signals cs JOIN channels c ON c.channel_id = cs.channel_id
    GROUP BY cs.channel_id, COALESCE(c.custom_title, c.title)
    ORDER BY SUM(cs.seconds) DESC, SUM(cs.watch_count) DESC, cs.channel_id ASC
    LIMIT 3
  `).all(uid, uid, ...nearbyHours) as { channel_id: string; title: string; watch_count: number; seconds: number }[];
  const topChannels = channelRows.map((row) => ({
    channel_id: row.channel_id,
    title: row.title,
    count: Number(row.watch_count) || 0,
    seconds: Math.round(Number(row.seconds) || 0),
  }));

  const tagRows = await database.prepare(`${effectiveVideoTagsCte},
    tag_signals AS (
      SELECT evt.tag_id AS id, evt.name, evt.color,
             COUNT(DISTINCT h.video_id) AS watch_count, 0.0 AS seconds
      FROM effective_video_tags evt
      JOIN history h ON h.video_id = evt.video_id AND h.user_id = ?
      WHERE evt.user_id = ?
      GROUP BY evt.tag_id, evt.name, evt.color
      UNION ALL
      SELECT wt.tag_id AS id, t.name, t.color, 0 AS watch_count, SUM(wt.seconds) AS seconds
      FROM watch_tag_time_log wt
      JOIN tags t ON t.id = wt.tag_id AND t.user_id = wt.user_id
      WHERE wt.user_id = ? AND wt.hour IN (${nearbyHourPlaceholders})
      GROUP BY wt.tag_id, t.name, t.color
    )
    SELECT id, name, color, SUM(watch_count) AS watch_count, SUM(seconds) AS seconds
    FROM tag_signals
    GROUP BY id, name, color
    ORDER BY SUM(seconds) DESC, SUM(watch_count) DESC, id ASC
    LIMIT 3
  `).all(uid, uid, uid, ...nearbyHours) as { id: number; name: string; color: string; watch_count: number; seconds: number }[];
  const topTags = tagRows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    color: row.color,
    count: Number(row.watch_count) || 0,
    seconds: Math.round(Number(row.seconds) || 0),
  }));

  const current = recommendationTimeOfDay(local.hour);
  const clock = await database.prepare(`
    SELECT COALESCE(SUM(seconds), 0) AS seconds
    FROM watch_time_log
    WHERE user_id = ? AND hour IN (${nearbyHourPlaceholders})
  `).get(uid, ...nearbyHours) as { seconds: number };

  const watchCount = Number(stats.watch_count) || 0;
  const partialCount = Number(stats.partial_count) || 0;
  const likedCount = Number(stats.liked_count) || 0;
  const hasCurrentTimeSignal = (Number(clock.seconds) || 0) > 0;
  const basedOn: RecommendationSummary["based_on"] = [];
  if (watchCount > 0) basedOn.push("watch_history");
  if (topChannels.length > 0) basedOn.push("channels");
  if (topTags.length > 0) basedOn.push("tags");
  if (hasCurrentTimeSignal) basedOn.push("time_of_day");
  if (likedCount > 0) basedOn.push("likes");
  if (partialCount > 0) basedOn.push("unfinished");

  return {
    top_channels: topChannels,
    top_tags: topTags,
    time_of_day: hasCurrentTimeSignal ? current : null,
    current_hour: hasCurrentTimeSignal ? local.hour : null,
    watch_count: watchCount,
    partial_count: partialCount,
    based_on: basedOn,
  };
}

export interface RecommendationFeedOptions {
  page?: number;
  limit?: number;
  refresh?: boolean;
  allowExternal?: boolean;
  downloadsOnly?: boolean;
}

/** Core recommendations are always available. Enabling Discovery only extends
 * this same ranked pool with profile-owned external search results. */
export async function recommendationFeed(uid: number, options: RecommendationFeedOptions = {}) {
  const page = Math.max(0, Math.floor(options.page ?? 0));
  const limit = Math.min(60, Math.max(1, Math.floor(options.limit ?? 40)));
  const settings = await discoverySettings(uid);
  const externalEnabled = pluginEnabled("discovery")
    && options.allowExternal !== false
    && options.downloadsOnly !== true;
  let extended: DiscoveryRecommendation[] = [];
  if (externalEnabled) {
    extended = (options.refresh
      ? await refreshDiscoveryNow(uid)
      : await discoveryRecommendations(uid)).recommendations;
  }

  // Rank and diversify the complete bounded pool before slicing pages. This
  // keeps page boundaries deterministic and lets lower-ranked channels fill
  // slots left by the per-channel cap.
  const local = await localRecommendations(uid, 300, settings, {
    allowExternal: externalEnabled,
    downloadsOnly: options.downloadsOnly,
  });
  const ranked = mixRecommendations([...extended, ...local], 300, settings);
  const offset = page * limit;
  const recommendations = ranked.slice(offset, offset + limit);
  return {
    enabled: true,
    external_enabled: externalEnabled,
    recommendations,
    page,
    limit,
    has_more: ranked.length > offset + limit,
    summary: await recommendationSummary(uid),
  };
}

function mixRecommendations(recommendations: DiscoveryRecommendation[], limit: number, settings: Record<string, number>) {
  return diversifyRecommendations(
    recommendations,
    Math.max(0, Math.floor(limit)),
    Math.max(1, Math.floor(settings.per_channel_limit ?? 5)),
  );
}

export async function dismissDiscoveryRecommendation(uid: number, videoId: string) {
  await database.prepare(
    "INSERT INTO recommendation_feedback (user_id, video_id, action, created_at) VALUES (?, ?, 'dismiss', datetime('now')) ON CONFLICT(user_id, video_id) DO UPDATE SET action = 'dismiss', created_at = excluded.created_at"
  ).run(uid, videoId);
  await database.prepare("DELETE FROM discovery_recommendations WHERE user_id = ? AND video_id = ?").run(uid, videoId);
  refreshDiscoveryInBackground(uid);
}
