import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type React from "react";
import { api, type AppSettings, type Bucket } from "./api";

export type Language = "en" | "pl";

const LANGUAGE_KEY = "language";

const labels = {
  en: {
    navToday: "Today",
    navLive: "Live",
    navWatchlist: "Scheduled",
    navHistory: "History",
    navArchive: "Rejected",
    navSettings: "Settings",
    subscriptions: "Subscriptions",
    loading: "Loading...",
    myPlaylists: "My playlists",
    newPlaylist: "New playlist",
    playlistName: "Playlist name",
    create: "Create",
    search: "Search",
    searchPlaceholder: "Search...",
    clear: "Clear",
    clearFilters: "Clear filters",
    yes: "Yes",
    cancel: "Cancel",
    save: "Save",
    delete: "Delete",
    edit: "Edit",
    restore: "Restore",
    reject: "Reject",
    watched: "Watched",
    remove: "Remove",
    removeFromPlaylist: "Remove from playlist",
    liveBadge: "LIVE",
    upcomingBadge: "UPCOMING",
    shortBadge: "SHORT",
    removeFrom: "Remove from:",
    noSearchResults: "No search results.",
    noVideos: "No videos. Add channels in Settings using OPML/CSV import or a channel link.",
    refresh: "Refresh",
    refreshError: "Refresh error:",
    loadMore: "Load more",
    searchResultsFor: "Results for:",
    gridSmall: "Small",
    gridMedium: "Medium",
    gridLarge: "Large",
    liveNow: "Live now",
    liveEmpty: "None of your channels is live right now.",
    upcoming: "Upcoming",
    watchlistEmpty: "The list is empty. Use the clock icon in the feed to schedule a video.",
    archiveEmpty: "The rejected list is empty.",
    historyTitle: "Watch history",
    historyEmpty: "History is empty. Watched videos will appear here.",
    settingsTitle: "Settings",
    channels: "Channels",
    tagsRules: "Tags & Rules",
    playlists: "Playlists",
    display: "Display",
    child: "Child",
    filters: "Filters",
    tags: "Tags",
    rules: "Rules",
    addChannel: "Add channel",
    addingChannel: "Adding...",
    addChannelNotFoundError: "An error occurred, the channel with this name probably does not exist.",
    channelLinkPlaceholder: "Channel link or @handle",
    importOpmlCsv: "Import OPML / CSV",
    searchChannelPlaceholder: "Search channel by name or ID",
    noMatchingChannels: "No channels match the search.",
    manageChannelTags: "Manage channel tags",
    addTag: "Add tag",
    newTag: "New tag",
    tagNamePlaceholder: "Tag name...",
    follow: "Follow",
    unfollow: "Unfollow",
    followAgain: "Follow again",
    deleteChannel: "Delete channel",
    allChannels: "all channels",
    filterHint: "Filters automatically reject matching videos right after import. Reject archives matches. Only matching archives everything else and requires a channel.",
    patternPlaceholder: "Pattern, e.g. Minecraft",
    contains: "contains",
    regex: "regex",
    inTitle: "in title",
    inDescription: "in description",
    titleOrDescription: "title or description",
    rejectMatching: "reject matching",
    onlyMatching: "only matching",
    addFilter: "Add filter",
    noFilterRules: "No filter rules.",
    tagHint: "Tags can be attached to channels, where all channel videos inherit them, and to individual videos.",
    tagNameExample: "Tag name, e.g. Minecraft",
    noTags: "No tags.",
    ruleHint: "A rule applies a tag to every video whose title or description matches the pattern. It works for new and existing videos.",
    chooseTag: "choose tag",
    addRule: "Add rule",
    noTagRules: "No tagging rules.",
    playlistHint: "Playlists can be filled manually from the watch screen or automatically with title and description rules.",
    newPlaylistName: "New playlist name",
    showShorts: "Show Shorts in feed",
    showShortsHint: "Videos detected as YouTube Shorts are hidden from the main list by default.",
    forceCaptions: "Force captions",
    forceCaptionsHint: "The player will automatically enable captions when available.",
    uiLanguage: "Interface language:",
    playerLanguage: "Player and caption language:",
    quality: "Preferred quality:",
    autoQuality: "automatic",
    qualityHint: "Quality is a suggestion for the YouTube player. YouTube may override it depending on connection and available formats.",
    playerSettingsSaved: "Player settings saved",
    displaySettingsSaved: "Display settings saved",
    shortsVisible: "Shorts will be visible in the feed",
    shortsHidden: "Shorts hidden in the feed",
    cinemaMode: "Theather",
    cinema: "Theather",
    watchLater: "Watch later",
    addToPlaylist: "Add to playlist",
    noPlaylists: "No playlists",
    newPlaylistDots: "New playlist...",
    name: "Name",
    createAndAdd: "Create and add",
    copyYoutubeLink: "Copy YouTube link",
    copied: "Copied",
    liveStream: "Live stream",
    showLess: "Show less",
    showMore: "Show more",
    moreLikeThis: "More like this",
    autoplay: "Autoplay",
    playlist: "Playlist",
    playlistEmpty: "No videos in this playlist.",
    publicPlaylistsEmpty: "No public playlists found.",
    channelVideosEmpty: "No videos from this channel in the database.",
    syncChannel: "Sync",
    syncing: "Syncing...",
    syncTitle: "Fetch new videos from this channel",
    noNewVideos: "No new videos",
    syncError: "Sync error",
    expand: "Expand",
    collapse: "Collapse",
    videos: "Videos",
    deletePlaylist: "Delete playlist",
    playlistIsEmpty: "This playlist is empty.",
    selectedTag: "Tag added",
    tagToChannel: "Add tag to channel",
    removeTagFromChannel: "Remove tag from channel",
    moveTo: "Move to:",
    removeFromQueue: "Remove from queue",
    todayAt: "today at",
    tomorrowAt: "tomorrow at",
    childLock: "Child lock",
    childLockHint: "Lock settings with a 6-digit PIN so channel and filter configuration cannot be changed casually.",
    childLockEnableHint: "After enabling, settings changes require unlocking this page with the PIN.",
    settingsLockedTitle: "Settings are locked",
    settingsLockedHint: "Enter the 6-digit PIN to change channels, filters, tags, playlists, and display settings.",
    pinPlaceholder: "6-digit PIN",
    newPinPlaceholder: "New 6-digit PIN",
    confirmPinPlaceholder: "Confirm PIN",
    unlockSettings: "Unlock settings",
    settingsUnlocked: "Settings unlocked",
    settingsLocked: "Settings locked",
    pinInvalid: "Invalid PIN",
    pinMustBeSixDigits: "PIN must have exactly 6 digits",
    pinsDoNotMatch: "PINs do not match",
    enableChildLock: "Enable child lock",
    childLockEnabled: "Child lock enabled",
    childLockDisabled: "Child lock disabled",
    childLockEnabledStatus: "Child lock is enabled",
    disableChildLock: "Disable child lock",
    lockNow: "Lock now",
    changePin: "Change PIN",
    changePinHint: "Set a new 6-digit PIN. The current unlocked session is enough to change it.",
    childLockPinChanged: "PIN changed",
    sponsorblockHint: "Automatically skip sponsored segments, intros, outros, and more.",
    sponsorblockCategories: "Segment categories to skip:",
    sbSegmentsTitle: "Segments to be skipped:",
    sponsorblockSaved: "SponsorBlock settings saved",
  },
  pl: {
    navToday: "Dziś",
    navLive: "Na żywo",
    navWatchlist: "Zaplanowane",
    navHistory: "Historia",
    navArchive: "Odrzucone",
    navSettings: "Ustawienia",
    subscriptions: "Subskrypcje",
    loading: "Ładowanie...",
    myPlaylists: "Moje playlisty",
    newPlaylist: "Nowa playlista",
    playlistName: "Nazwa playlisty",
    create: "Utwórz",
    search: "Szukaj",
    searchPlaceholder: "Szukaj...",
    clear: "Wyczyść",
    clearFilters: "Wyczyść filtry",
    yes: "Tak",
    cancel: "Anuluj",
    save: "Zapisz",
    delete: "Usuń",
    edit: "Edytuj",
    restore: "Przywróć",
    reject: "Odrzuć",
    watched: "Obejrzane",
    remove: "Usuń",
    removeFromPlaylist: "Usuń z playlisty",
    liveBadge: "NA ŻYWO",
    upcomingBadge: "WKRÓTCE",
    shortBadge: "SHORT",
    removeFrom: "Usuń z:",
    noSearchResults: "Brak wyników wyszukiwania.",
    noVideos: "Brak filmów. Dodaj kanały w Ustawieniach — import OPML/CSV lub link do kanału.",
    refresh: "Odśwież",
    refreshError: "Błąd odświeżania:",
    loadMore: "Załaduj więcej",
    searchResultsFor: "Wyniki dla:",
    gridSmall: "Mały",
    gridMedium: "Średni",
    gridLarge: "Duży",
    liveNow: "Trwa teraz",
    liveEmpty: "Żaden z Twoich kanałów nie nadaje teraz na żywo.",
    upcoming: "Wkrótce",
    watchlistEmpty: "Lista jest pusta. W feedzie użyj ikony zegara, żeby zaplanować film.",
    archiveEmpty: "Lista odrzuconych jest pusta.",
    historyTitle: "Historia oglądania",
    historyEmpty: "Historia jest pusta — odtworzone filmy pojawią się tutaj.",
    settingsTitle: "Ustawienia",
    channels: "Kanały",
    tagsRules: "Tagi & Reguły",
    playlists: "Playlisty",
    display: "Wyświetlanie",
    child: "Dziecko",
    filters: "Filtry",
    tags: "Tagi",
    rules: "Reguły",
    addChannel: "Dodaj kanał",
    addingChannel: "Dodaję...",
    addChannelNotFoundError: "Wystąpił błąd, prawdopodobnie kanał o tej nazwie nie istnieje.",
    channelLinkPlaceholder: "Link do kanału lub @handle",
    importOpmlCsv: "Import OPML / CSV",
    searchChannelPlaceholder: "Szukaj kanału po nazwie lub ID",
    noMatchingChannels: "Brak kanałów pasujących do wyszukiwania.",
    manageChannelTags: "Zarządzaj tagami kanału",
    addTag: "Dodaj tag",
    newTag: "Nowy tag",
    tagNamePlaceholder: "Nazwa tagu...",
    follow: "Obserwuj",
    unfollow: "Odobserwuj",
    followAgain: "Obserwuj ponownie",
    deleteChannel: "Usuń kanał",
    allChannels: "wszystkie kanały",
    filterHint: "Automatycznie odrzucają pasujące filmy zaraz po pobraniu. Akcja odrzuć archiwizuje pasujące. Akcja tylko pasujące archiwizuje wszystko inne i wymaga wybrania kanału.",
    patternPlaceholder: "Wzorzec, np. Minecraft",
    contains: "zawiera",
    regex: "regex",
    inTitle: "w tytule",
    inDescription: "w opisie",
    titleOrDescription: "tytuł lub opis",
    rejectMatching: "odrzuć pasujące",
    onlyMatching: "tylko pasujące",
    addFilter: "Dodaj filtr",
    noFilterRules: "Brak reguł filtrowania.",
    tagHint: "Tagi możesz przypinać do kanałów, gdzie dziedziczą je wszystkie filmy kanału, i do pojedynczych filmów.",
    tagNameExample: "Nazwa tagu, np. Minecraft",
    noTags: "Brak tagów.",
    ruleHint: "Reguła nadaje tag każdemu filmowi, którego tytuł lub opis pasuje do wzorca. Działa na nowe i istniejące filmy.",
    chooseTag: "wybierz tag",
    addRule: "Dodaj regułę",
    noTagRules: "Brak reguł tagowania.",
    playlistHint: "Playlisty możesz uzupełniać ręcznie z ekranu oglądania albo automatycznie regułami po tytule i opisie.",
    newPlaylistName: "Nazwa nowej playlisty",
    showShorts: "Pokazuj Shorts w feedzie",
    showShortsHint: "Filmy wykryte jako YouTube Shorts są domyślnie ukrywane na głównej liście.",
    forceCaptions: "Wymuszaj napisy",
    forceCaptionsHint: "Player będzie automatycznie włączał napisy, jeśli są dostępne.",
    uiLanguage: "Język interfejsu:",
    playerLanguage: "Język playera i napisów:",
    quality: "Preferowana jakość:",
    autoQuality: "automatyczna",
    qualityHint: "Jakość jest wskazówką dla playera YouTube. YouTube może ją nadpisać zależnie od łącza i dostępnych formatów.",
    playerSettingsSaved: "Zapisano ustawienia playera",
    displaySettingsSaved: "Zapisano ustawienia wyświetlania",
    shortsVisible: "Shorts będą widoczne w feedzie",
    shortsHidden: "Shorts ukryte w feedzie",
    cinemaMode: "Theather",
    cinema: "Theather",
    watchLater: "Obejrzyj później",
    addToPlaylist: "Dodaj do playlisty",
    noPlaylists: "Brak playlist",
    newPlaylistDots: "Nowa playlista...",
    name: "Nazwa",
    createAndAdd: "Utwórz i dodaj",
    copyYoutubeLink: "Kopiuj link do YouTube",
    copied: "Skopiowano",
    liveStream: "Transmisja na żywo",
    showLess: "Pokaż mniej",
    showMore: "Pokaż więcej",
    moreLikeThis: "Więcej podobnych",
    autoplay: "Autoodtwarzanie",
    playlist: "Playlista",
    playlistEmpty: "Brak filmów w playliście.",
    publicPlaylistsEmpty: "Nie znaleziono publicznych playlist.",
    channelVideosEmpty: "Brak filmów z tego kanału w bazie.",
    syncChannel: "Synchronizuj",
    syncing: "Synchronizuję...",
    syncTitle: "Pobierz nowe filmy z kanału",
    noNewVideos: "Brak nowych filmów",
    syncError: "Błąd synchronizacji",
    expand: "Rozwiń",
    collapse: "Zwiń",
    videos: "Filmy",
    deletePlaylist: "Usuń playlistę",
    playlistIsEmpty: "Ta playlista jest pusta.",
    selectedTag: "Tag dodany",
    tagToChannel: "Dodaj tag do kanału",
    removeTagFromChannel: "Usuń tag z kanału",
    moveTo: "Przenieś:",
    removeFromQueue: "Usuń z kolejki",
    todayAt: "dziś o",
    tomorrowAt: "jutro o",
    childLock: "Blokada ustawień",
    childLockHint: "Zablokuj ustawienia 6-cyfrowym PIN-em, żeby nie dało się przypadkiem zmienić kanałów i filtrów.",
    childLockEnableHint: "Po włączeniu zmiany ustawień wymagają odblokowania tej strony PIN-em.",
    settingsLockedTitle: "Ustawienia są zablokowane",
    settingsLockedHint: "Wpisz 6-cyfrowy PIN, żeby zmieniać kanały, filtry, tagi, playlisty i wyświetlanie.",
    pinPlaceholder: "6-cyfrowy PIN",
    newPinPlaceholder: "Nowy 6-cyfrowy PIN",
    confirmPinPlaceholder: "Potwierdź PIN",
    unlockSettings: "Odblokuj ustawienia",
    settingsUnlocked: "Ustawienia odblokowane",
    settingsLocked: "Ustawienia zablokowane",
    pinInvalid: "Nieprawidłowy PIN",
    pinMustBeSixDigits: "PIN musi mieć dokładnie 6 cyfr",
    pinsDoNotMatch: "PIN-y nie są takie same",
    enableChildLock: "Włącz blokadę",
    childLockEnabled: "Blokada włączona",
    childLockDisabled: "Blokada wyłączona",
    childLockEnabledStatus: "Blokada jest włączona",
    disableChildLock: "Wyłącz blokadę",
    lockNow: "Zablokuj teraz",
    changePin: "Zmień PIN",
    changePinHint: "Ustaw nowy 6-cyfrowy PIN. Aktualnie odblokowana sesja wystarczy do zmiany.",
    childLockPinChanged: "PIN zmieniony",
    sponsorblockHint: "Automatycznie pomijaj sponsorowane segmenty, intro, outro i inne.",
    sponsorblockCategories: "Kategorie segmentów do pominięcia:",
    sbSegmentsTitle: "Segmenty które zostaną pominięte:",
    sponsorblockSaved: "Zapisano ustawienia SponsorBlock",
  },
} as const;

export type I18nKey = keyof typeof labels.en;

export const bucketLabels: Record<Language, Record<Bucket, string>> = {
  en: {
    today: "Today",
    tonight: "Tonight",
    tomorrow: "Tomorrow",
    weekend: "Weekend",
  },
  pl: {
    today: "Dzisiaj",
    tonight: "Dziś wieczorem",
    tomorrow: "Jutro",
    weekend: "Weekend",
  },
};

type I18nValue = {
  language: Language;
  setLanguage: (language: Language) => Promise<void>;
  t: (key: I18nKey) => string;
  bucketLabel: (bucket: Bucket) => string;
  locale: string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function normalizeLanguage(value: unknown): Language {
  return value === "pl" ? "pl" : "en";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => normalizeLanguage(localStorage.getItem(LANGUAGE_KEY)));

  useEffect(() => {
    api
      .settings()
      .then((r) => {
        const next = normalizeLanguage(r.settings.language);
        setLanguageState(next);
        localStorage.setItem(LANGUAGE_KEY, next);
        document.documentElement.lang = next;
      })
      .catch(() => {
        document.documentElement.lang = language;
      });
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback(async (next: Language) => {
    setLanguageState(next);
    localStorage.setItem(LANGUAGE_KEY, next);
    await api.updateSettings({ language: next });
  }, []);

  const value = useMemo<I18nValue>(() => ({
    language,
    setLanguage,
    t: (key) => labels[language][key],
    bucketLabel: (bucket) => bucketLabels[language][bucket],
    locale: language === "pl" ? "pl-PL" : "en-US",
  }), [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

export function formatVideoCount(n: number, language: Language): string {
  if (language === "pl") {
    const rule = new Intl.PluralRules("pl").select(n);
    const suffix = rule === "one" ? "film" : rule === "few" ? "filmy" : "filmów";
    return `${n} ${suffix}`;
  }
  return `${n} ${n === 1 ? "video" : "videos"}`;
}

export function formatAddedVideos(n: number, language: Language): string {
  return language === "pl"
    ? `Dodano ${n} nowych filmów`
    : `Added ${n} new ${n === 1 ? "video" : "videos"}`;
}

export function formatViewsCount(views: number | null, language: Language): string {
  if (views == null) return "";
  const compact = new Intl.NumberFormat(language === "pl" ? "pl-PL" : "en-US", { notation: "compact", maximumFractionDigits: 1 });
  return language === "pl" ? `${compact.format(views)} wyświetleń` : `${compact.format(views)} views`;
}

export function formatTimeAgo(iso: string | null, language: Language): string {
  if (!iso) return "";
  const locale = language === "pl" ? "pl-PL" : "en-US";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (language === "pl") {
    if (min < 60) return `${min} min temu`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} godz. temu`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d} dni temu`;
    return new Date(iso).toLocaleDateString(locale);
  }
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(locale);
}

export function compactNumber(value: number | null, language: Language): string {
  if (value == null) return "";
  return new Intl.NumberFormat(language === "pl" ? "pl-PL" : "en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export type SettingsWithLanguage = AppSettings & { language: Language };
