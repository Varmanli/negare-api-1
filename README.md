# Negare API

## Hardened Auth & Token Platform

The authentication layer now guarantees hop-by-hop security for both CSR and SSR clients. Key traits:

- Username / email / phone login issues an access token (response body) and a refresh token stored **only** in an HttpOnly cookie (`Path=/`).
- Refresh tokens rotate on every call: the previous JTI is blacklisted, the new JTI is linked to the same session, and the cookie is reissued.
- Sessions live in Redis with per-user sets, sorted indices, and reverse JTI lookups for revoke/touch flows.
- Logout clears refresh cookies for every known path (`/`, `/api`, `/api/auth`), blacklists the supplied JTI, and tears down the Redis session.
- Swagger exposes both `Bearer` and cookie auth schemes; the Postman collection mirrors the same behaviour for local testing.

## Login → Refresh → Logout (happy path)

```text
Login (identifier + password)
  ├─ PasswordService.login → userId
  ├─ SessionService.create(userId, ip, userAgent) → sid
  ├─ RefreshService.issueTokensForUserId(userId, { sessionId: sid })
  │     ├─ TokenService.signAccess + signRefresh (HS256)
  │     ├─ Redis allow-list key auth:refresh:allow:<jti>
  │     └─ SessionService.linkRefreshJti(userId, sid, jti)
  └─ Set-Cookie refresh_token=…; HttpOnly; SameSite=Lax; Path=/

Refresh (cookie only)
  ├─ RefreshService.peekPayload(cookie) → { sub, sid, jti }
  ├─ RefreshService.refresh(refreshToken)
  │     ├─ validate allow-list + blacklist old jti
  │     ├─ SessionService.unlinkRefreshJti(sub, sid, oldJti)
  │     └─ mint new pair + relink session
  ├─ SessionService.touch(sub, sid)
  └─ Set-Cookie refresh_token=…; HttpOnly; Path=/

Logout
  ├─ RefreshService.peekPayload(refresh, ignoreExp=true)
  ├─ RefreshService.revoke(refresh)
  │     ├─ blacklist jti
  │     └─ unlink session ↔ jti
  ├─ SessionService.revoke(sub, sid)
  └─ Clear refresh cookie on /api/auth, /api, /
```

## SSR vs CSR clients

- **CSR (Next.js client components)** use the access token in memory/`Authorization` headers and delegate refresh/logout to the cookie-aware endpoints above.
- **SSR (Next.js route handlers/pages)** simply forward the browser cookies. No server-side refresh calls are needed; render requests must opt into `cache: 'no-store'`.
- Optional proxy route: expose `/api/auth/refresh` via a Next.js Route Handler that forwards the cookie and propagates the `Set-Cookie` response headers.
- Never place the access token in cookies or `localStorage`; short-lived tokens live in process memory only.

## Environment Quick Start

Core `.env` knobs (see `.env.example`):

- `ACCESS_JWT_SECRET` / `REFRESH_JWT_SECRET` & matching `*_EXPIRES` durations (`10m`, `30d`, etc.).
- `COOKIE_SAMESITE`, `COOKIE_SECURE`, `COOKIE_REFRESH_PATH=/`, `COOKIE_ACCESS_PATH=/`.
- `GLOBAL_PREFIX=api`, `CORS_ORIGIN=http://localhost:3000`, `REDIS_URL=redis://localhost:6379`.
- Production: set `COOKIE_SECURE=true` and `COOKIE_SAMESITE=none` once the API is served over HTTPS.

## Running & Testing

```bash
npm run start:dev        # local API (http://localhost:4000/api)
npm run test             # unit tests (TokenService, RefreshService, SessionService, AuthController)
npm run test:e2e         # end-to-end auth cookie/token rotation checks
```

All tests assume Redis is available — the suite boots against an in-memory fake Redis used by the services.

## Docs & Tooling

- Swagger: `http://localhost:4000/api/docs` (`Bearer` + cookie auth enabled).
- Postman collection: `postman/auth.postman_collection.json` (login, refresh, logout, profile) with environment variables `baseUrl`, `GLOBAL_PREFIX`, and `accessToken`.
- Example cURL probes:
  ```bash
  curl -i -X POST http://localhost:4000/api/auth/login \
       -H "Content-Type: application/json" \
       -d '{"identifier":"negare_user","password":"Password!1"}'

  curl -i -X POST http://localhost:4000/api/auth/refresh \
       -H "Cookie: refresh_token=<TOKEN>"
  ```

## Production Notes

- Configure your reverse proxy to forward `X-Forwarded-*` headers; Nest is already set to trust proxies in production.
- Serve over HTTPS so `COOKIE_SECURE=true` can be enforced; combine with `SameSite=None` for cross-site SSR fetches.
- Redis keys in play:
  - `auth:refresh:allow:<jti>` – refresh allow-list with TTL = refresh token TTL.
  - `auth:session:*` – session registry, bidirectional jti ↔ sid lookups, and paginated indices.
  - `auth:rbl:<jti>` – refresh blacklist managed by `TokenService`.

Together these changes bring the NestJS API in line with Next.js 15 SSR + CSR expectations while maintaining secure, single-use refresh tokens.





