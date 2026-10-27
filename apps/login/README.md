# @ds/login — the sign-in host

`login.doctor.school` (ADR-0015 §4, feature spec 003 EARS-60..71): the first-party login UI both storefronts' OIDC clients use. Zitadel Login V2 sends the browser to `<IDP_SIGN_IN_BASE_URI>/login?authRequest=<id>`; this app renders the originating storefront's own `@ds/auth-flow` door for that auth request and hands the finished sign-in back to Zitadel.

Next.js 16 App Router, standalone output, port **3005** in dev (`pnpm dev:ports`: API + 5). Out of scope here and owned by #3171: the Caddy vhost, compose service, stage slot, prod deploy and the release digest key.

## How a navigation is answered

1. **`proxy.ts`** (Next 16 proxy) sees every request except `/v1/*` and `/_next/*`.
   - A request that is not a top-level navigation (`Sec-Fetch-Mode: navigate` + `Sec-Fetch-Dest: document`) gets a bare **403**: no API call, no cookie (EARS-70, ADR-0015 §4 req. 2(a)). Next's client-router fetches fall under this and Next falls back to a full navigation.
   - `/healthz` (`app/healthz/route.ts`) is the one exception: the image liveness probe (runtime-images smoke, stand healthcheck) answers any request with `200 ok`, no auth state, no API call, no cookie, with the same hardening headers.
   - A navigation asks the API's entry (`GET /v1/sign-in-host/entry?authRequest=`, `lib/sign-in-entry.ts`) with the browser's `cookie`, `user-agent`, `accept-language`, `x-forwarded-for`, `origin`, `sec-fetch-site`. A `redirect` answer is a **303** to the API's URL (Zitadel callback, a stale request's storefront, EARS-66; a direct visit or an unknown path, EARS-67). The app holds **no client map and no storefront URL**: the API is the single source.
   - A `render` answer reaches the page in the `x-ds-sign-in-entry` request header (`SIGN_IN_HOST_ENTRY_HEADER`), which the proxy always overwrites, so a browser-sent value never reaches a page. The API's `Set-Cookie` rides the proxy's response unchanged (the page cannot set cookies).
   - When the Zitadel arrival on `/login` opens another door (the entry's choice, `doorFor`), the proxy **rewrites** to that door's own page with the same query, so the tab carries the storefront's title for that door (003 EARS-71); the address settles on the door's path client-side (`SettleDoorPath`).
2. **The door pages** (`app/{login,register,reset,verify}/page.tsx`) are thin mounts of `@ds/auth-flow`'s `SignInHostRoute` over `lib/sign-in-host.host-config.ts` (the two storefront configs from `@ds/auth-flow/hosts`). The route re-validates the hand-over, picks the storefront config by the entry's `storefront`, projects it onto the host transport (`signInHostConfig`: every command under `/v1/sign-in-host`, each post carrying `authRequest` + `csrf`) and mounts that storefront's own door route. The door's params come only from the entry intent (EARS-71): the browser's query is dropped.
3. On success the API answers `{status:"redirect", url}` and the auth-flow client navigates top-level to it.

## Hardening (EARS-70, ADR-0015 §4 req. 2(a)/3/4)

- **Strict nonce CSP** — net-new in this repository. The proxy mints a 128-bit nonce per request and sets `script-src 'nonce-…' 'strict-dynamic'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'` (plus SmartCaptcha's origins — smartcaptcha.cloud.yandex.ru, the one `@yandex/smart-captcha` loads from, and its yandexcloud.net alias — for `connect-src` / `frame-src`) on the response **and on the forwarded request**: Next reads the nonce from the request's `Content-Security-Policy` header and stamps it on every script it renders, and `'strict-dynamic'` lets those load their chunks. Hence the layout carries no inline script (no theme guard) and every page renders dynamically. `'unsafe-eval'` is added only under `next dev`.
- Every answer: `Cross-Origin-Opener-Policy: same-origin`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, no `Access-Control-*`. `/v1/*` and `/_next/*` get a `default-src 'none'` policy and the same headers from `next.config.ts`.
- Cookies are the API's (`__Host-ds_login`, `__Host-ds_login_form`: `Path=/`, `Secure`, `HttpOnly`, `SameSite=Lax`, no `Domain`), set through the same-origin `/v1` rewrite; `proxy.test.ts` pins that they pass through byte for byte.

## Commands

| command                               | what                                                                  |
| ------------------------------------- | --------------------------------------------------------------------- |
| `pnpm --filter @ds/login dev`         | dev server on 3005 (`API_PROXY_TARGET` = the stand's api)             |
| `pnpm --filter @ds/login test`        | unit tests (proxy gate, door pages)                                   |
| `pnpm --filter @ds/login test:e2e:ci` | CI axe tier against the built app and an entry double (`e2e/support`) |
| `pnpm ci:standalone-boot login`       | boots the standalone server the image ships                           |

Env: `.env.example` (`API_PROXY_TARGET`, `SMARTCAPTCHA_SITE_KEY` — runtime env, read per request).
