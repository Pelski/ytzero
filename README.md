# YT Zero

![YT Zero main feed](docs/assets/feed.png)

| Standard player | Theater player |
| --- | --- |
| <img src="docs/assets/video-standard.png" alt="YT Zero standard video player" width="360"> | <img src="docs/assets/video-theater.png" alt="YT Zero theater video player" width="360"> |

| Tags and rules | Display settings |
| --- | --- |
| <img src="docs/assets/tags.png" alt="YT Zero tags and rules settings" width="360"> | <img src="docs/assets/display.png" alt="YT Zero display settings" width="360"> |

> A self-hosted YouTube inbox for people who want subscriptions, not recommendations.

YT Zero turns YouTube back into a simple reader for channels you chose on purpose. No Google account. No API key. No algorithmic home feed pushing videos you did not ask for.

It reads public YouTube RSS feeds, stores everything locally in SQLite, and gives you a calm place to sort, schedule, watch, archive, and revisit videos from creators you already follow.

If the problem is "YouTube is good at surfacing more, not better," YT Zero is the opposite: a quiet inbox, your own rules, and a player built around intentional watching.

## Why it exists

YouTube is excellent at keeping attention and bad at staying out of the way. If all you want is:

- your subscriptions in one place
- a clean watch queue
- no forced sign-in
- no API setup
- no recommendation loop

then the default YouTube experience keeps adding noise around the thing you actually came for.

YT Zero removes that layer. It keeps subscriptions, watch progress, playlists, tags, and playback controls. It drops the account dependency and the recommendation machinery.

## What makes it useful

- **Focused inbox** — all new videos from followed channels in one chronological feed.
- **No Google dependency** — works without a Google account or YouTube Data API key.
- **Local-first state** — subscriptions, progress, history, playlists, tags, and rules are stored in SQLite.
- **Built for triage** — schedule videos for later, archive the ones you will not watch, and come back on your terms.
- **Organized watching** — use tags, inherited channel tags, rules, and local playlists to shape your own feed.
- **Real playback controls** — theater view, captions, quality, display settings, and optional SponsorBlock support.
- **Works for households** — profiles, authentication modes, child profiles with watch-time limits, and child lock make one install usable by more than one person.

## Features

- **Subscription inbox** — all new videos from followed channels in one feed.
- **Channel import** — add channels manually, import OPML, or import `subscriptions.csv` from Google Takeout.
- **Live and upcoming streams** — dedicated live view with automatic status refresh, plus a per-profile option to keep live and Upcoming entries out of the main feed.
- **Watch later buckets** — schedule videos for Today, Tonight, Tomorrow, Tomorrow evening, or Weekend.
- **Archive flow** — reject videos, restore them later, and keep the main feed clean.
- **History and progress** — record watched videos and resume partially watched ones.
- **Tags & rules** — tag videos and channels, inherit channel tags to videos, and automate sorting with rules.
- **User playlists** — local playlists with icons, manual additions, and rules.
- **Profiles** — multiple isolated profiles on one install, each with its own state.
- **Authentication** — none, shared login, per-profile login, OIDC, or proxy headers, with password and passkey support.
- **Child lock** — PIN-protect household settings while leaving each profile's own tags and playlists editable.
- **Child profiles** — daily watch-time limits, parent-approved extensions, subscribed-content-only mode, optional Shorts/live blocking, reduced settings access, and a parent activity panel with immediate stop/unlock controls.
- **Shorts tab & player** — a followed-channels-only Shorts feed and a full-screen vertical player.
- **SponsorBlock** — optionally skip sponsored segments, intros, outros, and more.
- **Playback and display controls** — theater view, captions, quality, and display customization.
- **Internationalization** — English, Polish, and German UI.

See the full list with screens in the **[Features](https://github.com/Pelski/ytzero/wiki/Features)** wiki page.

## How it works

YT Zero does not scrape your account or sync with YouTube through a private API. It watches public channel feeds, fetches the metadata needed to build your local library, and serves that library back as a quieter interface.

That means:

- easy self-hosting
- no API quota headaches
- local ownership of your app state
- a product that stays narrow on purpose

## Quick start

Run with Docker using the published GHCR image:

```yaml
services:
  ytzero:
    image: ghcr.io/pelski/ytzero:latest
    container_name: ytzero
    ports:
      - "3001:3001"
    volumes:
      - ./data:/data
    restart: unless-stopped
```

```bash
docker compose up -d
```

Open <http://localhost:3001>. The app starts empty — add channels from **Settings → Channels**.

Full instructions (local development, scripts, production-like start) are in **[Installation](https://github.com/Pelski/ytzero/wiki/Installation)**.

## Documentation

Full documentation lives in the **[Wiki](https://github.com/Pelski/ytzero/wiki)**:

- **[Installation](https://github.com/Pelski/ytzero/wiki/Installation)** — Docker, local dev, and scripts.
- **[Configuration](https://github.com/Pelski/ytzero/wiki/Configuration)** — environment variables.
- **[Features](https://github.com/Pelski/ytzero/wiki/Features)** — everything the app does, with screens.
- **[Importing Subscriptions](https://github.com/Pelski/ytzero/wiki/Importing-Subscriptions)** — OPML and Google Takeout.
- **[Profiles](https://github.com/Pelski/ytzero/wiki/Profiles)** — multi-account profiles.
- **[Authentication](https://github.com/Pelski/ytzero/wiki/Authentication)** — login methods and setup.
- **[Child Lock](https://github.com/Pelski/ytzero/wiki/Child-Lock)** — PIN-protecting settings.
- **[Backup & Updates](https://github.com/Pelski/ytzero/wiki/Backup-and-Updates)** — keeping your data safe.
- **[How It Works](https://github.com/Pelski/ytzero/wiki/How-It-Works)** — what is fetched and stored.
- **[Development](https://github.com/Pelski/ytzero/wiki/Development)** — tech stack and repository layout.

## Tech stack

| Layer | Stack |
| --- | --- |
| Backend | Bun, Hono, `bun:sqlite` |
| Frontend | React, Vite, TypeScript |
| Storage | SQLite |
| Runtime | Docker or local Bun |

## Privacy & license

YT Zero does not require a Google account or a YouTube Data API key, and stores app data locally in SQLite. It still connects to YouTube to fetch RSS feeds, metadata, thumbnails, pages, and embedded videos.

YouTube is a trademark of Google LLC. This project is not affiliated with, endorsed by, or associated with YouTube or Google LLC.

Licensed under the **GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`). See [LICENSE](LICENSE). More in **[Privacy & License](https://github.com/Pelski/ytzero/wiki/Privacy-and-License)**.

## Mentions

- **XDA Developers** — [This self-hosted YouTube frontend strips out recommendations and gives you back your feed](https://www.xda-developers.com/self-hosted-youtube-frontend-strips-out-recommendations-gives-back-feed/) (July 2026)

## Thanks

Thanks to [Green-Kite](https://github.com/Green-Kite) for help with the German language support and updating the wiki.
