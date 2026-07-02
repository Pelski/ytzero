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

YT Zero can run as a single-user app on a private network (the default, no
login) or be exposed more broadly using one of the built-in authentication
methods — see [Authentication](https://github.com/pelski/ytzero/wiki/Authentication).
Some things are intentional and **not** considered vulnerabilities:

- **No authentication by default.** With the default **None** method, the app
  has no login and assumes anyone who can reach it is the owner. If you expose
  the app beyond your LAN, activate one of the supported authentication
  methods first (shared login, per-profile login, OIDC, or a trusted
  reverse-proxy header).
- **Trusting the reverse-proxy header method.** The **Proxy header** auth
  method trusts whatever value your reverse proxy sends — it is your
  responsibility to run it behind a proxy that always sets that header and
  strips any client-supplied copy. Header spoofing due to a misconfigured or
  missing proxy is a deployment issue, not an app vulnerability.
- **The `YTZERO_AUTH_DISABLE` escape hatch.** This environment variable forces
  the **None** method for recovery purposes and is documented in
  [Authentication](https://github.com/pelski/ytzero/wiki/Authentication#recovery-anti-lockout).
  Leaving it set in production disables login by design — this is expected
  behavior, not a bug.
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
- Authentication or session bypass in any of the supported login methods
  (Shared, Per-profile, OIDC, Proxy header), including WebAuthn/passkey
  handling and OIDC token/issuer validation.
- Privilege escalation between profiles (e.g. a non-admin profile gaining
  admin powers) or between OIDC-mapped identities.

When in doubt, report it privately and let's discuss.
