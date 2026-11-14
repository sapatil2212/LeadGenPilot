/**
 * Campaign-time compilation of a component MessageTemplate.
 *
 * Campaigns snapshot a fully-rendered message string onto each CampaignMessage
 * at generation time; the executor sends that string verbatim and never
 * re-reads a template. So this is where a component-based WhatsApp template
 * becomes the plain text a lead will receive — rendered once per lead with the
 * lead's own variable values, through the same WhatsApp Web renderer the rest
 * of the system uses.
 */

import { prisma } from "../prisma";
import type { TenantContext } from "../tenancy/context";
import type { MessageTemplatePayload } from "./types";
import { renderForWhatsAppWeb } from "./renderers/whatsappWebRenderer";
import { resolveVariablesFromLead } from "./variables";

export interface ResolvedMessageTemplate {
  id: string;
  name: string;
  payload: MessageTemplatePayload;
}

/**
 * Load a WhatsApp MessageTemplate by id, scoped to the tenant. Returns null
 * when the id is not a MessageTemplate (so the caller can fall through to the
 * legacy OutreachTemplate path) or the template is archived.
 */
export async function resolveWhatsAppMessageTemplate(
  ctx: TenantContext,
  id: string | undefined | null
): Promise<ResolvedMessageTemplate | null> {
  if (!id) return null;
  if (!(prisma as any)?.messageTemplate?.findFirst) return null;

  const row = await prisma.messageTemplate.findFirst({
    where: { id, tenantId: ctx.tenantId, status: { not: "archived" } },
    select: { id: true, name: true, payload: true, channel: true },
  });
  if (!row || row.channel !== "whatsapp") return null;

  let payload: MessageTemplatePayload;
  try {
    payload = JSON.parse(row.payload) as MessageTemplatePayload;
  } catch {
    return null;
  }
  return { id: row.id, name: row.name, payload };
}

/**
 * Render a resolved MessageTemplate into the plain-text body for one lead.
 *
 * Produces exactly what WhatsApp Web would send: body, text-rendered CTAs and
 * quick replies, footer. Media headers are omitted from the text body (they are
 * sent as a separate attachment at delivery time, which the campaign text
 * snapshot does not carry) — the body still reads correctly without them.
 */
export function compileMessageTemplateForLead(
  template: ResolvedMessageTemplate,
  lead: Record<string, any>
): string {
  const values = resolveVariablesFromLead(lead);
  const output = renderForWhatsAppWeb(template.payload, values);
  return output.text.trim();
}

/** Increment a template's usage counter. Best-effort; never blocks a campaign. */
export async function markMessageTemplateUsed(tenantId: string, id: string): Promise<void> {
  await prisma.messageTemplate
    .updateMany({ where: { id, tenantId }, data: { usageCount: { increment: 1 } } })
    .catch(() => undefined);
}
