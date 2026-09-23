# User Integration System

## Overview

LeadGenPilot now supports **per-user integrations**, allowing each user to configure their own:
- **SMTP Email** credentials for outreach campaigns
- **Google Sheets** webhook URL for lead collection
- **WhatsApp** API (coming soon)

This is separate from the admin portal configuration in `.env` file.

## Key Features

✅ **Secure Storage**: All sensitive data (passwords, API keys) are encrypted before storage  
✅ **Per-User Configuration**: Each user maintains their own integration settings  
✅ **Test Before Save**: Validate SMTP and webhook connections before activating  
✅ **Enable/Disable**: Toggle integrations on/off without deleting  
✅ **Multiple Integrations**: Support for multiple integration types per user  

---

## Database Schema

### New Table: `user_integrations`

```prisma
model UserIntegration {
  id         String    @id @default(cuid())
  userId     String
  type       String    // "smtp" | "google_sheet" | "whatsapp"
  config     String    @db.Text  // Encrypted JSON configuration
  enabled    Boolean   @default(true)
  label      String?   // User-friendly name
  lastUsedAt DateTime?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([type])
  @@map("user_integrations")
}
```

---

## API Endpoints

All endpoints require authentication (session cookie).

### Get All User Integrations
```http
GET /api/integrations
```

**Response:**
```json
{
  "ok": true,
  "integrations": [
    {
      "id": "clx...",
      "type": "smtp",
      "label": "Gmail SMTP",
      "enabled": true,
      "lastUsedAt": "2024-01-15T10:30:00Z",
      "createdAt": "2024-01-10T08:00:00Z"
    }
  ]
}
```

### Get Specific Integration
```http
GET /api/integrations/:type
```

**Parameters:**
- `type`: `smtp`, `google_sheet`, or `whatsapp`

**Response:**
```json
{
  "ok": true,
  "configured": true,
  "config": {
    "host": "smtp.gmail.com",
    "port": 587,
    "user": "user@example.com",
    "password": "••••••••",  // Masked
    "fromEmail": "noreply@example.com"
  }
}
```

### Save SMTP Configuration
```http
POST /api/integrations/smtp
```

**Body:**
```json
{
  "host": "smtp.gmail.com",
  "port": 587,
  "secure": false,
  "user": "your-email@gmail.com",
  "password": "your-app-password",
  "fromEmail": "noreply@yourdomain.com",
  "fromName": "Your Company",
  "label": "My Gmail SMTP"
}
```

### Test SMTP Connection
```http
POST /api/integrations/smtp/test
```

**Body:** Same as save endpoint

**Response:**
```json
{
  "ok": true,
  "message": "SMTP connection successful"
}
```

### Save Google Sheet Configuration
```http
POST /api/integrations/google-sheet
```

**Body:**
```json
{
  "webhookUrl": "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec",
  "sheetName": "Leads",
  "label": "My Leads Sheet"
}
```

### Test Google Sheet Webhook
```http
POST /api/integrations/google-sheet/test
```

**Body:** Same as save endpoint

### Toggle Integration
```http
PATCH /api/integrations/:id/toggle
```

**Body:**
```json
{
  "enabled": false
}
```

### Delete Integration
```http
DELETE /api/integrations/:id
```

---

## Frontend Component

The `IntegrationSettings` component provides a user-friendly interface:

### Features:
- **Tabbed Interface**: Switch between SMTP, Google Sheets, and WhatsApp
- **Form Validation**: Required fields and format checking
- **Test Connections**: Validate before saving
- **Password Toggle**: Show/hide sensitive fields
- **Visual Feedback**: Success/error messages
- **Integration Management**: Enable/disable/delete existing integrations

### Usage in App:

```tsx
import IntegrationSettings from "./IntegrationSettings";

// In your settings tab:
<IntegrationSettings isLight={isLight} />
```

---

## Security

### Encryption

All sensitive configuration data is encrypted using AES-256-CBC before storage:

```typescript
// Automatic encryption on save
await saveUserIntegration(userId, "smtp", {
  host: "smtp.gmail.com",
  password: "sensitive-password",  // Automatically encrypted
  // ...
});

// Automatic decryption on retrieval
const config = await getUserIntegration(userId, "smtp");
// Returns decrypted config ready to use
```

### Environment Variable

Set a strong encryption key in `.env`:

```env
ENCRYPTION_KEY="your-secure-32-character-key-here"
```

⚠️ **Important**: Keep this key secret and backed up. Changing it will make existing encrypted data unreadable.

---

## Migration Steps

### 1. Update Prisma Schema

The schema has been updated. Run the migration:

```bash
npx prisma migrate dev --name add_user_integrations
```

### 2. Set Encryption Key

Add to your `.env` file:

```env
ENCRYPTION_KEY="generate-a-secure-random-32char-key"
```

You can generate a secure key using:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Deploy Changes

```bash
npm run build
npm run start
```

---

## Usage Flow

### For Users:

1. **Navigate to Settings Tab**
   - Click "Integrations" in the sidebar

2. **Configure SMTP**
   - Enter SMTP server details
   - Click "Test Connection"
   - If successful, click "Save SMTP Configuration"

3. **Configure Google Sheets**
   - Enter Google Apps Script webhook URL
   - Click "Test Webhook"
   - If successful, click "Save Google Sheet Configuration"

4. **Launch Campaigns**
   - Go to Outreach tab
   - Your configured integrations will be used automatically

### For Admins:

The `.env` SMTP and Google Sheet settings remain as fallback/defaults. User-specific configurations take precedence when available.

---

## Testing

### Test SMTP Configuration:

```bash
curl -X POST http://localhost:3000/api/integrations/smtp/test \
  -H "Content-Type: application/json" \
  -H "Cookie: leadgenpilot_session=YOUR_SESSION" \
  -d '{
    "host": "smtp.gmail.com",
    "port": 587,
    "secure": false,
    "user": "your-email@gmail.com",
    "password": "your-app-password",
    "fromEmail": "noreply@example.com"
  }'
```

### Test Google Sheet Webhook:

```bash
curl -X POST http://localhost:3000/api/integrations/google-sheet/test \
  -H "Content-Type: application/json" \
  -H "Cookie: leadgenpilot_session=YOUR_SESSION" \
  -d '{
    "webhookUrl": "https://script.google.com/macros/s/YOUR_SCRIPT/exec"
  }'
```

---

## Troubleshooting

### SMTP Issues

**Problem**: "SMTP connection failed"

**Solutions**:
- For Gmail: Use an [App Password](https://support.google.com/accounts/answer/185833), not your account password
- Check port (587 for TLS, 465 for SSL, 25 for unencrypted)
- Verify firewall isn't blocking SMTP ports
- Ensure "Less secure app access" is enabled (if applicable)

### Google Sheets Issues

**Problem**: "Webhook test failed"

**Solutions**:
- Ensure Google Apps Script is deployed as "Web App"
- Set access to "Anyone" in deployment settings
- Copy the deployment URL, not the script URL
- Check Apps Script permissions

### Encryption Issues

**Problem**: "Failed to decrypt config"

**Solutions**:
- Ensure `ENCRYPTION_KEY` is set in `.env`
- Verify the key hasn't changed since data was encrypted
- Check for special characters in the encryption key

---

## Future Enhancements

- [ ] WhatsApp Business API integration
- [ ] Multiple SMTP profiles per user
- [ ] Slack notifications
- [ ] Zapier webhooks
- [ ] Custom API integrations
- [ ] Integration usage analytics
- [ ] Bulk import/export of integrations

---

## Support

For issues or questions:
- Check the logs: `tail -f scraper-log.txt`
- Review database: `npx prisma studio`
- Contact support: support@leadgenpilot.com
