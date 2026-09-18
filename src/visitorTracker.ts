/**
 * Website visitor tracking middleware + analytics queries.
 *
 * Records page views for HTML page requests (skips API, static assets, bots)
 * and provides aggregated stats for the superadmin dashboard.
 */

import type { Request, Response, NextFunction } from "express";
import { prisma } from "./prisma";
import { logger } from "./logger";

// ── Bot detection (simple user-agent check) ──
const BOT_PATTERNS = /bot|crawl|spider|slurp|bingpreview|mediapartners|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|preview/i;

// ── Debounce: skip duplicate IP+path combos within DEBOUNCE_MS ──
const DEBOUNCE_MS = 60_000; // 60 seconds
const recentVisits = new Map<string, number>();

// Prune stale entries every 5 minutes to prevent memory growth
setInterval(() => {
  const cutoff = Date.now() - DEBOUNCE_MS;
  for (const [key, ts] of recentVisits) {
    if (ts < cutoff) recentVisits.delete(key);
  }
}, 5 * 60_000).unref();

/** Paths we never track. */
const SKIP_PREFIXES = ["/api", "/_next", "/_vite", "/__vite", "/node_modules"];
const SKIP_EXTENSIONS = /\.(js|css|map|ico|png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf|eot|json|txt|xml|webmanifest)$/i;

/**
 * Express middleware — records a PageView for qualifying HTML page requests.
 * Non-blocking: the DB write fires in the background and never delays the response.
 */
export function visitorTrackingMiddleware() {
  return (req: Request, _res: Response, next: NextFunction) => {
    next(); // never block the request

    // Only track GET requests
    if (req.method !== "GET") return;

    const path = req.path;

    // Skip API, static assets, and known framework paths
    if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return;
    if (SKIP_EXTENSIONS.test(path)) return;

    // Skip bot traffic
    const ua = req.headers["user-agent"] || "";
    if (BOT_PATTERNS.test(ua)) return;

    // Debounce: same IP + path within the window → skip
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
    const dedupeKey = `${ip}::${path}`;
    const now = Date.now();
    const lastSeen = recentVisits.get(dedupeKey);
    if (lastSeen && now - lastSeen < DEBOUNCE_MS) return;
    recentVisits.set(dedupeKey, now);

    // Fire-and-forget DB write
    const referrer = (req.headers["referer"] || req.headers["referrer"] || "") as string;
    prisma.pageView
      .create({
        data: {
          path,
          ip,
          userAgent: ua.slice(0, 500), // cap length
          referrer: referrer.slice(0, 2000) || null,
        },
      })
      .catch((err) => {
        // Silent — never crash the server for analytics
        logger.warn(`Visitor tracker: failed to record page view: ${(err as Error).message}`);
      });
  };
}

// ── Analytics queries ──

export interface VisitorStats {
  totalViews: number;
  todayViews: number;
  last7DaysViews: number;
  last30DaysViews: number;
  uniqueVisitorsToday: number;
  uniqueVisitors7Days: number;
  dailyTrend: { date: string; views: number }[];
  topPages: { path: string; views: number }[];
}

/**
 * Fetches aggregated visitor analytics for the superadmin dashboard.
 */
export async function getVisitorStats(): Promise<VisitorStats> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Run all queries in parallel
  const [
    totalViews,
    todayViews,
    last7DaysViews,
    last30DaysViews,
    uniqueToday,
    unique7Days,
    dailyRows,
    topPageRows,
  ] = await Promise.all([
    // Total all-time views
    prisma.pageView.count(),

    // Today
    prisma.pageView.count({ where: { createdAt: { gte: todayStart } } }),

    // Last 7 days
    prisma.pageView.count({ where: { createdAt: { gte: sevenDaysAgo } } }),

    // Last 30 days
    prisma.pageView.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),

    // Unique IPs today
    prisma.$queryRaw<{ cnt: bigint }[]>`
      SELECT COUNT(DISTINCT ip) AS cnt FROM page_views WHERE created_at >= ${todayStart}
    `,

    // Unique IPs last 7 days
    prisma.$queryRaw<{ cnt: bigint }[]>`
      SELECT COUNT(DISTINCT ip) AS cnt FROM page_views WHERE created_at >= ${sevenDaysAgo}
    `,

    // Daily trend (last 14 days) — raw SQL for DATE() grouping
    prisma.$queryRaw<{ day: string; views: bigint }[]>`
      SELECT DATE(created_at) AS day, COUNT(*) AS views
      FROM page_views
      WHERE created_at >= ${fourteenDaysAgo}
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `,

    // Top pages (last 30 days)
    prisma.$queryRaw<{ path: string; views: bigint }[]>`
      SELECT path, COUNT(*) AS views
      FROM page_views
      WHERE created_at >= ${thirtyDaysAgo}
      GROUP BY path
      ORDER BY views DESC
      LIMIT 10
    `,
  ]);

  // Build the 14-day trend array (fill missing days with 0)
  const dailyMap = new Map<string, number>();
  for (const row of dailyRows) {
    // MySQL DATE() returns a Date object or string depending on the driver
    const dateStr = typeof row.day === "string" ? row.day : new Date(row.day).toISOString().split("T")[0];
    dailyMap.set(dateStr, Number(row.views));
  }

  const dailyTrend: { date: string; views: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().split("T")[0];
    dailyTrend.push({ date: key, views: dailyMap.get(key) || 0 });
  }

  return {
    totalViews,
    todayViews,
    last7DaysViews,
    last30DaysViews,
    uniqueVisitorsToday: Number(uniqueToday[0]?.cnt ?? 0),
    uniqueVisitors7Days: Number(unique7Days[0]?.cnt ?? 0),
    dailyTrend,
    topPages: topPageRows.map((r) => ({ path: r.path, views: Number(r.views) })),
  };
}
