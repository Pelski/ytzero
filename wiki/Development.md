## Tech stack

| Layer | Stack |
| --- | --- |
| Backend | Bun, Hono, `bun:sqlite` |
| Frontend | React, Vite, TypeScript |
| Storage | SQLite |
| Runtime | Docker or local Bun |

## Repository layout

```text
.
├── app/                 # Bun + Hono backend
│   └── src/
│       ├── db.ts        # SQLite schema, migrations, settings
│       ├── routes.ts    # API routes
│       ├── auth.ts      # Authentication (sessions, WebAuthn, OIDC, proxy)
│       ├── refresher.ts # RSS/live/background refresh work
│       └── youtube.ts   # YouTube parsing and fetch helpers
├── ui/                  # React + Vite frontend
│   └── src/
│       ├── pages/       # App screens
│       ├── components/  # Shared UI components
│       ├── api.ts       # API client and shared types
│       └── i18n/        # Per-language UI text (en, pl, de)
├── scripts/             # setup/dev/build/start helpers
├── wiki/                # Source for the GitHub Wiki
├── data/                # Local runtime data, usually gitignored
├── Dockerfile
├── docker-compose.yml      # Run with the published GHCR image
└── docker-compose.dev.yml  # Build locally from source
```

## Workflow

Install everything and run both servers:

```bash
bun run setup
bun run dev
```

Type and build checks for the frontend:

```bash
cd ui
bunx tsc --noEmit
bun run build
```

The backend is TypeScript executed by Bun. In development it runs with:

```bash
cd app
bun run dev
```

## Video thumbnail and link regression checklist

Video links are rendered in several independent UI surfaces. Whenever thumbnail behavior, video-card overlays, or navigation to `/watch/:id` changes, check all of them:

- shared `VideoCard` grids (`FeedPage`, Discovery, channels, playlists, liked, history, archive and live views),
- YouTube search results in `FeedPage`,
- **More like this** and playlist items in `WatchPage`,
- scheduled items in `WatchlistPage`,
- temporary/external videos in Settings → Advanced,
- the latest-video thumbnail beside subscriptions in the sidebar (`App.tsx`).

Every static video destination must be a real `<Link>` or `<a href>` rather than a clickable `div`, image, or `navigate()` handler. Verify right-click, middle-click, and Ctrl/Cmd+click. Overlay containers such as `VideoCard` thumbnail actions must use `pointer-events: none` outside their visible, interactive controls so they do not create invisible dead zones over the underlying link.
