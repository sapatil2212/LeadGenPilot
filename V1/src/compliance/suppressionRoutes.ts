/**
 * Suppression list API.
 *
 * A router rather than inline routes so the tenant scoping, permissions and
 * validation can be exercised over real HTTP in tests instead of only through
 * the service beneath them.
 *
 * Reading opt-outs follows lead visibility; recording or clearing one is an
 * outreach decision, so it requires the same permission as editing a lead.
 */
import express, { type Request, type Response } from "express";
import { logger, logContext } from "../logger";
import { resolveTenantContext, requirePermission, ctxOf } from "../tenancy/context";
import {
  listSuppressions,
  removeSuppression,
  suppressContact,
  type SuppressionChannel,
} from "./suppressionService";

const router = express.Router();
router.use(resolveTenantContext);

function parseChannel(value: unknown): SuppressionChannel | null {
  return value === "email" || value === "whatsapp" ? value : null;
}

/** Route-local error handling: an unhandled rejection here must not hang the request. */
function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    void fn(req, res).catch((error: any) => {
      logger.error(`Suppression request failed: ${error?.message || error}`);
      if (!res.headersSent) res.status(500).json({ error: "Suppression request failed.", code: "suppression_error" });
    });
  };
}

router.get(
  "/",
  requirePermission("VIEW_LEADS"),
  handle(async (req, res) => {
    const result = await listSuppressions(ctxOf(req), {
      channel: parseChannel(req.query.channel) ?? undefined,
      search: req.query.search ? String(req.query.search) : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });
    res.json(result);
  })
);

router.post(
  "/",
  requirePermission("EDIT_LEADS"),
  handle(async (req, res) => {
    const channel = parseChannel(req.body?.channel);
    const contact = String(req.body?.contact || "").trim();
    if (!channel) return res.status(400).json({ error: "channel must be email or whatsapp.", code: "invalid_channel" });
    if (!contact) return res.status(400).json({ error: "A contact email or phone number is required.", code: "invalid_contact" });

    const ctx = ctxOf(req);
    const suppression = await suppressContact({
      tenantId: ctx.tenantId,
      channel,
      contact,
      reason: req.body?.reason ? String(req.body.reason).slice(0, 60) : "manual",
      source: "api",
      notes: req.body?.notes ? String(req.body.notes) : undefined,
    });
    logger.info(`Suppression recorded.${logContext({ tenant: ctx.tenantId, user: ctx.userId, channel, suppression: suppression.id })}`);
    res.status(201).json({ suppression });
  })
);

router.delete(
  "/",
  requirePermission("EDIT_LEADS"),
  handle(async (req, res) => {
    const channel = parseChannel(req.query.channel);
    const contact = String(req.query.contact || "").trim();
    if (!channel) return res.status(400).json({ error: "channel must be email or whatsapp.", code: "invalid_channel" });
    if (!contact) return res.status(400).json({ error: "A contact email or phone number is required.", code: "invalid_contact" });

    const removed = await removeSuppression(ctxOf(req), channel, contact);
    if (!removed) return res.status(404).json({ error: "Suppression not found.", code: "not_found" });
    res.json({ removed: true });
  })
);

export default router;
