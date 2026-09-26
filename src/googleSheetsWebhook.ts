/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import path from "path";
import axios from "axios";
import { Lead } from "./types";
import { logger } from "./logger";
import { readJson, writeJsonAtomic } from "./storage";

const failedLeadsPath = path.join(process.cwd(), "failed-leads.json");

/**
 * Loads failed leads from failed-leads.json
 */
export function loadFailedLeads(): Lead[] {
  return readJson<Lead[]>(failedLeadsPath, []);
}

/**
 * Saves failed leads list to failed-leads.json
 */
export function saveFailedLeads(leads: Lead[]): void {
  try {
    writeJsonAtomic(failedLeadsPath, leads);
  } catch (error) {
    logger.error("Failed to write to failed-leads.json", error);
  }
}

/**
 * Adds a single lead to the failed-leads.json list
 */
export function addFailedLead(lead: Lead): void {
  const failedList = loadFailedLeads();
  // Check duplicate inside failed leads
  const exists = failedList.some(
    l => l.businessName === lead.businessName && l.address === lead.address
  );
  if (!exists) {
    failedList.push(lead);
    saveFailedLeads(failedList);
    logger.warn(`Fallback: Saved '${lead.businessName}' to failed-leads.json for future retry.`);
  }
}

/**
 * Sends a qualified lead to Google Sheets webhook with retry logic
 */
export async function sendLeadToWebhook(lead: Lead, customWebhookUrl?: string): Promise<boolean> {
  const webhookUrl = customWebhookUrl;
  
  if (!webhookUrl || webhookUrl.trim() === "" || webhookUrl === "YOUR_WEBHOOK_URL") {
    logger.warn("Google Sheet Webhook URL is not configured in Integrations.");
    return false;
  }

  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Sending '${lead.businessName}' to webhook (Attempt ${attempt}/${maxRetries})...`);
      
      const response = await axios.post(webhookUrl, lead, {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 10000,
      });

      if (response && response.status >= 200 && response.status < 300) {
        let responseData = response.data;
        if (typeof responseData === "string") {
          try {
            responseData = JSON.parse(responseData);
          } catch (e) {
            // Ignore parse errors if it's not JSON
          }
        }
        if (responseData && typeof responseData === "object" && responseData.status === "error") {
          throw new Error(`Google Apps Script error: ${responseData.message}`);
        }
        logger.success(`Webhook delivery successful for '${lead.businessName}'!`);
        return true;
      } else {
        const statusCode = response ? response.status : "unknown";
        throw new Error(`Server returned status code ${statusCode}`);
      }
    } catch (error: any) {
      let statusCode = "unknown";
      let errorMsg = error.message || String(error);

      if (error.response) {
        statusCode = String(error.response.status);
        errorMsg = JSON.stringify(error.response.data) || errorMsg;

        if (error.response.status === 403) {
          logger.error(`[403 AUTHENTICATION FAILURE] Your Google Apps Script Web App returned 403 Forbidden!`);
          logger.error(`DIAGNOSTIC ADVISORY: Please verify the sharing configurations in your active script deployment:`);
          logger.error(`1. In the Google Apps Script project editor, click "Deploy" > "Manage deployments".`);
          logger.error(`2. Click the edit (pencil) icon. Change "Execute as" to "Me" and configure "Who has access" to "Anyone" (Anonymous/public access is REQUIRED for webhook posting).`);
          logger.error(`3. Create a NEW DEPLOYMENT (very important: Apps Script will not update your script changes on old links unless you create a new deployment) and paste the updated link in your .env configuration.`);
        } else if (error.response.status === 405) {
          logger.error(`[405 METHOD NOT ALLOWED] Server returned 405 Method Not Allowed.`);
          logger.error(`DIAGNOSTIC ADVISORY: Please ensure that your Apps Script Web App has a 'doPost(e)' function implemented, is deployed as a Web App, and the deployment is active.`);
        }
      }

      logger.error(`Attempt ${attempt} failed for '${lead.businessName}' (status: ${statusCode}): ${errorMsg}`);
      
      if (attempt < maxRetries) {
        // Wait briefly before retrying
        const delay = attempt * 1500;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // If we reach here, all retries failed
  logger.error(`Webhook delivery permanently failed for '${lead.businessName}' after 3 attempts.`);
  addFailedLead(lead);
  return false;
}

/**
 * Retries all failed leads from failed-leads.json
 */
export async function retryFailedLeads(customWebhookUrl?: string): Promise<{ succeeded: number; failed: number }> {
  const failedList = loadFailedLeads();
  if (failedList.length === 0) {
    logger.info("No failed leads found to retry.");
    return { succeeded: 0, failed: 0 };
  }

  logger.info(`Found ${failedList.length} failed leads. Retrying delivery...`);
  const remainingFailed: Lead[] = [];
  let succeededCount = 0;

  for (const lead of failedList) {
    const success = await sendLeadToWebhook(lead, customWebhookUrl);
    if (success) {
      succeededCount++;
    } else {
      remainingFailed.push(lead);
    }
  }

  saveFailedLeads(remainingFailed);
  logger.success(`Retry finished. Successfully processed: ${succeededCount}, remaining: ${remainingFailed.length}`);
  
  return {
    succeeded: succeededCount,
    failed: remainingFailed.length
  };
}

/**
 * Fetches the active list of leads directly from the Google Sheet via Web App GET request,
 * optionally filtered by a specific sub-sheet (tab) name.
 */
export async function fetchLeadsFromGoogleSheet(sheetName?: string, customWebhookUrl?: string): Promise<Lead[]> {
  const webhookUrl = customWebhookUrl;
  if (!webhookUrl || webhookUrl.trim() === "" || webhookUrl === "YOUR_WEBHOOK_URL") {
    logger.warn("Google Sheet webhook URL is not configured in Integrations. Cannot fetch leads.");
    throw new Error("Google Sheet integration is not connected. Please connect your Google Sheet under Settings > Integrations.");
  }

  try {
    logger.info(`Fetching active leads list directly from Google Sheet${sheetName ? ` (tab: ${sheetName})` : ""}...`);
    const url = sheetName ? `${webhookUrl}?sheet=${encodeURIComponent(sheetName)}` : webhookUrl;
    
    // axios handles redirects (302) by default
    const response = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5
    });

    if (response && Array.isArray(response.data)) {
      logger.success(`Successfully fetched ${response.data.length} leads from Google Sheet.`);
      const normalizedLeads = response.data.map((rawLead: any) => {
        const lead = { ...rawLead };
        if (lead.whatsappOutreachStatus !== undefined && lead.whatsappStatus === undefined) {
          lead.whatsappStatus = lead.whatsappOutreachStatus;
        }
        return lead;
      });
      return normalizedLeads as Lead[];
    } else {
      if (response && response.data && typeof response.data === "object" && (response.data as any).status === "error") {
        logger.error(`Google Sheet Web App returned script error: ${(response.data as any).message}`);
        return [];
      }
      logger.error("Invalid response format received from Google Sheet Web App (expected JSON array).");
      if (response && response.data) {
        const rawData = String(response.data);
        const preview = rawData.substring(0, 300);
        logger.error(`Response content preview: ${preview}`);
        
        // Attempt to extract the error message from Google's standard error page
        const errorMatch = rawData.match(/class="errorMessage"[^>]*>([\s\S]*?)<\/div>/i) 
          || rawData.match(/class="errorMessage"[^>]*>([\s\S]*?)<\/span>/i)
          || rawData.match(/<div[^>]*id="error-message"[^>]*>([\s\S]*?)<\/div>/i);
        if (errorMatch && errorMatch[1]) {
          logger.error(`Extracted Google Script Error: ${errorMatch[1].replace(/<[^>]*>/g, "").trim()}`);
        } else {
          // Fallback: extract visible body text
          const bodyMatch = rawData.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
          if (bodyMatch && bodyMatch[1]) {
            const bodyText = bodyMatch[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
            logger.error(`Extracted error page text: ${bodyText.substring(0, 500)}`);
          }
        }
      }
    }
  } catch (error: any) {
    logger.error(`Failed to fetch leads from Google Sheet: ${error.message || error}`);
  }
  return [];
}

/**
 * Fetches the active list of sub-sheets (tab names) from the Google Sheet via Web App GET request.
 */
export async function fetchSheetNamesFromGoogleSheet(customWebhookUrl?: string): Promise<string[]> {
  const webhookUrl = customWebhookUrl;
  if (!webhookUrl || webhookUrl.trim() === "" || webhookUrl === "YOUR_WEBHOOK_URL") {
    logger.warn("Google Sheet webhook URL is not configured in Integrations. Cannot fetch sub-sheet names.");
    return [];
  }

  try {
    logger.info("Fetching sub-sheet names from Google Sheet...");
    const url = `${webhookUrl}?action=getSheets`;
    const response = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5
    });

    if (response && Array.isArray(response.data)) {
      logger.success(`Successfully fetched ${response.data.length} sub-sheet names from Google Sheet.`);
      return response.data as string[];
    } else {
      if (response && response.data && typeof response.data === "object" && (response.data as any).status === "error") {
        logger.error(`Google Sheet Web App returned script error: ${(response.data as any).message}`);
        return [];
      }
      logger.error("Invalid response format received from Google Sheet Web App when getting sheet names.");
    }
  } catch (error: any) {
    logger.error(`Failed to fetch sub-sheet names from Google Sheet: ${error.message || error}`);
  }
  return [];
}

/**
 * Synchronize a durable campaign's terminal outreach state to the workspace's
 * connected Google Sheet.
 *
 * Delivery has already happened when this runs, so a Sheet outage must never
 * cause the SMTP/WhatsApp provider call to be repeated. The webhook gets its
 * own short retries and returns false for logging/repair instead.
 */
export async function syncCampaignOutreachToGoogleSheet(options: {
  webhookUrl: string;
  businessName: string;
  mapsUrl?: string;
  channel: "email" | "whatsapp";
  status: "SENT" | "FAILED";
}): Promise<boolean> {
  const webhookUrl = String(options.webhookUrl || "").trim();
  if (!webhookUrl || webhookUrl === "YOUR_WEBHOOK_URL") return false;

  const date = new Date().toISOString().split("T")[0];
  const payload = {
    action: "updateOutreach",
    businessName: options.businessName,
    mapsUrl: options.mapsUrl || "",
    emailStatus: options.channel === "email" ? options.status : undefined,
    emailSentDate: options.channel === "email" ? date : undefined,
    whatsappStatus: options.channel === "whatsapp" ? options.status : undefined,
    whatsappSentDate: options.channel === "whatsapp" ? date : undefined,
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.post(webhookUrl, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 8_000,
      });
      let data = response.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          // A successful Apps Script deployment can return an empty/plain body.
        }
      }
      if (data && typeof data === "object" && data.status === "error") {
        throw new Error(`Google Apps Script error: ${data.message || "unknown error"}`);
      }
      logger.success(
        `Synchronized ${options.channel} ${options.status} status for '${options.businessName}' to the workspace Google Sheet.`
      );
      return true;
    } catch (error: any) {
      if (attempt === 3) {
        logger.warn(
          `Could not synchronize campaign status for '${options.businessName}' to Google Sheets after 3 attempts: ${error?.message || error}`
        );
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }

  return false;
}
