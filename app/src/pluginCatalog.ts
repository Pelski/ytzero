import { DL_DEFAULTS } from "./downloader";
import { SUBTITLE_LANGUAGES } from "./subtitleLanguages";

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

export type PluginLanguage = "en" | "pl" | "de";
export type LocalizedText = Record<PluginLanguage, string>;

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
  scope?: "user" | "global";
  adminOnly?: boolean;
}

export type PluginSettingValue = number | string;

export interface PluginTermState {
  lastTerms: string[];
  blockedTerms: string[];
}

export type PluginSettingSource = Omit<PluginSettingDef, "label" | "description" | "type" | "options"> & {
  label: LocalizedText;
  description: LocalizedText;
  type?: PluginSettingType;
  options?: { value: string; label: LocalizedText }[];
};

export const SOCIAL_SETTINGS: PluginSettingSource[] = [
  {
    key: "comments_enabled",
    type: "toggle",
    scope: "global",
    adminOnly: true,
    label: { en: "Comments", pl: "Komentarze", de: "Kommentare" },
    description: { en: "Profiles can discuss videos shared in Social.", pl: "Profile mogą rozmawiać o filmach udostępnionych w Social.", de: "Profile können in Social geteilte Videos kommentieren." },
    defaultValue: 1,
  },
  {
    key: "reactions_enabled",
    type: "toggle",
    scope: "global",
    adminOnly: true,
    label: { en: "Emoji reactions", pl: "Reakcje emoji", de: "Emoji-Reaktionen" },
    description: { en: "Each profile can select several different reactions on one post.", pl: "Każdy profil może wybrać kilka różnych reakcji na jeden post.", de: "Jedes Profil kann mehrere verschiedene Reaktionen auf einen Beitrag auswählen." },
    defaultValue: 1,
  },
  {
    key: "allow_child_profiles",
    type: "toggle",
    scope: "global",
    adminOnly: true,
    label: { en: "Child profiles", pl: "Profile dziecięce", de: "Kinderprofile" },
    description: { en: "Allow child profiles to open Social, publish, react and comment.", pl: "Pozwól profilom dziecięcym otwierać Social, publikować, reagować i komentować.", de: "Erlaube Kinderprofilen Social zu öffnen, zu posten, zu reagieren und zu kommentieren." },
    defaultValue: 0,
  },
  {
    key: "notify_new_posts",
    type: "toggle",
    scope: "user",
    label: { en: "New posts", pl: "Nowe posty", de: "Neue Beiträge" },
    description: { en: "Notify me when another profile shares a video.", pl: "Powiadamiaj, gdy inny profil udostępni film.", de: "Benachrichtige mich, wenn ein anderes Profil ein Video teilt." },
    defaultValue: 1,
  },
  {
    key: "notify_comments",
    type: "toggle",
    scope: "user",
    label: { en: "Comments on my posts", pl: "Komentarze do moich postów", de: "Kommentare zu meinen Beiträgen" },
    description: { en: "Notify me about new comments on videos I shared.", pl: "Powiadamiaj o nowych komentarzach pod udostępnionymi przeze mnie filmami.", de: "Benachrichtige mich über neue Kommentare zu meinen geteilten Videos." },
    defaultValue: 1,
  },
  {
    key: "notify_reactions",
    type: "toggle",
    scope: "user",
    label: { en: "Reactions and comment likes", pl: "Reakcje i polubienia komentarzy", de: "Reaktionen und Kommentar-Likes" },
    description: { en: "Notify me about the first reaction from a profile and likes on my comments.", pl: "Powiadamiaj o pierwszej reakcji profilu i polubieniach moich komentarzy.", de: "Benachrichtige mich über die erste Reaktion eines Profils und Likes auf meine Kommentare." },
    defaultValue: 0,
  },
  {
    key: "notify_mentions",
    type: "toggle",
    scope: "user",
    label: { en: "@mentions", pl: "Oznaczenia @profil", de: "@Erwähnungen" },
    description: { en: "Notify me when another profile mentions me in a post or comment.", pl: "Powiadamiaj, gdy inny profil oznaczy mnie w poście lub komentarzu.", de: "Benachrichtige mich, wenn ein anderes Profil mich in einem Beitrag oder Kommentar erwähnt." },
    defaultValue: 1,
  },
];

export const DISCOVERY_SETTINGS: PluginSettingSource[] = [
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
  { key: "recency_points", label: { en: "Freshness", pl: "Świeżość", de: "Aktualität" }, description: { en: "Raises newer videos so the list does not feel stale.", pl: "Podbija nowsze filmy, żeby lista nie była zbyt stara.", de: "Hebt neuere Videos an, damit die Liste aktuell bleibt." }, min: 0, max: 60, step: 1, defaultValue: 18 },
  { key: "random_pick_count", label: { en: "Variety near the top", pl: "Różnorodność na początku", de: "Abwechslung am Anfang" }, description: { en: "Mixes in a few strong suggestions so the list changes between reloads.", pl: "Miesza kilka mocnych propozycji, żeby lista zmieniała się po przeładowaniu.", de: "Mischt starke Vorschläge ein, damit die Liste beim Neuladen variiert." }, min: 0, max: 10, step: 1, defaultValue: 3 },
  { key: "high_pick_count", label: { en: "Top matches after variety", pl: "Najlepsze po miksie", de: "Beste Treffer nach dem Mix" }, description: { en: "How many strongest matches should follow the first mixed items.", pl: "Ile najmocniejszych dopasowań ma iść po pierwszych wymieszanych pozycjach.", de: "Wie viele stärkste Treffer nach den gemischten Einträgen folgen." }, min: 0, max: 20, step: 1, defaultValue: 6 },
];

export const DOWNLOADS_SETTINGS: PluginSettingSource[] = [
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
    description: { en: "Allow automatic downloads of Shorts, including videos in Watch later. Manual downloads are unaffected.", pl: "Zezwalaj na automatyczne pobieranie Shorts, także filmów z „Do obejrzenia”. Ręczne pobieranie pozostaje bez zmian.", de: "Automatische Downloads von Shorts erlauben, auch aus Später ansehen. Manuelle Downloads bleiben unverändert." },
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

// These values affect the one physical download store shared by all profiles.
// They remain instance-wide and may only be changed by an administrator; the
// remaining download preferences are stored per profile.
export const DOWNLOADS_ADMIN_SETTING_KEYS = new Set([
  "output_template",
  "write_thumbnail",
  "embed_metadata",
  "write_info_json",
  "write_nfo",
  "write_subs",
  "max_storage_gb",
]);

export const PLUGINS: PluginManifest[] = [
  {
    id: "discovery",
    name: "Recommendations",
    version: "0.1.0",
    description: "Ranks eligible videos already stored in your local library.",
    route: "/recommendations",
    icon: "Sparkles",
    permissions: ["read:library", "read:history"],
  },
  {
    id: "downloads",
    name: "YT-DLP Integration",
    version: "0.1.0",
    description: "Downloads videos with yt-dlp for smooth local playback, with retention and storage limits.",
    route: "/downloads",
    icon: "Download",
    permissions: ["read:library", "network:video-download", "storage:local-files"],
    settingsScope: "user",
  },
  {
    id: "social",
    name: "Social",
    version: "0.1.0",
    description: "A local social space where profiles share videos, react and comment together.",
    route: "/social",
    icon: "UsersRound",
    permissions: ["read:profiles", "read:library", "write:social"],
    settingsScope: "user",
  },
];

export const PLUGIN_TEXT: Record<string, { name: LocalizedText; description: LocalizedText; permissions: Record<string, LocalizedText> }> = {
  discovery: {
    name: { en: "Recommendations", pl: "Rekomendacje", de: "Empfehlungen" },
    description: {
      en: "Ranks eligible videos already stored in your local library.",
      pl: "Porządkuje pasujące filmy, które są już zapisane w lokalnej bibliotece.",
      de: "Sortiert passende Videos, die bereits in deiner lokalen Bibliothek gespeichert sind.",
    },
    permissions: {
      "read:library": { en: "reads your local library", pl: "czyta lokalną bibliotekę", de: "liest deine lokale Bibliothek" },
      "read:history": { en: "uses your watch history", pl: "używa historii oglądania", de: "nutzt deinen Verlauf" },
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
  social: {
    name: { en: "Social", pl: "Social", de: "Social" },
    description: {
      en: "A local space where profiles share videos, use emoji reactions, mention each other and comment together.",
      pl: "Lokalne miejsce, w którym profile udostępniają filmy, reagują emoji, oznaczają się i wspólnie komentują.",
      de: "Ein lokaler Bereich, in dem Profile Videos teilen, mit Emojis reagieren, sich erwähnen und gemeinsam kommentieren.",
    },
    permissions: {
      "read:profiles": { en: "shows participating profile names and avatars", pl: "pokazuje nazwy i avatary uczestniczących profili", de: "zeigt Namen und Avatare teilnehmender Profile" },
      "read:library": { en: "reads videos from the local library", pl: "czyta filmy z lokalnej biblioteki", de: "liest Videos aus der lokalen Bibliothek" },
      "write:social": { en: "stores posts, reactions, mentions and comments locally", pl: "zapisuje lokalnie posty, reakcje, oznaczenia i komentarze", de: "speichert Beiträge, Reaktionen, Erwähnungen und Kommentare lokal" },
    },
  },
};


