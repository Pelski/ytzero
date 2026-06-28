# Security Policy

YT Zero is a personal, self-hosted project maintained in spare time.
Security reports are taken seriously, but please set expectations accordingly:
there is no SLA, and fixes ship on a best-effort basis.

## Supported versions

Only the latest code on `main` (and the matching `ghcr.io/pelski/ytzero:latest`
image) is supported. There are no backports to older tags — please update to
the latest version before reporting an issue.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's
[private vulnerability reporting](https://github.com/pelski/ytzero/security/advisories/new):

1. Go to the repository's **Security** tab → **Report a vulnerability**.
2. Describe the issue, the impact, and clear steps to reproduce.
3. Include affected version/commit and any relevant configuration.

You can expect an initial acknowledgement within a reasonable time. Once a fix
is available, the advisory will be published and credit given to the reporter
unless you prefer to stay anonymous.

## Scope and threat model

YT Zero is designed to be run by a single user on their own machine or private
network. Some things are intentional and **not** considered vulnerabilities:

- **No authentication / authorization.** The app has no login and assumes the
  person who can reach it is the owner. Do not expose it directly to the public
  internet — put it behind your own auth (reverse proxy, VPN, etc.).
- **Outbound connections to YouTube and SponsorBlock.** The app fetches RSS
  feeds, metadata, thumbnails, pages, embedded videos, and (optionally)
  SponsorBlock segments. This is expected behaviour.
- **Local data storage.** App data lives unencrypted in a local SQLite database
  and an on-disk image cache under `./data`.

Things that **are** in scope and worth reporting:

- Remote code execution, SSRF, or path traversal in the backend.
- Cross-site scripting (XSS) or injection reachable through normal use.
- Leaking local data or making requests to unintended hosts.
- Vulnerabilities in how external/untrusted content (feeds, page data) is
  parsed or rendered.

When in doubt, report it privately and let's discuss.
