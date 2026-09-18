/**
 * Integration Settings Component
 * Allows users to configure their own SMTP, Google Sheets, and WhatsApp integrations
 */

import React, { useState, useEffect } from "react";
import WhatsAppLogo from "./WhatsAppLogo";
import { 
  Mail, 
  FileSpreadsheet, 
  MessageCircle, 
  Plus, 
  Trash2, 
  Eye, 
  EyeOff, 
  Check, 
  X, 
  Loader2, 
  Key, 
  Power, 
  Edit2, 
  AlertTriangle, 
  ExternalLink, 
  Sparkles, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp,
  FileCode,
  Smartphone
} from "lucide-react";

interface Integration {
  id: string;
  type: string;
  label: string;
  enabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

interface SMTPFormData {
  host: string;
  port: string;
  secure: boolean;
  user: string;
  password: string;
  fromEmail: string;
  fromName: string;
  label: string;
}

interface GoogleSheetFormData {
  webhookUrl: string;
  sheetName: string;
  label: string;
}

/** Meta WhatsApp Business Cloud API credentials, as entered in the form. */
interface CloudFormData {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  verifyToken: string;
  appSecret: string;
  defaultTemplateName: string;
  defaultTemplateLang: string;
}

interface CloudStatusState {
  connected: boolean;
  displayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating?: string;
  error?: string;
}

/** An approved (or pending) message template on the connected WABA. */
interface CloudTemplate {
  name: string;
  status: string;
  language: string;
  category?: string;
}

interface IntegrationSettingsProps {
  isLight: boolean;
  canWhatsapp?: boolean;
  whatsappStatus: { status: string; qr: string };
  onInitializeWhatsApp: () => Promise<void>;
  onDisconnectWhatsApp: () => Promise<void>;
  onSendWhatsAppTest: () => Promise<void>;
  isSendingTestMsg: boolean;
  isDisconnectingWa: boolean;
  webhookConfigured: boolean;
  onWebhookConfiguredChange: (val: boolean) => void;
  onIntegrationsChange?: () => void;
  onRequestPricingModal?: () => void;
}

export default function IntegrationSettings({ 
  isLight, 
  canWhatsapp = true,
  whatsappStatus,
  onInitializeWhatsApp,
  onDisconnectWhatsApp,
  onSendWhatsAppTest,
  isSendingTestMsg,
  isDisconnectingWa,
  webhookConfigured,
  onWebhookConfiguredChange,
  onIntegrationsChange,
  onRequestPricingModal
}: IntegrationSettingsProps) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"smtp" | "google_sheet" | "whatsapp">("smtp");
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Accordion state for Apps Script
  const [showAppsScript, setShowAppsScript] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  // Edit states
  const [isEditingSmtp, setIsEditingSmtp] = useState(false);
  const [isEditingGoogleSheet, setIsEditingGoogleSheet] = useState(false);

  const [smtpForm, setSmtpForm] = useState<SMTPFormData>({
    host: "",
    port: "587",
    secure: false,
    user: "",
    password: "",
    fromEmail: "",
    fromName: "",
    label: "My SMTP",
  });

  const [googleSheetForm, setGoogleSheetForm] = useState<GoogleSheetFormData>({
    webhookUrl: "",
    sheetName: "",
    label: "My Google Sheet",
  });

  // ── WhatsApp provider: QR web session vs official Meta Cloud API ──
  const [waProvider, setWaProvider] = useState<"web" | "cloud">("web");
  const [cloudForm, setCloudForm] = useState<CloudFormData>({
    phoneNumberId: "",
    wabaId: "",
    accessToken: "",
    verifyToken: "",
    appSecret: "",
    defaultTemplateName: "",
    defaultTemplateLang: "en_US",
  });
  const [cloudConfigured, setCloudConfigured] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<CloudStatusState | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [cloudSaving, setCloudSaving] = useState(false);
  const [cloudTesting, setCloudTesting] = useState(false);
  const [cloudStatusLoading, setCloudStatusLoading] = useState(false);
  const [cloudTestPhone, setCloudTestPhone] = useState("");
  const [sendingCloudTest, setSendingCloudTest] = useState(false);
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [showAppSecret, setShowAppSecret] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [switchingProvider, setSwitchingProvider] = useState(false);
  const [cloudTemplates, setCloudTemplates] = useState<CloudTemplate[] | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  useEffect(() => {
    fetchIntegrations();
    fetchCloudConfig();
  }, []);

  /**
   * Poll Meta for live connection state while the Cloud tab is visible.
   * Every check is a real Graph API call, so 30s keeps the badge honest without
   * hammering the rate limit.
   */
  useEffect(() => {
    if (activeTab !== "whatsapp" || waProvider !== "cloud" || !cloudConfigured) return;

    refreshCloudStatus();
    const timer = setInterval(refreshCloudStatus, 30000);
    return () => clearInterval(timer);
  }, [activeTab, waProvider, cloudConfigured]);

  const fetchIntegrations = async () => {
    try {
      const res = await fetch("/api/integrations", {
        credentials: "include",
      });
      const data = await res.json();
      if (data.ok) {
        setIntegrations(data.integrations);
      }
    } catch (error) {
      console.error("Failed to fetch integrations:", error);
    } finally {
      setLoading(false);
    }
  };

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const loadSMTPForEditing = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/integrations/smtp", { credentials: "include" });
      const data = await res.json();
      if (data.ok && data.configured) {
        setSmtpForm({
          host: data.config.host || "",
          port: String(data.config.port || "587"),
          secure: Boolean(data.config.secure),
          user: data.config.user || "",
          password: data.config.password || "••••••••",
          fromEmail: data.config.fromEmail || "",
          fromName: data.config.fromName || "",
          label: integrations.find(i => i.type === "smtp")?.label || "My SMTP",
        });
        setIsEditingSmtp(true);
      }
    } catch (err) {
      showMessage("error", "Failed to fetch SMTP details for editing.");
    } finally {
      setLoading(false);
    }
  };

  const loadGoogleSheetForEditing = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/integrations/google-sheet", { credentials: "include" });
      const data = await res.json();
      if (data.ok && data.configured) {
        setGoogleSheetForm({
          webhookUrl: data.config.webhookUrl || "",
          sheetName: data.config.sheetName || "",
          label: integrations.find(i => i.type === "google_sheet")?.label || "My Google Sheet",
        });
        setIsEditingGoogleSheet(true);
      }
    } catch (err) {
      showMessage("error", "Failed to fetch Google Sheet details for editing.");
    } finally {
      setLoading(false);
    }
  };

  const testSMTP = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/integrations/smtp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(smtpForm),
      });
      const data = await res.json();
      if (data.ok) {
        showMessage("success", "✓ SMTP connection successful!");
      } else {
        showMessage("error", data.error || "SMTP test failed");
      }
    } catch (error) {
      showMessage("error", "Failed to test SMTP connection");
    } finally {
      setTesting(false);
    }
  };

  const saveSMTP = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/smtp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(smtpForm),
      });
      const data = await res.json();
      if (data.ok) {
        showMessage("success", "SMTP configuration saved successfully!");
        setIsEditingSmtp(false);
        fetchIntegrations();
        if (onIntegrationsChange) onIntegrationsChange();
      } else {
        showMessage("error", data.error || "Failed to save SMTP");
      }
    } catch (error) {
      showMessage("error", "Failed to save SMTP configuration");
    } finally {
      setSaving(false);
    }
  };

  const testGoogleSheet = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/integrations/google-sheet/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(googleSheetForm),
      });
      const data = await res.json();
      if (data.ok) {
        showMessage("success", "✓ Google Sheet webhook is working!");
      } else {
        showMessage("error", data.error || "Webhook test failed");
      }
    } catch (error) {
      showMessage("error", "Failed to test webhook");
    } finally {
      setTesting(false);
    }
  };

  const saveGoogleSheet = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/google-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(googleSheetForm),
      });
      const data = await res.json();
      if (data.ok) {
        showMessage("success", "Google Sheet configuration saved successfully!");
        setIsEditingGoogleSheet(false);
        fetchIntegrations();
        onWebhookConfiguredChange(true);
        if (onIntegrationsChange) onIntegrationsChange();
      } else {
        showMessage("error", data.error || "Failed to save Google Sheet");
      }
    } catch (error) {
      showMessage("error", "Failed to save Google Sheet configuration");
    } finally {
      setSaving(false);
    }
  };

  /* ── WhatsApp Cloud API (Meta) ─────────────────────────────────────────── */

  const fetchCloudConfig = async () => {
    try {
      const res = await fetch("/api/integrations/whatsapp-cloud", { credentials: "include" });
      const data = await res.json();
      if (!data.ok) return;

      setWebhookUrl(data.webhookUrl || "");
      setWaProvider(data.provider === "cloud" ? "cloud" : "web");
      setCloudConfigured(Boolean(data.configured));

      if (data.configured && data.config) {
        setCloudForm({
          phoneNumberId: data.config.phoneNumberId || "",
          wabaId: data.config.wabaId || "",
          accessToken: data.config.accessToken || "",
          verifyToken: data.config.verifyToken || "",
          appSecret: data.config.appSecret || "",
          defaultTemplateName: data.config.defaultTemplateName || "",
          defaultTemplateLang: data.config.defaultTemplateLang || "en_US",
        });
      }
    } catch (error) {
      console.error("Failed to fetch WhatsApp Cloud config:", error);
    }
  };

  /**
   * `force` bypasses the server-side status cache. The background poll leaves it
   * off so it stays cheap; the Refresh button turns it on.
   */
  const refreshCloudStatus = async (force = false) => {
    setCloudStatusLoading(true);
    try {
      const res = await fetch(`/api/integrations/whatsapp-cloud/status${force ? "?force=1" : ""}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (data.ok) {
        setCloudStatus({
          connected: Boolean(data.connected),
          displayPhoneNumber: data.displayPhoneNumber,
          verifiedName: data.verifiedName,
          qualityRating: data.qualityRating,
          error: data.error,
        });
      }
    } catch (error) {
      setCloudStatus({ connected: false, error: "Could not reach the server." });
    } finally {
      setCloudStatusLoading(false);
    }
  };

  /**
   * Pull the approved templates for the connected WABA so the user picks from a
   * real list instead of typing a name from memory. A wrong name only surfaces
   * mid-campaign otherwise.
   */
  const loadCloudTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const res = await fetch("/api/integrations/whatsapp-cloud/templates", { credentials: "include" });
      const data = await res.json();
      if (data.ok) {
        setCloudTemplates(data.templates || []);
        if (!data.templates?.length) {
          showMessage("error", "No templates found. Submit one in the Meta dashboard first.");
        }
      } else {
        showMessage("error", data.error || "Could not load templates.");
      }
    } catch (error) {
      showMessage("error", "Could not load templates.");
    } finally {
      setLoadingTemplates(false);
    }
  };

  const saveCloudConfig = async () => {
    if (!cloudForm.phoneNumberId.trim() || !cloudForm.verifyToken.trim()) {
      showMessage("error", "Phone Number ID and Verify Token are required.");
      return;
    }
    setCloudSaving(true);
    try {
      const res = await fetch("/api/integrations/whatsapp-cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(cloudForm),
      });
      const data = await res.json();
      if (data.ok) {
        setCloudConfigured(true);
        setCloudStatus({
          connected: Boolean(data.connected),
          displayPhoneNumber: data.displayPhoneNumber,
          verifiedName: data.verifiedName,
          qualityRating: data.qualityRating,
          error: data.error,
        });
        showMessage(data.connected ? "success" : "error", data.message || "Saved.");
        fetchIntegrations();
        if (onIntegrationsChange) onIntegrationsChange();
      } else {
        showMessage("error", data.error || "Failed to save credentials.");
      }
    } catch (error) {
      showMessage("error", "Failed to save WhatsApp Cloud credentials.");
    } finally {
      setCloudSaving(false);
    }
  };

  const testCloudConnection = async () => {
    setCloudTesting(true);
    try {
      const res = await fetch("/api/integrations/whatsapp-cloud/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          phoneNumberId: cloudForm.phoneNumberId,
          accessToken: cloudForm.accessToken,
          wabaId: cloudForm.wabaId,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        showMessage("success", `✓ ${data.message}`);
        setCloudStatus({
          connected: true,
          displayPhoneNumber: data.displayPhoneNumber,
          verifiedName: data.verifiedName,
          qualityRating: data.qualityRating,
        });
      } else {
        showMessage("error", data.error || "Connection test failed.");
      }
    } catch (error) {
      showMessage("error", "Failed to test the Cloud API connection.");
    } finally {
      setCloudTesting(false);
    }
  };

  const sendCloudTestMessage = async () => {
    if (!cloudTestPhone.trim()) {
      showMessage("error", "Enter a phone number to receive the test message.");
      return;
    }
    setSendingCloudTest(true);
    try {
      const res = await fetch("/api/integrations/whatsapp-cloud/send-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          phone: cloudTestPhone,
          message: "Test message from NexaLeadAi. Your WhatsApp Cloud API connection is working.",
        }),
      });
      const data = await res.json();
      if (data.ok) {
        showMessage("success", "✓ Test message sent. Check the recipient's WhatsApp.");
      } else {
        showMessage("error", data.error || "Failed to send the test message.");
      }
    } catch (error) {
      showMessage("error", "Failed to send the test message.");
    } finally {
      setSendingCloudTest(false);
    }
  };

  const switchProvider = async (provider: "web" | "cloud") => {
    if (provider === waProvider) return;
    setSwitchingProvider(true);
    try {
      const res = await fetch("/api/integrations/whatsapp-provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (data.ok) {
        setWaProvider(provider);
        showMessage(
          "success",
          provider === "cloud"
            ? "Outreach will now use your official WhatsApp Cloud API number."
            : "Outreach will now use the WhatsApp Web QR gateway."
        );
        if (onIntegrationsChange) onIntegrationsChange();
      } else {
        // Selecting cloud without saved credentials is rejected server-side;
        // still move the UI so the user can fill in the form.
        setWaProvider(provider);
        showMessage("error", data.error || "Could not switch provider.");
      }
    } catch (error) {
      showMessage("error", "Could not switch provider.");
    } finally {
      setSwitchingProvider(false);
    }
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  const deleteIntegration = async (id: string, type: string) => {
    if (!confirm(`Are you sure you want to delete this ${type} integration?`)) return;

    try {
      const res = await fetch(`/api/integrations/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (data.ok) {
        showMessage("success", "Integration deleted successfully");
        if (type === "google_sheet") {
          onWebhookConfiguredChange(false);
        }
        fetchIntegrations();
        if (onIntegrationsChange) onIntegrationsChange();
      }
    } catch (error) {
      showMessage("error", "Failed to delete integration");
    }
  };

  const toggleIntegration = async (id: string, type: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/integrations/${id}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json();
      if (data.ok) {
        fetchIntegrations();
        if (type === "google_sheet") {
          onWebhookConfiguredChange(enabled);
        }
        if (onIntegrationsChange) onIntegrationsChange();
      }
    } catch (error) {
      showMessage("error", "Failed to toggle integration status");
    }
  };

  const copyAppsScriptCode = () => {
    const code = `// ============================================
// Google Apps Script for NexaLeadAi Web App
// PASTE THIS ENTIRE CODE IN YOUR APPS SCRIPT
// Then: Deploy > New deployment > Web app
// ============================================

// Column header mapping (JSON key -> Sheet column name)
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

// Reverse map: Sheet column name > JSON key (used by doGet)
var REVERSE_HEADER_MAP = {};
for (var key in HEADER_MAP) {
  REVERSE_HEADER_MAP[HEADER_MAP[key]] = key;
}

// Helper to prevent Google Sheets from interpreting "+" or "=" as formulas
function sanitizeForSheet(val) {
  if (val === null || val === undefined) return "";
  var str = String(val);
  if (str.indexOf('+') === 0 || str.indexOf('=') === 0) {
    return "\\u200B" + str;
  }
  return val;
}

// Helper to sanitize sheet name (limit to 31 chars and remove invalid characters: \\ / ? * : [ ])
function sanitizeSheetName(name) {
  if (!name) return "Leads";
  var clean = name.replace(/[\\\\/\\?\\*:\\[\\]]/g, "");
  // Remove single quotes from beginning or end
  clean = clean.replace(/^'+|'+$/g, "");
  return clean.substring(0, 31).trim();
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    
    // -- Handle outreach status updates (searches all sheets) --
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
    
    // -- Append new lead data --
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
          } else if (typeof val === "string" && val.indexOf("\\u200B") === 0) {
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
}`;
    navigator.clipboard.writeText(code);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  const smtpInt = integrations.find((i) => i.type === "smtp");
  const sheetInt = integrations.find((i) => i.type === "google_sheet");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 bg-transparent">
        <Loader2 className={`w-8 h-8 animate-spin ${isLight ? "text-indigo-600" : "text-indigo-500"}`} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl animate-fadeIn">
      {/* Header Info Panel */}
      <div className={`border rounded-2xl p-6 relative overflow-hidden ${
        isLight 
          ? "bg-white border-slate-200" 
          : "bg-slate-900/60 border-slate-800 backdrop-blur-md"
      }`}>
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className={`text-xl font-bold tracking-tight mb-1.5 ${isLight ? "text-slate-900" : "text-white"}`}>
              Integration Hub
            </h2>
            <p className={`text-xs leading-relaxed max-w-2xl ${isLight ? "text-slate-500" : "text-slate-400"}`}>
              Configure your personal connection gateways. Use custom SMTP configurations for email dispatches, Google Sheets sync for lead capture, or the virtual WhatsApp Web gateway for outreach dispatches.
            </p>
          </div>
          
          <div className="flex items-center gap-3 shrink-0">
            <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
              isLight ? "bg-slate-100 text-slate-600" : "bg-slate-800 text-slate-300"
            }`}>
              Active Nodes: {integrations.filter(i => i.enabled).length + (whatsappStatus.status === "CONNECTED" ? 1 : 0)}
            </span>
          </div>
        </div>
      </div>

      {/* Tab Switcher Segmented Control */}
      <div className="flex p-1 gap-1.5 rounded-xl border border-slate-200/40 bg-slate-100/10 max-w-md">
        <button
          onClick={() => setActiveTab("smtp")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
            activeTab === "smtp"
              ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/10"
              : `${isLight ? "text-slate-600 hover:bg-white hover:text-slate-950" : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"}`
          }`}
        >
          <Mail className="w-3.5 h-3.5" />
          SMTP Email
        </button>
        <button
          onClick={() => setActiveTab("google_sheet")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
            activeTab === "google_sheet"
              ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/10"
              : `${isLight ? "text-slate-600 hover:bg-white hover:text-slate-950" : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"}`
          }`}
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          Google Sheets
        </button>
        <button
          onClick={() => setActiveTab("whatsapp")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
            activeTab === "whatsapp"
              ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/10"
              : `${isLight ? "text-slate-600 hover:bg-white hover:text-slate-950" : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"}`
          }`}
        >
          <WhatsAppLogo className="w-3.5 h-3.5 fill-emerald-500 text-emerald-500" />
          WhatsApp
        </button>
      </div>

      {/* Message Banner */}
      {message && (
        <div
          className={`p-3.5 rounded-xl border flex items-center gap-2.5 transition-all text-xs font-medium ${
            message.type === "success"
              ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-500"
              : "bg-rose-500/5 border-rose-500/20 text-rose-500"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <AlertTriangle className="w-4 h-4" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* TAB 1: SMTP Settings */}
      {activeTab === "smtp" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 space-y-6">
            {smtpInt && !isEditingSmtp ? (
              /* Active SMTP connection detail card */
              <div className={`border rounded-2xl p-6 ${
                isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
              }`}>
                <div className="flex justify-between items-start border-b border-slate-200/20 pb-4 mb-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                      <Mail className="w-5.5 h-5.5 text-indigo-500" />
                    </div>
                    <div>
                      <h4 className={`text-sm font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                        {smtpInt.label || "SMTP Email Gateway"}
                      </h4>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Connected on {new Date(smtpInt.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleIntegration(smtpInt.id, "smtp", !smtpInt.enabled)}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
                        smtpInt.enabled
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                          : "bg-slate-500/10 border-slate-500/20 text-slate-400"
                      }`}
                    >
                      <Power className="w-3 h-3" />
                      {smtpInt.enabled ? "Enabled" : "Disabled"}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-xs mb-6 font-sans">
                  <div>
                    <span className="text-slate-500 block mb-0.5 text-[10px]">SMTP Host Address</span>
                    <strong className={isLight ? "text-slate-800" : "text-white"}>Configured</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5 text-[10px]">Authorized User</span>
                    <strong className={isLight ? "text-slate-800" : "text-white"}>Configured</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5 text-[10px]">Encryption Port</span>
                    <strong className={isLight ? "text-slate-800" : "text-white"}>Configured</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5 text-[10px]">Last dispatched</span>
                    <strong className={isLight ? "text-slate-800" : "text-white"}>
                      {smtpInt.lastUsedAt ? new Date(smtpInt.lastUsedAt).toLocaleString() : "Never"}
                    </strong>
                  </div>
                </div>

                <div className="flex gap-2.5 border-t border-slate-200/20 pt-4">
                  <button
                    onClick={loadSMTPForEditing}
                    className={`px-3.5 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
                      isLight 
                        ? "border-slate-200 text-slate-600 hover:bg-slate-50" 
                        : "border-slate-800 text-slate-300 hover:bg-slate-850"
                    }`}
                  >
                    <Edit2 className="w-3.5 h-3.5 text-indigo-400" />
                    Edit Settings
                  </button>
                  <button
                    onClick={() => {
                      setSmtpForm({
                        host: "temp",
                        port: "587",
                        secure: false,
                        user: "temp",
                        password: "••••••••",
                        fromEmail: "temp",
                        fromName: "",
                        label: ""
                      });
                      testSMTP();
                    }}
                    disabled={testing}
                    className={`px-3.5 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
                      isLight 
                        ? "border-slate-200 text-slate-600 hover:bg-slate-50" 
                        : "border-slate-800 text-slate-300 hover:bg-slate-850"
                    }`}
                  >
                    {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-emerald-500" />}
                    Test Connection
                  </button>
                  <button
                    onClick={() => deleteIntegration(smtpInt.id, "smtp")}
                    className="ml-auto px-3.5 py-2 text-xs font-semibold rounded-lg bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 border border-rose-500/25 transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Config
                  </button>
                </div>
              </div>
            ) : (
              /* SMTP Edit/Add form */
              <div className={`border rounded-2xl p-6 space-y-4 ${
                isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
              }`}>
                <div className="pb-3 border-b border-slate-200/20">
                  <h3 className={`text-sm font-bold flex items-center gap-2 ${isLight ? "text-slate-800" : "text-white"}`}>
                    <Key className="w-4 h-4 text-indigo-400" />
                    {isEditingSmtp ? "Modify SMTP Settings" : "Configure Custom SMTP"}
                  </h3>
                </div>

                <div className="space-y-4 text-xs">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">SMTP Host</label>
                      <input
                        type="text"
                        value={smtpForm.host}
                        onChange={(e) => setSmtpForm({ ...smtpForm, host: e.target.value })}
                        placeholder="smtp.gmail.com"
                        className={`w-full px-3 py-2 rounded-lg border focus:outline-none focus:border-indigo-500 ${
                          isLight
                            ? "bg-white border-slate-200 text-slate-900"
                            : "bg-[#030712] border-slate-700 text-white"
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">Port</label>
                      <input
                        type="number"
                        value={smtpForm.port}
                        onChange={(e) => setSmtpForm({ ...smtpForm, port: e.target.value })}
                        placeholder="587"
                        className={`w-full px-3 py-2 rounded-lg border focus:outline-none focus:border-indigo-500 ${
                          isLight
                            ? "bg-white border-slate-200 text-slate-900"
                            : "bg-[#030712] border-slate-700 text-white"
                        }`}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="flex items-center gap-2 py-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={smtpForm.secure}
                        onChange={(e) => setSmtpForm({ ...smtpForm, secure: e.target.checked })}
                        className="rounded accent-indigo-600"
                      />
                      <span className={`text-xs font-semibold ${isLight ? "text-slate-700" : "text-slate-300"}`}>
                        Use SSL/TLS (Secure Connection on Port 465)
                      </span>
                    </label>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">Username / Email</label>
                    <input
                      type="text"
                      value={smtpForm.user}
                      onChange={(e) => setSmtpForm({ ...smtpForm, user: e.target.value })}
                      placeholder="yourname@gmail.com"
                      className={`w-full px-3 py-2 rounded-lg border focus:outline-none focus:border-indigo-500 ${
                        isLight
                          ? "bg-white border-slate-200 text-slate-900"
                          : "bg-[#030712] border-slate-700 text-white"
                      }`}
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">Password / App Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={smtpForm.password}
                        onChange={(e) => setSmtpForm({ ...smtpForm, password: e.target.value })}
                        placeholder="••••••••••••"
                        className={`w-full px-3 py-2.5 rounded-lg border focus:outline-none focus:border-indigo-500 pr-10 ${
                          isLight
                            ? "bg-white border-slate-200 text-slate-900"
                            : "bg-[#030712] border-slate-700 text-white"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">From Email</label>
                      <input
                        type="email"
                        value={smtpForm.fromEmail}
                        onChange={(e) => setSmtpForm({ ...smtpForm, fromEmail: e.target.value })}
                        placeholder="noreply@domain.com"
                        className={`w-full px-3 py-2 rounded-lg border focus:outline-none focus:border-indigo-500 ${
                          isLight
                            ? "bg-white border-slate-200 text-slate-900"
                            : "bg-[#030712] border-slate-700 text-white"
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">From Name</label>
                      <input
                        type="text"
                        value={smtpForm.fromName}
                        onChange={(e) => setSmtpForm({ ...smtpForm, fromName: e.target.value })}
                        placeholder="e.g. Sales Team"
                        className={`w-full px-3 py-2 rounded-lg border focus:outline-none focus:border-indigo-500 ${
                          isLight
                            ? "bg-white border-slate-200 text-slate-900"
                            : "bg-[#030712] border-slate-700 text-white"
                        }`}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">Custom Label</label>
                      <input
                        type="text"
                        value={smtpForm.label}
                        onChange={(e) => setSmtpForm({ ...smtpForm, label: e.target.value })}
                        placeholder="e.g. Gmail SMTP Gateway"
                        className={`w-full px-3 py-2 rounded-lg border focus:outline-none focus:border-indigo-500 ${
                          isLight
                            ? "bg-white border-slate-200 text-slate-900"
                            : "bg-[#030712] border-slate-700 text-white"
                        }`}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2.5 pt-4 border-t border-slate-200/20">
                    <button
                      type="button"
                      onClick={testSMTP}
                      disabled={testing || !smtpForm.host || !smtpForm.user || !smtpForm.password}
                      className="px-4 py-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-300 text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      Test Connection
                    </button>
                    <button
                      type="button"
                      onClick={saveSMTP}
                      disabled={saving || !smtpForm.host || !smtpForm.user || !smtpForm.password || !smtpForm.fromEmail}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      Save Configuration
                    </button>
                    {isEditingSmtp && (
                      <button
                        type="button"
                        onClick={() => setIsEditingSmtp(false)}
                        className={`ml-auto px-4 py-2 border rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                          isLight ? "border-slate-200 text-slate-600 hover:bg-slate-50" : "border-slate-800 text-slate-400 hover:bg-slate-850"
                        }`}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-4 space-y-6">
            {/* Gmail SMTP Guide Banner */}
            <div className={`p-5 rounded-2xl border font-sans space-y-3.5 ${
              isLight 
                ? "bg-amber-50/50 border-amber-200 text-amber-950" 
                : "bg-amber-500/5 border-amber-500/15 text-amber-400"
            }`}>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4.5 h-4.5 text-amber-500" />
                <h4 className="font-bold text-xs">Gmail SMTP Advisory</h4>
              </div>
              <p className="text-[11px] leading-relaxed">
                To prevent Google authorization blocks, do NOT use your standard account password.
              </p>
              <ol className="text-[10px] space-y-1.5 list-decimal pl-4 leading-relaxed text-slate-400">
                <li>Enable <strong className={isLight ? "text-slate-800" : "text-white"}>2-Step Verification</strong> on your Google Account.</li>
                <li>Search Google Account settings for <strong className={isLight ? "text-slate-800" : "text-white"}>App Passwords</strong>.</li>
                <li>Select App type "Other" and label it "NexaLeadAi".</li>
                <li>Copy the 16-character passcode generated and paste it as your SMTP password here.</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Google Sheets Settings */}
      {activeTab === "google_sheet" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 space-y-6">
            {sheetInt && !isEditingGoogleSheet ? (
              /* Active sheets connection card */
              <div className={`border rounded-2xl p-6 ${
                isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
              }`}>
                <div className="flex justify-between items-start border-b border-slate-200/20 pb-4 mb-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                      <FileSpreadsheet className="w-5.5 h-5.5 text-emerald-500" />
                    </div>
                    <div>
                      <h4 className={`text-sm font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                        {sheetInt.label || "Google Sheet Sync Node"}
                      </h4>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Connected on {new Date(sheetInt.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleIntegration(sheetInt.id, "google_sheet", !sheetInt.enabled)}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
                        sheetInt.enabled
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                          : "bg-slate-500/10 border-slate-500/20 text-slate-400"
                      }`}
                    >
                      <Power className="w-3 h-3" />
                      {sheetInt.enabled ? "Active Sync" : "Sync Paused"}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-xs mb-6 font-sans">
                  <div className="col-span-2">
                    <span className="text-slate-500 block mb-0.5 text-[10px]">Google Web App Deployment URL</span>
                    <strong className="text-indigo-400 font-mono text-[10px] break-all block py-1 bg-slate-950/20 px-2 rounded border border-slate-800">
                      Configured
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5 text-[10px]">Target Sheet (Optional)</span>
                    <strong className={isLight ? "text-slate-800" : "text-white"}>
                      {(JSON.parse(window.atob(window.btoa(JSON.stringify(sheetInt)))) as any).sheetName || "Default Active Sheet"}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5 text-[10px]">Last Sync Dispatch</span>
                    <strong className={isLight ? "text-slate-800" : "text-white"}>
                      {sheetInt.lastUsedAt ? new Date(sheetInt.lastUsedAt).toLocaleString() : "No leads synced yet"}
                    </strong>
                  </div>
                </div>

                <div className="flex gap-2.5 border-t border-slate-200/20 pt-4">
                  <button
                    onClick={loadGoogleSheetForEditing}
                    className={`px-3.5 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
                      isLight 
                        ? "border-slate-200 text-slate-600 hover:bg-slate-50" 
                        : "border-slate-800 text-slate-300 hover:bg-slate-850"
                    }`}
                  >
                    <Edit2 className="w-3.5 h-3.5 text-indigo-400" />
                    Edit Settings
                  </button>
                  <button
                    onClick={() => {
                      setGoogleSheetForm({
                        webhookUrl: "temp",
                        sheetName: "",
                        label: ""
                      });
                      testGoogleSheet();
                    }}
                    disabled={testing}
                    className={`px-3.5 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
                      isLight 
                        ? "border-slate-200 text-slate-600 hover:bg-slate-50" 
                        : "border-slate-800 text-slate-300 hover:bg-slate-850"
                    }`}
                  >
                    {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-emerald-500" />}
                    Verify Webhook
                  </button>
                  <button
                    onClick={() => deleteIntegration(sheetInt.id, "google_sheet")}
                    className="ml-auto px-3.5 py-2 text-xs font-semibold rounded-lg bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 border border-rose-500/25 transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Sync
                  </button>
                </div>
              </div>
            ) : (
              /* Add/Edit Sheets form */
              <div className={`border rounded-2xl p-6 space-y-4 ${
                isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
              }`}>
                <div className="pb-3 border-b border-slate-200/20">
                  <h3 className={`text-sm font-bold flex items-center gap-2 ${isLight ? "text-slate-800" : "text-white"}`}>
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                    {isEditingGoogleSheet ? "Modify Google Sheets Sync Settings" : "Configure Google Sheets Sync"}
                  </h3>
                </div>

                <div className="space-y-4 text-xs">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">Google Apps Script Webhook URL</label>
                    <input
                      type="url"
                      value={googleSheetForm.webhookUrl}
                      onChange={(e) => setGoogleSheetForm({ ...googleSheetForm, webhookUrl: e.target.value })}
                      placeholder="https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec"
                      className={`w-full px-3 py-2 rounded-lg border focus:outline-none focus:border-indigo-500 ${
                        isLight
                          ? "bg-white border-slate-200 text-slate-900"
                          : "bg-[#030712] border-slate-700 text-white"
                      }`}
                    />
                    <span className="text-[10px] text-slate-500 mt-1 block leading-normal">
                      Copy the Web App link deployed from the Google Apps Script in your sheet.
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">Target Tab/Sheet Name</label>
                      <input
                        type="text"
                        value={googleSheetForm.sheetName}
                        onChange={(e) => setGoogleSheetForm({ ...googleSheetForm, sheetName: e.target.value })}
                        placeholder="Leads (optional)"
                        className={`w-full px-3 py-2 rounded-lg border focus:outline-none focus:border-indigo-500 ${
                          isLight
                            ? "bg-white border-slate-200 text-slate-900"
                            : "bg-[#030712] border-slate-700 text-white"
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">Sync Label</label>
                      <input
                        type="text"
                        value={googleSheetForm.label}
                        onChange={(e) => setGoogleSheetForm({ ...googleSheetForm, label: e.target.value })}
                        placeholder="Leads Spreadsheet"
                        className={`w-full px-3 py-2 rounded-lg border focus:outline-none focus:border-indigo-500 ${
                          isLight
                            ? "bg-white border-slate-200 text-slate-900"
                            : "bg-[#030712] border-slate-700 text-white"
                        }`}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2.5 pt-4 border-t border-slate-200/20">
                    <button
                      type="button"
                      onClick={testGoogleSheet}
                      disabled={testing || !googleSheetForm.webhookUrl}
                      className="px-4 py-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-300 text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      Test Webhook Link
                    </button>
                    <button
                      type="button"
                      onClick={saveGoogleSheet}
                      disabled={saving || !googleSheetForm.webhookUrl}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      Save Sync Gateway
                    </button>
                    {isEditingGoogleSheet && (
                      <button
                        type="button"
                        onClick={() => setIsEditingGoogleSheet(false)}
                        className={`ml-auto px-4 py-2 border rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                          isLight ? "border-slate-200 text-slate-600 hover:bg-slate-50" : "border-slate-800 text-slate-400 hover:bg-slate-850"
                        }`}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Accordion Guide: How to deploy Apps Script */}
            <div className={`border rounded-2xl overflow-hidden ${
              isLight ? "bg-slate-50 border-slate-200" : "bg-slate-900/40 border-slate-800"
            }`}>
              <button
                onClick={() => setShowAppsScript(!showAppsScript)}
                className="w-full py-4 px-6 flex items-center justify-between text-xs font-bold tracking-tight cursor-pointer hover:bg-slate-800/10"
              >
                <span className="flex items-center gap-2">
                  <FileCode className="w-4.5 h-4.5 text-indigo-400" />
                  Google Sheets Apps Script Setup Instructions & Code
                </span>
                {showAppsScript ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </button>

              {showAppsScript && (
                <div className="p-6 border-t border-slate-200/20 space-y-4 font-sans text-xs">
                  <div className={`p-4 rounded-xl border leading-relaxed space-y-1.5 ${
                    isLight ? "bg-white border-slate-200 text-slate-700" : "bg-[#030712] border-slate-800 text-slate-400"
                  }`}>
                    <p className="font-semibold text-indigo-400 mb-1">Follow these steps carefully:</p>
                    <ol className="list-decimal pl-4 space-y-1 text-[11px]">
                      <li>Create a new Google Sheet.</li>
                      <li>Go to <strong className={isLight ? "text-slate-900" : "text-white"}>Extensions &gt; Apps Script</strong>.</li>
                      <li>Delete all text in the script editor and click <strong className={isLight ? "text-slate-900" : "text-white"}>Copy Apps Script Code</strong> button below to copy the required code.</li>
                      <li>Paste the copied script code into the script editor. Click save (floppy disk icon).</li>
                      <li>Click the blue <strong className={isLight ? "text-slate-900" : "text-white"}>Deploy</strong> button &gt; <strong className={isLight ? "text-slate-900" : "text-white"}>New deployment</strong>.</li>
                      <li>Select configuration type: <strong className={isLight ? "text-slate-900" : "text-white"}>Web app</strong>.</li>
                      <li>Change settings to:
                        <ul className="list-disc pl-4 mt-0.5 space-y-0.5 font-mono text-[10px]">
                          <li>"Execute as": "Me" (your email)</li>
                          <li>"Who has access": "Anyone"</li>
                        </ul>
                      </li>
                      <li>Click Deploy, approve permissions, and copy the Web App URL generated. Paste it into the form above.</li>
                    </ol>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={copyAppsScriptCode}
                      className="px-4 py-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-200 text-xs font-bold rounded-lg cursor-pointer transition-all flex items-center gap-1.5"
                    >
                      <FileCode className="w-4 h-4 text-emerald-400" />
                      {copiedScript ? "Script Code Copied!" : "Copy Apps Script Code"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-4 space-y-6">
            <div className={`p-5 rounded-2xl border font-sans space-y-3.5 ${
              isLight 
                ? "bg-emerald-50/50 border-emerald-200 text-emerald-950" 
                : "bg-emerald-500/5 border-emerald-500/15 text-emerald-400"
            }`}>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4.5 h-4.5 text-emerald-500" />
                <h4 className="font-bold text-xs">Spreadsheet Benefits</h4>
              </div>
              <p className="text-[11px] leading-relaxed">
                Synchronizing dispatches logs harvest data directly to your spreadsheets.
              </p>
              <ul className="text-[10px] space-y-1.5 list-disc pl-4 leading-relaxed text-slate-400">
                <li>Instant sync of lead information as they are scraped.</li>
                <li>Sync outreach campaign statuses (SENT, FAILED) dynamically in real-time.</li>
                <li>Enable teamwork dispatches inside Google Sheets.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: WhatsApp Settings */}
      {activeTab === "whatsapp" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-fadeIn">
          <div className="lg:col-span-8 space-y-6">
            {!canWhatsapp ? (
              <div className={`border rounded-2xl p-8 flex flex-col items-center text-center gap-4 ${
                isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
              }`}>
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center animate-pulse">
                  <Sparkles className="h-6 w-6 text-indigo-400" />
                </div>
                <div>
                  <h4 className={`text-sm font-bold tracking-tight ${isLight ? "text-slate-900" : "text-white"}`}>
                    WhatsApp Outreach is a Pro Feature
                  </h4>
                  <p className="text-xs text-slate-400 mt-2 max-w-sm leading-relaxed">
                    Your current free plan doesn't include WhatsApp outreach gateways. Upgrade to a premium plan to launch headless gateways, link browser sessions, and dispatch outreach campaigns directly.
                  </p>
                </div>
                <button 
                  onClick={onRequestPricingModal}
                  className="mt-2 px-5 py-2.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-lg shadow-indigo-600/20 cursor-pointer transition-all hover:scale-[1.02]"
                >
                  Upgrade to Pro
                </button>
              </div>
            ) : (
            <>
              {/* Provider selector: which transport actually sends outreach */}
              <div className={`border rounded-2xl p-5 ${
                isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
              }`}>
                <h3 className={`text-sm font-semibold mb-1 ${isLight ? "text-slate-800" : "text-white"}`}>
                  Sending Method
                </h3>
                <p className="text-[11px] text-slate-500 mb-4 leading-relaxed">
                  Choose how outreach messages leave the platform. The official API is stable and compliant but
                  requires cold outreach to use pre-approved templates.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => switchProvider("web")}
                    disabled={switchingProvider}
                    className={`text-left p-4 rounded-xl border transition-all cursor-pointer disabled:opacity-60 ${
                      waProvider === "web"
                        ? "border-indigo-500/60 bg-indigo-500/5 ring-1 ring-indigo-500/30"
                        : isLight
                          ? "border-slate-200 hover:border-slate-300"
                          : "border-[#1e293b] hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <Smartphone className="w-4 h-4 text-indigo-400" />
                      <span className={`text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                        WhatsApp Web (QR)
                      </span>
                      {waProvider === "web" && (
                        <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Links your personal number by QR scan. Fast to set up, no approval needed, but unofficial
                      and can be rate limited or blocked by WhatsApp.
                    </p>
                  </button>

                  <button
                    onClick={() => switchProvider("cloud")}
                    disabled={switchingProvider}
                    className={`text-left p-4 rounded-xl border transition-all cursor-pointer disabled:opacity-60 ${
                      waProvider === "cloud"
                        ? "border-emerald-500/60 bg-emerald-500/5 ring-1 ring-emerald-500/30"
                        : isLight
                          ? "border-slate-200 hover:border-slate-300"
                          : "border-[#1e293b] hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <WhatsAppLogo className="w-4 h-4 fill-emerald-500 text-emerald-500" />
                      <span className={`text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                        Official API (Meta Cloud)
                      </span>
                      {waProvider === "cloud" && (
                        <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Your WhatsApp Business account via Meta. Reliable delivery and no session drops. Cold
                      outreach must use an approved template.
                    </p>
                  </button>
                </div>
              </div>

              {waProvider === "web" ? (
              <div className={`border rounded-2xl p-6 space-y-4 ${
                isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
              }`}>
                <div className={`flex items-center justify-between pb-3 border-b ${
                  isLight ? "border-slate-200" : "border-[#1e293b]/60"
                }`}>
                  <div className="flex items-center gap-2">
                    <Smartphone className="h-5 w-5 text-indigo-400" />
                    <h3 className={`text-sm font-semibold ${isLight ? "text-slate-800" : "text-white"}`}>
                      WhatsApp Gateway Session
                    </h3>
                  </div>

                  {whatsappStatus.status === "CONNECTED" && (
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={onSendWhatsAppTest}
                        disabled={isSendingTestMsg}
                        className="px-3.5 py-1.5 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/25 font-bold text-[10px] rounded-lg cursor-pointer transition-all disabled:opacity-50"
                      >
                        {isSendingTestMsg ? "Sending Test..." : "Send Test Message"}
                      </button>
                      <button 
                        onClick={onDisconnectWhatsApp}
                        disabled={isDisconnectingWa}
                        className="px-3.5 py-1.5 bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 border border-rose-500/25 font-bold text-[10px] rounded-lg cursor-pointer transition-all disabled:opacity-50"
                      >
                        {isDisconnectingWa ? "Disconnecting..." : "Disconnect WhatsApp"}
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-col md:flex-row items-center gap-8 py-2">
                  <div className="flex-1 space-y-4 font-sans">
                    <p className={`text-xs leading-relaxed ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                      Authenticates a virtual headless browser with WhatsApp Web. Once authenticated, outreach campaigns can dispatch customized messages directly to business lines.
                    </p>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-slate-400">Connection state:</span>
                        <span className={`font-bold px-2 py-0.5 rounded text-[10px] tracking-wide ${
                          whatsappStatus.status === "CONNECTED" ? "bg-emerald-500/10 text-emerald-400" :
                          whatsappStatus.status === "CONNECTING" ? "bg-indigo-500/10 text-indigo-400 animate-pulse" :
                          whatsappStatus.status === "QR_READY" ? "bg-amber-500/10 text-amber-400" :
                          "bg-slate-500/10 text-slate-400"
                        }`}>
                          {whatsappStatus.status === "CONNECTED" ? "ACTIVE" : whatsappStatus.status}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 flex gap-2">
                      {whatsappStatus.status === "DISCONNECTED" && (
                        <button
                          onClick={onInitializeWhatsApp}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg cursor-pointer transition-all shadow-md shadow-indigo-600/10"
                        >
                          Initialize WhatsApp Gateway
                        </button>
                      )}

                      {whatsappStatus.status === "QR_READY" && (
                        <button
                          onClick={onInitializeWhatsApp}
                          className="px-4 py-2 bg-amber-600/10 hover:bg-amber-600/20 text-amber-400 border border-amber-500/20 text-xs font-bold rounded-lg cursor-pointer transition-all"
                        >
                          Regenerate QR Code
                        </button>
                      )}
                    </div>
                  </div>

                  {/* QR view */}
                  {whatsappStatus.status !== "CONNECTED" && (
                    <div className="shrink-0 flex items-center justify-center p-4 bg-white rounded-xl border border-slate-200 w-48 h-48 shadow-lg relative">
                      {whatsappStatus.qr ? (
                        <img 
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(whatsappStatus.qr)}`} 
                          alt="WhatsApp Scan QR" 
                          className="w-40 h-40"
                        />
                      ) : (
                        <div className="text-slate-400 text-center text-[10px] font-sans">
                          {whatsappStatus.status === "CONNECTING" ? (
                            <div className="space-y-2 flex flex-col items-center">
                              <Loader2 className="h-6 w-6 text-indigo-600 animate-spin" />
                              <span className="leading-normal">{isDisconnectingWa ? "Disconnecting Gateway..." : "Launching headless client..."}</span>
                            </div>
                          ) : (
                            "Gateway connection is inactive. Press button to initialize."
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {whatsappStatus.status === "CONNECTED" && (
                    <div className={`shrink-0 flex flex-col items-center justify-center p-6 border border-emerald-500/20 rounded-xl w-48 h-48 text-emerald-400 text-xs ${
                      isLight ? "bg-emerald-50" : "bg-slate-900/50"
                    }`}>
                      <CheckCircle2 className="h-12 w-12 text-emerald-400 mb-2 animate-bounce" />
                      <span className="font-bold text-center">Session Verified</span>
                      <span className="text-[10px] text-slate-500 mt-1">Active Gateway</span>
                    </div>
                  )}
                </div>
              </div>
              ) : (
              /* ── Official Meta WhatsApp Business Cloud API ── */
              <div className="space-y-6">
                {/* Live connection state */}
                <div className={`border rounded-2xl p-6 ${
                  isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
                }`}>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3.5">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                        cloudStatus?.connected ? "bg-emerald-500/10" : "bg-slate-500/10"
                      }`}>
                        <WhatsAppLogo className={`w-6 h-6 ${
                          cloudStatus?.connected ? "fill-emerald-500 text-emerald-500" : "fill-slate-500 text-slate-500"
                        }`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className={`text-sm font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                            {cloudStatus?.connected ? "Connected" : "Not Connected"}
                          </h4>
                          {cloudStatusLoading && <Loader2 className="w-3 h-3 animate-spin text-slate-500" />}
                          {cloudStatus?.qualityRating && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              cloudStatus.qualityRating === "GREEN"
                                ? "bg-emerald-500/15 text-emerald-400"
                                : cloudStatus.qualityRating === "YELLOW"
                                  ? "bg-amber-500/15 text-amber-400"
                                  : "bg-rose-500/15 text-rose-400"
                            }`}>
                              QUALITY: {cloudStatus.qualityRating}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                          {cloudStatus?.connected
                            ? `${cloudStatus.verifiedName || "Business account"} · ${cloudStatus.displayPhoneNumber || ""}`
                            : "Configure your Meta API credentials below to connect your WhatsApp Business account."}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {cloudConfigured && (
                        <button
                          onClick={() => refreshCloudStatus(true)}
                          disabled={cloudStatusLoading}
                          className={`px-3.5 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5 ${
                            isLight
                              ? "border-slate-200 text-slate-600 hover:bg-slate-50"
                              : "border-slate-800 text-slate-300 hover:bg-slate-850"
                          }`}
                        >
                          {cloudStatusLoading
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Check className="w-3.5 h-3.5 text-emerald-500" />}
                          Refresh Status
                        </button>
                      )}
                    </div>
                  </div>

                  {cloudStatus?.error && !cloudStatus.connected && (
                    <div className="mt-4 p-3 rounded-lg bg-rose-500/5 border border-rose-500/20 flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400 mt-0.5 shrink-0" />
                      <span className="text-[11px] text-rose-400 leading-relaxed">{cloudStatus.error}</span>
                    </div>
                  )}
                </div>

                {/* Credentials */}
                <div className={`border rounded-2xl p-6 space-y-4 ${
                  isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
                }`}>
                  <div className={`pb-3 border-b ${isLight ? "border-slate-200" : "border-[#1e293b]/60"}`}>
                    <div className="flex items-center gap-2">
                      <Key className="h-4.5 w-4.5 text-indigo-400" />
                      <h3 className={`text-sm font-semibold ${isLight ? "text-slate-800" : "text-white"}`}>
                        API Credentials
                      </h3>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                      Enter your Meta WhatsApp Business API credentials. Find these under your app's WhatsApp
                      section in the{" "}
                      <a
                        href="https://developers.facebook.com/apps"
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-0.5"
                      >
                        Meta App Dashboard <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                      .
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">
                        Phone Number ID <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={cloudForm.phoneNumberId}
                        onChange={(e) => setCloudForm({ ...cloudForm, phoneNumberId: e.target.value })}
                        placeholder="e.g. 123456789012345"
                        className={`w-full px-3 py-2 text-xs rounded-lg border outline-none transition-all focus:border-indigo-500 ${
                          isLight
                            ? "bg-white border-slate-200 text-slate-900 placeholder-slate-400"
                            : "bg-slate-900/60 border-slate-800 text-white placeholder-slate-600"
                        }`}
                      />
                      <p className="text-[9px] text-slate-500 mt-1">
                        The numeric ID of your sending number, not the number itself.
                      </p>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">
                        WhatsApp Business Account ID
                      </label>
                      <input
                        type="text"
                        value={cloudForm.wabaId}
                        onChange={(e) => setCloudForm({ ...cloudForm, wabaId: e.target.value })}
                        placeholder="e.g. 987654321098765"
                        className={`w-full px-3 py-2 text-xs rounded-lg border outline-none transition-all focus:border-indigo-500 ${
                          isLight
                            ? "bg-white border-slate-200 text-slate-900 placeholder-slate-400"
                            : "bg-slate-900/60 border-slate-800 text-white placeholder-slate-600"
                        }`}
                      />
                      <p className="text-[9px] text-slate-500 mt-1">Optional. Enables template listing.</p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">
                      Permanent Access Token <span className="text-rose-400">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showAccessToken ? "text" : "password"}
                        value={cloudForm.accessToken}
                        onChange={(e) => setCloudForm({ ...cloudForm, accessToken: e.target.value })}
                        placeholder="EAAG..."
                        className={`w-full px-3 py-2 pr-10 text-xs rounded-lg border outline-none transition-all focus:border-indigo-500 font-mono ${
                          isLight
                            ? "bg-white border-slate-200 text-slate-900 placeholder-slate-400"
                            : "bg-slate-900/60 border-slate-800 text-white placeholder-slate-600"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowAccessToken(!showAccessToken)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
                      >
                        {showAccessToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <p className="text-[9px] text-slate-500 mt-1">
                      Use a System User token from Business Settings. Temporary tokens expire in 24 hours.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">
                        Webhook Verify Token <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={cloudForm.verifyToken}
                        onChange={(e) => setCloudForm({ ...cloudForm, verifyToken: e.target.value })}
                        placeholder="any-secret-string-you-choose"
                        className={`w-full px-3 py-2 text-xs rounded-lg border outline-none transition-all focus:border-indigo-500 ${
                          isLight
                            ? "bg-white border-slate-200 text-slate-900 placeholder-slate-400"
                            : "bg-slate-900/60 border-slate-800 text-white placeholder-slate-600"
                        }`}
                      />
                      <p className="text-[9px] text-slate-500 mt-1">
                        A custom string you create. Must match the token you set in Meta webhook settings.
                      </p>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">
                        App Secret
                      </label>
                      <div className="relative">
                        <input
                          type={showAppSecret ? "text" : "password"}
                          value={cloudForm.appSecret}
                          onChange={(e) => setCloudForm({ ...cloudForm, appSecret: e.target.value })}
                          placeholder="Enables webhook signature checks"
                          className={`w-full px-3 py-2 pr-10 text-xs rounded-lg border outline-none transition-all focus:border-indigo-500 font-mono ${
                            isLight
                              ? "bg-white border-slate-200 text-slate-900 placeholder-slate-400"
                              : "bg-slate-900/60 border-slate-800 text-white placeholder-slate-600"
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowAppSecret(!showAppSecret)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
                        >
                          {showAppSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <p className="text-[9px] text-slate-500 mt-1">
                        Recommended. Lets us verify inbound webhooks really came from Meta.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                          Default Template
                        </label>
                        <button
                          type="button"
                          onClick={loadCloudTemplates}
                          disabled={loadingTemplates || !cloudConfigured}
                          className="text-[9px] font-bold text-indigo-400 hover:text-indigo-300 cursor-pointer disabled:opacity-40 flex items-center gap-1"
                        >
                          {loadingTemplates ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Plus className="w-2.5 h-2.5" />}
                          {cloudTemplates ? "Reload" : "Load from Meta"}
                        </button>
                      </div>

                      {cloudTemplates && cloudTemplates.length > 0 ? (
                        <select
                          value={cloudForm.defaultTemplateName}
                          onChange={(e) => {
                            const picked = cloudTemplates.find((t) => t.name === e.target.value);
                            setCloudForm({
                              ...cloudForm,
                              defaultTemplateName: e.target.value,
                              // Keep the language in step with the chosen template,
                              // since a mismatch is rejected by Meta at send time.
                              defaultTemplateLang: picked?.language || cloudForm.defaultTemplateLang,
                            });
                          }}
                          className={`w-full px-3 py-2 text-xs rounded-lg border outline-none transition-all focus:border-indigo-500 cursor-pointer ${
                            isLight
                              ? "bg-white border-slate-200 text-slate-900"
                              : "bg-slate-900/60 border-slate-800 text-white"
                          }`}
                        >
                          <option value="">No template selected</option>
                          {cloudTemplates.map((t) => (
                            <option key={`${t.name}-${t.language}`} value={t.name} disabled={t.status !== "APPROVED"}>
                              {t.name} ({t.language}){t.status !== "APPROVED" ? ` — ${t.status}` : ""}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={cloudForm.defaultTemplateName}
                          onChange={(e) => setCloudForm({ ...cloudForm, defaultTemplateName: e.target.value })}
                          placeholder="e.g. lead_intro"
                          className={`w-full px-3 py-2 text-xs rounded-lg border outline-none transition-all focus:border-indigo-500 ${
                            isLight
                              ? "bg-white border-slate-200 text-slate-900 placeholder-slate-400"
                              : "bg-slate-900/60 border-slate-800 text-white placeholder-slate-600"
                          }`}
                        />
                      )}
                      <p className="text-[9px] text-slate-500 mt-1">
                        Used for cold outreach when the 24-hour reply window is closed.
                        {!cloudForm.defaultTemplateName && (
                          <span className="text-amber-400"> Without one, cold campaigns cannot send.</span>
                        )}
                      </p>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">
                        Template Language
                      </label>
                      <input
                        type="text"
                        value={cloudForm.defaultTemplateLang}
                        onChange={(e) => setCloudForm({ ...cloudForm, defaultTemplateLang: e.target.value })}
                        placeholder="en_US"
                        className={`w-full px-3 py-2 text-xs rounded-lg border outline-none transition-all focus:border-indigo-500 ${
                          isLight
                            ? "bg-white border-slate-200 text-slate-900 placeholder-slate-400"
                            : "bg-slate-900/60 border-slate-800 text-white placeholder-slate-600"
                        }`}
                      />
                      <p className="text-[9px] text-slate-500 mt-1">Must match the approved template locale.</p>
                    </div>
                  </div>

                  <div className={`flex flex-wrap gap-2.5 border-t pt-4 ${
                    isLight ? "border-slate-200" : "border-[#1e293b]/60"
                  }`}>
                    <button
                      onClick={saveCloudConfig}
                      disabled={cloudSaving}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg cursor-pointer transition-all shadow-md shadow-indigo-600/10 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {cloudSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      {cloudSaving ? "Saving..." : "Save & Connect"}
                    </button>
                    <button
                      onClick={testCloudConnection}
                      disabled={cloudTesting}
                      className={`px-4 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5 ${
                        isLight
                          ? "border-slate-200 text-slate-600 hover:bg-slate-50"
                          : "border-slate-800 text-slate-300 hover:bg-slate-850"
                      }`}
                    >
                      {cloudTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-emerald-500" />}
                      Test Connection
                    </button>
                  </div>
                </div>

                {/* Webhook configuration */}
                <div className={`border rounded-2xl p-6 space-y-4 ${
                  isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
                }`}>
                  <div className={`pb-3 border-b ${isLight ? "border-slate-200" : "border-[#1e293b]/60"}`}>
                    <div className="flex items-center gap-2">
                      <FileCode className="h-4.5 w-4.5 text-indigo-400" />
                      <h3 className={`text-sm font-semibold ${isLight ? "text-slate-800" : "text-white"}`}>
                        Webhook Configuration
                      </h3>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                      Use this URL as your webhook callback in the Meta App Dashboard. It receives lead replies and
                      delivery receipts, which is what powers the Conversations inbox.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">
                      Callback URL
                    </label>
                    <div className="flex gap-2">
                      <input
                        readOnly
                        value={webhookUrl}
                        className={`flex-1 px-3 py-2 text-xs rounded-lg border outline-none font-mono ${
                          isLight
                            ? "bg-slate-50 border-slate-200 text-slate-700"
                            : "bg-slate-900/60 border-slate-800 text-slate-300"
                        }`}
                      />
                      <button
                        onClick={copyWebhookUrl}
                        className={`px-3.5 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
                          isLight
                            ? "border-slate-200 text-slate-600 hover:bg-slate-50"
                            : "border-slate-800 text-slate-300 hover:bg-slate-850"
                        }`}
                      >
                        {copiedWebhook ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <FileCode className="w-3.5 h-3.5" />}
                        {copiedWebhook ? "Copied" : "Copy"}
                      </button>
                    </div>
                    {webhookUrl.startsWith("http://") && (
                      <p className="text-[9px] text-amber-400 mt-1.5 flex items-center gap-1">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        Meta requires HTTPS. Set PUBLIC_BASE_URL to your public HTTPS domain.
                      </p>
                    )}
                    <p className="text-[9px] text-slate-500 mt-1.5">
                      Subscribe to the <strong className={isLight ? "text-slate-700" : "text-slate-300"}>messages</strong> field
                      so replies reach your inbox.
                    </p>
                  </div>

                  {/* End-to-end delivery test */}
                  <div className={`border-t pt-4 ${isLight ? "border-slate-200" : "border-[#1e293b]/60"}`}>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">
                      Send a Test Message
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={cloudTestPhone}
                        onChange={(e) => setCloudTestPhone(e.target.value)}
                        placeholder="Recipient number with country code"
                        className={`flex-1 px-3 py-2 text-xs rounded-lg border outline-none transition-all focus:border-indigo-500 ${
                          isLight
                            ? "bg-white border-slate-200 text-slate-900 placeholder-slate-400"
                            : "bg-slate-900/60 border-slate-800 text-white placeholder-slate-600"
                        }`}
                      />
                      <button
                        onClick={sendCloudTestMessage}
                        disabled={sendingCloudTest || !cloudConfigured}
                        className="px-4 py-2 bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border border-emerald-500/25 text-xs font-bold rounded-lg cursor-pointer transition-all disabled:opacity-50 shrink-0 flex items-center gap-1.5"
                      >
                        {sendingCloudTest ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageCircle className="w-3.5 h-3.5" />}
                        {sendingCloudTest ? "Sending..." : "Send Test"}
                      </button>
                    </div>
                    <p className="text-[9px] text-slate-500 mt-1.5">
                      A plain text test only works if that number messaged your business in the last 24 hours.
                      Otherwise WhatsApp requires an approved template.
                    </p>
                  </div>
                </div>
              </div>
              )}
            </>
            )}
          </div>

          <div className="lg:col-span-4 space-y-6">
            <div className={`p-5 rounded-2xl border font-sans space-y-3.5 ${
              isLight 
                ? "bg-indigo-50/50 border-indigo-200 text-indigo-950" 
                : "bg-indigo-500/5 border-indigo-500/15 text-indigo-400"
            }`}>
              {waProvider === "cloud" ? (
                <>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4.5 h-4.5 text-indigo-500" />
                    <h4 className="font-bold text-xs">Official API Setup Guide</h4>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    Connect the WhatsApp Business account you already own through Meta.
                  </p>
                  <ol className="text-[10px] space-y-1.5 list-decimal pl-4 leading-relaxed text-slate-400">
                    <li>In the <strong className={isLight ? "text-slate-800" : "text-white"}>Meta App Dashboard</strong>, open your app and go to <strong className={isLight ? "text-slate-800" : "text-white"}>WhatsApp → API Setup</strong>.</li>
                    <li>Copy the <strong className={isLight ? "text-slate-800" : "text-white"}>Phone Number ID</strong> and <strong className={isLight ? "text-slate-800" : "text-white"}>WhatsApp Business Account ID</strong>.</li>
                    <li>Create a <strong className={isLight ? "text-slate-800" : "text-white"}>System User</strong> in Business Settings and generate a permanent token with <em>whatsapp_business_messaging</em> permission.</li>
                    <li>Invent a <strong className={isLight ? "text-slate-800" : "text-white"}>Verify Token</strong> and paste the same string here and in Meta.</li>
                    <li>Under <strong className={isLight ? "text-slate-800" : "text-white"}>Configuration → Webhook</strong>, paste the callback URL and subscribe to <strong className={isLight ? "text-slate-800" : "text-white"}>messages</strong>.</li>
                    <li>Save here, then hit <strong className={isLight ? "text-slate-800" : "text-white"}>Test Connection</strong>.</li>
                  </ol>
                  <div className="pt-1 border-t border-indigo-500/15">
                    <p className="text-[10px] leading-relaxed text-amber-400/90 flex items-start gap-1.5">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>
                        WhatsApp only allows free-form text within 24 hours of a lead messaging you. Cold campaigns
                        need an approved template, so submit one in Meta and set it as your default above.
                      </span>
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4.5 h-4.5 text-indigo-500" />
                    <h4 className="font-bold text-xs">WhatsApp Scanning Guide</h4>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    Scan the QR code to authenticate the headless browser session.
                  </p>
                  <ol className="text-[10px] space-y-1.5 list-decimal pl-4 leading-relaxed text-slate-400">
                    <li>Open <strong className={isLight ? "text-slate-800" : "text-white"}>WhatsApp</strong> on your phone.</li>
                    <li>Tap <strong className={isLight ? "text-slate-800" : "text-white"}>Menu</strong> or Settings and select <strong className={isLight ? "text-slate-800" : "text-white"}>Linked Devices</strong>.</li>
                    <li>Tap <strong className={isLight ? "text-slate-800" : "text-white"}>Link a Device</strong>.</li>
                    <li>Point your camera at the QR code on the left to scan.</li>
                  </ol>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
