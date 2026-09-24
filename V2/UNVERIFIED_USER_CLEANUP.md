# Unverified User Cleanup System

## Overview

This system automatically removes users who haven't verified their email within **10 minutes** of account creation. This keeps the database clean and prevents accumulation of abandoned signup attempts.

## How It Works

### Automatic Cleanup (Default)

When the server starts, a background job is automatically initiated that:

1. **Runs immediately** on server startup
2. **Checks every 5 minutes** for unverified users
3. **Deletes users** where:
   - `email_verified = false` (0)
   - `created_at < 10 minutes ago`

### Example Timeline

```
00:00 - User signs up → Account created (email_verified = false)
00:10 - Cleanup job runs → Account is older than 10 minutes → DELETED
```

If the user verifies within 10 minutes, their account is safe.

---

## Configuration

### Cleanup Interval

The cleanup job runs every **5 minutes** by default. You can modify this in:

**File:** `src/cleanupUnverifiedUsers.ts`

```typescript
const interval = setInterval(() => {
  cleanupUnverifiedUsers();
}, 5 * 60 * 1000); // Change this value (in milliseconds)
```

### Verification Timeout

Users have **10 minutes** to verify their email. You can modify this in:

**File:** `src/cleanupUnverifiedUsers.ts`

```typescript
const VERIFICATION_TIMEOUT_MS = 10 * 60 * 1000; // Change this value
```

Examples:
- `5 * 60 * 1000` = 5 minutes
- `15 * 60 * 1000` = 15 minutes
- `30 * 60 * 1000` = 30 minutes

---

## Manual Cleanup

You can manually run the cleanup script at any time:

### Using the Script

```bash
node cleanup-unverified.js
```

**Output Example:**
```
🔍 Checking for unverified users older than 10 minutes...

Found 2 unverified user(s) to delete:

1. chatnexgen@gmail.com (chatnexgen)
   Created: 7/16/2026, 11:59:30 AM
   Age: 15 minutes old

2. test@example.com (No name)
   Created: 7/16/2026, 11:45:12 AM
   Age: 29 minutes old

✅ Successfully deleted 2 unverified user(s).
```

### Direct Database Query

You can also check manually with SQL:

```sql
-- View unverified users
SELECT 
  email, 
  name, 
  created_at,
  TIMESTAMPDIFF(MINUTE, created_at, NOW()) as age_minutes
FROM users 
WHERE email_verified = 0 
  AND created_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE);

-- Delete unverified users manually
DELETE FROM users 
WHERE email_verified = 0 
  AND created_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE);
```

---

## Logs

The cleanup job logs its activity to the console and log file:

```
[INFO] Started unverified user cleanup job (runs every 5 minutes)
[INFO] Cleaned up 1 unverified user(s) older than 10 minutes
```

If no users need cleanup, the job runs silently.

---

## Server Lifecycle

### Startup
```
✓ Server starts
✓ Database connected
✓ Cleanup job started (runs immediately, then every 5 minutes)
```

### Shutdown
```
✓ SIGTERM/SIGINT received
✓ Cleanup job stopped
✓ Server closed gracefully
```

---

## Testing

### Test the Cleanup Manually

1. **Create a test unverified user:**
   ```sql
   INSERT INTO users (id, email, name, password_hash, email_verified, role, created_at, updated_at)
   VALUES (
     'test123',
     'test@example.com',
     'Test User',
     '$2b$12$test',
     0,
     'user',
     DATE_SUB(NOW(), INTERVAL 15 MINUTE), -- 15 minutes ago
     NOW()
   );
   ```

2. **Run the cleanup:**
   ```bash
   node cleanup-unverified.js
   ```

3. **Verify deletion:**
   ```sql
   SELECT * FROM users WHERE email = 'test@example.com';
   -- Should return empty result
   ```

### Test Current User (Swapnil)

Your current user is **safe** because:
```sql
email_verified = 1  ✅ (verified)
```

The cleanup only affects users with `email_verified = 0`.

### Test Second User (chatnexgen)

The user `chatnexgen@gmail.com` created at `2026-07-16 11:59:30` is currently:
```sql
email_verified = 0  ❌ (unverified)
created_at = 2026-07-16 11:59:30
```

**Status:** Will be deleted in the next cleanup run if not verified within 10 minutes of creation.

---

## Troubleshooting

### Users Being Deleted Too Quickly

**Problem:** Users are being deleted before they can verify.

**Solution:** Increase the `VERIFICATION_TIMEOUT_MS` value:

```typescript
// In src/cleanupUnverifiedUsers.ts
const VERIFICATION_TIMEOUT_MS = 15 * 60 * 1000; // Increase to 15 minutes
```

Then rebuild:
```bash
npm run build
npm run start
```

### Cleanup Not Running

**Check server logs:**
```bash
tail -f scraper-log.txt
```

You should see:
```
[INFO] Started unverified user cleanup job (runs every 5 minutes)
```

### Disable Automatic Cleanup

If you want to disable automatic cleanup and only run it manually:

**Comment out in `server.ts`:**
```typescript
// cleanupJobInterval = startUnverifiedUserCleanup();
```

Then rebuild:
```bash
npm run build
```

---

## Database Impact

### Performance

- **Query:** Uses indexed `email_verified` and `created_at` fields
- **Impact:** Minimal - deletes happen in background every 5 minutes
- **Load:** Very low (typically 0-5 rows deleted per run)

### Related Tables

When a user is deleted, related records are automatically cleaned up:

```
users (deleted)
  └── email_otps (CASCADE DELETE)
  └── audit_logs (SET NULL)
  └── user_integrations (CASCADE DELETE)
```

---

## Monitoring

### Check Cleanup Activity

View recent cleanup activity in logs:
```bash
grep "Cleaned up" scraper-log.txt
```

### Database Query for Old Unverified Users

```sql
SELECT 
  COUNT(*) as count,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM users 
WHERE email_verified = 0 
  AND created_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE);
```

---

## Production Recommendations

### Email Reminders (Future Enhancement)

Consider sending a reminder email at 5 minutes:
```
"Your verification code expires in 5 minutes. 
Please verify your email to complete registration."
```

### Metrics Dashboard

Track cleanup metrics:
- Users deleted per day
- Average time to verification
- Signup vs. verification completion rate

### Alert on High Cleanup Rate

If cleanup rate is high (>10 users/hour), investigate:
- Email delivery issues
- OTP code problems
- User experience issues in signup flow

---

## Code Files

### Main Files

1. **src/cleanupUnverifiedUsers.ts**
   - Core cleanup logic
   - Exports: `cleanupUnverifiedUsers()`, `startUnverifiedUserCleanup()`, `stopUnverifiedUserCleanup()`

2. **server.ts**
   - Starts cleanup job on server startup
   - Stops cleanup job on graceful shutdown

3. **cleanup-unverified.js**
   - Manual cleanup script
   - Can be run independently

---

## Security Considerations

### Why 10 Minutes?

- **User Experience:** Long enough for users to check email
- **Security:** Short enough to prevent abuse (spam signups)
- **Database:** Keeps unverified accounts from accumulating

### Rate Limiting

The signup endpoint should have rate limiting to prevent:
- Spam account creation
- Email bombing
- Database bloat

Current rate limit: **120 requests/minute** (configured in `server.ts`)

---

## Summary

✅ **Automatic cleanup** runs every 5 minutes  
✅ **Deletes unverified users** after 10 minutes  
✅ **Manual cleanup** available via `cleanup-unverified.js`  
✅ **Graceful shutdown** stops the cleanup job properly  
✅ **Logged activity** for monitoring  
✅ **Configurable** timeout and interval  

Your database will stay clean automatically! 🎯
