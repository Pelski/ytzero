#!/usr/bin/env bash
# Copyright (c) 2021-2026 community-scripts ORG
# Author: Pelski
# License: MIT | https://github.com/community-scripts/ProxmoxVE/raw/main/LICENSE
# Source: https://github.com/Pelski/ytzero

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

msg_info "Installing Dependencies"
$STD apt-get install -y \
  ca-certificates \
  curl \
  unzip \
  python3 \
  ffmpeg
msg_ok "Installed Dependencies"

msg_info "Installing YT Zero"
# Bun, yt-dlp, the release tarball, the ytzero system user and the systemd unit
# all come from the project's own installer, so a container built here and one
# built by scripts/install.sh stay identical.
$STD bash -c "$(curl -fsSL https://raw.githubusercontent.com/Pelski/ytzero/main/scripts/install.sh)"
msg_ok "Installed YT Zero"

motd_ssh
customize

msg_info "Cleaning up"
$STD apt-get -y autoremove
$STD apt-get -y autoclean
msg_ok "Cleaned"
