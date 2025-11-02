# 🧩 Auth Module — Negare Platform

این ماژول مسئول **احراز هویت (Authentication)**، **مدیریت نشست‌ها (Sessions)** و **چرخش توکن‌ها (Token Rotation)** است.  
ساختار آن بر پایه‌ی **NestJS + Redis + JWT** طراحی شده و تمام فلوهای ثبت‌نام، ورود، خروج و تنظیم رمز عبور را پوشش می‌دهد.

---

## ⚙️ ماژول‌ها و سرویس‌ها

### 1. **PasswordService**
- مدیریت رمز عبور کاربران (ثبت، تغییر، ورود)
- اعتبارسنجی کاربر با `email` یا `phone`
- هش رمزها با `bcrypt`
- تایید تیکت OTP JWT (برای set-password اولیه)
- ساخت یا بروزرسانی کاربر (upsert) در Prisma
- **هیچ توکنی صادر نمی‌کند** — فقط اعتبارسنجی را انجام می‌دهد.

**متدهای کلیدی:**
| متد | توضیح |
|------|-------|
| `setPassword(token, password)` | رمز را پس از OTP تنظیم می‌کند |
| `login(identifier, password)` | بررسی اعتبار کاربر و بازگشت userId |
| `changePassword(userId, old, new)` | تغییر رمز برای کاربر لاگین‌شده |

---

### 2. **RefreshService**
- مدیریت توکن‌های `access` و `refresh`
- ساخت جفت‌توکن (TokenPair)
- ثبت JTI در Redis (allow-list)
- لغو و چرخش امن رفرش‌توکن‌ها
- اتصال JTI به Session (برای ردیابی نشست)

**متدهای کلیدی:**
| متد | توضیح |
|------|-------|
| `issueTokensForUserId(userId, { sessionId })` | ساخت access و refresh جدید |
| `refresh(refreshToken)` | چرخش (rotate) توکن‌ها |
| `revoke(refreshToken)` | باطل کردن توکن |
| `peekPayload(token)` | بررسی payload بدون خطا در انقضا |

---

### 3. **SessionService**
- ذخیره و مدیریت نشست‌ها در Redis  
- TTL سشن‌ها معمولاً `45d`
- ردیابی دستگاه‌ها و مرورگرهای مختلف کاربر
- ارتباط سشن ↔ JTI برای logout اختصاصی

**ساختار کلیدها در Redis:**
```
session:<userId>:<sessionId>      → JSON(SessionRecord)
session:index:<userId>             → SET از sessionIdها
session:jtis:<userId>:<sessionId>  → SET از JTIهای آن سشن
session:jti:index:<jti>            → "userId:sessionId"
```

**متدهای کلیدی:**
| متد | توضیح |
|------|-------|
| `create()` | ساخت نشست جدید با IP و User-Agent |
| `touch()` | تمدید TTL و به‌روزرسانی lastUsedAt |
| `linkRefreshJti()` | اتصال JTI به سشن |
| `findSessionByJti()` | پیدا کردن سشن از روی JTI |
| `revoke()` | بستن یک نشست خاص |
| `revokeAll()` | خروج از همه‌ی دستگاه‌ها |

---

### 4. **TokenService**
- ابزار JWT مستقل برای پروژه (در صورت نیاز در سرویس‌های دیگر)
- مدیریت sign/verify برای access و refresh
- پشتیبانی از blacklisting در Redis

(در فاز فعلی بخش اصلی کار توکن‌ها در `RefreshService` انجام می‌شود.)

---

### 5. **AuthController**
مسیرهای HTTP اصلی برای احراز هویت:

| متد | مسیر | توضیح |
|------|------|--------|
| `POST /auth/login` | ورود با `email` یا `phone` و رمز عبور |
| `POST /auth/refresh` | صدور مجدد accessToken با refresh_token |
| `POST /auth/logout` | خروج و حذف کوکی refresh_token |

---

## 🔐 جریان ورود (Login Flow)

1. کاربر درخواست `POST /auth/login` می‌فرستد:
   ```json
   { "identifier": "test@example.com", "password": "123456" }
   ```
2. سیستم:
   - با `PasswordService.login` اعتبار کاربر را بررسی می‌کند.
   - یک `Session` جدید در Redis می‌سازد.
   - جفت‌توکن (access + refresh) را با `RefreshService` تولید می‌کند.
   - `refresh_token` را در کوکی HttpOnly ذخیره می‌کند.
3. پاسخ:
   ```json
   { "accessToken": "<JWT>" }
   ```
4. کلاینت `accessToken` را در هدر `Authorization` می‌فرستد:
   ```
   Authorization: Bearer <accessToken>
   ```

---

## ♻️ جریان رفرش توکن (Token Rotation)

1. کاربر درخواست `POST /auth/refresh` می‌فرستد.
2. کنترلر، `refresh_token` را از **کوکی یا body** می‌خواند.
3. `RefreshService.refresh()` جفت جدید می‌سازد:
   - refreshToken قبلی از Redis حذف می‌شود.
   - refreshToken جدید ثبت می‌شود.
4. پاسخ جدید:
   ```json
   { "accessToken": "<new-access>" }
   ```
   و کوکی HttpOnly جدید ست می‌شود.

---

## 🚪 خروج از حساب (Logout Flow)

1. `POST /auth/logout`
2. توکن رفرش از کوکی یا body گرفته می‌شود.
3. `RefreshService.revoke()` آن را از Redis حذف می‌کند.
4. کوکی پاک می‌شود.
5. پاسخ:
   ```json
   { "success": true }
   ```

---

## 🧱 طراحی امنیتی

- **AccessToken**: کوتاه‌عمر (مثلاً 10 دقیقه)
- **RefreshToken**: بلندمدت (مثلاً 30 روز)
- **HttpOnly Cookie** برای refresh (جلوگیری از دسترسی JS)
- **Redis Allow-list** برای کنترل دقیق JTIها
- **Session TTL** مستقل برای هر دستگاه (قابل مشاهده در داشبورد آینده)
- **Blacklist** در حال توسعه برای revoke آنی access tokens

---

## 🧩 وابستگی‌ها

| سرویس | توضیح |
|--------|--------|
| `PrismaService` | ارتباط با دیتابیس کاربران |
| `Redis` | ذخیره سشن و توکن‌ها |
| `ConfigService` | خواندن تنظیمات از ENV |
| `MailService` | ارسال ایمیل خوش‌آمد یا اطلاع تغییر رمز |

---

## ✅ تست با Postman / Swagger

**Login:**
```
POST /auth/login
Body: { "identifier": "user@example.com", "password": "123456" }
Response: { "accessToken": "<token>" }
```

**Refresh:**
```
POST /auth/refresh
Cookie: refresh_token=<refresh>
Response: { "accessToken": "<new token>" }
```

**Logout:**
```
POST /auth/logout
Clears cookie & revokes token
```

---

## 🧾 Environment Variables (نمونه .env)
```env
ACCESS_JWT_SECRET=super-secret-access
ACCESS_JWT_EXPIRES=10m
REFRESH_JWT_SECRET=super-secret-refresh
REFRESH_JWT_EXPIRES=30d

SET_PWD_JWT_SECRET=otp-secret
BCRYPT_ROUNDS=10

SESSION_TTL=45d

REDIS_URL=redis://redis:6379
```

---

**آخرین به‌روزرسانی:** 2025-10-29  
توسعه‌دهنده: امیرحسین 👨‍💻  
نسخه: v2.0 — ساختار کامل و تست‌شده Auth System (Negare)
