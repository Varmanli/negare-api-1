/* ==========================================================
   Safe migration for auth models (PostgreSQL, schema=core)
   - Preserves username/email by casting to CITEXT
   - Enables CITEXT extension if missing
   - Drops legacy otp_codes if exists
   - Uses IF NOT EXISTS for idempotent indexes
   ========================================================== */

-- 0) Prereqs (idempotent)
CREATE EXTENSION IF NOT EXISTS citext;
-- CREATE SCHEMA IF NOT EXISTS core;

-- 1) Enums
DO $$ BEGIN
  CREATE TYPE "core"."UserStatus" AS ENUM ('active', 'blocked', 'pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "core"."SessionRevokeReason" AS ENUM ('logout', 'rotation', 'reuse_detected', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "core"."AuditAction" AS ENUM ('OTP_REQUEST', 'OTP_VERIFY_SUCCESS', 'OTP_VERIFY_FAIL', 'LOGIN_SUCCESS', 'LOGIN_FAIL', 'REFRESH_ROTATE', 'REFRESH_REUSE_DETECTED', 'LOGOUT', 'LOGOUT_ALL', 'PASSWORD_SET', 'PASSWORD_FORGOT_REQUEST', 'PASSWORD_RESET_SUCCESS', 'PASSWORD_RESET_FAIL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Alter users (safe casts; no data loss)
ALTER TABLE "core"."users"
  DROP COLUMN IF EXISTS "isActive",
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isPhoneVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "status" "core"."UserStatus" NOT NULL DEFAULT 'active';

-- 🔹 به‌جای Drop/Add، نوع ستون‌ها را ایمن به CITEXT تبدیل می‌کنیم (اگر ستون وجود داشته باشد)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='core' AND table_name='users' AND column_name='username') THEN
    ALTER TABLE "core"."users"
      ALTER COLUMN "username" TYPE CITEXT USING "username"::citext;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='core' AND table_name='users' AND column_name='email') THEN
    ALTER TABLE "core"."users"
      ALTER COLUMN "email" TYPE CITEXT USING "email"::citext;
  END IF;
END $$;

-- محدود کردن طول phone (اگر ستون وجود دارد)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='core' AND table_name='users' AND column_name='phone') THEN
    ALTER TABLE "core"."users"
      ALTER COLUMN "phone" SET DATA TYPE VARCHAR(32);
  END IF;
END $$;

-- 3) Legacy cleanup (OTP moved to Redis)
DROP TABLE IF EXISTS "core"."otp_codes";

-- 4) New tables (create if not exists for idempotency)
CREATE TABLE IF NOT EXISTS "core"."sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshJti" UUID NOT NULL,
    "refreshTokenHash" VARCHAR(255) NOT NULL,
    "uaHash" VARCHAR(64),
    "ipHash" VARCHAR(64),
    "fingerprintHash" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "revokeReason" "core"."SessionRevokeReason",
    "rotatedFromJti" UUID,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "core"."password_reset_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "uaHash" VARCHAR(64),
    "ipHash" VARCHAR(64),
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "core"."audit_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" "core"."AuditAction" NOT NULL,
    "meta" JSONB,
    "ipHash" VARCHAR(64),
    "uaHash" VARCHAR(64),
    "traceId" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- 5) Indexes (IF NOT EXISTS to avoid P3006 in shadow DB)
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_refreshJti_key" ON "core"."sessions"("refreshJti");
CREATE INDEX IF NOT EXISTS "session_user_active_idx" ON "core"."sessions"("userId", "revokedAt");
CREATE INDEX IF NOT EXISTS "session_expiry_idx" ON "core"."sessions"("expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_tokenHash_key" ON "core"."password_reset_tokens"("tokenHash");
CREATE INDEX IF NOT EXISTS "pwd_reset_expiry_idx" ON "core"."password_reset_tokens"("expiresAt");

CREATE INDEX IF NOT EXISTS "audit_created_at_idx" ON "core"."audit_logs"("createdAt");
CREATE INDEX IF NOT EXISTS "audit_user_time_idx" ON "core"."audit_logs"("userId", "createdAt");

-- 🔹 این دو ایندکس ممکنه قبلاً وجود داشته باشن؛ IF NOT EXISTS جلوی خطا را می‌گیرد
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "core"."users"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key"   ON "core"."users"("email");
CREATE INDEX IF NOT EXISTS "users_status_idx"         ON "core"."users"("status");
CREATE INDEX IF NOT EXISTS "users_created_at_idx"     ON "core"."users"("createdAt");

-- 6) FKs (IF NOT EXISTS-like via exception guard)
DO $$ BEGIN
  ALTER TABLE "core"."sessions"
    ADD CONSTRAINT "sessions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "core"."users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "core"."password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "core"."users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "core"."audit_logs"
    ADD CONSTRAINT "audit_logs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "core"."users"("id"
  ) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
