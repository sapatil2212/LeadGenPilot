/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The published pricing table, for anyone.
 *
 * This is the only unauthenticated read of the plan catalogue, and it exists so
 * the marketing pricing section and the in-app upgrade modal show what the
 * operator actually configured at /superadmin/dashboard/plans instead of a
 * hardcoded copy that drifts from it.
 *
 * Deliberate properties:
 *  - Read-only. Every mutation stays behind requireAdmin in adminBilling.
 *  - Published fields only. Subscriber counts and revenue are operator data and
 *    are filtered out by listPublicPlans, not here.
 *  - Filtered to isActive + isPublic, so a grandfathered or draft tier is not
 *    advertised while still working for the accounts already on it.
 *  - Never fails hard: an unreadable catalogue serves the compiled defaults so
 *    the pricing section degrades to the previous prices rather than to blank.
 *
 * It must be mounted BEFORE the global apiKeyAuth() guard in server.ts —
 * visitors reading the pricing page have neither an API key nor a session.
 */

import { Router, type Request, type Response } from "express";
import {
  listPublicPlans,
  PLAN_FEATURE_KEYS,
  PLAN_FEATURE_LABELS,
} from "./admin/planCatalog";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  const { plans, source } = await listPublicPlans();

  // A pricing page may be cached briefly by the browser; an operator's edit
  // should still appear on a reload within seconds rather than minutes.
  res.set("Cache-Control", "public, max-age=30");
  res.json({
    plans,
    // Ordered keys + labels let a client render one aligned comparison table,
    // including the rows a given plan does NOT include, without hardcoding the
    // feature vocabulary in two places.
    featureKeys: [...PLAN_FEATURE_KEYS],
    featureLabels: PLAN_FEATURE_LABELS,
    source,
  });
});

export default router;
