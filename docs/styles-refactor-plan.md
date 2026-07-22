# Plan refaktoryzacji CSS

## Cel

Rozbić `ui/src/styles.css` według właścicieli stylów. Komponenty i strony mają przechowywać własny CSS obok implementacji, a globalny plik powinien zawierać wyłącznie fundamenty aplikacji.

Stan podczas przygotowania planu:

- `ui/src/styles.css`: 6629 linii, około 238 KB,
- jeden globalny import w `ui/src/main.tsx`,
- około 330 reguł design systemu z prefiksem `.ui-`,
- 11 użyć `!important`,
- powielone animacje, między innymi `@keyframes spin`,
- równoległe stare i nowe systemy kontrolek (`.btn`/`.ui-button`, `.dropdown-menu`/`Popover`, stare formularze/komponenty UI).

## Docelowa struktura

```text
ui/src/
├── styles.css                 # tylko prawdziwie globalne style
├── styles/
│   ├── tokens.css             # kolory, odstępy, promienie, warstwy
│   ├── reset.css              # box-sizing oraz reset elementów HTML
│   ├── typography.css
│   ├── scrollbars.css
│   ├── utilities.css          # wyłącznie faktycznie współdzielone utility
│   └── legacy.css             # tymczasowe miejsce; ma ostatecznie zniknąć
├── components/
│   ├── VideoCard.tsx
│   ├── VideoCard.css
│   ├── VideoThumbnail.tsx
│   ├── VideoThumbnail.css
│   └── ui/
│       ├── Button.tsx
│       ├── Button.css
│       ├── Popover.tsx
│       ├── Popover.css
│       └── ...
└── pages/
    ├── WatchPage.tsx
    ├── WatchPage.css
    ├── SettingsPage.tsx
    ├── SettingsPage.css
    └── ...
```

Każdy komponent i każda strona importują własny arkusz CSS. `styles.css` pozostaje punktem wejścia dla fundamentów, ale nie może zawierać selektorów konkretnych komponentów ani stron.

Na pierwszym etapie nie migrować masowo do CSS Modules. Istniejące klasy są w znacznej części namespacowane (`ui-*`, `watch-*`, `settings-*`), a jednoczesna konwersja JSX zwiększyłaby ryzyko regresji. Najpierw należy rozdzielić własność stylów. CSS Modules mogą być osobnym, późniejszym etapem.

## Reguły własności

1. Bazowa klasa komponentu należy do CSS tego komponentu.
2. Modyfikacja komponentu używanego w konkretnej stronie należy do CSS strony albo powinna zostać zamieniona w jawny wariant komponentu.
3. Media query i animacje muszą znajdować się obok właściciela selektora.
4. `styles.css` może zawierać wyłącznie:
   - tokeny i zmienne motywu,
   - reset oraz bazowe style `html`, `body`, `a`, `button`, `input`,
   - globalną typografię i scrollbary,
   - niewielką liczbę udokumentowanych utility, np. `sr-only`.
5. W `styles.css` nie mogą pozostać klasy takie jak `.watch-*`, `.settings-*`, `.video-*`, `.profile-*`, `.dropdown-*` ani `.ui-*`.
6. Nie dodawać nowych stylów do `legacy.css`. Jest to wyłącznie etap przejściowy.

Przykład własności:

- `.ui-button` należy do `components/ui/Button.css`,
- `.settings-update-status .ui-button` należy do `pages/SettingsPage.css` albo powinno korzystać z wariantu `Button`,
- `.profile-notification .ui-list-row__meta` należy do `components/NotificationCenter.css`.

## Warstwy kaskady

Warto wprowadzić jawny porządek kaskady:

```css
@layer reset, tokens, base, components, pages, utilities;
```

Pliki komponentów powinny używać warstwy `components`, strony warstwy `pages`, a utility warstwy `utilities`. Dzięki temu kolejność importowania modułów przez Vite nie będzie przypadkowo zmieniała priorytetu reguł.

## Etapy migracji

### 1. Fundament

- Wydzielić `tokens.css`, `reset.css`, `typography.css`, `scrollbars.css` i `utilities.css`.
- Pozostawić dotychczasowe wartości bez zmian.
- Dodać warstwy kaskady.
- Nie wykonywać jeszcze porządków wizualnych.

### 2. Design system

Przenieść dobrze namespacowane reguły `.ui-*` do plików odpowiadających istniejącym komponentom:

- `Button.css`
- `Fields.css`
- `Controls.css`
- `Selection.css`
- `Popover.css`
- `Menu.css`
- `Dialog.css`
- `Feedback.css`
- `List.css`
- `Layout.css`
- `Settings.css`
- `ColorPicker.css`
- `SteppedSlider.css`

Każdy komponent powinien importować własny CSS bezpośrednio. Najpierw przenieść reguły 1:1, zachowując selektory i kolejność w ramach komponentu.

### 3. Współdzielone komponenty aplikacji

Migrować kolejno:

1. `Tooltip`
2. `TagChip`, `TagCreateForm` i pickery tagów
3. `VideoThumbnail`
4. `VideoCard`
5. `VideoScheduleActions`
6. `PlaylistPicker` i `PlaylistIcon`
7. `NotificationCenter`
8. `ProfileMenu`
9. `LocalPlayer` i `SubtitlePicker`
10. `ShortCard` i `ShortsPlayer`
11. komponenty profili dziecięcych

Jeśli styl komponentu zależy od miejsca użycia, należy dodać jawny wariant lub modifier zamiast pozostawiać selektor przecinający niepowiązane obszary DOM.

### 4. Layout aplikacji

Wydzielić style dla:

- `AppShell`,
- `Sidebar`,
- `Topbar`,
- głównego obszaru treści,
- paska kanałów,
- poziomych list filmów.

Klasy `.layout`, `.layout-body`, `.sidebar`, `.topbar`, `.profile-menu` i podobne nie powinny pozostać globalne.

### 5. Strony

Migrować od najmniej do najbardziej splątanych:

1. `DownloadsPage`
2. `SubscriptionsPage`
3. `HistoryPage` i `WatchlistPage`
4. `ChannelPage`, `ChannelPlaylistPage`, `UserPlaylistPage`, `FollowedPlaylistsPage`
5. `InsightsPage`
6. `ShortsPage`
7. `SettingsPage`
8. `WatchPage`

`SettingsPage` i `WatchPage` powinny być ostatnie, ponieważ korzystają z największej liczby współdzielonych komponentów i zawierają najwięcej wyjątków responsywnych.

### 6. Likwidacja legacy

Tymczasowo przenieść stare rodziny stylów do `styles/legacy.css`:

- `.btn`,
- `.btn-ghost`,
- `.icon-btn`,
- `.dropdown-menu`,
- starsze klasy pól formularzy,
- stare switche i selecty.

Następnie odnajdywać ich użycia i migrować na istniejące komponenty design systemu. Nie utrzymywać dwóch równoległych implementacji. `legacy.css` musi ostatecznie zostać usunięty.

### 7. Porządki po migracji

Po przeniesieniu każdego obszaru:

- usunąć martwe klasy,
- scalać identyczne reguły,
- usuwać nadmiarowe `!important`,
- scalać powielone `@keyframes`,
- zamieniać magiczne wartości na tokeny,
- ujednolicić breakpointy,
- wprowadzić nazwane poziomy `z-index`,
- ograniczyć głębokie selektory zależne od struktury DOM,
- zastępować wyjątkowe selektory jawnymi wariantami komponentów.

Nie łączyć mechanicznego przenoszenia i dużych zmian wizualnych w jednym kroku. Najpierw migracja 1:1 i weryfikacja, dopiero potem cleanup danego fragmentu.

## Kontrola jakości i zabezpieczenia

Dodać skrypt, np. `ui/scripts/check-css-ownership.ts`, uruchamiany w CI/buildzie. Powinien:

- blokować prefiksy stron i komponentów w `styles.css`,
- pilnować limitu około 200–250 linii globalnego pliku,
- wykrywać powielone dokładne selektory,
- wykrywać powielone nazwy `@keyframes`,
- blokować nowe użycia legacy `.btn`, `.dropdown-*` i podobnych,
- opcjonalnie raportować nowe `!important`.

Do `AGENTS.md` dopisać zasadę: przed dodaniem CSS znaleźć właściciela komponentu; `styles.css` jest wyłącznie dla fundamentów globalnych.

## Procedura dla każdego pakietu zmian

1. Zidentyfikować wszystkie selektory właściciela, w tym media queries i animacje.
2. Przenieść je bez zmiany zachowania.
3. Dodać import CSS w komponencie lub stronie.
4. Usunąć przeniesione reguły z `styles.css`.
5. Sprawdzić brak zduplikowanych selektorów.
6. Uruchomić:

```bash
ui/node_modules/.bin/tsc --noEmit -p ui/tsconfig.json
git diff --check
cd ui && bun run build
```

7. Sprawdzić widoki przy szerokościach 360, 768, 1280 i 1920 px.
8. Zweryfikować co najmniej Feed, WatchPage, Settings, Channel, Shorts oraz zagnieżdżone popovery.
9. Dopiero po zgodności wizualnej wykonać cleanup przeniesionego fragmentu.

Nie uruchamiać samodzielnie serwera developerskiego; użytkownik zarządza działającym procesem Bun.

## Kryteria zakończenia

- `styles.css` ma około 100–200 linii i nie zawiera selektorów komponentów ani stron.
- Każdy komponent i każda strona mają oczywiste miejsce na własne style.
- `legacy.css` nie istnieje.
- Nie ma powielonych nazw animacji ani dokładnych selektorów.
- Nowe `!important` są blokowane lub wymagają jawnego uzasadnienia.
- Nie ma równoległych starych i nowych implementacji przycisków, pól, selectów oraz popoverów.
- Build i TypeScript przechodzą, a kluczowe widoki są sprawdzone na mobilce, tablecie i desktopie.

