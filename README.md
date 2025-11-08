# Negare API

## Hardened Auth & Token Platform

The authentication layer now guarantees hop-by-hop security for both CSR and SSR clients. Key traits:

- Username / email / phone login issues an access token (response body) and a refresh token stored **only** in an HttpOnly cookie (default `Path=/api/auth/refresh`, `SameSite` / `Secure` derived from env).
- Refresh tokens rotate on every call: the previous JTI is blacklisted, the new JTI is linked to the same session, and the cookie is reissued.
- Sessions live in Redis with per-user sets, sorted indices, and reverse JTI lookups for revoke/touch flows.
- `/auth/refresh` is marked `@Public()`, enforces JSON requests + allowed Origins, is rate-limited via Redis, and emits trace-aware logs for allow-list hits/misses.
- Logout clears the refresh cookie on the configured path, blacklists the supplied JTI, and tears down the Redis session.
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
  └─ Set-Cookie refresh_token=…; HttpOnly; SameSite (env); Path=/api/auth/refresh

Refresh (cookie only)
  ├─ Controller enforces JSON body, allowed Origin/Referer, and Redis-backed rate-limit
  ├─ RefreshService.refresh(refreshToken)
  │     ├─ validate allow-list + blacklist old jti
  │     ├─ SessionService.unlinkRefreshJti(sub, sid, oldJti)
  │     └─ mint new pair + relink session
  └─ Set-Cookie refresh_token=…; HttpOnly; Path=/api/auth/refresh

Logout
  ├─ RefreshService.peekPayload(refresh, ignoreExp=true)
  ├─ RefreshService.revoke(refresh)
  │     ├─ blacklist jti
  │     └─ unlink session ↔ jti
  ├─ SessionService.revoke(sub, sid)
  └─ Clear refresh cookie on configured path (`COOKIE_REFRESH_PATH`)

## Refresh Endpoint Hardening

- `/api/auth/refresh` is explicitly annotated with `@Public()`, so the HybridAuth guard skips it while the controller performs its own checks.
- Only `POST` requests with `Content-Type: application/json` are accepted; `Origin` and `Referer` must match `FRONTEND_URL`, otherwise the call is rejected with `403 OriginNotAllowed`.
- A Redis-backed rate limiter (`RefreshRateLimitService`) guards brute-force attempts (defaults: `REFRESH_RL_MAX=5` requests per `REFRESH_RL_WINDOW=10s`, keyed by IP + User-Agent).
- Each call consumes the allow-list entry, blacklists the old JTI, relinks the session/JTI pair, and issues a fresh cookie:  
  `Set-Cookie: refresh_token=...; HttpOnly; SameSite=<env>; Secure=<env>; Path=/api/auth/refresh`.
- Missing cookies produce `401 No refresh cookie`; reusing a rotated cookie immediately hits the allow-list miss path (401) and leaves the old JTI blacklisted.
- CORS is pinned to `FRONTEND_URL` with `credentials: true`, and `app.set('trust proxy', 1)` ensures `req.secure` works behind HTTPS terminators.
- Trace-aware logs capture cookie presence, `{ sub, sid, jti }`, allow-list hits/misses, and rotation outcomes to simplify debugging across pods.

### Manual Verification

1. Login → inspect the first `Set-Cookie` header. It must include `HttpOnly`, `Path=/api/auth/refresh`, `SameSite=Lax` in dev (or `None` in prod), and `Secure` only when HTTPS is enabled.
2. `curl -i -X POST http://localhost:4000/api/auth/refresh \`  
   `     -H "Origin: http://localhost:3000" \`  
   `     -H "Content-Type: application/json" \`  
   `     -H "Cookie: refresh_token=<PASTE_TOKEN>"`  
   returns `200` with body `{ "success": true, "data": { "accessToken": "..." } }` plus a brand-new `refresh_token` cookie.
3. Reuse the old cookie after rotation → `401 { code: "InvalidRefresh" }`.
4. Omit the cookie entirely → `401 { code: "MissingRefresh" }`.
5. Spoof the `Origin`/`Referer` or send a non-JSON body → expect `403 OriginNotAllowed` or `400 InvalidContentType`.
```

## SSR vs CSR clients

- **CSR (Next.js client components)** use the access token in memory/`Authorization` headers and delegate refresh/logout to the cookie-aware endpoints above.
- **SSR (Next.js route handlers/pages)** simply forward the browser cookies. No server-side refresh calls are needed; render requests must opt into `cache: 'no-store'`.
- Optional proxy route: expose `/api/auth/refresh` via a Next.js Route Handler that forwards the cookie and propagates the `Set-Cookie` response headers.
- Never place the access token in cookies or `localStorage`; short-lived tokens live in process memory only.

## Environment Quick Start

Core `.env` knobs (see `.env.example`):

- `ACCESS_JWT_SECRET` / `REFRESH_JWT_SECRET` & matching `*_EXPIRES` durations (`10m`, `30d`, etc.).
- `COOKIE_SAMESITE`, `COOKIE_SECURE`, `COOKIE_REFRESH_PATH=/api/auth/refresh`, `COOKIE_ACCESS_PATH=/`.
- `GLOBAL_PREFIX=api`, `FRONTEND_URL=http://localhost:3000` (used for both CORS + Origin enforcement), `CORS_ORIGIN` (legacy fallback), `REDIS_URL=redis://localhost:6379`.
- Refresh throttling knobs: `REFRESH_RL_MAX` (default 5) and `REFRESH_RL_WINDOW` (default 10s).
- Production: set `COOKIE_SECURE=true` and `COOKIE_SAMESITE=none` once the API is served over HTTPS.

## Running & Testing

```bash
npm run start:dev        # local API (http://localhost:4000/api)
npm run test             # unit tests (TokenService, RefreshService, SessionService, AuthController)
npm run test:e2e         # end-to-end auth cookie/token rotation checks
npm run test:cov         # full coverage report (HTML + lcov)
```

All tests assume Redis is available — the suite boots against an in-memory fake Redis used by the services.

Key coverage:

- `apps/api/test/auth/auth.e2e.spec.ts` — legacy login/profile smoke tests.
- `apps/api/test/auth/auth.refresh.e2e.spec.ts` — refresh cookie issuance, allow-list rotation, concurrency failures, malformed Redis entries, session mismatch, cookie-flag assertions for dev/prod, and Origin enforcement.

## Upload Module

The chunked upload pipeline lives under `apps/api/src/core/upload` and now ships with:

- Strict validation for init/chunk/finish flows, MIME sniffing, CDN-safe filenames, and lock-aware state transitions.
- WebSocket progress notifications via `/upload` namespace (`serverUploadProgress`, `uploaded`, `uploadError`).
- Comprehensive unit/integration/e2e coverage (≥90% lines, ≥85% branches) with fakes for storage, Redis, and media persistence.
- Swagger-ready DTOs plus a Postman collection at `postman/UploadModule.postman_collection.json`.

### Local workflow

1. `npm run test:cov` – executes unit + e2e suites and publishes coverage to `coverage/index.html`.
2. Import the Postman collection, set `{{baseUrl}}` (e.g. `http://localhost:4000/api`), and provide `x-user-id` when hitting `/upload/init`.
3. For WebSocket smoke-tests, connect via Socket.IO client to `ws://localhost:4000/upload`, emit `join { uploadId }`, and watch for `serverUploadProgress`/`uploaded` events.

## Docs & Tooling

- Swagger: `http://localhost:4000/api/docs` (`Bearer` + cookie auth enabled).
- Postman collection: `postman/auth.postman_collection.json` (login, refresh, logout, profile) with environment variables `baseUrl`, `GLOBAL_PREFIX`, and `accessToken`.
- Example cURL probes:
  ```bash
  curl -i -X POST http://localhost:4000/api/auth/login \
       -H "Content-Type: application/json" \
       -d '{"identifier":"negare_user","password":"Password!1"}'

  curl -i -X POST http://localhost:4000/api/auth/refresh \
       -H "Origin: http://localhost:3000" \
       -H "Content-Type: application/json" \
       -H "Cookie: refresh_token=<TOKEN>" \
       -d '{}'
  ```

## Production Notes

- Configure your reverse proxy to forward `X-Forwarded-*` headers; Nest is already set to trust proxies in production.
- Serve over HTTPS so `COOKIE_SECURE=true` can be enforced; combine with `SameSite=None` for cross-site SSR fetches.
- Redis keys in play:
  - `auth:refresh:allow:<jti>` – refresh allow-list with TTL = refresh token TTL.
  - `auth:session:*` – session registry, bidirectional jti ↔ sid lookups, and paginated indices.
  - `auth:rbl:<jti>` – refresh blacklist managed by `TokenService`.

Together these changes bring the NestJS API in line with Next.js 15 SSR + CSR expectations while maintaining secure, single-use refresh tokens.





