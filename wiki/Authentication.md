By default YT Zero uses **no authentication** — it assumes a trusted local network, and [profiles](Profiles) are just named views. If you expose the app beyond your LAN, or want each member of the household to sign in, the **primary profile** can switch the login method under **Settings → Authentication**.

> The **Authentication** tab is only visible to the primary profile (the first profile created). See [Profiles](Profiles) for what "primary" means.

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
2. In the profile table, give each profile a **username** and **password**.
   - At minimum, the primary profile must have a username **and** password before you can activate.
   - Passkeys can be added by each profile from their own session after activation.
3. **Activate**.

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

Set an optional **Logout URL** to send users to your provider's logout endpoint when they sign out.

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

If a misconfiguration locks you out (for example an OIDC provider that stops responding, or a proxy header that no longer arrives), set the environment variable and restart:

```text
YTZERO_AUTH_DISABLE=1
```

This forces the **None** method regardless of the saved setting. Sign in to the primary profile, fix the configuration on the **Authentication** tab, then remove the variable and restart.

See [`YTZERO_AUTH_DISABLE`](Configuration) in the configuration reference.
