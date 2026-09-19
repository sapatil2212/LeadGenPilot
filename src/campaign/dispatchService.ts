import { prisma } from "../prisma";

export interface DispatchInput {
  tenantId: string; campaignId?: string; campaignMessageId?: string; leadId?: string;
  businessName: string; recipient: string; channel: "email" | "whatsapp";
  status: "SENT" | "FAILED"; sourceType: string; sourceLabel: string;
  subject?: string | null; messageSnippet?: string; errorMessage?: string;
  externalMessageId?: string; dryRun?: boolean; occurredAt?: Date;
}

function dataFor(input: DispatchInput) {
  return {
    tenantId: input.tenantId, campaignId: input.campaignId ?? null, campaignMessageId: input.campaignMessageId ?? null,
    leadId: input.leadId ?? null, businessName: input.businessName, recipient: input.recipient, channel: input.channel,
    status: input.status, sourceType: input.sourceType, sourceLabel: input.sourceLabel, dryRun: input.dryRun ?? false,
    subject: input.subject ?? null, messageSnippet: input.messageSnippet?.slice(0, 500) ?? null,
    errorMessage: input.errorMessage?.slice(0, 500) ?? null, externalMessageId: input.externalMessageId ?? null,
    occurredAt: input.occurredAt ?? new Date(),
  };
}

/** Append a non-campaign report row. Campaign messages use the idempotent path below. */
export async function recordDispatch(input: DispatchInput): Promise<void> {
  await prisma.campaignDispatch.create({ data: dataFor(input) });
}

/**
 * One final report per CampaignMessage. A stale worker cannot append a second
 * receipt after the lease owner has already finalised it; retries are retained
 * on the message row instead of producing contradictory delivery reports.
 */
export async function recordCampaignDispatch(input: { message: any; campaignName: string; status: "SENT" | "FAILED"; externalMessageId?: string; errorMessage?: string }): Promise<void> {
  const data = dataFor({
    tenantId: input.message.tenantId, campaignId: input.message.campaignId, campaignMessageId: input.message.id,
    leadId: input.message.leadId, businessName: input.message.businessName, recipient: input.message.recipient,
    channel: input.message.channel as "email" | "whatsapp", status: input.status, sourceType: "reviewed_campaign",
    sourceLabel: input.campaignName, subject: input.message.subject, messageSnippet: input.message.body,
    externalMessageId: input.externalMessageId, errorMessage: input.errorMessage,
  });
  await (prisma.campaignDispatch as any).upsert({ where: { campaignMessageId: input.message.id }, create: data, update: data });
}
