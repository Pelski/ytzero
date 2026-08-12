YT Zero uses only public YouTube surfaces — no Google account and no YouTube Data API key.

## What is fetched

- Videos are fetched from official RSS feeds:

  ```text
  https://www.youtube.com/feeds/videos.xml?channel_id=UC...
  ```

- Channel IDs are resolved from common YouTube URLs and handles.
- Live and upcoming stream status is detected from channel live pages.
- Video duration, Shorts detection, view counts, likes, channel metadata, avatars, and public playlists are refreshed in the background where available.
- Watch-page comments are fetched on demand through yt-dlp only when the per-profile option is enabled and the viewer scrolls to the section.
- Optional DeArrow branding uses the privacy behavior described in [Privacy & License](Privacy-and-License#dearrow).
- When the optional TubeArchivist plugin is enabled, its paginated API supplies archive metadata, comments, thumbnails, subtitles, and protected media locations. The YT Zero server proxies protected resources with the API token; the browser never receives it. See [TubeArchivist Integration](TubeArchivist-Integration).

See [Configuration](Configuration#background-refresh) for the refresh intervals and how lazy duration backfill works.

## What is stored locally

Everything user-specific lives in the configured YT Zero database: SQLite by default, or PostgreSQL after an explicit migration. Most of it is [per profile](Profiles#what-is-per-profile):

- followed channels
- videos and statuses
- queue buckets
- tags and rules
- filter rules
- playlists and playlist rules
- watch history and progress
- display and player settings
- language preference

Channels and videos are stored globally and shared across profiles; per-profile state references them.

TubeArchivist items reuse this shared catalog and retain separate source records
for availability, media location, and synchronized metadata. This avoids
mistaking externally managed archive files for YT Zero downloads. Portable
backup includes only the plugin enabled state and safe refresh/watched policies;
the TubeArchivist URL, token, media locators, catalog cache, sync state, and
watched outbox remain machine-local or rebuildable.
