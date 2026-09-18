// ============================================
// Google Apps Script for NexaLeadAi Web App
// PASTE THIS ENTIRE CODE IN YOUR APPS SCRIPT
// Then: Deploy → New deployment → Web app
// ============================================

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
  "whatsappSentDate": "WhatsApp Sent Date",
  // ── AI Growth Intelligence columns (additive) ──
  "youtubeStatus": "YouTube Status",
  "youtubeUrl": "YouTube URL",
  "websiteScore": "Website Score",
  "seoScore": "SEO Score",
  "performanceScore": "Performance Score",
  "socialScore": "Social Score",
  "brandScore": "Brand Score",
  "conversionScore": "Conversion Score",
  "gmbScore": "GMB Score",
  "digitalPresenceScore": "Digital Presence Score",
  "opportunityScore": "Opportunity Score"
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

// Helper to sanitize sheet name (limit to 100 chars and remove invalid characters: \ / ? * : [ ])
function sanitizeSheetName(name) {
  if (!name) return "Leads";
  var clean = name.replace(/[\\/\?\*:\[\]]/g, "");
  // Remove single quotes from beginning or end
  clean = clean.replace(/^'+|'+$/g, "");
  return clean.substring(0, 31).trim();
}

// ==========================================
// doPost — Receives new leads & status updates
// ==========================================
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
    
    // Auto-append headers if the sheet is completely empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Business Name", 
        "Phone Number", 
        "Address", 
        "Rating", 
        "Reviews", 
        "Website", 
        "Website Status",
        "Instagram URL",
        "Instagram Status",
        "Instagram Last Post",
        "Facebook URL",
        "Facebook Status",
        "Facebook Last Post",
        "LinkedIn URL",
        "LinkedIn Status",
        "Emails",
        "Google Analytics",
        "Meta Pixel",
        "WhatsApp Present",
        "Appointment System",
        "Google Maps URL", 
        "Lead Score", 
        "Lead Priority",
        "Date Added",
        "AI Insight",
        "Category",
        "Website Missing",
        "Email Status",
        "Email Sent Date",
        "WhatsApp Status",
        "WhatsApp Sent Date",
        "YouTube Status",
        "YouTube URL",
        "Website Score",
        "SEO Score",
        "Performance Score",
        "Social Score",
        "Brand Score",
        "Conversion Score",
        "GMB Score",
        "Digital Presence Score",
        "Opportunity Score"
      ]);
    }
    
    // Format the Phone Number column as Plain Text
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
      "",  // Email Status (empty for new leads)
      "",  // Email Sent Date
      "",  // WhatsApp Status
      "",  // WhatsApp Sent Date
      data.youtubeStatus || "NOT_FOUND",
      data.youtubeUrl || "",
      data.websiteScore != null ? data.websiteScore : "",
      data.seoScore != null ? data.seoScore : "",
      data.performanceScore != null ? data.performanceScore : "",
      data.socialScore != null ? data.socialScore : "",
      data.brandScore != null ? data.brandScore : "",
      data.conversionScore != null ? data.conversionScore : "",
      data.gmbScore != null ? data.gmbScore : "",
      data.digitalPresenceScore != null ? data.digitalPresenceScore : "",
      data.opportunityScore != null ? data.opportunityScore : ""
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({ "status": "success" }))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": error.toString() }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}

// ==========================================
// doGet — Returns all leads as JSON array from ALL sheets or specific sheet, or returns sheet names
// ==========================================
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
