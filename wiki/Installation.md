Run YT Zero with Docker (recommended) or locally with Bun.

## Requirements

### Docker

- Docker
- Docker Compose

### Local

- Bun 1.3 or newer

## Docker

Use the published GHCR image:

```yaml
services:
  ytzero:
    image: ghcr.io/pelski/ytzero:latest
    container_name: ytzero
    ports:
      - "3001:3001"
    volumes:
      - ./data:/data
    environment:
      - IDLE_TIMEOUT_SECONDS=120
      - REFRESH_INTERVAL_MINUTES=5
      - VIDEO_MAINTENANCE_MAX_AGE_DAYS=90
      - DB_PATH=/data/db/ytzero.db
      - IMG_CACHE_DIR=/data/imgcache
    restart: unless-stopped
```

Start it:

```bash
docker compose up -d
```

Or build locally from the repository:

```bash
docker compose -f docker-compose.dev.yml up --build -d
```

Open <http://localhost:3001>. Data is stored under `./data`.

See [Configuration](Configuration) for all environment variables.

## Local development

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

## Local production-like start

```bash
bun run start
```

This builds `ui/dist` if needed and starts the backend serving the built frontend at <http://localhost:3001>.

## Scripts

| Command | Description |
| --- | --- |
| `bun run setup` | Install backend and frontend dependencies. |
| `bun run dev` | Start backend watcher and Vite dev server. |
| `bun run dev:app` | Start only the backend watcher. |
| `bun run dev:ui` | Start only the Vite dev server. |
| `bun run build` | Build the frontend. |
| `bun run start` | Serve the production frontend through the backend. |

## First run

After the first start you get a local YouTube subscriptions app at <http://localhost:3001>.

The initial app is intentionally empty: no Google login, no imported account data, and no recommendations. From **Settings → Channels** you add channels manually or import an OPML / Google Takeout subscriptions file (see [Importing Subscriptions](Importing-Subscriptions)). Once channels are added, YT Zero starts filling a local SQLite database with their public RSS videos and background metadata.
