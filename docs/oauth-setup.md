# Google / Social OAuth — setup & troubleshooting

How Aumrti's social login works, and the exact config steps for the two things that
trip people up: **redirect URLs** (functional) and the **consent-screen brand name**
(cosmetic). None of this requires code changes — the app already does the right thing.

## How the flow works

- The web client ([src/integrations/supabase/client.ts](../src/integrations/supabase/client.ts))
  calls `supabase.auth.signInWithOAuth({ provider, options: { redirectTo: `${window.location.origin}/auth/callback` } })`
  ([src/pages/login/LoginPage.tsx](../src/pages/login/LoginPage.tsx)).
- So the app always asks Supabase to return to the **origin it was opened from**
  (`http://localhost:8080/auth/callback` in dev, `https://aumrti.netlify.app/auth/callback` in prod).
- Supabase only honours that `redirectTo` **if it is in the Redirect URLs allowlist**.
  Otherwise it silently falls back to the **Site URL**.
- The callback is handled by [src/pages/auth/AuthCallbackPage.tsx](../src/pages/auth/AuthCallbackPage.tsx),
  which calls the `resolve_oauth_login` RPC to route the user (platform admin / hospital staff / rejected).
- Google provider credentials are stored in `public.oauth_provider_settings` and pushed into
  the project's GoTrue config by the `update-oauth-providers` edge function (needs the
  `MANAGEMENT_API_PAT` function secret).

Active project ref: `pdxvisvmnzjhsgmvygku` (`https://pdxvisvmnzjhsgmvygku.supabase.co`).

## 1. Redirect URL configuration (the functional fix)

**Symptom:** after Google login the browser lands on `localhost:8080/#access_token=…`
(or `…/?error=bad_oauth_state`) and shows **"This site can't be reached / ERR_CONNECTION_REFUSED"**,
even when signing in from the deployed Netlify site.

**Cause:** Site URL is `http://localhost:8080` and the production URL is **not** in the
Redirect URLs allowlist, so Supabase ignores the app's `redirectTo` and bounces the token
to localhost.

**Fix — Supabase Dashboard → Authentication → URL Configuration:**

- **Site URL:** `https://aumrti.netlify.app`  *(the safe production fallback)*
- **Redirect URLs** (add all that apply):
  - `https://aumrti.netlify.app/**`
  - `http://localhost:8080/**`   *(local dev)*
  - `https://<your-custom-domain>/**`   *(when you have one)*
- Save, then retry sign-in.

With these allowlisted, login works from **both** localhost and the deployed site, landing
back on whichever origin it started from.

> Local dev only: the Vite dev server must actually be running (`npm run dev`, port 8080)
> for the return leg to succeed.

## 2. Consent-screen brand name (cosmetic)

**Symptom:** the Google screen says **"Sign in to pdxvisvmnzjhsgmvygku.supabase.co"** instead
of "Aumrti".

**Cause:** Google shows the OAuth client's **App name** / redirect domain. The brand name on
the Google **OAuth consent screen** isn't set, so it shows the Supabase domain.

**Quick win — Google Cloud Console → APIs & Services → OAuth consent screen → Edit**
(in the project that owns the OAuth Client ID):

- **App name:** `Aumrti`
- **App logo:** upload the Aumrti logo
- **User support email** + **Developer contact email**
- Save → Google then shows "Sign in to **Aumrti**" with the logo.

**Full clean version (removes `*.supabase.co` entirely):** use a custom auth domain.

1. Own a domain (e.g. `aumrti.com`) — Google will not verify a free `*.netlify.app` subdomain.
2. Supabase → Project Settings → **Custom Domains** (Pro plan) → set e.g. `auth.aumrti.com`.
   The OAuth callback becomes `https://auth.aumrti.com/auth/v1/callback`.
3. In the Google OAuth **client**, update the Authorized redirect URI to that callback, and add
   `aumrti.com` under **Authorized domains** on the consent screen.
4. **Publish** the consent screen (Testing → Production) and complete Google verification
   (needs the owned domain + privacy/terms URLs).

## Notes
- The Google Cloud side is already working (consent appears, token is issued) — don't change the
  OAuth **client ID/secret** when only fixing redirect URLs or branding.
- Branding is cosmetic and independent of whether login succeeds.
- Provider keys can be managed in-app (Platform UI → `oauth_provider_settings`), which then calls
  `update-oauth-providers` to sync them into the project auth config.
