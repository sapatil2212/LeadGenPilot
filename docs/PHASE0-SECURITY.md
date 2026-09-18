# Phase 0 — Security findings and credential rotation checklist

Produced during the Phase 0 safety pass. **No credential value is reproduced in
this document.** Everything is referenced by variable name and location.

---

## 1. Credentials requiring manual rotation

Three files on disk hold real credential values. None of them are tracked by
git (verified with `git check-ignore`), but `.env.example` is the kind of file
that is *conventionally* committed, and this project had no git history at all
until Phase 0 — so the safest assumption is that these values have been shared,
copied, or pasted somewhere outside the machine.

**Treat every value below as compromised and rotate it.**

| # | Variable | Where it appears | Rotate via | Priority |
|---|----------|------------------|------------|----------|
| 1 | `DATABASE_URL` | `.env`, `.env.example` | MySQL user password at the DB host, then update both files | **Critical** |
| 2 | `JWT_SECRET` | `.env`, `.env.example` | Generate new (`openssl rand -base64 48`). Invalidates all sessions — expected | **Critical** |
| 3 | `SUPERADMIN_SECRET` | `.env`, `.env.example` | Generate new | **Critical** |
| 4 | `ADMIN_PASSWORD` | `.env`, `.env.example` | Generate new | **Critical** |
| 5 | `ENCRYPTION_KEY` | `.env`, `.env.example` | See the warning below — **do not rotate blindly** | **Critical** |
| 6 | `SMTP_PASS` | `.env`, `.env.example` | Revoke the Google App Password, issue a new one | **High** |
| 7 | `GEMINI_API_KEY` | `.env`, `.env.example` | Google AI Studio → delete + recreate | **High** |
| 8 | `OPEN_ROUTER_API` | `.env`, `.env.example`, `utils/.env` | OpenRouter dashboard → revoke + recreate | **High** |
| 9 | `GOOGLE_SHEET_WEBHOOK_URL` | `.env`, `.env.example` (one value), `utils/.env` (a **different** value) | Apps Script → new deployment URL | **Medium** |
| 10 | `SMTP_USER`, `ADMIN_EMAILS` | `.env`, `.env.example` | Not secrets, but they identify real mailboxes — expect targeted phishing | Low |

### `ENCRYPTION_KEY` — rotate with care

`src/userIntegrationService.ts` uses this key to AES-encrypt every stored
per-tenant integration credential (SMTP passwords, WhatsApp Cloud access
tokens). Rotating it makes existing rows **undecryptable**, and the failure is
silent: `getUserIntegration()` catches the error and returns `null`, after which
campaigns quietly fall back to the platform's own SMTP mailbox.

Current exposure is low because `user_integrations` has **0 rows** (confirmed in
the Phase 0 backup manifest), so there is nothing to lose *right now*. Rotate it
before any tenant configures an integration. After that point, rotation requires
a decrypt-with-old-key / re-encrypt-with-new-key migration.

---

## 2. Files holding credentials

| File | Tracked by git? | Action needed |
|------|-----------------|---------------|
| `.env` | No (`.env*`) | Correct. Leave in place, rotate contents. |
| `.env.example` | No — the `!.env.example` whitelist was **removed** in Phase 0 | **Manual cleanup required**: this is supposed to be a template but contains real values. Replace its contents with placeholders, or delete it in favour of the new `.env.template`. Not done automatically because Phase 0 must not destroy credential material. |
| `utils/.env` | No (`.env*`) | Second, undocumented secrets file holding `OPEN_ROUTER_API` and a `GOOGLE_SHEET_WEBHOOK_URL` that **differs** from the root one. Determine which webhook is live, then consolidate or delete. |
| `.env.template` | **Yes** | New in Phase 0. Placeholders only. This is the config contract going forward. |

---

## 3. Configuration defects found

**`OPENROUTER_API_KEY` is never read.** `src/aiInsights.ts:55` reads
`process.env.OPENROUTER_API_KEY`, but `.env`, `.env.example` and `utils/.env`
all define `OPEN_ROUTER_API`. The names do not match, so the OpenRouter branch
is skipped on every call and lead-insight generation silently falls through to
Gemini. `render.yaml` uses the correct name, so production and local behave
differently. Not fixed in Phase 0 (behaviour change); fold into Phase 3 when the
AI provider abstraction is built.

**`page_views` holds 28,048 rows of un-retained PII.** Raw client IP, user agent
and referrer, written by a global middleware that runs before any auth layer,
with no retention policy and no tenant scoping. Sizeable GDPR exposure for a
table that only feeds one admin chart. Anonymise or add retention in Phase 10.

**Live database had schema drift.** MySQL had auto-created an index
(`email_otps_user_id_fkey`) to back a foreign key that `schema.prisma` never
declared — a side effect of using `db push`. Resolved in Phase 0 by declaring
the index with its existing name; `prisma migrate diff` now reports zero drift.
No database object was created or altered.

---

## 4. Findings deferred to Phase 1

Full detail is in the Phase 1 audit. Ranked by severity, these are the
exploitable issues Phase 1 must close first:

1. `GET /api/crm/lists/ALL/export` — unauthenticated CSV dump of **every**
   tenant's leads (`crmRoutes.ts:428-431`).
2. `POST /api/production/backups/:id/restore` — unauthenticated archive
   extraction over `process.cwd()`, zip-slip prone (`productionRoutes.ts:223`).
3. Ten IDOR routes in `crmRoutes.ts` with no ownership predicate.
4. `productionRoutes.ts` imports `requireAuth` and never applies it — 13
   anonymous endpoints, 7 permanently dead ones.
5. `requireAdmin` grants unconditional admin to any JWT carrying
   `{ sub: "superadmin", role: "admin" }` (`authRoutes.ts:213-218`), combined
   with a dev-default `JWT_SECRET` fallback (`env.ts:89`) and a `validateEnv()`
   that never populates `errors`, so the server never refuses to boot.
6. `CORS_ORIGINS="*"` reflects any Origin with `Allow-Credentials: true`
   (`security.ts:24-38`).
7. Password-free login path via `resendOtp({ purpose: "login" })`
   (`authService.ts:433-441`).
8. No suppression list, opt-out, or STOP-keyword handling anywhere.

---

## 5. Phase 0 verification evidence

| Check | Result |
|-------|--------|
| Sensitive paths ignored by git | 21/21 verified via `git check-ignore` |
| Secret-pattern scan of staged content | 2 hits, both false positives (a UI mask placeholder, a docs example string) |
| Baseline commit contents | 133 files, no `.env*`, no lead PII, no session credentials |
| Database backup | 7 tables, 28,149 rows, SHA-256 per file |
| Schema drift after fix | `-- This is an empty migration.` |
| `prisma migrate status` | `Database schema is up to date!` |
| Typecheck (`tsc --noEmit`) | 0 errors |
| Tests | 91 passed / 91 |
| Build | Next.js export + Vite SPA + esbuild server all green |
