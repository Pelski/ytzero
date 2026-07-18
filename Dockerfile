# ---- build UI ----
FROM oven/bun:1.3 AS ui-build
WORKDIR /ui
COPY ui/package.json ui/bun.lock* ./
RUN bun install
COPY ui/ .
RUN bun run build

# ---- runtime ----
FROM oven/bun:1.3-slim
WORKDIR /app
RUN apt-get update && \
    apt-get upgrade -y --no-install-recommends && \
    apt-get install -y --no-install-recommends python3 ffmpeg curl ca-certificates && \
    curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    apt-get purge -y curl && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*
COPY app/package.json app/bun.lock* ./
RUN bun install --production
COPY app/src ./src
COPY --from=ui-build /ui/dist ./public

ARG YTZERO_VERSION=dev
ARG YTZERO_COMMIT=unknown
ENV PORT=3001 \
    IDLE_TIMEOUT_SECONDS=120 \
    DB_PATH=/data/db/ytzero.db \
    IMG_CACHE_DIR=/data/imgcache \
    DOWNLOADS_DIR=/data/downloads \
    AVATAR_DIR=/data/avatars \
    LOG_PATH=/data/logs/ytzero.log \
    YTDLP_AUTO_UPDATE=1 \
    UI_DIST=./public \
    YTZERO_VERSION=${YTZERO_VERSION} \
    YTZERO_COMMIT=${YTZERO_COMMIT}

VOLUME /data
EXPOSE 3001

# curl is purged above to keep the image small, so probe with the Bun that is
# already here. Exits non-zero on a non-2xx status or a refused connection.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD bun -e 'const r = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3001}/api/health`); process.exit(r.ok ? 0 : 1)'

CMD ["bun", "src/index.ts"]
