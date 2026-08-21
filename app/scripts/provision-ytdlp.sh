#!/bin/sh
# Keep yt-dlp self-updates on the persistent /data volume. The image copy is
# only a bootstrap binary for a brand-new volume; do not replace an operator's
# custom YTDLP_PATH or an existing managed binary.
set -eu

managed_path="${YTDLP_MANAGED_PATH:-/data/bin/yt-dlp}"
bootstrap_path="${YTDLP_BOOTSTRAP_PATH:-/usr/local/bin/yt-dlp}"
pending_marker="${YTDLP_PROVISION_MARKER:-/data/bin/.yt-dlp-channel-reconciliation-pending}"

if [ "${YTDLP_PATH:-${managed_path}}" = "${managed_path}" ] && [ ! -e "${managed_path}" ]; then
  mkdir -p "$(dirname "${managed_path}")"
  cp "${bootstrap_path}" "${managed_path}"
  chmod 0755 "${managed_path}"
  : > "${pending_marker}"
fi

exec "$@"
