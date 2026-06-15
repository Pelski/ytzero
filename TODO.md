# Playlisty użytkownika — plan implementacji

## Cel

Umożliwić tworzenie własnych playlist, ręczne i automatyczne dodawanie filmów, wyświetlanie w menu i zarządzanie w ustawieniach.

---

## Krok 1 — Baza danych (migracja)

Nowe tabele w `app/src/db.ts`:

```sql
CREATE TABLE IF NOT EXISTS user_playlists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT 'ListMusic',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_playlist_videos (
  playlist_id INTEGER NOT NULL REFERENCES user_playlists(id) ON DELETE CASCADE,
  video_id    TEXT    NOT NULL REFERENCES videos(video_id)   ON DELETE CASCADE,
  added_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (playlist_id, video_id)
);

CREATE TABLE IF NOT EXISTS user_playlist_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL REFERENCES user_playlists(id) ON DELETE CASCADE,
  pattern     TEXT NOT NULL,
  match_type  TEXT NOT NULL CHECK (match_type IN ('contains', 'regex')),
  field       TEXT NOT NULL CHECK (field IN ('title', 'description', 'both'))
);
```

---

## Krok 2 — API (Hono, `app/src/routes.ts`)

Nowe endpointy:

| Metoda | Ścieżka | Opis |
|--------|---------|------|
| GET | `/playlists` | lista playlist użytkownika (+ liczba filmów) |
| POST | `/playlists` | utwórz playlistę `{ name, icon }` |
| PUT | `/playlists/:id` | edytuj nazwę/ikonę/kolejność |
| DELETE | `/playlists/:id` | usuń playlistę |
| GET | `/playlists/:id` | szczegóły + filmy (VideoRow z attachTags) |
| POST | `/playlists/:id/videos` | dodaj film `{ video_id }` |
| DELETE | `/playlists/:id/videos/:videoId` | usuń film z playlisty |
| GET | `/playlists/:id/rules` | reguły auto-dodawania |
| POST | `/playlists/:id/rules` | dodaj regułę `{ pattern, match_type, field }` |
| DELETE | `/playlists/:id/rules/:ruleId` | usuń regułę |
| POST | `/playlists/:id/rules/apply` | zastosuj reguły do wszystkich filmów w bazie |

Odpowiednie typy dodać do `ui/src/api.ts`:

```ts
export interface UserPlaylist {
  id: number;
  name: string;
  icon: string;
  sort_order: number;
  video_count: number;
}

export interface UserPlaylistRule {
  id: number;
  playlist_id: number;
  pattern: string;
  match_type: "contains" | "regex";
  field: "title" | "description" | "both";
}
```

---

## Krok 3 — WatchPage: dropdown "Dodaj do playlisty"

Plik: `ui/src/pages/WatchPage.tsx`

- Import ikony `BookmarkPlus` z lucide-react
- Nowy przycisk `btn icon-only` obok "Obejrzyj później"
- Po kliknięciu: dropdown z listą playlist (checkbox przy każdej)
- Zaznaczenie/odznaczenie → `POST /playlists/:id/videos` lub `DELETE`
- Na dole dropdownu: "Nowa playlista…" → inline formularz (nazwa + wybór ikony)
- Stan: które playlisty zawierają ten film pobierać przy otwarciu dropdownu

---

## Krok 4 — Sidebar: sekcja playlist

Plik: `ui/src/App.tsx`, komponent `SidebarPlaylists`

- Wyświetlana pod sekcją "Subskrypcje"
- Nagłówek "Moje playlisty"
- Każdy element: `{icon} {name} ({video_count})`
- Link do `/playlists/:id`
- Przycisk "+" otwiera modal tworzenia playlisty
- Zawsze rozwinięte (tak jak Subskrypcje)

Nowa trasa w `App.tsx`:
```tsx
<Route path="/playlists/:id" element={<UserPlaylistPage onPlay={play} />} />
```

---

## Krok 5 — UserPlaylistPage

Nowy plik: `ui/src/pages/UserPlaylistPage.tsx`

- Nagłówek: `{icon} {name}` + przycisk edycji (inline rename)
- Siatka filmów `VideoCard` z dodatkowym przyciskiem "Usuń z playlisty"
- Przycisk "Edytuj playlistę" → modal: zmień nazwę i ikonę
- Przycisk "Usuń playlistę" (z potwierdzeniem)

---

## Krok 6 — Ustawienia: zarządzanie playlistami + auto-reguły

Plik: `ui/src/pages/SettingsPage.tsx`

- Nowa zakładka "Playlisty" (obok "Tagi", "Kanały" itp.)
- Lista playlist z możliwością edycji nazwy/ikony i usunięcia
- Pod każdą playlistą: sekcja reguł (identyczna UX jak reguły tagów):
  - Pole `pattern` + select `match_type` + select `field`
  - Przycisk "Dodaj regułę"
  - Lista aktywnych reguł z przyciskiem usunięcia
  - Przycisk "Zastosuj reguły do całej bazy"
- Nowa playlista: formularz na dole sekcji

### Automatyczne stosowanie reguł

W `app/src/refresher.ts` — przy każdym odświeżaniu kanału (po dodaniu nowych filmów) wywołać funkcję `applyPlaylistRulesToVideos(newVideoIds)` analogicznie do `applyRuleToAllVideos`.

```ts
function applyPlaylistRulesToVideo(videoId: string) {
  const video = db.prepare("SELECT * FROM videos WHERE video_id = ?").get(videoId);
  const rules = db.prepare("SELECT * FROM user_playlist_rules").all();
  for (const rule of rules) {
    if (matches(video, rule)) {
      db.prepare("INSERT OR IGNORE INTO user_playlist_videos (playlist_id, video_id) VALUES (?, ?)")
        .run(rule.playlist_id, videoId);
    }
  }
}
```

---

## Priorytet

| Krok | Zakres | Czas est. |
|------|--------|-----------|
| 1 + 2 | DB + API | ~1h |
| 3 | WatchPage dropdown | ~45 min |
| 4 | Sidebar | ~30 min |
| 5 | UserPlaylistPage | ~45 min |
| 6 | Ustawienia + auto-reguły | ~1h |

Minimalne MVP (kroki 1–4) daje pełną funkcjonalność bez strony szczegółowej.

---

## Drobne UI

- Zmienić polską nazwę trybu kina z `Kino` na `Tryb kinowy`; angielskiej nazwy nie zmieniać.
