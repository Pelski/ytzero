Settings use a two-column layout: navigation stays on the left and the selected
options appear on the right. On short screens both areas remain scrollable, and
on narrow screens the navigation collapses into a compact selector. Changes are
saved immediately unless an action explicitly shows a confirmation button.

## Navigation

The menu is grouped by purpose:

- **Library** — Channels, Followed playlists, Filters, Tags, Rules, and personal Playlists.
- **Experience** — Appearance, Feed, Navigation, Playback, Subtitles, Screenshots, and Privacy.
- **Administration** — Plugins, Profiles, and Authentication.
- **System** — Changelog and update checks, Logs, External videos, Backup and restore, Database, and other dangerous operations.

Only sections available to the active profile are shown. Authentication remains
owner-only, while system and shared administration tools require administrator
access.

## Experience settings

- **Appearance** controls the interface language, application identity, video-card density, and watched-video style.
- **Feed** controls the feed age window and visibility of Shorts, live, Upcoming, and members-only content. Shorts can be hidden, shown for selected channels, or shown for every followed channel; a channel opt-in affects only the main feed.
- **Navigation** controls Shorts, top channels, and the order and visibility of sidebar destinations.
- **Playback** controls related videos, on-demand comments, list continuation, player language, quality, speed, keyboard seeking, and automatic landscape fullscreen.
- **Subtitles** controls caption defaults and presentation.
- **Screenshots** controls captures made by the local player or YT Zero Enhance.
- **Privacy** contains the optional SponsorBlock and [DeArrow](Privacy-and-License#dearrow) integrations. DeArrow titles and thumbnails are separate and both are disabled by default.

## Plugins

Built-in plugins are disabled by default and can be enabled or configured under
**Settings → Plugins**. The [YT-DLP Integration](YT-DLP-Integration) owns files
downloaded by YT Zero and has a dedicated Downloads destination. The
[TubeArchivist Integration](TubeArchivist-Integration) instead connects an
existing external archive as a headless source for the normal feed and player;
it intentionally adds no route or sidebar item. Shared plugin configuration and
connection tests require administrator access.

## Administrator-only access

The primary profile chooses which areas non-administrator profiles may change
under **Settings → Profiles → Administrator-only access**. Permissions are split
into channels, followed playlists, imports, tags and rules, filters, personal
playlists, appearance, feed, navigation, playback, plugins, and profiles.

The default keeps shared behavior and administration restricted while leaving
personal tags, rules, filters, and playlists editable. The Child Lock PIN is a
separate temporary gate: it does not grant administrator status or change these
permissions. See [Profiles](Profiles) and [Child Lock](Child-Lock).
