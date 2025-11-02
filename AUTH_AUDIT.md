# Auth Flow Audit

## Flow Overview

```mermaid
flowchart TD
    A[Client] -->|POST /api/auth/login| B(AuthController.login)
    B --> C[PasswordService.login]
    C --> D[SessionService.create]
    D --> E[RefreshService.issueTokensForUserId]
    E --> F[Set-Cookie refresh_token<br/>HttpOnly + path /api/auth/refresh]
    F --> G[{JSON accessToken}]
    A -->|POST /api/auth/refresh| H(AuthController.refresh)
    H --> I[RefreshService.peekPayload]
    I --> J[RefreshService.refresh -> redis allowlist]
    J --> K[SessionService.touch via jti]
    K --> L[Set-Cookie rotated refresh_token + accessToken]
    A -->|POST /api/auth/logout| M(AuthController.logout)
    M --> N[Clear refresh_token cookie + RefreshService.revoke + SessionService.revoke]
    A -->|GET /api/core/profile<br/>Bearer access token| O[JwtAuthGuard]
    O --> P[ProfileController.getProfile]
```

## Route Map (GLOBAL_PREFIX = `api`)

- `POST /api/auth/login` → `AuthController.login` — password login, session bootstrap, refresh cookie issued.
- `POST /api/auth/refresh` → `AuthController.refresh` — rotates refresh token, mints new access token, touches session.
- `POST /api/auth/logout` → `AuthController.logout` — clears cookie, revokes refresh token and associated session.
- `GET /api/core/profile` → `ProfileController.getProfile` — JWT-protected profile read.
- `POST /api/auth/otp/*` → `OtpController` — OTP request/resend/verify flows feeding password reset/signup.

`GLOBAL_PREFIX` is applied in `main.ts` and now automatically prefixed onto cookie paths through the config fix.

## Execution Details

1. **Login (`POST /api/auth/login`)**
   - Validates payload (`LoginDto`), throttles per identifier/IP, and authenticates via `PasswordService.login`.
   - Creates a session (`SessionService.create`) capturing IP/user-agent.
   - Calls `RefreshService.issueTokensForUserId` which:
     - Fetches user and roles, signs access/refresh tokens, persists refresh JTI allowlist in Redis, links session⇄JTI.
   - `AuthController.setRefreshCookie` writes `refresh_token` HttpOnly cookie with config-driven attributes before returning `{ accessToken }`.

2. **Refresh (`POST /api/auth/refresh`)**
   - Reads refresh token from cookie (or DTO fallback), `peekPayload` extracts the old JTI.
   - `RefreshService.refresh` verifies token, checks Redis allowlist, rotates tokens, stores new JTI, and removes the old entry.
   - Session JTI lookup/touch keeps the device session active.
   - Responds with new access token and rotates cookie.

3. **Logout (`POST /api/auth/logout`)**
   - Clears refresh cookie immediately.
   - If a token (cookie/body) was provided, `RefreshService.peekPayload` + `revoke` remove JTI allowlist entry and linked session.
   - Idempotent: missing/expired tokens still return `{ success: true }`.

4. **Profile (`GET /api/core/profile`)**
   - `JwtAuthGuard` verifies bearer/cookie access token using the configured secret and populates `request.user`.
   - `ProfileController` fetches profile via `ProfileService`.

5. **OTP**
   - `OtpController` endpoints under `/api/auth/otp/*` coordinate verification tickets that ultimately feed password flows (`PasswordController`).

## Cookie & CORS Audit

| Scenario | Issued From | Path | HttpOnly | SameSite | Secure | Max-Age / Expires |
| --- | --- | --- | --- | --- | --- | --- |
| Login (dev) | `AuthController.login` | `/api/auth/refresh` | ✅ | `lax` | ❌ | `Max-Age=<refresh TTL>` |
| Refresh (dev) | `AuthController.refresh` | `/api/auth/refresh` | ✅ | `lax` | ❌ | `Max-Age=<refresh TTL>` |
| Logout (dev) | `AuthController.logout` | `/api/auth/refresh` | ✅ | `lax` | ❌ | `Expires=Thu, 01 Jan 1970 ...` |
| Login/Refresh (prod) | same as above | `/api/auth/refresh` | ✅ | `none` | ✅ (forced when SameSite=None) | `Max-Age=<refresh TTL>` |

**CORS & Headers**
- `main.ts` enables CORS with `credentials: true` and origin from `CORS_ORIGIN` (`http://localhost:3000` in dev). When multiple origins are configured, Express CORS reflects the requesting origin instead of `*`, satisfying credentialed requests.
- Middleware appends `Vary: Origin, Authorization, Cookie`. Auth endpoints add `Cache-Control: no-store`.
- Production config sets `app.set('trust proxy', 1)` ensuring `req.secure` honors reverse proxies.

## Findings & Fixes

| Issue | Impact | Fix |
| --- | --- | --- |
| `COOKIE_REFRESH_PATH` expected raw `/auth/refresh`, but cookies were scoped to that literal path while endpoints live under `/api/auth/refresh` whenever `GLOBAL_PREFIX` is set. Browsers therefore withheld the refresh cookie on all API calls. | Refresh & logout requests lost the cookie, blocking session rotation and logout. | Updated `auth.config.ts` (`apps/api/src/config/auth.config.ts:18-64`) with `sanitizePrefix` and `applyPrefixIfNeeded` helpers so cookie paths automatically include the global prefix (while preserving `/` when desired). |
| Tests previously executed unrelated suites, obscuring auth regressions. | Hard to validate auth-only fixes quickly. | Added dedicated Jest config (`jest.config.ts`) with `testMatch` restricted to `apps/api/test/auth/**/*.spec.ts`, pruned legacy config from `package.json`, and added focused e2e coverage in `apps/api/test/auth/auth.e2e.spec.ts`. |

**Additional Notes**
- Config already enforces `secure=true` when `SameSite=None`, preventing modern-browser rejections.
- `AuthController` consistently calls `res.cookie`/`res.clearCookie` before JSON responses; no late header mutations detected.
- Logout relies on `Expires` instead of `Max-Age=0`; modern clients honor either attribute.

## Dev vs Prod Matrix

| Env | Protocol | SameSite | Secure | Refresh Cookie Path | Works With |
| --- | --- | --- | --- | --- | --- |
| Dev (`NODE_ENV=development`) | HTTP | `lax` | `false` | `/api/auth/refresh` | Localhost SPA |
| Prod (`NODE_ENV=production`) | HTTPS | `none` | `true` (auto enforced) | `/api/auth/refresh` | Cross-site front-ends |

## CORS Checklist for `http://localhost:3000`

- `CORS_ORIGIN=http://localhost:3000`
- `credentials: true`
- Allow headers: `Content-Type`, `Authorization`, `X-CSRF-Token`
- Allow methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`
- Ensure reverse proxy forwards `Origin` and standard forwarded headers so Nest’s trust proxy configuration remains effective.

## Test Coverage

- Auth-only e2e tests live in `apps/api/test/auth/auth.e2e.spec.ts`, covering login success/failure, cookie attributes, refresh rotation, logout, profile access, and production attribute enforcement.
- Jest now targets only auth suites; run with:
  ```
  npm run test -- --runInBand
  ```
