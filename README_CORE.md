# README_CORE

## Overview
- Core authentication delivers OTP onboarding, password login, refresh-token rotation, and logout safeguards.
- User, Role, and UserRole modules store RBAC state and expose admin endpoints guarded by metadata and runtime checks.
- Profile module allows authenticated users to read/update their own profile while keeping email/phone changes inside the OTP pipeline.
- Guards (HybridAuthGuard, JwtAuthGuard, RolesGuard) plus decorators (CurrentUser, Roles) coordinate authentication and authorization across controllers.

## End-to-End Flow (OTP -> Set Password -> Login -> Refresh -> Logout -> Profile)
1. **Request OTP** � POST /auth/otp/request
   - Body: { "channel": "sms" | "email", "phone" | "email": "..." }
   - Response: { "success": true, "expiresIn": 120 } (seconds until expiry).
2. **Verify OTP** � POST /auth/otp/verify
   - Supply the same channel + identifier and the numeric code.
   - Response: { "success": true, "token": "<set_password_jwt>" }.
3. **Set Password** � POST /auth/password/set
   - Header: Authorization: Bearer <set_password_jwt>.
   - Body: { "password": "P@ssw0rd!" }.
   - Response: { "success": true, "accessToken": "...", "refreshToken": "..." }.
4. **Login** � POST /auth/login
   - Body: { "identifier": "user@example.com", "password": "P@ssw0rd!" } (email or phone).
   - Response: same token payload as step 3.
5. **Refresh** � POST /auth/refresh
   - Body: { "refreshToken": "..." }.
   - Redis revokes the prior JTI; response returns a rotated pair.
6. **Logout** � POST /auth/logout
   - Body: { "refreshToken": "..." }; response { "success": true } once the token is removed.
7. **Profile** � GET /core/profile and PATCH /core/profile
   - Require Authorization: Bearer <accessToken>.
   - Responses are wrapped by TransformResponseInterceptor as { "success": true, "data": { ... } } when the service returns plain objects.

## Roles & Guards
- **HybridAuthGuard** (global APP_GUARD)
  - Production: only accepts Authorization Bearer access JWTs.
  - Development/testing: when MOCK_AUTH_ENABLED=true, allows x-mock-user JSON header ({"id":"<uuid>","roles":["admin"]}) so E2E tests and local tools can authenticate without real tokens.
- **JwtAuthGuard**
  - Verifies access tokens, attaches { id, roles[] } to 
equest.user, and throws 401 on signature/claim issues.
- **RolesGuard**
  - Reads required roles from the @Roles(...) decorator and returns 403 when the current user lacks at least one of them.
- **Decorators**
  - @CurrentUser() injects the 
equest.user payload.
  - @Roles(...roles) annotates handlers with the roles enforced by RolesGuard.
- **User/UserRole services** ensure owner-or-admin checks when guards alone are insufficient (e.g., user profile lookup, wallet routes).

## Configuration & Secrets (names only)
| Variable | Purpose |
| --- | --- |
| ACCESS_JWT_SECRET, ACCESS_JWT_EXPIRES | Sign and expire access tokens.|
| REFRESH_JWT_SECRET, REFRESH_JWT_EXPIRES | Sign/expire refresh tokens.|
| SET_PWD_JWT_SECRET, SET_PWD_JWT_EXPIRES | JWT minted after OTP verification for password/set.|
| OTP_TTL_SECONDS, OTP_REQUEST_WINDOW/MAX, OTP_VERIFY_WINDOW/MAX | OTP lifetime and rate-limiting windows.|
| KAVENEGAR_API_KEY, KAVENEGAR_TEMPLATE | SMS delivery configuration.|
| SMTP_HOST/PORT/USER/PASS, MAIL_FROM | Email OTP + welcome messages.|
| REDIS_HOST/PORT or REDIS_URL | Redis connection for rate limits and JTI storage.|
| MOCK_AUTH_ENABLED, NODE_ENV | Configure hybrid auth fallback behaviour.|
| DATABASE_URL | Postgres connection string for TypeORM.|
| WALLET_WEBHOOK_SECRET, WALLET_TX_* | Wallet module throttling/webhook (referenced but not documented here).|

**Production guidance:** manage these secrets with a dedicated secret manager (AWS/GCP/Azure/Vault), enforce rotation schedules, keep .env files out of version control, and limit runtime IAM permissions to the minimum required.

## Quick Test & Postman Checklist
1. Install dependencies if needed (
pm install) and compile (
pm run build).
2. Start runtime stack: docker compose up -d api (Postgres, Redis, Nest API).
3. Import postman/Negare-Core-API.postman_collection.json into Postman.
4. Run the **Auth** folder in order (Request OTP -> Verify -> Set Password -> Login -> Refresh -> Logout). The login/refresh requests store {{accessToken}} and {{refreshToken}} variables automatically in the Tests tab.
5. Use the populated tokens to call **Profile** (GET/PATCH) and **Roles** folders; each request already includes Bearer {{accessToken}}.
6. Optional regression: docker compose exec api npm run typeorm -- migration:show then 
pm run test:e2e to execute automated coverage.

## Route Summary (Auth/User/Roles/Profile)
### Auth
| Method | Path | Description |
| --- | --- | --- |
| POST | /auth/otp/request | Request OTP for email or SMS identifier.|
| POST | /auth/otp/verify | Validate OTP and receive the set-password JWT.|
| POST | /auth/password/set | Exchange the OTP JWT for access/refresh tokens by setting a password.|
| POST | /auth/login | Authenticate with stored credentials.|
| POST | /auth/refresh | Rotate tokens using the refresh token.|
| POST | /auth/logout | Revoke refresh tokens (idempotent).|

### Profile
| Method | Path | Notes |
| --- | --- | --- |
| GET | /core/profile | Returns profile data for the authenticated principal. Example below.|
| PATCH | /core/profile | Updates 
ame, io, city, vatarUrl. Email/phone changes are rejected with guidance to use the OTP flow.|

`json
{
  "success": true,
  "data": {
    "id": "c1d5f0bc-6f46-4ae4-9b28-2d7574156d1b",
    "username": "negare_user",
    "email": "user@example.com",
    "phone": "09121234567",
    "bio": null,
    "city": "Tehran",
    "avatarUrl": null
  }
}
`

### Users, Roles & Assignments (Admin only unless noted)
| Method | Path | Description |
| --- | --- | --- |
| GET/POST/PATCH | /core/users | List, create, and update users (@Roles(admin)).|
| GET | /core/users/:id | Owner or admin can view a specific user (controller enforces owner check).|
| GET/POST/PATCH | /core/roles | Manage role catalog (@Roles(admin)).|
| GET/POST/DELETE | /core/user-roles | List, assign, and remove user-role mappings (@Roles(admin)).|

## Current Status
- SMS/Email OTP issuance, verification, and single-use JWT minting are implemented with Redis-backed rate limits.
- Password onboarding reuses RefreshService, keeping token issuance logic centralized for OTP and login flows.
- Access JWTs include role arrays; guards and controllers rely on UsersService hydration to enforce RBAC.
- Swagger and Postman cover every Core route (localization step adds Persian titles/examples).
- E2E suite (
pm run test:e2e) runs with mock auth headers and exercises the main flows.

## Gaps & Improvements
1. Store refresh tokens in HttpOnly cookies and support multi-session logout semantics.
2. Add a "logout all sessions" / refresh-token family invalidation endpoint.
3. Offer optional second factor (e.g., TOTP) after password authentication.
4. Enforce stronger password policy and breached-password checks (HIBP or custom list).
5. Harden OTP endpoints with higher rate limits, CAPTCHA, and anomaly alerts.
6. Produce audit logs for login success/failure, password changes, and role assignments.
7. Localize error responses (401/403/429/422) with Persian examples in Swagger once localization lands.
8. Expand E2E coverage for edge cases (expired OTP, brute-force lockout, revoked refresh usage, role escalation attempts).
9. Move secrets to managed secret stores; automate rotation pipelines.
10. Provide test doubles for mail/SMS providers to keep local/E2E flows deterministic.

## Related Docs
- Wallet domain behaviour remains documented in REPORT.md and wallet-specific reports; this README focuses solely on Auth/User/Roles/Profile.

## Verification Cheat Sheet
`ash
npm run build
npm run test:e2e
`
- Schema sanity: docker compose exec api npm run typeorm -- migration:show
- Manual smoke: run the Postman collection after booting the Docker stack.
