/**
 * Campaign delivery prerequisites.
 *
 * Readiness is checked on the server at both creation and execution. UI-only
 * checks are advisory and can be bypassed; these checks make the workspace's
 * connected Google Sheet authoritative and prevent an email campaign from
 * entering the queue without tenant-owned SMTP credentials.
 */

import type { TenantContext } from "../tenancy/context";
import { getUserIntegration } from "../userIntegrationService";

export interface CampaignChannels {
  email: boolean;
  whatsapp: boolean;
}

export interface CampaignReadiness {
  googleSheet: boolean;
  smtp: boolean;
}

function hasGoogleSheet(config: any): boolean {
  const url = String(config?.webhookUrl || "").trim();
  return Boolean(url && url !== "YOUR_WEBHOOK_URL");
}

function hasSmtp(config: any): boolean {
  const port = Number(config?.port);
  return Boolean(
    String(config?.host || "").trim() &&
      String(config?.user || "").trim() &&
      String(config?.password || "").trim() &&
      Number.isInteger(port) &&
      port >= 1 &&
      port <= 65_535
  );
}

export async function getCampaignReadiness(ctx: TenantContext): Promise<CampaignReadiness> {
  const envSheetUrl = String(
    process.env.GOOGLE_SHEETS_WEBHOOK_URL || process.env.GOOGLE_SHEET_WEBHOOK_URL || ""
  ).trim();
  const hasEnvSheet = Boolean(envSheetUrl && envSheetUrl !== "YOUR_WEBHOOK_URL");

  if (!ctx.userId) return { googleSheet: hasEnvSheet, smtp: false };

  const [googleSheet, smtp] = await Promise.all([
    getUserIntegration(ctx.userId, "google_sheet", ctx.tenantId),
    getUserIntegration(ctx.userId, "smtp", ctx.tenantId),
  ]);

  return {
    googleSheet: hasGoogleSheet(googleSheet) || hasEnvSheet,
    smtp: hasSmtp(smtp),
  };
}

export async function assertCampaignReadiness(
  ctx: TenantContext,
  channels: CampaignChannels
): Promise<CampaignReadiness> {
  const readiness = await getCampaignReadiness(ctx);

  if (channels.email && !readiness.smtp) {
    throw new Error(
      "SMTP email is not configured for this workspace. Connect SMTP in Integrations before creating or starting an email campaign."
    );
  }

  return readiness;
}
