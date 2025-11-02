# Auth Testing Quickstart

1. **Start backing services**
   ```bash
   docker compose up -d db redis
   ```
2. **Run the API locally (loads `.env`)**
   ```bash
   npm run start:dev
   ```
3. **Execute auth-focused tests**
   ```bash
   npm run test -- --runInBand
   ```

### What to Expect
- Jest is locked to `apps/api/test/auth/**/*.spec.ts`; no unrelated suites run.
- Tests spin up a lightweight Nest application with stubbed data sources to validate:
  - Login success/error responses
  - Refresh rotation & cookie attributes
  - Logout cookie clearing
  - Profile guard behaviour
  - Production cookie flags (`Secure`, `SameSite=None`)
  - CORS headers for `http://localhost:3000`
- Failing assertions point directly at cookie/CORS regressions in the auth stack.
