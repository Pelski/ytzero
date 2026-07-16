#!/usr/bin/env bash
# YT Zero — native installer for Debian/Ubuntu (LXC, VM or bare metal).
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/Pelski/ytzero/main/scripts/install.sh)"
#
# Re-running the script updates an existing install: the release is replaced,
# /opt/ytzero/data and /etc/ytzero/ytzero.env are left alone.
#
# Knobs (environment):
#   YTZERO_VERSION   release tag to install, e.g. v0.5.1 (default: latest)
#   YTZERO_PORT      port to listen on (default: 3001)
#   YTZERO_DIR       install directory (default: /opt/ytzero)
#   YTZERO_DATA      data directory (default: $YTZERO_DIR/data)
set -euo pipefail

REPO="Pelski/ytzero"
APP_DIR="${YTZERO_DIR:-/opt/ytzero}"
DATA_DIR="${YTZERO_DATA:-${APP_DIR}/data}"
PORT="${YTZERO_PORT:-3001}"
ENV_FILE="/etc/ytzero/ytzero.env"
SERVICE_USER="ytzero"
BUN_DIR="/opt/bun"

msg() { echo -e "\e[1;34m==>\e[0m $*"; }
warn() { echo -e "\e[1;33m warn\e[0m $*" >&2; }
die() { echo -e "\e[1;31merror\e[0m $*" >&2; exit 1; }

# ---------- preflight ----------

[[ ${EUID} -eq 0 ]] || die "Run as root."
command -v apt-get >/dev/null || die "This installer targets Debian/Ubuntu (apt-get not found)."
[[ -d /run/systemd/system ]] || die "systemd is required (this is not a systemd system)."
[[ "${PORT}" =~ ^[0-9]+$ ]] && ((PORT >= 1 && PORT <= 65535)) \
  || die "YTZERO_PORT must be a number between 1 and 65535."
[[ "${APP_DIR}" != *[[:space:]]* ]] || die "YTZERO_DIR cannot contain whitespace."
[[ "${DATA_DIR}" != *[[:space:]]* ]] || die "YTZERO_DATA cannot contain whitespace."

case "$(uname -m)" in
  x86_64 | aarch64) ;;
  *) die "Unsupported architecture: $(uname -m). Bun ships x86_64 and aarch64 builds only." ;;
esac

# ---------- packages ----------

msg "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# unzip is needed by Bun's installer; python3 and ffmpeg by the yt-dlp plugin.
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl unzip python3 ffmpeg tar >/dev/null

# ---------- bun ----------

if [[ ! -x "${BUN_DIR}/bin/bun" ]]; then
  msg "Installing Bun to ${BUN_DIR}"
  # Bun's installer picks the baseline build itself on CPUs without AVX2,
  # which is what older homelab hardware needs.
  BUN_INSTALL="${BUN_DIR}" bash -c "$(curl -fsSL https://bun.sh/install)" >/dev/null
fi
ln -sf "${BUN_DIR}/bin/bun" /usr/local/bin/bun

if ! bun --version >/dev/null 2>&1; then
  die "Bun was installed but will not run on this CPU. Check the host CPU flags (a baseline build is selected automatically when AVX2 is missing)."
fi
msg "Bun $(bun --version)"

# ---------- service user ----------

if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  msg "Creating system user ${SERVICE_USER}"
  useradd --system --home-dir "${APP_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

mkdir -p \
  "${APP_DIR}" \
  "${APP_DIR}/bin" \
  "${DATA_DIR}/db" \
  "${DATA_DIR}/imgcache" \
  "${DATA_DIR}/downloads" \
  "${DATA_DIR}/avatars" \
  "${DATA_DIR}/logs" \
  "$(dirname "${ENV_FILE}")"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}"

# ---------- yt-dlp ----------

# Kept inside APP_DIR and owned by the service user: `yt-dlp -U` rewrites its own
# binary, and the unit mounts /usr read-only, so /usr/local/bin would break
# auto-update for the optional downloads plugin.
msg "Installing yt-dlp"
curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o "${APP_DIR}/bin/yt-dlp"
chmod 0755 "${APP_DIR}/bin/yt-dlp"

# ---------- resolve release ----------

VERSION="${YTZERO_VERSION:-}"
if [[ -z "${VERSION}" ]]; then
  msg "Resolving latest release"
  RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")" \
    || die "Could not query the latest release from the GitHub API."
  if [[ "${RELEASE_JSON}" =~ \"tag_name\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
    VERSION="${BASH_REMATCH[1]}"
  else
    die "Could not resolve the latest release tag from the GitHub API."
  fi
fi
[[ "${VERSION}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([._+-][0-9A-Za-z.-]+)?$ ]] \
  || die "Invalid YTZERO_VERSION '${VERSION}'. Expected a tag such as v0.5.1."
msg "Installing YT Zero ${VERSION}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

TARBALL="ytzero-${VERSION}.tar.gz"
BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"
curl -fsSL "${BASE_URL}/${TARBALL}" -o "${TMP_DIR}/${TARBALL}" \
  || die "Release asset ${TARBALL} not found. Check that ${VERSION} exists and ships a tarball."
if curl -fsSL "${BASE_URL}/${TARBALL}.sha256" -o "${TMP_DIR}/${TARBALL}.sha256" 2>/dev/null; then
  (cd "${TMP_DIR}" && sha256sum -c "${TARBALL}.sha256" >/dev/null) || die "Checksum mismatch on ${TARBALL}."
  msg "Checksum verified"
else
  warn "No .sha256 published for ${VERSION}; skipping checksum verification."
fi

mkdir -p "${TMP_DIR}/unpack"
tar -xzf "${TMP_DIR}/${TARBALL}" -C "${TMP_DIR}/unpack" --strip-components=1
for required in src public package.json bun.lock VERSION; do
  [[ -e "${TMP_DIR}/unpack/${required}" ]] \
    || die "Release asset ${TARBALL} is incomplete: missing ${required}."
done

# ---------- install files ----------

systemctl stop ytzero 2>/dev/null || true

# Replaced wholesale so files dropped between releases do not linger. Everything
# stateful lives in DATA_DIR and the env file, both untouched here.
rm -rf "${APP_DIR}/src" "${APP_DIR}/public"
cp -r "${TMP_DIR}/unpack/src" "${APP_DIR}/src"
cp -r "${TMP_DIR}/unpack/public" "${APP_DIR}/public"
cp "${TMP_DIR}/unpack/package.json" "${TMP_DIR}/unpack/bun.lock" "${TMP_DIR}/unpack/VERSION" "${APP_DIR}/"

msg "Installing dependencies"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}"
runuser -u "${SERVICE_USER}" -- env HOME="${APP_DIR}" \
  bun install --cwd "${APP_DIR}" --production --frozen-lockfile >/dev/null

# ---------- config ----------

if [[ ! -f "${ENV_FILE}" ]]; then
  msg "Writing ${ENV_FILE}"
  cat > "${ENV_FILE}" <<EOF
# YT Zero configuration. Full reference:
# https://github.com/Pelski/ytzero/wiki/Configuration
# Applies on: systemctl restart ytzero
PORT=${PORT}
UI_DIST=./public
# Every path is set explicitly: unset ones default to a directory next to the
# source tree (../../data), which is outside ReadWritePaths here.
DB_PATH=${DATA_DIR}/db/ytzero.db
IMG_CACHE_DIR=${DATA_DIR}/imgcache
DOWNLOADS_DIR=${DATA_DIR}/downloads
AVATAR_DIR=${DATA_DIR}/avatars
LOG_PATH=${DATA_DIR}/logs/ytzero.log
YTDLP_PATH=${APP_DIR}/bin/yt-dlp
YTDLP_AUTO_UPDATE=1
IDLE_TIMEOUT_SECONDS=120
REFRESH_INTERVAL_MINUTES=5
VIDEO_MAINTENANCE_MAX_AGE_DAYS=90
EOF
  chmod 0640 "${ENV_FILE}"
  chown root:"${SERVICE_USER}" "${ENV_FILE}"
else
  msg "Keeping existing ${ENV_FILE}"
fi

# YTZERO_VERSION is what /api/health reports; refreshed on every update.
sed -i '/^YTZERO_VERSION=/d' "${ENV_FILE}"
echo "YTZERO_VERSION=${VERSION}" >> "${ENV_FILE}"

# An update keeps the existing env file, including a custom PORT. Probe the
# port the service will actually use rather than the install-time default.
HEALTH_PORT="$(sed -n 's/^PORT=//p' "${ENV_FILE}" | tail -n 1)"
HEALTH_PORT="${HEALTH_PORT:-${PORT}}"
[[ "${HEALTH_PORT}" =~ ^[0-9]+$ ]] && ((HEALTH_PORT >= 1 && HEALTH_PORT <= 65535)) \
  || die "PORT in ${ENV_FILE} must be a number between 1 and 65535."

# ---------- service ----------

msg "Writing systemd unit"
cat > /etc/systemd/system/ytzero.service <<EOF
[Unit]
Description=YT Zero
Documentation=https://github.com/${REPO}/wiki
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
Environment=HOME=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${BUN_DIR}/bin/bun src/index.ts
Restart=on-failure
RestartSec=5

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ProtectControlGroups=true
ProtectKernelTunables=true
# The database, caches, downloads, and the self-updating yt-dlp binary.
ReadWritePaths=${DATA_DIR} ${APP_DIR}/bin

[Install]
WantedBy=multi-user.target
EOF

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}"
systemctl daemon-reload
systemctl enable -q --now ytzero

# ---------- wait for health ----------

msg "Waiting for the app to come up"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${HEALTH_PORT}/api/health" >/dev/null 2>&1; then
    IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    echo
    msg "YT Zero ${VERSION} is running at http://${IP:-localhost}:${HEALTH_PORT}"
    echo "    config:  ${ENV_FILE}"
    echo "    data:    ${DATA_DIR}"
    echo "    logs:    journalctl -u ytzero -f"
    echo "    update:  re-run this script"
    exit 0
  fi
  sleep 2
done

die "The service did not become healthy within 60s. Inspect: journalctl -u ytzero -n 50"
