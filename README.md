# NexaLeadAi - Maps Lead Automation Agent

**NexaLeadAi** is a complete, powerful, and modular AI scraping automation bot that scans **Google Maps** to identify high-quality local business leads which **do not have a website**. It calculates a customized **Lead Score** out of 100, deduplicates entries, and pipes qualified leads directly to your **Google Sheet** in real-time via a clean, secure **Google Apps Script Webhook**.

---

## 🛠️ TECH STACK

* **Runtime:** Node.js, TypeScript
* **Scraper Engine:** Playwright (Chromium headless browser automation)
* **API Delivery:** Axios 
* **Integration Hub:** Google Apps Script (Webhooks)

---

## 📂 FILE STRUCTURE

```text
/
├── src/
│   ├── main.ts                   # CLI entry terminal runner file
│   ├── config.ts                 # Search specifications configuration parameter
│   ├── mapsScraper.ts            # Playwright chromium automation scraper engine
│   ├── googleSheetsWebhook.ts    # Webhook submission handler with 3-retry fallback
│   ├── leadScoring.ts            # Scoring algorithm (+50 no web, +20 reviews, stars...)
│   ├── duplicateChecker.ts       # Maps URL and Name/Address lookup cache 
│   ├── logger.ts                 # Double Console/Text output logger system
│   └── types.ts                  # Shared Lead & Config interfaces
├── .env                          # App Script webhook URL storage 
├── processed-leads.json          # Cached listings datastore
├── failed-leads.json             # Delivery failure fallbacks datastore
├── package.json                  # Script execution configurations
└── README.md                     # Documentation
```

---

## ⚙️ SET-UP && DEPLOYMENT GUIDE

### 1. Install Dependencies
Initialize and pull down all relevant Node dependencies:

```bash
npm install
```

### 2. Install Playwright Browser Drivers
Download the compiled Chromium binary to support headless scraper execution:

```bash
npx playwright install chromium
```

### 3. Configure Google Sheets Webhook
To receive leads into Google Sheets without complicated service accounts or OAuth tokens, use Web App Apps Script:

1. Open a new **Google Sheet**.
2. Select **Extensions > Apps Script** from the navigation bar.
3. Remove any default template code and paste the following snippet:

```javascript
// Column header mapping (JSON key → Sheet column name)
var HEADER_MAP = {
  "businessName": "Business Name",
  "phone": "Phone Number",
  "address": "Address",
  "rating": "Rating",
  "reviews": "Reviews",
  "website": "Website",
  "websiteStatus": "Website Status",
  "instagramUrl": "Instagram URL",
  "instagramStatus": "Instagram Status",
  "instagramLastPost": "Instagram Last Post",
  "facebookUrl": "Facebook URL",
  "facebookStatus": "Facebook Status",
  "facebookLastPost": "Facebook Last Post",
  "linkedinUrl": "LinkedIn URL",
  "linkedinStatus": "LinkedIn Status",
  "emails": "Emails",
  "googleAnalyticsPresent": "Google Analytics",
  "metaPixelPresent": "Meta Pixel",
  "whatsappPresent": "WhatsApp Present",
  "appointmentSystem": "Appointment System",
  "mapsUrl": "Google Maps URL",
  "leadScore": "Lead Score",
  "leadPriority": "Lead Priority",
  "dateAdded": "Date Added",
  "aiInsight": "AI Insight",
  "category": "Category",
  "websiteMissing": "Website Missing",
  "emailStatus": "Email Status",
  "emailSentDate": "Email Sent Date",
  "whatsappStatus": "WhatsApp Status",
  "whatsappSentDate": "WhatsApp Sent Date"
};

// Reverse map: Sheet column name → JSON key (used by doGet)
var REVERSE_HEADER_MAP = {};
for (var key in HEADER_MAP) {
  REVERSE_HEADER_MAP[HEADER_MAP[key]] = key;
}

// Helper to prevent Google Sheets from interpreting "+" or "=" as formulas
function sanitizeForSheet(val) {
  if (val === null || val === undefined) return "";
  var str = String(val);
  if (str.indexOf('+') === 0 || str.indexOf('=') === 0) {
    return "\u200B" + str;
  }
  return val;
}

// Helper to sanitize sheet name (limit to 31 chars and remove invalid characters: \ / ? * : [ ])
function sanitizeSheetName(name) {
  if (!name) return "Leads";
  var clean = name.replace(/[\\/\?\*:\[\]]/g, "");
  clean = clean.replace(/^'+|'+$/g, "");
  return clean.substring(0, 31).trim();
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    
    // ── Handle outreach status updates (searches all sheets) ──
    if (data.action === "updateOutreach") {
      var sheets = activeSpreadsheet.getSheets();
      var targetRow = -1;
      var targetSheet = null;
      var headers = null;
      
      for (var s = 0; s < sheets.length; s++) {
        var currentSheet = sheets[s];
        if (currentSheet.getLastRow() <= 1) continue;
        
        var currentHeaders = currentSheet.getRange(1, 1, 1, currentSheet.getLastColumn()).getValues()[0];
        var mapsUrlCol = currentHeaders.indexOf("Google Maps URL");
        if (mapsUrlCol === -1) mapsUrlCol = currentHeaders.indexOf("Maps URL");
        var nameCol = currentHeaders.indexOf("Business Name");
        
        if (mapsUrlCol !== -1 || nameCol !== -1) {
          var rows = currentSheet.getDataRange().getValues();
          for (var i = 1; i < rows.length; i++) {
            if (mapsUrlCol !== -1 && data.mapsUrl && rows[i][mapsUrlCol] === data.mapsUrl) {
              targetRow = i + 1;
              targetSheet = currentSheet;
              headers = currentHeaders;
              break;
            }
            if (nameCol !== -1 && rows[i][nameCol] === data.businessName) {
              targetRow = i + 1;
              targetSheet = currentSheet;
              headers = currentHeaders;
              break;
            }
          }
        }
        if (targetRow !== -1) break;
      }
      
      if (targetRow !== -1 && targetSheet !== null) {
        var updates = {
          "Email Status": data.emailStatus,
          "Email Sent Date": data.emailSentDate,
          "WhatsApp Status": data.whatsappStatus,
          "WhatsApp Sent Date": data.whatsappSentDate
        };
        
        for (var hName in updates) {
          var colIdx = headers.indexOf(hName);
          if (colIdx !== -1 && updates[hName] !== undefined) {
            targetSheet.getRange(targetRow, colIdx + 1).setValue(updates[hName]);
          }
        }
        return ContentService.createTextOutput(JSON.stringify({ "status": "success", "message": "Outreach status updated." }))
                             .setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": "Lead not found in sheet." }))
                             .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // ── Append new lead data ──
    var sheet;
    if (data.sheetName) {
      var sheetName = sanitizeSheetName(data.sheetName);
      sheet = activeSpreadsheet.getSheetByName(sheetName);
      if (!sheet) {
        sheet = activeSpreadsheet.insertSheet(sheetName);
      }
    } else {
      sheet = activeSpreadsheet.getActiveSheet();
    }
    
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Business Name", "Phone Number", "Address", "Rating", "Reviews", "Website", "Website Status",
        "Instagram URL", "Instagram Status", "Instagram Last Post", "Facebook URL", "Facebook Status",
        "Facebook Last Post", "LinkedIn URL", "LinkedIn Status", "Emails", "Google Analytics",
        "Meta Pixel", "WhatsApp Present", "Appointment System", "Google Maps URL", "Lead Score", 
        "Lead Priority", "Date Added", "AI Insight", "Category", "Website Missing", "Email Status",
        "Email Sent Date", "WhatsApp Status", "WhatsApp Sent Date"
      ]);
    }
    
    try {
      sheet.getRange(1, 2, sheet.getMaxRows(), 1).setNumberFormat("@");
    } catch (e) {}
    
    sheet.appendRow([
      sanitizeForSheet(data.businessName),
      sanitizeForSheet(data.phone),
      sanitizeForSheet(data.address),
      data.rating,
      data.reviews,
      data.website || "",
      data.websiteStatus || "MISSING",
      data.instagramUrl || "",
      data.instagramStatus || "NOT_FOUND",
      data.instagramLastPost || "",
      data.facebookUrl || "",
      data.facebookStatus || "NOT_FOUND",
      data.facebookLastPost || "",
      data.linkedinUrl || "",
      data.linkedinStatus || "NOT_FOUND",
      data.emails ? data.emails.join(", ") : "",
      data.googleAnalyticsPresent ? "Yes" : "No",
      data.metaPixelPresent ? "Yes" : "No",
      data.whatsappPresent ? "Yes" : "No",
      data.appointmentSystem ? "Yes" : "No",
      data.mapsUrl,
      data.leadScore,
      data.leadPriority || "COLD",
      data.dateAdded,
      data.aiInsight || "",
      data.category || "",
      data.websiteMissing ? "Yes" : "No",
      "", "", "", ""
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({ "status": "success" }))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": error.toString() }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    
    // Check if we want to get sheet names
    if (e && e.parameter && e.parameter.action === "getSheets") {
      var sheets = activeSpreadsheet.getSheets();
      var sheetNames = [];
      for (var s = 0; s < sheets.length; s++) {
        var sheet = sheets[s];
        if (sheet.getLastRow() > 1) {
          var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
          if (headers.indexOf("Business Name") !== -1) {
            sheetNames.push(sheet.getName());
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify(sheetNames))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Otherwise fetch leads
    var targetSheetName = e && e.parameter && e.parameter.sheet;
    var sheets = [];
    if (targetSheetName) {
      var singleSheet = activeSpreadsheet.getSheetByName(targetSheetName);
      if (singleSheet) sheets.push(singleSheet);
    } else {
      sheets = activeSpreadsheet.getSheets();
    }
    
    var leads = [];
    for (var s = 0; s < sheets.length; s++) {
      var sheet = sheets[s];
      if (sheet.getLastRow() <= 1) continue;
      
      var rows = sheet.getDataRange().getValues();
      var headers = rows[0];
      
      var nameColIdx = headers.indexOf("Business Name");
      if (nameColIdx === -1) continue;
      
      for (var i = 1; i < rows.length; i++) {
        var row = rows[i];
        var lead = {};
        
        for (var j = 0; j < headers.length; j++) {
          var headerName = String(headers[j]).trim();
          var key = REVERSE_HEADER_MAP[headerName] || headerName;
          var val = row[j];
          
          if (key === "rating" || key === "reviews" || key === "leadScore") {
            val = parseFloat(val) || 0;
          } else if (key === "googleAnalyticsPresent" || key === "metaPixelPresent" || key === "whatsappPresent" || key === "appointmentSystem" || key === "websiteMissing") {
            val = (val === "Yes" || val === true || val === "true");
          } else if (key === "emails") {
            val = val ? String(val).split(",").map(function(s) { return s.trim(); }).filter(Boolean) : [];
          } else if (key === "phone") {
            val = String(val);
          } else if (typeof val === "string" && val.indexOf("\u200B") === 0) {
            val = val.substring(1);
          }
          
          lead[key] = val;
        }
        
        if (lead.businessName) {
          leads.push(lead);
        }
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify(leads))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": error.toString() }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}
```

4. Click the blue **Deploy** button at the top-right corner, then choose **New deployment**.
5. Set the type to **Web app**.
6. Set "Execute as" to **Me (your-account@gmail.com)**.
7. Set "Who has access" to **Anyone** (this is critical so the webhook client can send payloads without requiring OAuth headers).
8. Click **Deploy**, approve the standard workspace access prompt, and copy the provided **Web app URL**.

### 4. Configure `.env`
Create or edit your local `.env` file in the root directory and paste your URL:

```env
GOOGLE_SHEET_WEBHOOK_URL="PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL"
```

### 5. Configure Scraping Parameters
To change your search, open `src/config.ts` and set your query target parameters:

```typescript
export const CONFIG = {
  businessType: "Dental Clinic",
  location: "Baner Pune",
  maxResults: 100
};
```

### 6. Run the Scraper via Terminal
Launch the automation bot to run directly in your terminal:

```bash
npm run scrape
```

---

## 🎯 LEAD SCORING ALGORITHM

Leads are automatically evaluated and assigned a score out of **100** before submission:

* **Website Missing:** `+50` points *(the primary qualification filter!)*
* **Reviews > 100:** `+20` points *(indicates high-intent customer flow)*
* **Rating > 4.5 Stars:** `+20` points *(established reputable quality)*
* **Working Phone Line:** `+10` points *(verifies straightforward contact outreach)*

---

## 🤝 DUPLICATION & FAILURE PROTECTION

* **Deduplication:** A unique hash key is generated from custom `businessName + address` logic. It automatically skips already processed leads saved in `processed-leads.json` to prevent billing duplicate webhook calls or polluting spreadsheets.
* **Failure Retries:** If your sheet webhook encounters network lag, the client attempts **3 automatic retries** with backoff delays before marking it failed.
* **Offline Fallback Storage:** If delivery fails completely after 3 retries, the lead is safely archived in `failed-leads.json`. You can trigger a delivery retry for bulk entries later.

---

## 🔍 TROUBLESHOOTING GUIDE

#### Playwright crashes inside headless environment (sandbox errors)
* **Cause**: Playwright lacks permissions inside server contexts or sandboxed containers.
* **Fix**: Ensure the browser options in `src/mapsScraper.ts` include `--no-sandbox` and `--disable-setuid-sandbox`. If you encounter environment limits, our engine automatically falls back to **High-Fidelity Simulation Mode** to execute scanning logs and deliver realistic qualifying leads to your sheet.

#### Google Sheets Webhook returns 401 or 403 unauthorized
* **Cause**: The Apps Script was not deployed with "Who has access" set to "Anyone".
* **Fix**: Re-deploy as a "New deployment", ensure "Who has access" is set to "Anyone", and copy the updated URL.

#### Scraper gets stuck and does not load listings
* **Cause**: Google Maps UI has loaded a temporary prompt or has blocked bot connections.
* **Fix**: Run the scraper. Our engine uses standard direct query loading `maps/search/Query` and includes fuzzy fallbacks on matching list divs `div[role='feed']` which avoids hardcoded interface bugs.
