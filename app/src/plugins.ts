import { db, getSetting, setSetting } from "./db";
import { fetchChannelAbout, fetchVideoInfo, searchYouTube, type SearchResult, type VideoInfo } from "./youtube";
import { buildKeywordPlan, tokenizeDiscoveryText, type KeywordSeed } from "./discoveryKeywords";
import { DL_DEFAULTS, resetDownloadsState } from "./downloader";

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

export type PluginSettingType = "slider" | "select" | "toggle";

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
  { key: "total_limit", label: { en: "Number of suggestions", pl: "Liczba propozycji", de: "Anzahl der Vorschläge" }, description: { en: "How many videos Discovery should show at once.", pl: "Ile filmów Odkrywanie ma pokazać naraz.", de: "Wie viele Videos Odkrywanie auf einmal anzeigen soll." }, min: 8, max: 80, step: 1, defaultValue: 32 },
  { key: "per_channel_limit", label: { en: "Videos from one channel", pl: "Filmy z jednego kanału", de: "Videos von einem Kanal" }, description: { en: "Prevents one channel from taking over the whole list.", pl: "Pilnuje, żeby jeden kanał nie zajął całej listy.", de: "Verhindert, dass ein Kanal die ganze Liste dominiert." }, min: 1, max: 20, step: 1, defaultValue: 5 },
  { key: "shared_tag_points", label: { en: "Shared tags", pl: "Wspólne tagi", de: "Gemeinsame Tags" }, description: { en: "Raises videos that match tags you already watch or like.", pl: "Podbija filmy z tagami, które już oglądasz albo lubisz.", de: "Hebt Videos mit Tags an, die du bereits ansiehst oder magst." }, min: 0, max: 80, step: 1, defaultValue: 25 },
  { key: "tag_history_points", label: { en: "Watched tags", pl: "Oglądane tagi", de: "Angesehene Tags" }, description: { en: "Adds weight for tags that appear often in your watch history.", pl: "Dodaje wagę tagom, które często pojawiają się w Twojej historii.", de: "Gewichtet Tags höher, die oft in deinem Verlauf vorkommen." }, min: 0, max: 20, step: 1, defaultValue: 3 },
  { key: "tag_history_cap", label: { en: "Watched tag limit", pl: "Limit oglądanych tagów", de: "Limit für angesehene Tags" }, description: { en: "Caps how much watched tags can influence one video.", pl: "Ogranicza, jak mocno oglądane tagi mogą podbić jeden film.", de: "Begrenzt, wie stark angesehene Tags ein Video anheben können." }, min: 0, max: 120, step: 1, defaultValue: 36 },
  { key: "watched_channel_points", label: { en: "Known channels", pl: "Znane kanały", de: "Bekannte Kanäle" }, description: { en: "Raises videos from channels you watch frequently.", pl: "Podbija filmy z kanałów, które często oglądasz.", de: "Hebt Videos von Kanälen an, die du häufig ansiehst." }, min: 0, max: 30, step: 1, defaultValue: 8 },
  { key: "watched_channel_cap", label: { en: "Known channel limit", pl: "Limit znanych kanałów", de: "Limit für bekannte Kanäle" }, description: { en: "Caps how much channel history can influence one video.", pl: "Ogranicza wpływ historii kanału na jeden film.", de: "Begrenzt den Einfluss der Kanalhistorie auf ein Video." }, min: 0, max: 120, step: 1, defaultValue: 40 },
  { key: "playlist_points", label: { en: "Your playlists", pl: "Twoje playlisty", de: "Deine Playlists" }, description: { en: "Raises videos that are already saved in your playlists.", pl: "Podbija filmy zapisane już na Twoich playlistach.", de: "Hebt Videos an, die bereits in deinen Playlists liegen." }, min: 0, max: 80, step: 1, defaultValue: 20 },
  { key: "liked_points", label: { en: "Liked videos", pl: "Polubione filmy", de: "Favorisierte Videos" }, description: { en: "Raises videos you marked as liked.", pl: "Podbija filmy oznaczone jako polubione.", de: "Hebt Videos an, die du favorisiert hast." }, min: 0, max: 100, step: 1, defaultValue: 35 },
  { key: "already_watched_points", label: { en: "Watched videos", pl: "Obejrzane filmy", de: "Angesehene Videos" }, description: { en: "Lets watched videos stay useful as a positive signal.", pl: "Pozwala traktować obejrzane filmy jako pozytywny sygnał.", de: "Nutzt angesehene Videos weiterhin als positives Signal." }, min: 0, max: 50, step: 1, defaultValue: 10 },
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
];

export const PLUGINS: PluginManifest[] = [
  {
    id: "discovery",
    name: "Discovery",
    version: "0.1.0",
    description: "Finds videos that fit your habits, tags, playlists and recent watch history.",
    route: "/discovery",
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
    name: { en: "Discovery", pl: "Odkrywanie", de: "Entdecken" },
    description: {
      en: "Finds videos that fit your habits, tags, playlists and recent watch history.",
      pl: "Dobiera filmy pasujące do Twoich nawyków, tagów, playlist i ostatniej historii oglądania.",
      de: "Findet Videos, die zu deinen Gewohnheiten, Tags, Playlists und deinem aktuellen Verlauf passen.",
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
  db.prepare("INSERT OR IGNORE INTO plugins (id, enabled, version) VALUES (?, ?, ?)")
    .run(plugin.id, 0, plugin.version);
  db.prepare("UPDATE plugins SET version = ? WHERE id = ?").run(plugin.version, plugin.id);
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

export function listPlugins(language?: string | null) {
  const states = db.prepare("SELECT id, enabled, version FROM plugins").all() as { id: string; enabled: number; version: string }[];
  const byId = new Map(states.map((s) => [s.id, s]));
  return PLUGINS.map((manifest) => {
    const state = byId.get(manifest.id);
    return { ...localizePlugin(manifest, language), enabled: state?.enabled !== 0 };
  });
}

export function pluginEnabled(id: string) {
  const row = db.prepare("SELECT enabled FROM plugins WHERE id = ?").get(id) as { enabled: number } | null;
  return row?.enabled !== 0;
}

export function setPluginEnabled(id: string, enabled: boolean) {
  const manifest = PLUGINS.find((p) => p.id === id);
  if (!manifest) throw new Error("plugin not found");
  db.prepare(
    "INSERT INTO plugins (id, enabled, version, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, version = excluded.version, updated_at = excluded.updated_at"
  ).run(id, enabled ? 1 : 0, manifest.version);
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
  const n = Number(raw);
  const value = raw != null && Number.isFinite(n) ? n : Number(def.defaultValue);
  if (type === "toggle") return value === 1 ? 1 : 0;
  return clampSetting(value, def);
}

export function getPluginSettings(uid: number, pluginId: string, language?: string | null) {
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
    const rows = db.prepare("SELECT key, value FROM plugin_settings WHERE plugin_id = ? AND user_id = ?")
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
    terms: pluginId === "discovery" ? discoveryTermState(uid) : undefined,
  };
}

export function setPluginSettings(uid: number, pluginId: string, patch: Record<string, unknown>, language?: string | null) {
  const manifest = PLUGINS.find((p) => p.id === pluginId);
  if (!manifest) throw new Error("plugin not found");
  const defs = settingDefs(pluginId);
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      const def = byKey.get(key);
      if (!def) continue;
      const normalized = normalizeSettingValue(value == null ? null : String(value), def);
      if (manifest.settingsScope === "global") {
        setSetting(`plugin_${pluginId}_${key}`, String(normalized));
      } else {
        db.prepare(
          "INSERT INTO plugin_settings (plugin_id, user_id, key, value) VALUES (?, ?, ?, ?) ON CONFLICT(plugin_id, user_id, key) DO UPDATE SET value = excluded.value"
        ).run(pluginId, uid, key, String(normalized));
      }
    }
  });
  tx();
  if (pluginId === "discovery" && "blockedTerms" in patch) {
    setDiscoveryBlockedTerms(uid, patch.blockedTerms);
  }
  if (pluginId === "discovery") {
    invalidateDiscoveryRecommendations(uid);
    refreshDiscoveryInBackground(uid);
  }
  return getPluginSettings(uid, pluginId, language);
}

export async function resetPluginState(uid: number, pluginId: string, language?: string | null) {
  if (!PLUGINS.some((plugin) => plugin.id === pluginId)) throw new Error("plugin not found");
  if (pluginId === "downloads") {
    resetDownloadsState();
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

  const tx = db.transaction(() => {
    if (pluginId === "discovery") {
      // Remove only temporary videos introduced by this profile's recommendations.
      // Anything watched, queued, liked or saved by any profile remains intact.
      db.prepare(`
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
      db.prepare("DELETE FROM discovery_recommendations WHERE user_id = ?").run(uid);
      db.prepare("DELETE FROM recommendation_feedback WHERE user_id = ?").run(uid);
      db.prepare("DELETE FROM channels WHERE external = 1 AND channel_id NOT IN (SELECT DISTINCT channel_id FROM videos)").run();
    }
    db.prepare("DELETE FROM plugin_settings WHERE plugin_id = ? AND user_id = ?").run(pluginId, uid);
    db.prepare("DELETE FROM plugin_state WHERE plugin_id = ? AND user_id = ?").run(pluginId, uid);
  });
  tx();
  return getPluginSettings(uid, pluginId, language);
}

function discoverySettings(uid: number) {
  // Discovery definitions are all sliders, so the values are numbers.
  return getPluginSettings(uid, "discovery").settings as Record<string, number>;
}

function discoveryTermState(uid: number): PluginTermState {
  return {
    lastTerms: readDiscoveryTerms(uid, "last_terms"),
    blockedTerms: readDiscoveryTerms(uid, "blocked_terms"),
  };
}

function readDiscoveryTerms(uid: number, key: "last_terms" | "blocked_terms") {
  const row = db.prepare("SELECT value FROM plugin_state WHERE plugin_id = 'discovery' AND user_id = ? AND key = ?")
    .get(uid, key) as { value: string } | null;
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.filter((term) => typeof term === "string") : [];
  } catch {
    return [];
  }
}

function writeDiscoveryTerms(uid: number, key: "last_terms" | "blocked_terms", terms: string[]) {
  db.prepare(`
    INSERT INTO plugin_state (plugin_id, user_id, key, value, updated_at)
    VALUES ('discovery', ?, ?, ?, datetime('now'))
    ON CONFLICT(plugin_id, user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(uid, key, JSON.stringify(terms));
}

function setDiscoveryBlockedTerms(uid: number, value: unknown) {
  const raw = Array.isArray(value) ? value : [];
  const normalized = Array.from(new Set(raw.flatMap((term) => typeof term === "string" ? tokenizeDiscoveryText(term) : []))).sort();
  writeDiscoveryTerms(uid, "blocked_terms", normalized);
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

function localRecommendations(uid: number, limit: number, settings: Record<string, number>): DiscoveryRecommendation[] {
  const rows = db.prepare(`
    SELECT v.video_id, v.channel_id, v.title, v.description, v.thumbnail, v.published_at,
           v.live_status, COALESCE(uv.status, 'inbox') AS status, uv.bucket, uv.show_from,
           v.is_short, v.views, v.likes, uv.liked, v.duration, uv.watch_position,
           uv.watch_duration, v.external,
           EXISTS(SELECT 1 FROM history h WHERE h.video_id = v.video_id AND h.user_id = ?) AS in_history,
           c.title AS channel_title, c.thumbnail AS channel_thumbnail, c.subscriber_count AS channel_subscriber_count,
           COALESCE(chw.watch_count, 0) AS channel_watch_count,
           COALESCE(taghit.tag_hits, 0) AS tag_hits,
           COALESCE(tagwatch.tag_watch_count, 0) AS tag_watch_count,
           COALESCE(plhit.playlist_hits, 0) AS playlist_hits
    FROM videos v
    JOIN channels c ON c.channel_id = v.channel_id
    LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ?
    LEFT JOIN (
      SELECT v2.channel_id, count(*) AS watch_count
      FROM history h JOIN videos v2 ON v2.video_id = h.video_id
      WHERE h.user_id = ?
      GROUP BY v2.channel_id
    ) chw ON chw.channel_id = v.channel_id
    LEFT JOIN (
      SELECT candidate.video_id, count(DISTINCT candidate.tag_id) AS tag_hits
      FROM (
        SELECT vt.video_id, vt.tag_id FROM video_tags vt
        UNION
        SELECT v3.video_id, ct.tag_id FROM videos v3 JOIN channel_tags ct ON ct.channel_id = v3.channel_id
      ) candidate
      JOIN (
        SELECT DISTINCT source.tag_id
        FROM (
          SELECT vt2.video_id, vt2.tag_id FROM video_tags vt2
          UNION
          SELECT v4.video_id, ct2.tag_id FROM videos v4 JOIN channel_tags ct2 ON ct2.channel_id = v4.channel_id
        ) source
        JOIN tags t ON t.id = source.tag_id AND t.user_id = ?
        LEFT JOIN user_videos suv ON suv.video_id = source.video_id AND suv.user_id = ?
        WHERE suv.liked = 1 OR EXISTS (SELECT 1 FROM history h2 WHERE h2.video_id = source.video_id AND h2.user_id = ?)
      ) liked_tags ON liked_tags.tag_id = candidate.tag_id
      GROUP BY candidate.video_id
    ) taghit ON taghit.video_id = v.video_id
    LEFT JOIN (
      SELECT upv.video_id, count(*) AS playlist_hits
      FROM user_playlist_videos upv JOIN user_playlists up ON up.id = upv.playlist_id
      WHERE up.user_id = ?
      GROUP BY upv.video_id
    ) plhit ON plhit.video_id = v.video_id
    LEFT JOIN (
      SELECT candidate.video_id, sum(watched_tags.watch_count) AS tag_watch_count
      FROM (
        SELECT vt.video_id, vt.tag_id FROM video_tags vt
        UNION
        SELECT v5.video_id, ct.tag_id FROM videos v5 JOIN channel_tags ct ON ct.channel_id = v5.channel_id
      ) candidate
      JOIN (
        SELECT source.tag_id, count(DISTINCT source.video_id) AS watch_count
        FROM (
          SELECT vt3.video_id, vt3.tag_id FROM video_tags vt3
          UNION
          SELECT v6.video_id, ct3.tag_id FROM videos v6 JOIN channel_tags ct3 ON ct3.channel_id = v6.channel_id
        ) source
        JOIN tags t4 ON t4.id = source.tag_id AND t4.user_id = ?
        JOIN history h4 ON h4.video_id = source.video_id AND h4.user_id = ?
        GROUP BY source.tag_id
      ) watched_tags ON watched_tags.tag_id = candidate.tag_id
      GROUP BY candidate.video_id
    ) tagwatch ON tagwatch.video_id = v.video_id
    WHERE v.is_short IS NOT 1
      AND COALESCE(uv.status, 'inbox') != 'archived'
      AND NOT EXISTS (SELECT 1 FROM recommendation_feedback rf WHERE rf.user_id = ? AND rf.video_id = v.video_id AND rf.action = 'dismiss')
    ORDER BY v.published_at DESC
    LIMIT 300
  `).all(uid, uid, uid, uid, uid, uid, uid, uid, uid, uid) as any[];

  return rows
    .map((video) => {
      let score = 0;
      const reasons: string[] = [];
      if (video.tag_hits > 0) {
        score += Number(video.tag_hits) * settings.shared_tag_points;
        reasons.push("shared tags");
      }
      if (video.tag_watch_count > 0) {
        score += Math.min(settings.tag_history_cap, Number(video.tag_watch_count) * settings.tag_history_points);
        reasons.push("watched tag history");
      }
      if (video.channel_watch_count > 0) {
        score += Math.min(settings.watched_channel_cap, Number(video.channel_watch_count) * settings.watched_channel_points);
        reasons.push("watched channel");
      }
      if (video.playlist_hits > 0) {
        score += settings.playlist_points;
        reasons.push("in your playlists");
      }
      if (video.liked === 1) {
        score += settings.liked_points;
        reasons.push("liked");
      }
      if (video.in_history) {
        score += settings.already_watched_points;
        reasons.push("already watched");
      }
      if (video.watch_position != null && video.watch_duration != null && Number(video.watch_duration) > 30) {
        score += settings.started_points;
        reasons.push("started watching");
      }
      if (video.external === 1) {
        score += settings.external_adjustment;
        reasons.push("temporary source");
      }
      const ageDays = video.published_at ? (Date.now() - new Date(video.published_at).getTime()) / 86_400_000 : 90;
      score += Math.max(0, settings.recency_points - Math.floor(ageDays / 7));
      return { kind: "local" as const, score, reasons, video };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function externalRecommendations(uid: number, limit: number, settings: Record<string, number>): Promise<DiscoveryRecommendation[]> {
  const seedRows = db.prepare(`
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
  const tagRows = db.prepare(`
    SELECT t.name AS text, 5 AS weight, 'tag' AS kind
    FROM tags t
    WHERE t.user_id = ? AND (
      EXISTS (SELECT 1 FROM video_tags vt JOIN user_videos uv ON uv.video_id = vt.video_id AND uv.user_id = ? WHERE vt.tag_id = t.id AND uv.liked = 1)
      OR EXISTS (SELECT 1 FROM channel_tags ct JOIN videos v ON v.channel_id = ct.channel_id JOIN history h ON h.video_id = v.video_id AND h.user_id = ? WHERE ct.tag_id = t.id)
    )
  `).all(uid, uid, uid) as KeywordSeed[];
  const blockedTerms = new Set(readDiscoveryTerms(uid, "blocked_terms"));
  const keywordPlan = buildKeywordPlan([...tagRows, ...seedRows], blockedTerms, 24, 3);
  const foundTerms = keywordPlan.terms;
  writeDiscoveryTerms(uid, "last_terms", foundTerms);
  const queries = keywordPlan.queries;

  const candidates: (SearchResult & { query: string; matchScore: number })[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    const queryTerms = new Set(tokenizeDiscoveryText(query));
    const search = await searchYouTube(query).catch(() => ({ results: [], channels: [] }));
    for (const result of search.results) {
      if (seen.has(result.videoId)) continue;
      if (db.prepare("SELECT 1 FROM recommendation_feedback WHERE user_id = ? AND video_id = ? AND action = 'dismiss'").get(uid, result.videoId)) continue;
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
    const about = await fetchChannelAbout(info.channelId).catch(() => null);
    upsertExternalVideo(info, about?.avatar ?? "");
    const video = selectVideo(uid, info.videoId);
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

function upsertExternalVideo(info: VideoInfo, channelThumbnail: string) {
  db.prepare(`
    INSERT INTO channels (channel_id, title, url, thumbnail, followed, external)
    VALUES (?, ?, ?, ?, 0, 1)
    ON CONFLICT(channel_id) DO UPDATE SET
      title = CASE WHEN channels.title = '' OR channels.title IS NULL THEN excluded.title ELSE channels.title END,
      thumbnail = CASE WHEN channels.thumbnail = '' OR channels.thumbnail IS NULL THEN excluded.thumbnail ELSE channels.thumbnail END
  `).run(info.channelId, info.channelTitle, `https://www.youtube.com/channel/${info.channelId}`, channelThumbnail);

  db.prepare(`
    INSERT INTO videos
      (video_id, channel_id, title, description, thumbnail, published_at, live_status, status, views, duration, external)
    VALUES (?, ?, ?, ?, ?, ?, 'none', 'inbox', ?, ?, 1)
    ON CONFLICT(video_id) DO UPDATE SET
      title = CASE WHEN videos.title = '' OR videos.title IS NULL THEN excluded.title ELSE videos.title END,
      description = CASE WHEN videos.description = '' OR videos.description IS NULL THEN excluded.description ELSE videos.description END,
      thumbnail = CASE WHEN videos.thumbnail = '' OR videos.thumbnail IS NULL THEN excluded.thumbnail ELSE videos.thumbnail END,
      views = COALESCE(videos.views, excluded.views),
      duration = COALESCE(videos.duration, excluded.duration)
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

function selectVideo(uid: number, videoId: string) {
  return db.prepare(`
    SELECT v.video_id, v.channel_id, v.title, v.description, v.thumbnail,
           v.published_at, v.live_status, COALESCE(uv.status, 'inbox') AS status, uv.bucket, uv.show_from,
           v.is_short, v.views, v.likes, uv.liked,
           v.duration, uv.watch_position, uv.watch_duration, v.external,
           EXISTS(SELECT 1 FROM history h WHERE h.video_id = v.video_id AND h.user_id = ?) AS in_history,
           c.title AS channel_title, c.thumbnail AS channel_thumbnail, c.subscriber_count AS channel_subscriber_count
    FROM videos v JOIN channels c ON c.channel_id = v.channel_id
    LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ?
    WHERE v.video_id = ?
  `).get(uid, uid, videoId) as any | null;
}

export async function discoveryRecommendations(uid: number) {
  if (!pluginEnabled("discovery")) return { recommendations: [], enabled: false };
  const settings = discoverySettings(uid);
  let recommendations = readStoredDiscoveryRecommendations(uid, settings.total_limit);
  if (recommendations.length === 0) {
    await runDiscoveryRefresh(uid);
    recommendations = readStoredDiscoveryRecommendations(uid, settings.total_limit);
  } else if (storedDiscoveryAgeMs(uid) > DISCOVERY_REFRESH_INTERVAL_MS) {
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
  const settings = discoverySettings(uid);
  return { recommendations: readStoredDiscoveryRecommendations(uid, settings.total_limit), enabled: true };
}

export function refreshDiscoveryInBackground(uid: number) {
  if (!pluginEnabled("discovery") || discoveryRefreshInFlight.has(uid) || discoveryRefreshTimers.has(uid)) return;
  const delay = Math.max(0, DISCOVERY_REFRESH_INTERVAL_MS - storedDiscoveryAgeMs(uid));
  const timer = setTimeout(() => {
    discoveryRefreshTimers.delete(uid);
    runDiscoveryRefresh(uid).catch(() => {});
  }, delay);
  discoveryRefreshTimers.set(uid, timer);
}

async function runDiscoveryRefresh(uid: number) {
  const current = discoveryRefreshInFlight.get(uid);
  if (current) return current;
  const promise = rebuildDiscoveryRecommendations(uid).finally(() => discoveryRefreshInFlight.delete(uid));
  discoveryRefreshInFlight.set(uid, promise);
  return promise;
}

async function rebuildDiscoveryRecommendations(uid: number) {
  if (!pluginEnabled("discovery")) return;
  const settings = discoverySettings(uid);
  const totalLimit = settings.total_limit;
  const local = localRecommendations(uid, Math.max(24, totalLimit), settings);
  const importedExternal = await externalRecommendations(uid, Math.max(settings.early_external_count, 8), settings);
  const recommendations = mixRecommendations([...local, ...importedExternal], totalLimit, settings);
  persistDiscoveryRecommendations(uid, recommendations);
}

function persistDiscoveryRecommendations(uid: number, recommendations: DiscoveryRecommendation[]) {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM discovery_recommendations WHERE user_id = ?").run(uid);
    const insert = db.prepare(`
      INSERT INTO discovery_recommendations (user_id, video_id, score, reasons_json, query, rank, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    recommendations.forEach((recommendation, index) => {
      const videoId = recommendation.video?.video_id;
      if (!videoId) return;
      insert.run(
        uid,
        videoId,
        recommendation.score,
        JSON.stringify(recommendation.reasons),
        recommendation.query ?? null,
        index,
      );
    });
    setDiscoveryGeneratedAt(uid);
  });
  tx();
}

function invalidateDiscoveryRecommendations(uid: number) {
  const timer = discoveryRefreshTimers.get(uid);
  if (timer) {
    clearTimeout(timer);
    discoveryRefreshTimers.delete(uid);
  }
  db.prepare("DELETE FROM discovery_recommendations WHERE user_id = ?").run(uid);
  db.prepare("DELETE FROM plugin_state WHERE plugin_id = 'discovery' AND user_id = ? AND key = 'last_generated_at'").run(uid);
}

function setDiscoveryGeneratedAt(uid: number) {
  db.prepare(`
    INSERT INTO plugin_state (plugin_id, user_id, key, value, updated_at)
    VALUES ('discovery', ?, 'last_generated_at', datetime('now'), datetime('now'))
    ON CONFLICT(plugin_id, user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(uid);
}

function readStoredDiscoveryRecommendations(uid: number, limit: number): DiscoveryRecommendation[] {
  const rows = db.prepare(`
    SELECT video_id, score, reasons_json, query
    FROM discovery_recommendations
    WHERE user_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_feedback rf
        WHERE rf.user_id = discovery_recommendations.user_id
          AND rf.video_id = discovery_recommendations.video_id
          AND rf.action = 'dismiss'
      )
    ORDER BY rank ASC
    LIMIT ?
  `).all(uid, limit) as { video_id: string; score: number; reasons_json: string; query: string | null }[];
  const out: DiscoveryRecommendation[] = [];
  for (const row of rows) {
    const video = selectVideo(uid, row.video_id);
    if (!video) continue;
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

function storedDiscoveryAgeMs(uid: number) {
  const state = db.prepare("SELECT value AS generated_at FROM plugin_state WHERE plugin_id = 'discovery' AND user_id = ? AND key = 'last_generated_at'")
    .get(uid) as { generated_at: string | null } | null;
  const row = state?.generated_at
    ? state
    : db.prepare("SELECT MAX(generated_at) AS generated_at FROM discovery_recommendations WHERE user_id = ?")
      .get(uid) as { generated_at: string | null } | null;
  if (!row?.generated_at) return DISCOVERY_REFRESH_INTERVAL_MS;
  const ts = new Date(row.generated_at).getTime();
  if (!Number.isFinite(ts)) return DISCOVERY_REFRESH_INTERVAL_MS;
  return Math.max(0, Date.now() - ts);
}

function mixRecommendations(recommendations: DiscoveryRecommendation[], limit: number, settings: Record<string, number>) {
  const seen = new Set<string>();
  const sorted = recommendations
    .filter((r) => {
      const id = r.video?.video_id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => b.score - a.score);

  const first = sorted.shift();
  if (!first) return [];

  const out: DiscoveryRecommendation[] = [first];
  const earlyExternal = takeExternalPicks(sorted.slice(0, 18), settings.early_external_count);
  removePicked(sorted, earlyExternal);
  const randomPicks = takeRandom(sorted.slice(0, 12), settings.random_pick_count);
  removePicked(sorted, randomPicks);
  out.push(...interleave([earlyExternal, randomPicks]));

  const highPicks = sorted.splice(0, settings.high_pick_count);
  out.push(...highPicks);
  out.push(...weightedShuffle(sorted));

  return limitPerChannel(out, settings.per_channel_limit).slice(0, limit);
}

function limitPerChannel(recommendations: DiscoveryRecommendation[], perChannel: number) {
  const counts = new Map<string, number>();
  return recommendations.filter((r) => {
    const channelId = r.video?.channel_id;
    if (!channelId) return false;
    const count = counts.get(channelId) ?? 0;
    if (count >= perChannel) return false;
    counts.set(channelId, count + 1);
    return true;
  });
}

function takeExternalPicks(items: DiscoveryRecommendation[], count: number) {
  return items.filter((item) => item.video?.external === 1).slice(0, count);
}

function interleave<T>(groups: T[][]) {
  const out: T[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const group of groups) {
      const item = group.shift();
      if (item) {
        out.push(item);
        added = true;
      }
    }
  }
  return out;
}

function takeRandom<T>(items: T[], count: number) {
  const pool = [...items];
  const out: T[] = [];
  while (pool.length > 0 && out.length < count) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function removePicked(items: DiscoveryRecommendation[], picked: DiscoveryRecommendation[]) {
  const ids = new Set(picked.map((r) => r.video?.video_id).filter(Boolean));
  for (let i = items.length - 1; i >= 0; i--) {
    if (ids.has(items[i].video?.video_id)) items.splice(i, 1);
  }
}

function weightedShuffle(items: DiscoveryRecommendation[]) {
  const pool = [...items];
  const out: DiscoveryRecommendation[] = [];
  while (pool.length > 0) {
    const total = pool.reduce((sum, item) => sum + Math.max(1, item.score), 0);
    let cursor = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      cursor -= Math.max(1, pool[idx].score);
      if (cursor <= 0) break;
    }
    out.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0]);
  }
  return out;
}

export function dismissDiscoveryRecommendation(uid: number, videoId: string) {
  db.prepare(
    "INSERT INTO recommendation_feedback (user_id, video_id, action, created_at) VALUES (?, ?, 'dismiss', datetime('now')) ON CONFLICT(user_id, video_id) DO UPDATE SET action = 'dismiss', created_at = excluded.created_at"
  ).run(uid, videoId);
  db.prepare("DELETE FROM discovery_recommendations WHERE user_id = ? AND video_id = ?").run(uid, videoId);
  refreshDiscoveryInBackground(uid);
}
