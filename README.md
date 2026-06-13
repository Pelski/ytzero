# YouTube Zero

![YouTube Zero Today view](docs/assets/youtube-zero-today.png)

| Settings: Channels | Settings: Display |
| --- | --- |
| <img src="docs/assets/youtube-zero-settings-channels.png" alt="YouTube Zero Settings channels view" width="360"> | <img src="docs/assets/youtube-zero-settings-display.png" alt="YouTube Zero Settings display view" width="360"> |

> A self-hosted YouTube subscriptions reader with no Google account, no API key, and no recommendation algorithm.

YouTube Zero is a small web app for watching channels you already care about. It reads public YouTube RSS feeds, stores videos locally in SQLite, and gives you a quiet inbox for filtering, scheduling, watching, archiving, and organizing videos.

## Table of Contents

- [Why](#why)
- [Features](#features)
- [Screens](#screens)
- [Tech Stack](#tech-stack)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Scripts](#scripts)
- [Importing Subscriptions](#importing-subscriptions)
- [Child Lock and Kids](#child-lock-and-kids)
- [Configuration](#configuration)
- [Data, Backup, and Updates](#data-backup-and-updates)
- [How It Works](#how-it-works)
- [Repository Layout](#repository-layout)
- [Development Notes](#development-notes)
- [Privacy](#privacy)
- [Trademark Notice](#trademark-notice)
- [Limitations](#limitations)
- [License](#license)

## Why

YouTube is useful. The default YouTube experience is not always useful.

YouTube Zero keeps the parts that matter:

- your subscriptions
- your own watch queue
- your own tags and playlists
- an embedded player
- local history and progress

And leaves out:

- Google sign-in
- API keys
- recommendations
- Shorts-first navigation
- algorithmic home feeds

## Features

- **Subscription inbox** - all new videos from followed channels in one feed.
- **Channel import** - add channels manually, import OPML, or import `subscriptions.csv` from Google Takeout.
- **Live and upcoming streams** - dedicated live view with automatic status refresh.
- **Watch later buckets** - schedule videos for Morning, Evening, Tomorrow, or Weekend.
- **Archive flow** - reject videos, restore them later, and keep the main feed clean.
- **Watch history and progress** - record watched videos and resume partially watched videos.
- **Tags** - tag videos and channels; channel tags are inherited by their videos.
- **Automatic tag rules** - apply tags by matching title or description text.
- **Filter rules** - automatically reject matching videos, or keep only matching videos for selected channels.
- **User playlists** - create local playlists, choose icons, add videos manually, and populate playlists with rules.
- **Child lock** - protect settings with a 6-digit PIN so channel, filter, tag, playlist, and display configuration cannot be changed without unlocking.
- **Channel pages** - browse regular videos, Shorts, public playlists, channel metadata, and channel-specific tags.
- **Theather view** - distraction-light player layout for watching.
- **Internationalization** - English and Polish UI, with saved user preference.
- **Player preferences** - captions, player language, caption language, preferred quality, and Shorts visibility.
- **SponsorBlock** - optional integration with [SponsorBlock](https://sponsor.ajay.app) to automatically skip sponsored segments, intros, outros, interaction reminders, and more. Configurable per category.
- **Image cache** - local thumbnail and image cache for faster repeat loads.

## Screens

The app is designed around a few primary workflows:

- **Today** - the main inbox for fresh videos.
- **Live** - currently live and upcoming streams.
- **Scheduled** - videos saved into time-based buckets.
- **History** - watched videos.
- **Rejected** - archived videos.
- **Settings** - channels, tags, rules, playlists, display, language, and player preferences.

## Tech Stack

| Layer | Stack |
| --- | --- |
| Backend | Bun, Hono, `bun:sqlite` |
| Frontend | React, Vite, TypeScript |
| Storage | SQLite |
| Runtime | Docker or local Bun |

## Requirements

Use either Docker or a local Bun installation.

### Docker

- Docker
- Docker Compose

### Local

- Bun 1.3 or newer

## Quick Start

### Docker

```bash
docker compose up --build -d
```

Open:

```text
http://localhost:3001
```

Data is stored under:

```text
./data
```

### Local Development

Install dependencies:

```bash
bun run setup
```

Start backend and frontend:

```bash
bun run dev
```

Development URLs:

```text
UI:  http://localhost:5173
API: http://localhost:3001
```

### Local Production-like Start

```bash
bun run start
```

This builds `ui/dist` if needed and starts the backend serving the built frontend at:

```text
http://localhost:3001
```

## Scripts

| Command | Description |
| --- | --- |
| `bun run setup` | Install backend and frontend dependencies. |
| `bun run dev` | Start backend watcher and Vite dev server. |
| `bun run dev:app` | Start only the backend watcher. |
| `bun run dev:ui` | Start only the Vite dev server. |
| `bun run build` | Build the frontend. |
| `bun run start` | Serve the production frontend through the backend. |

## Importing Subscriptions

You can add channels in **Settings -> Channels**.

Supported inputs:

- A YouTube channel URL, for example `https://www.youtube.com/@handle`
- A channel ID URL, for example `https://www.youtube.com/channel/UC...`
- OPML files from tools such as NewPipe, FreeTube, or Invidious
- Google Takeout `subscriptions.csv`

To export subscriptions from Google Takeout:

1. Go to [takeout.google.com](https://takeout.google.com).
2. Select only **YouTube and YouTube Music**.
3. Include subscriptions.
4. Download the archive.
5. Import `subscriptions.csv` in YouTube Zero settings.

## Child Lock and Kids

You can enable **Child lock** in **Settings -> Child** and set a 6-digit PIN. When it is enabled, settings changes are locked until the PIN is entered.

This can be useful for children when you want YouTube access to be limited to selected channels only. You still need to manage the setup yourself: add only the channels you want available, keep filters and followed channels configured correctly, and make sure the app is the YouTube surface the child actually uses.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | HTTP server port. |
| `DB_PATH` | `./data/db/ytzero.db` | SQLite database path. |
| `IMG_CACHE_DIR` | `./data/imgcache` | Thumbnail and image cache directory. |
| `REFRESH_INTERVAL_MINUTES` | `15` | RSS and live-status refresh interval. |
| `UI_DIST` | `./public` | Built frontend directory served by the backend. |

Docker Compose sets:

```yaml
DB_PATH=/data/db/ytzero.db
IMG_CACHE_DIR=/data/imgcache
REFRESH_INTERVAL_MINUTES=15
```

and mounts:

```text
./data:/data
```

## Data, Backup, and Updates

All persistent Docker data lives in `./data`.

To back up a Docker install, stop the container and copy the data directory:

```bash
docker compose down
cp -R data data.backup
docker compose up -d
```

To update a Docker install after pulling new code:

```bash
docker compose up --build -d
```

For local installs, the default database and image cache are under:

```text
data/db/ytzero.db
data/imgcache
```

## How It Works

YouTube Zero uses public YouTube surfaces:

- Videos are fetched from official RSS feeds:

```text
https://www.youtube.com/feeds/videos.xml?channel_id=UC...
```

- Channel IDs can be resolved from common YouTube URLs and handles.
- Live and upcoming stream status is detected from channel live pages.
- Video duration, Shorts detection, view counts, likes, channel metadata, avatars, and public playlists are refreshed in the background where available.

Everything user-specific lives locally in SQLite:

- followed channels
- videos and statuses
- queue buckets
- tags and rules
- filter rules
- playlists and playlist rules
- watch history and progress
- display and player settings
- language preference

## Repository Layout

```text
.
├── app/                 # Bun + Hono backend
│   └── src/
│       ├── db.ts        # SQLite schema, migrations, settings
│       ├── routes.ts    # API routes
│       ├── refresher.ts # RSS/live/background refresh work
│       └── youtube.ts   # YouTube parsing and fetch helpers
├── ui/                  # React + Vite frontend
│   └── src/
│       ├── pages/       # App screens
│       ├── components/  # Shared UI components
│       ├── api.ts       # API client and shared types
│       └── i18n.tsx     # English/Polish UI text
├── scripts/             # setup/dev/build/start helpers
├── data/                # Local runtime data, usually gitignored
├── Dockerfile
└── docker-compose.yml
```

## Development Notes

Run type and build checks from the frontend package:

```bash
cd ui
bunx tsc --noEmit
bun run build
```

The backend is TypeScript executed by Bun. In development, it runs with:

```bash
cd app
bun run dev
```

## Privacy

YouTube Zero does not require a Google account or a YouTube Data API key. It stores app data locally in SQLite. The app still connects to YouTube to fetch RSS feeds, metadata, thumbnails, pages, and embedded videos.

## Trademark Notice

YouTube is a trademark of Google LLC. This project is not affiliated with, endorsed by, sponsored by, or otherwise associated with YouTube or Google LLC.

## Limitations

- RSS feeds expose only a limited recent set of videos per channel.
- YouTube page structure can change, which may affect metadata, live detection, Shorts detection, or playlist parsing.
- Embedded playback is still YouTube playback and follows YouTube embed behavior.
- This is a personal/self-hosted tool, not a multi-user service.

## Acknowledgements

- **[SponsorBlock](https://sponsor.ajay.app)** — community-driven database of skippable segments in YouTube videos (sponsors, intros, outros, and more). YouTube Zero optionally queries the SponsorBlock API to automatically skip segments while watching. SponsorBlock is an open-source project by [Ajay Ramachandran](https://github.com/ajayyy) — thank you to everyone who contributes segments to the database. Ajay is doing an amazing job and the project is well worth supporting — you can do so at [sponsor.ajay.app/donate](https://sponsor.ajay.app/donate).

## License

This project is licensed under the **GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`).

See [LICENSE](LICENSE) for the full license text.
