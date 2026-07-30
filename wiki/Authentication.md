By default YT Zero uses **no authentication** — it assumes a trusted local network, and [profiles](Profiles) are just named views. If you expose the app beyond your LAN, or want each member of the household to sign in, the **primary profile** can switch the login method under **Settings → Authentication**.

> The **Authentication** tab is owner-only: only the primary profile (the first profile created) can change login configuration or administrator roles. Delegated and OIDC group administrators can manage ordinary admin-only settings, but cannot change the primary profile or its credentials. See [Profiles](Profiles) for what "primary" means.

## Methods at a glance

| Method | Login | Profile switching | Best for |
| --- | --- | --- | --- |
| **None** | none | free | Trusted local network (default) |
| **Shared login + profiles** | one household login | free, after sign-in | A shared device, Netflix/Plex style |
| **Login per profile** | per profile | requires re-login | Separate accounts per person |
| **OIDC** | external provider | depends on mode | SSO with Pocket ID, Authentik, Keycloak, … |
| **Proxy header** | reverse proxy | requires re-login | Authelia / forward-auth setups |

> When any method other than **None** is active, the per-profile 6-digit PINs are not used — the login replaces them. The [Child Lock](Child-Lock) settings PIN is separate and keeps working.

## How to configure

The Authentication tab is a three-step wizard:

1. **Choose a method** — pick one of the cards. The currently active method is marked.
2. **Configure** — fill in the credentials / provider details for the selected method. Use **Save** to store them without switching yet.
3. **Activate** — apply the method. The app reloads and the new login takes effect immediately.

The wizard refuses to activate a method until its prerequisites are met (for example, a shared password or passkey must exist before activating **Shared**), so you cannot accidentally lock yourself out in one click. If you still do, see [Recovery](#recovery-anti-lockout).

> **Exactly one method is active at a time, and there is no fallback between methods.** Whatever you activate is the *only* way in — if it stops working (OIDC provider unreachable, proxy header no longer arriving, forgotten shared/per-profile credentials, a lost passkey), the app does **not** silently fall back to **None** or to any previously configured method. You are locked out until you recover. The only way back in is the environment-variable escape hatch below: set it, restart, fix the configuration in **Settings → Authentication**, then remove it and restart. Plan for this before exposing the app publicly.

---

## None

No login. Anyone who can reach the app picks a profile, exactly as before. This is the default.

---

## Shared login + profiles

One household login guards the app; once signed in, you can switch freely between all profiles (like choosing a profile on a shared streaming account).

1. Select **Shared login + profiles**.
2. Set a **password** (and optionally a username).
3. Optionally click **Add passkey** to register a passkey for password-less sign-in.
4. **Activate**.

After activation everyone signs in with the shared credentials, then uses the profile menu to switch profiles without signing in again.

---

## Login per profile

Each profile has its own credentials. Switching profile means signing out and signing back in as the other profile.

1. Select **Login per profile**.
2. Generate credentials for the primary profile and save the one-time temporary password.
3. Generate credentials separately for every other profile that needs to sign in.
4. **Activate**.

Usernames are derived from profile names: spaces become `_`, unsupported
characters are removed, and case-insensitive collisions receive a numeric
suffix. Generating credentials again immediately invalidates the previous
password. Temporary passwords are shown once and stored only as hashes.

After signing in, a profile changes only its own password under **Settings →
Profiles** and must provide the current password. A newly created profile
receives one-time temporary credentials in the creation result while this login
method is active. Passkeys can be added by each profile from its own session.

In the profile menu, choosing a different profile prompts you to sign out first.

---

## OIDC

Sign in through an external OpenID Connect provider such as **Pocket ID**, **Authentik**, **Keycloak**, or **Authelia (OIDC)**.

1. Select **OIDC** and fill in:
   - **Issuer URL** — the provider's full issuer. Pocket ID and Keycloak usually use the root or a realm URL (`https://id.example.com`), while **Authentik uses a per-application path with a trailing slash**: `https://id.example.com/application/o/<slug>/`. If discovery returns 404, the issuer is wrong — copy the "OpenID Configuration Issuer" from your provider and use **Test connection** to verify.
   - **Client ID** and **Client secret**
   - **Scopes** — defaults to `openid profile email`
   - **Redirect URI** — shown read-only; copy it into your provider's allowed redirect URIs. It is `<your app URL>/api/auth/oidc/callback`. Set [`APP_URL`](Configuration) if the app is behind a reverse proxy so this URL is correct.
2. Click **Test connection** to verify the issuer's discovery document is reachable.
3. Choose a **mapping mode** (below).
4. **Activate**.

### Mapping modes

- **Identity → one profile (mapped)** — each external identity maps to exactly one profile. Profile switching is disabled (you sign out to change profile). Choose the **identity claim** (default `preferred_username`) and, in the profile table, enter the claim value that maps to each profile. Optionally enable **auto-create a profile on first login** to create a profile automatically for unknown identities.
- **Gateway → profile picker** — OIDC only guards the front door. After signing in, everyone sees the profile picker and can switch freely (similar to **Shared**).

For active profile-bound methods (**Login per profile**, **OIDC**, and **Proxy header**), an administrator can hide other profile names from the profile picker. The signed-in profile remains visible, and administrators can still manage every profile in Settings. This instance-local authentication preference is not included in portable backups.

### Delegated profile administrators

While a profile-bound login is active (**Login per profile**, **OIDC mapped mode**, or **Proxy header**), the primary profile can grant administrator access to another non-child profile in **Settings → Profiles**. Delegated administrators can manage shared settings, other non-primary profiles, and child restrictions. They cannot:

- grant or revoke administrator access,
- edit, delete, or demote the primary profile,
- change the primary profile's credentials,
- open or change Authentication settings.

The grant is checked on every request, so revoking it takes effect immediately. It is instance-local security policy and is excluded from portable backups. Delegation is unavailable for **None**, **Shared**, and OIDC **Gateway** because those methods do not securely bind the current request to one profile.

Set an optional **Logout URL** to send users to your provider's logout endpoint when they sign out.

### Group-based admin

By default only the **primary profile** has admin powers. With OIDC you can additionally grant ordinary administrator powers to identities based on a group claim from your provider:

- **Groups claim** — the claim in the ID token / userinfo that lists the user's groups (default `groups`).
- **Admin group** — the group name that grants admin. Leave it **empty to disable** group-based admin entirely. When set, any signed-in identity whose groups claim contains this value can manage admin-only app settings and non-primary profiles.

This works in both mapping modes. Group administrators cannot change authentication configuration, administrator grants, or the primary profile. The primary profile always keeps owner powers regardless of groups, so local recovery still works.

### Troubleshooting

- **`unsupported operation` in the logs after a successful token exchange** — the provider signed the ID token with **HS256** (HMAC), which isn't accepted. In **Authentik** this happens when the provider has **no Signing Key** selected; set it to an RSA/EC certificate (e.g. "authentik Self-signed Certificate") so the ID token uses RS256.
- **`404` on `/.well-known/openid-configuration`** — wrong **Issuer URL**; for Authentik use `https://<host>/application/o/<slug>/` (trailing slash).
- **"Invalid redirect URI"** — add the wizard's **Redirect URI** verbatim to the provider, and set `APP_URL` to your public `https://` URL so the callback isn't generated as `http://`.
- **`no profile mapped to this identity`** (mapped mode) — the identity claim value doesn't match any profile's mapped value; fix the claim or the mapping, or enable auto-create.

---

## Proxy header

A trusted reverse proxy (e.g. **Authelia** with forward-auth) authenticates the user and passes their username in a request header. YT Zero matches that value to a profile.

1. Select **Proxy header**.
2. Set the **header name** your proxy sends (e.g. `Remote-User`, `X-authentik-username`). The name is configurable — nothing is hard-coded.
3. The page shows the **currently received value** of that header so you can confirm your proxy is sending it.
4. In the profile table, enter the header value that maps to each profile.
5. Optionally set a **logout / redirect URL** (e.g. your Authelia logout endpoint).
6. **Activate**.

Profile switching is disabled internally — the profile menu offers a sign-out that redirects to the configured logout URL.

> **Important:** only enable this behind a proxy that *always* sets the header and strips any client-supplied copy. Without a trusted proxy, anyone could send the header themselves.

---

## Passkeys

Passkeys (WebAuthn) are supported for the **Shared** and **Login per profile** methods, alongside or instead of passwords.

- The WebAuthn Relying Party ID and origin are derived from the request host. Behind a reverse proxy, set [`APP_URL`](Configuration) (and `WEBAUTHN_RP_ID` if needed) so registration and login validate against the correct domain.
- Passkeys require a secure context (HTTPS, or `localhost`).

---

## Recovery (anti-lockout)

Because there is **no fallback between methods** (see the note above), a broken or forgotten login means you are locked out — the app will not revert to **None** on its own. The single recovery path is the `YTZERO_AUTH_DISABLE` environment variable, which requires access to the deployment (Docker Compose file, systemd unit, shell, etc.).

Step by step:

1. **Set the variable** in the environment and **restart** the container/process:

   ```text
   YTZERO_AUTH_DISABLE=1
   ```

   This forces the **None** method for as long as the variable is set, regardless of the saved setting. Nothing in the database is changed — the saved method is only overridden at runtime.
2. **Sign in** as the primary profile (or any profile — None has no login) and open **Settings → Authentication**.
3. **Correct the configuration** — fix the OIDC issuer, re-enter credentials, adjust the proxy header, re-add a passkey, or switch to a different method. Save/Activate as needed.
4. **Remove** `YTZERO_AUTH_DISABLE` (or set it to anything other than `1`) and **restart** again so the saved method takes effect.

> Keep the ability to edit environment variables and restart the deployment available to whoever administers YT Zero — it is the only way back in. If you run behind a reverse proxy that itself enforces auth, make sure that layer can't also permanently block the recovery login.

See [`YTZERO_AUTH_DISABLE`](Configuration) in the configuration reference.
