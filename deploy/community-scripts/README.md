# Proxmox VE Helper-Scripts submission

`scripts/proxmox-lxc.sh` in this repository is self-contained and needs nothing
from anyone else. This directory is about the *other* Proxmox path: getting YT
Zero listed at [community-scripts.github.io/ProxmoxVE](https://community-scripts.github.io/ProxmoxVE/),
which is where most Proxmox users look first.

Those scripts do not live here. New submissions currently start in the
[community-scripts/ProxmoxVED](https://github.com/community-scripts/ProxmoxVED)
development repository and move to
[community-scripts/ProxmoxVE](https://github.com/community-scripts/ProxmoxVE)
after review. The files below are drafts to adapt in a fork of the development
repository.

## What upstream expects

- **Native installs, no Docker.** Their reviewers reject Docker-in-LXC
  submissions. YT Zero qualifies: `scripts/install.sh` is a native Bun +
  systemd install.
- **Two script files**, using their shared helper libraries, which our drafts
  source rather than reimplement:
  - `ct/ytzero.sh` — the entry point users run on the host.
  - `install/ytzero-install.sh` — runs inside the freshly created LXC.
- **An `update_script` function** in `ct/ytzero.sh`, so their menu can update an
  existing install in place.
- `frontend/public/json/ytzero.json` in this directory is retained as a metadata
  reference for the website listing. It is not one of the two required script
  files; enter or reshape the metadata according to the submission system in
  use when the PR is prepared.
- Read their current
  [CONTRIBUTING.md](https://github.com/community-scripts/ProxmoxVE/blob/main/CONTRIBUTING.md)
  before opening the PR — the conventions move, and these drafts will drift.

## Before submitting

1. **Cut a release first.** Both this repo's installer and the upstream draft
   download `ytzero-vX.Y.Z.tar.gz` from the GitHub release. Until a tag ships
   that asset (see `.github/workflows/release.yml`), every install fails at the
   download step.
2. Test `scripts/proxmox-lxc.sh` on a real Proxmox host.
3. Fork `community-scripts/ProxmoxVED`, copy the two script drafts in, adjust to
   whatever their helpers look like at that moment, and test from the fork.
4. Open the PR. Expect review comments about their coding standard.

Upstream keeps the copyright header format, the `APP`/`var_*` block, and the
`header_info` call — they are not decoration, their tooling parses them.
