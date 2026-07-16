#!/usr/bin/env bash
# YT Zero — create a Debian LXC on a Proxmox VE host and install YT Zero in it.
# Run this ON THE PROXMOX HOST (not inside a container):
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/Pelski/ytzero/main/scripts/proxmox-lxc.sh)"
#
# The container is unprivileged and gets a DHCP address on vmbr0. YT Zero is
# installed natively (Bun + systemd, no Docker) by scripts/install.sh.
#
# Knobs (environment):
#   CTID        container id (default: next free id)
#   CT_HOSTNAME container hostname (default: ytzero)
#   DISK_GB     root disk size in GB (default: 8)
#   CORES       cpu cores (default: 2)
#   RAM_MB      memory in MB (default: 2048)
#   BRIDGE      network bridge (default: vmbr0)
#   STORAGE     container storage (default: local-lvm)
#   TEMPLATE_STORAGE  storage holding the template (default: local)
#   YTZERO_VERSION    release tag to install (default: latest)
set -euo pipefail

REPO="Pelski/ytzero"
# Not HOSTNAME: bash sets that to the PVE node's own name, so the container
# would inherit it instead of defaulting to "ytzero".
CT_HOSTNAME="${CT_HOSTNAME:-ytzero}"
DISK_GB="${DISK_GB:-8}"
CORES="${CORES:-2}"
RAM_MB="${RAM_MB:-2048}"
BRIDGE="${BRIDGE:-vmbr0}"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
OS_TEMPLATE="debian-13-standard"

msg() { echo -e "\e[1;34m==>\e[0m $*"; }
die() { echo -e "\e[1;31merror\e[0m $*" >&2; exit 1; }

# ---------- preflight ----------

[[ ${EUID} -eq 0 ]] || die "Run as root on the Proxmox host."
command -v pct >/dev/null || die "pct not found — run this on a Proxmox VE host, not inside a container."

for value_name in DISK_GB CORES RAM_MB; do
  value="${!value_name}"
  [[ "${value}" =~ ^[1-9][0-9]*$ ]] || die "${value_name} must be a positive integer."
done
[[ "${CT_HOSTNAME}" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$ ]] \
  || die "CT_HOSTNAME must be a valid hostname (letters, digits and hyphens)."
[[ -n "${BRIDGE}" && "${BRIDGE}" != *[[:space:]]* ]] || die "BRIDGE must be a non-empty bridge name."
[[ -n "${STORAGE}" && "${STORAGE}" != *[[:space:]]* ]] || die "STORAGE must be a non-empty storage id."
[[ -n "${TEMPLATE_STORAGE}" && "${TEMPLATE_STORAGE}" != *[[:space:]]* ]] || die "TEMPLATE_STORAGE must be a non-empty storage id."
if [[ -n "${YTZERO_VERSION:-}" ]]; then
  [[ "${YTZERO_VERSION}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([._+-][0-9A-Za-z.-]+)?$ ]] \
    || die "Invalid YTZERO_VERSION '${YTZERO_VERSION}'. Expected a tag such as v0.5.1."
fi

CTID="${CTID:-$(pvesh get /cluster/nextid)}"
[[ "${CTID}" =~ ^[1-9][0-9]*$ ]] || die "CTID must be a positive integer."
pct status "${CTID}" >/dev/null 2>&1 && die "Container ${CTID} already exists. Set CTID to a free id."

# ---------- template ----------

msg "Looking for a ${OS_TEMPLATE} template"
TEMPLATE="$(pveam list "${TEMPLATE_STORAGE}" 2>/dev/null | awk '{print $1}' | grep -m1 "${OS_TEMPLATE}" || true)"
if [[ -z "${TEMPLATE}" ]]; then
  msg "Downloading the template (this takes a minute)"
  pveam update >/dev/null
  AVAILABLE="$(pveam available --section system | awk '{print $2}' | grep -m1 "${OS_TEMPLATE}")" \
    || die "No ${OS_TEMPLATE} template available from pveam."
  pveam download "${TEMPLATE_STORAGE}" "${AVAILABLE}"
  TEMPLATE="${TEMPLATE_STORAGE}:vztmpl/${AVAILABLE}"
fi
msg "Template: ${TEMPLATE}"

# ---------- create ----------

msg "Creating unprivileged LXC ${CTID} (${CORES} cores, ${RAM_MB} MB RAM, ${DISK_GB} GB disk)"
pct create "${CTID}" "${TEMPLATE}" \
  --hostname "${CT_HOSTNAME}" \
  --cores "${CORES}" \
  --memory "${RAM_MB}" \
  --swap 512 \
  --rootfs "${STORAGE}:${DISK_GB}" \
  --net0 "name=eth0,bridge=${BRIDGE},ip=dhcp" \
  --unprivileged 1 \
  --onboot 1 \
  --description "YT Zero — https://github.com/${REPO}" \
  >/dev/null

msg "Starting the container"
pct start "${CTID}"

# The installer needs working DNS and a default route; give the container a
# moment to finish DHCP before curl runs inside it.
NETWORK_READY=0
for _ in $(seq 1 30); do
  if pct exec "${CTID}" -- getent hosts github.com >/dev/null 2>&1; then
    NETWORK_READY=1
    break
  fi
  sleep 2
done
((NETWORK_READY == 1)) \
  || die "LXC ${CTID} started, but it has no working DNS/network after 60s. Check DHCP and bridge ${BRIDGE}, then retry inside the container."

# ---------- install ----------

msg "Installing YT Zero inside the container"
pct exec "${CTID}" -- bash -c "\
  apt-get update -qq && \
  apt-get install -y -qq --no-install-recommends curl ca-certificates >/dev/null && \
  YTZERO_VERSION='${YTZERO_VERSION:-}' bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/${REPO}/main/scripts/install.sh)\""

IP="$(pct exec "${CTID}" -- hostname -I 2>/dev/null | awk '{print $1}')"
IP="${IP:-<container-ip>}"

echo
msg "Done. YT Zero is running in LXC ${CTID} at http://${IP}:3001"
echo "    shell:   pct enter ${CTID}"
echo "    logs:    pct exec ${CTID} -- journalctl -u ytzero -f"
echo "    update:  pct exec ${CTID} -- bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/${REPO}/main/scripts/install.sh)\""
