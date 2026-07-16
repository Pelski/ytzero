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

ENV PORT=3001 \
    IDLE_TIMEOUT_SECONDS=120 \
    DB_PATH=/data/db/ytzero.db \
    IMG_CACHE_DIR=/data/imgcache \
    DOWNLOADS_DIR=/data/downloads \
    YTDLP_AUTO_UPDATE=1 \
    UI_DIST=./public

VOLUME /data
EXPOSE 3001
CMD ["bun", "src/index.ts"]
