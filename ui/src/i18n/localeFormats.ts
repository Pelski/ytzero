import { plural } from "./format";
import type { Language, LocaleFormat } from "./types";

const polishVideoForms = { one: "film", few: "filmy", many: "filmów", other: "filmów" };

export const localeFormats: Record<Language, LocaleFormat> = {
  en: {
    videoCount: (n) => `${n} ${plural("en", n, { one: "video", other: "videos" })}`,
    addedVideos: (n) => `Added ${n} new ${plural("en", n, { one: "video", other: "videos" })}`,
    channelCount: (n) => `${n} ${plural("en", n, { one: "channel", other: "channels" })}`,
    playlistCount: (n) => `${n} ${plural("en", n, { one: "playlist", other: "playlists" })}`,
    historyEntryCount: (n) => `${n} ${plural("en", n, { one: "entry", other: "entries" })}`,
    ageUnit: (n, unit) => plural("en", n, {
      days: { one: "day", other: "days" },
      weeks: { one: "week", other: "weeks" },
      months: { one: "month", other: "months" },
      years: { one: "year", other: "years" },
    }[unit]),
  },
  pl: {
    videoCount: (n) => `${n} ${plural("pl", n, polishVideoForms)}`,
    addedVideos: (n) => `Dodano ${n} nowych filmów`,
    channelCount: (n) => `${n} ${plural("pl", n, { one: "kanał", few: "kanały", many: "kanałów", other: "kanałów" })}`,
    playlistCount: (n) => `${n} ${plural("pl", n, { one: "playlista", few: "playlisty", many: "playlist", other: "playlist" })}`,
    historyEntryCount: (n) => `${n} ${plural("pl", n, { one: "wpis", few: "wpisy", many: "wpisów", other: "wpisów" })}`,
    ageUnit: (n, unit) => plural("pl", n, {
      days: { one: "dzień", few: "dni", many: "dni", other: "dni" },
      weeks: { one: "tydzień", few: "tygodnie", many: "tygodni", other: "tygodni" },
      months: { one: "miesiąc", few: "miesiące", many: "miesięcy", other: "miesięcy" },
      years: { one: "rok", few: "lata", many: "lat", other: "lat" },
    }[unit]),
  },
  de: {
    videoCount: (n) => `${n} ${plural("de", n, { one: "Video", other: "Videos" })}`,
    addedVideos: (n) => `${n} neue${n === 1 ? "s" : ""} ${plural("de", n, { one: "Video", other: "Videos" })} hinzugefügt`,
    channelCount: (n) => `${n} ${plural("de", n, { one: "Kanal", other: "Kanäle" })}`,
    playlistCount: (n) => `${n} ${plural("de", n, { one: "Playlist", other: "Playlists" })}`,
    historyEntryCount: (n) => `${n} ${plural("de", n, { one: "Eintrag", other: "Einträge" })}`,
    ageUnit: (n, unit) => plural("de", n, {
      days: { one: "Tag", other: "Tage" },
      weeks: { one: "Woche", other: "Wochen" },
      months: { one: "Monat", other: "Monate" },
      years: { one: "Jahr", other: "Jahre" },
    }[unit]),
  },
};
