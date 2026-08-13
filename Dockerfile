ARG YTZERO_VERSION=dev
ARG YTZERO_COMMIT=unknown

# ---- build UI ----
FROM oven/bun:1.3 AS ui-build
ARG YTZERO_VERSION
ARG YTZERO_COMMIT
ARG YTZERO_CHANGELOG_PREGENERATED=0
ENV YTZERO_VERSION=${YTZERO_VERSION} \
    YTZERO_COMMIT=${YTZERO_COMMIT}
WORKDIR /ui
COPY ui/package.json ui/bun.lock* ./
RUN bun install
COPY ui/ .
RUN if [ "${YTZERO_CHANGELOG_PREGENERATED}" = "1" ]; then bun run build:prepared; else bun run build; fi

# ---- runtime ----
FROM oven/bun:1.3-slim
ARG DENO_VERSION=2.8.1
WORKDIR /app
RUN apt-get update && \
    apt-get upgrade -y --no-install-recommends && \
    apt-get install -y --no-install-recommends python3 ffmpeg curl ca-certificates unzip && \
    curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    curl -fsSL https://deno.land/install.sh -o /tmp/install-deno.sh && \
    DENO_INSTALL=/usr/local sh /tmp/install-deno.sh "v${DENO_VERSION}" && \
    deno --version && \
    rm /tmp/install-deno.sh && \
    apt-get purge -y curl unzip && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*
COPY app/package.json app/bun.lock* ./
RUN bun install --production
COPY app/src ./src
COPY --from=ui-build /ui/dist ./public

ARG YTZERO_VERSION
ARG YTZERO_COMMIT
ENV PORT=3001 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    IDLE_TIMEOUT_SECONDS=120 \
    DB_PATH=/data/db/ytzero.db \
    IMG_CACHE_DIR=/data/imgcache \
    IMG_CACHE_TTL_DAYS=7 \
    DOWNLOADS_DIR=/data/downloads \
    DENO_DIR=/data/deno-cache \
    DOWNLOAD_COOKIES_DIR=/data/download-cookies \
    RESTORE_SESSION_DIR=/data/restore-sessions \
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
