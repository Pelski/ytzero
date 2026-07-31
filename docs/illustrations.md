# Empty-state illustrations

How the drawings in `ui/src/components/illustrations/EmptyArt.tsx` are built, and —
more importantly — where they are allowed to appear.

## The rule that matters

**An illustration is expensive attention. Its value comes from being rare.**

Give a screen an illustration only when all three are true:

1. It is a **primary destination** — something reachable from the sidebar, not a
   panel inside Settings or a tab inside another page.
2. The emptiness is a **stable, meaningful state** — "you're done", "nothing is
   happening right now", "you haven't started this yet". Not a filter that
   returned nothing, not an error, not a loading gap.
3. The state **fills the page**. If it sits inside a card or a section next to
   other content, it gets the plain `icon` variant instead.

Everything else uses `<EmptyState icon={…} title={…} />` (or `compact`), which
stays deliberately quiet.

### Current allocation

| Surface | Scene | Why |
|---|---|---|
| `/` feed, nothing left | `inboxZero` | The reward state — the whole point of the app |
| `/` feed, no followed channels | `noSubscriptions` | First-run state; same meaning as an empty subscriptions page |
| `/watchlist` | `scheduleClear` | Nothing planned; calm, recurring |
| `/live` | `offAir` | Nobody streaming; recurring, not a failure |
| `/downloads` | `noDownloads` | Primary destination, hasn't been used yet |
| `/archive` | `archiveEmpty` | Primary destination, reassures nothing was lost |
| `/liked` | `nothingLiked` | Primary destination, hasn't been used yet |
| `/history` | `noHistory` | Primary destination, hasn't been used yet |
| `/shorts` | `noShorts` | Primary destination |
| `/followed-playlists` | `playlistEmpty` | Primary destination |
| `/playlists/:id` | `playlistEmpty` | Same meaning, same drawing — reuse, don't invent |
| `/subscriptions` (unfiltered) | `noSubscriptions` | Primary destination |
| `/recommendations` (no picks) | `noDiscovery` | Primary destination |
| `/insights` (no data, no error) | `noInsights` | Primary destination |
| `/social` | `socialEmpty` | Primary destination, no shared conversations yet |

### Deliberately **not** illustrated

- **Filtered results** — `noMatchingChannels`, `channelSearchEmpty`, the feed's
  "no videos match these tags", cleanup's preview sides. These are a query
  outcome, and the user wants to retry, not admire a picture. Note
  `/subscriptions` therefore branches: illustrated when genuinely empty, plain
  icon when a search or tag filter is what emptied it.
- **Errors** — `/insights` shows a plain state when the request failed. An error
  is a failure, not a milestone; the same page is illustrated only for the real
  "nothing watched yet" case.
- **Channel page tabs** (`channelVideosEmpty`, `processingEmpty`,
  `publicPlaylistsEmpty`) — sections inside a page, rule 3.
- **Settings panels** (`logsEmpty`, `changelogEmpty`, `externalEmpty`) — dense
  config surfaces, rule 1.
- **Notification popover** — a small surface; `compact` exists for this.

## Anatomy

Every scene is the same 220×150 stage, composed back-to-front:

```
1. glow      radial ellipse, cy 98 — grounds the composition
2. atmosphere  0–2 drifting cards + 1–2 sparkles (the content that is gone)
3. badge     accent circle, ALWAYS at (110, 58), r 18 + a glyph
4. subject   the outlined object, occupying roughly y 84–134
```

The badge position is fixed on purpose: flipping between empty pages should feel
like one family, with only the object and the glyph changing.

### Colour

There is exactly one colour input: the SVG root sets `color: var(--accent)`.

- **Accent parts** (badge, glyph, cards, sparkles, glow) use `currentColor` with
  varying opacity. They inherit the instance's accent for free.
- **Structure** (`.empty-art__base`, `.empty-art__line`, `.empty-art__dot`) uses
  `color-mix(in srgb, var(--accent) 30%, var(--text-3))` for strokes and
  `color-mix(in srgb, var(--accent) 7%, var(--surface-2))` for fills — muted, but
  tinted toward the accent so it never looks like a foreign grey sticker.

Never hard-code a hex value in a scene.

### Line weights

| Element | Width |
|---|---|
| Subject outline / structural lines | `2.6` |
| Badge ring | `2.4` |
| Badge glyph | `3.2` |
| Drifting card outline | `2` |

`stroke-linecap` and `stroke-linejoin` are `round` everywhere. This is what makes
it sit next to lucide icons without clashing.

## Adding a scene

1. Add the name to `EmptyArtScene`.
2. Add a glyph path to `GLYPH`, authored around the badge centre **(110, 58)**,
   staying inside roughly ±9 units.
3. Add a `case` to `Subject` — the new object, using the `empty-art__*` classes.
   Keep it inside `y ≈ 82…134` and `x ≈ 44…176` so it never crowds the badge.
4. Add a `case` to `Atmosphere`. Cards live in `y ≈ 20…60`; keep them clear of
   the badge's circle (roughly `x 88…132`) or the composition gets muddy.
5. Give it copy: a short title (a statement, not a label) plus one sentence of
   description that says what will make the page fill up.

### Copy voice

Talk like a person who is quietly pleased the screen is empty. This app exists to
get people *out* of an endless feed, so an empty page is usually good news —
sometimes worth an outright compliment ("Not a single Short. Beautiful.").

Read the strings in the locale files before writing new ones; match that
register. The shape it lands on is usually **two short sentences**: a reaction,
then the useful bit.

> "Well, look at that. All caught up." / "Nothing left waiting for you. New
> videos will show up when they're ready."
>
> "Not a single channel. Bold minimalism." / "Add your first channel and let's
> turn this into an actual feed."
>
> "Still has that new-app smell." / "Not a single play yet. Gotta start somewhere."

**The trap: "do X and Y will happen."** It is the obvious sentence for every one
of these screens, which is exactly why a set written that way reads grey and
mechanical — a dozen screens, one formula. If a draft is technically accurate,
grammatically fine and still feels like a tooltip, that is the formula talking.
Rewrite it as something a person would actually say.

Also:

- A description needing a comma-spliced clause about plugins or import formats
  is documentation, not copy — put it in an `Alert` or in Settings.
- Describe the **actual control**: liking is a thumbs up in this app, so never
  "hit the heart".
- Warmth is fine, twee is not. No exclamation marks stacked up, no emoji.

Polish copy must stay **impersonal** — Polish past tense is gendered, so
"Wszystko ogarnięte" is correct and "Ogarnąłeś wszystko" is not. Imperatives
("Dodaj pierwszy kanał") and "Tobą" are safe; gendered past forms are not.

## Gotchas

- Gradient ids are derived from `useId()` per instance. Do not hard-code them —
  two empty states can be mounted at once and would otherwise share a definition.
- The whole SVG is `aria-hidden`. All meaning lives in the title and description.
- The entrance animation is behind `prefers-reduced-motion: no-preference`.
