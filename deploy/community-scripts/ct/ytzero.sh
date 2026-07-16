#!/usr/bin/env bash
source <(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/misc/build.func)
# Copyright (c) 2021-2026 community-scripts ORG
# Author: Pelski
# License: MIT | https://github.com/community-scripts/ProxmoxVE/raw/main/LICENSE
# Source: https://github.com/Pelski/ytzero

APP="YT Zero"
var_tags="${var_tags:-media;youtube}"
var_cpu="${var_cpu:-2}"
var_ram="${var_ram:-2048}"
var_disk="${var_disk:-8}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_unprivileged="${var_unprivileged:-1}"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources

  if [[ ! -d /opt/ytzero ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi

  RELEASE_JSON=$(curl -fsSL https://api.github.com/repos/Pelski/ytzero/releases/latest) || {
    msg_error "Could not query the latest ${APP} release"
    exit 1
  }
  if [[ "${RELEASE_JSON}" =~ \"tag_name\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
    RELEASE="${BASH_REMATCH[1]}"
  else
    msg_error "Could not resolve the latest ${APP} release"
    exit 1
  fi
  if [[ "${RELEASE}" == "$(cat /opt/ytzero/VERSION 2>/dev/null)" ]]; then
    msg_ok "No update required. ${APP} is already at ${RELEASE}"
    exit
  fi

  msg_info "Updating ${APP} to ${RELEASE}"
  # The upstream installer is idempotent: it swaps the release, reruns
  # dependencies and restarts the unit, leaving /opt/ytzero/data and
  # /etc/ytzero/ytzero.env alone.
  YTZERO_VERSION="${RELEASE}" bash -c "$(curl -fsSL https://raw.githubusercontent.com/Pelski/ytzero/main/scripts/install.sh)" &>/dev/null
  msg_ok "Updated ${APP} to ${RELEASE}"

  exit
}

start
build_container
description

msg_ok "Completed Successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW} Access it using the following URL:${CL}"
echo -e "${TAB}${GATEWAY}${BGN}http://${IP}:3001${CL}"
