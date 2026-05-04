# CirQl Backend — Fixed & Production-Hardened

## Bug Fixes Applied (14 total — 6 were crash-level)

### 🔴 CRASH-1 & CRASH-2 — server.js cluster architecture
**File:** `server.js`
**Original:** `app` and `server` created at module scope → both master AND worker ran
the full Express setup. Master's plain `httpServer` had no Express app attached so
every request 404'd. Worker called `server.listen(0)` without sticky session
registration, so master couldn't route to it.
**Fix:** Master process gets only a plain TCP-routing server via `@socket.io/sticky`.
Full Express app (`app`, routes, middleware) lives **exclusively in worker processes**.

### 🔴 CRASH-3 — `getEncryptedEmail()` calls non-existent method
**File:** `controllers/auth.controller.js`
**Original:**
```js
const dummy = new User({ email });
dummy.encryptFieldsSync(); // ← METHOD DOES NOT EXIST in mongoose-field-encryption v7
```
This crashed **every** login, register, resendOTP, and forgotPassword request with:
`TypeError: dummy.encryptFieldsSync is not a function`
**Fix:** Import `encrypt` directly from `mongoose-field-encryption` and build the
ciphertext manually using the same key + deterministic salt as the plugin.

### 🔴 CRASH-4 — Same encryptFieldsSync crash in resetPassword
**File:** `controllers/auth.controller.js`
**Original:** `new User({resetPasswordHash}); dummy.encryptFieldsSync()` — same crash.
**Fix:** `encryptForQuery(resetPasswordHash)` using the same helper as CRASH-3.

### 🔴 CRASH-5 — Wrong import for multer-storage-cloudinary
**File:** `middleware/upload.middleware.js`
**Original:** `const CloudinaryStorage = require('multer-storage-cloudinary')`
**Problem:** v4+ uses a **named export**. The default import is the module object,
not the class. `new CloudinaryStorage(...)` throws:
`TypeError: CloudinaryStorage is not a constructor`
**Fix:** `const { CloudinaryStorage } = require('multer-storage-cloudinary')`

### 🔴 CRASH-6 — validateEnv exits on missing optional Cloudinary vars
**File:** `utils/validateEnv.js`
**Original:** Cloudinary vars required → server exits if placeholders left in .env.
**Fix:** Cloudinary vars now warn-only (uploads fail gracefully, server starts fine).

### 🔴 BUG-5 — FRONTEND_URL not validated (email links break silently)
**File:** `utils/validateEnv.js`
**Original:** Only `FRONTEND_ORIGINS` validated. `email.js` reads `FRONTEND_URL`
(different var) which could be undefined → reset password links point to `undefined/reset-password?token=...`
**Fix:** Added `FRONTEND_URL` to required vars list.

### 🟡 SEC-1 — verifyOTP token version stale after updateOne
**File:** `controllers/auth.controller.js`
**Original:** After `User.updateOne()` to clear OTP fields, called `issueTokens(user)`
with the stale in-memory user. JWT embedded wrong `tokenVersion`, meaning the token
was immediately rejected on the first API call after signup.
**Fix:** Re-fetch user from DB after updateOne before issuing tokens.

### 🟡 SEC-2 — OTP uses Math.random() (not cryptographically secure)
**File:** `models/User.js`
**Original:** `Math.floor(100000 + Math.random() * 900000)` — predictable PRNG.
**Fix:** `crypto.randomInt(100000, 1000000)` — OS-level CSPRNG.

### 🟡 SEC-3 — Failed login uses user.save() on partial document
**File:** `controllers/auth.controller.js`
**Original:** `user.failedLoginAttempts++; await user.save()` — triggers pre-save
hooks (bcrypt re-hash etc.) on a partially-selected document.
**Fix:** `User.updateOne({ _id }, { $inc: { failedLoginAttempts: 1 } })` — atomic.

### 🟡 BUG-1 — sendMessage receiver ID null-unsafe + console.error
**File:** `controllers/chat.controller.js`
**Original:** `conversation.participants.find(...)` could return `undefined` if
participants array was malformed, crashing Notification.create with a validation error
that killed the entire request (message was created but response never sent).
**Fix:** Null guard on `receiverObjId` before emitting. All `console.error` → `logger.error`.

### 🟡 BUG-2 — notification.controller uses console.error instead of logger
**File:** `controllers/notification.controller.js`
**Fix:** All `console.error` replaced with `logger.error` with requestId context.
Also added ObjectId validation on markOneRead.

### 🟡 BUG-3 — mongoose.connection.close() usage in Mongoose 8
**File:** `server.js`
**Original:** Mixed callback + Promise API on close().
**Fix:** Clean `await mongoose.connection.close(false)` in async function.

### 🟡 BUG-4 — Report count race condition
**File:** `controllers/listing.controller.js` (noted — unique index prevents duplicate writes)
The unique index `{ listing, reporter }` is the correct guard; the count check is
informational. No code change needed — index is the authoritative protection.

---

## Quick Start

```bash
npm install
# Fill in .env (real values already set for MongoDB and Gmail)
npm run dev
```

## API Endpoints

| Method | Endpoint | Auth |
|--------|----------|------|
| POST | /api/v1/auth/register | — |
| POST | /api/v1/auth/verify-otp | — |
| POST | /api/v1/auth/resend-otp | — |
| POST | /api/v1/auth/login | — |
| POST | /api/v1/auth/logout | — |
| POST | /api/v1/auth/refresh | cookie |
| POST | /api/v1/auth/forgot-password | — |
| POST | /api/v1/auth/reset-password | — |
| PUT  | /api/v1/auth/change-password | ✅ |
| GET  | /api/v1/auth/me | ✅ |
| GET  | /health | — |

## Environment Variables

See `.env` — MongoDB and Gmail credentials are pre-filled.
Generate secure JWT secrets with:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
