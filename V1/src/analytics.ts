/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { prisma } from "./prisma";
import { duplicateChecker } from "./duplicateChecker";
import { loadFailedLeads } from "./googleSheetsWebhook";

/**
 * Analytics and metrics for dashboard reporting.
 * Production-grade tracking for business insights.
 */

export interface DashboardMetrics {
  leads: {
    total: number;
    hot: number;
    warm: number;
    cold: number;
    today: number;
    thisWeek: number;
    thisMonth: number;
  };
  outreach: {
    emailSent: number;
    emailFailed: number;
    whatsappSent: number;
    whatsappFailed: number;
    pendingEmail: number;
    pendingWhatsapp: number;
  };
  conversion: {
    totalLeads: number;
    contacted: number;
    conversionRate: number;
  };
  sources: {
    category: string;
    count: number;
  }[];
  trends: {
    date: string;
    leadsGenerated: number;
    emailsSent: number;
    whatsappSent: number;
  }[];
}

export interface UserAnalytics {
  totalLeads: number;
  leadsThisMonth: number;
  quotaUsed: number;
  quotaLimit: number;
  quotaPercentage: number;
  campaignsRun: number;
  avgLeadScore: number;
  topCategories: { category: string; count: number }[];
}

/**
 * Compute dashboard metrics from local storage (processed-leads.json).
 */
export function getDashboardMetrics(): DashboardMetrics {
  const leads = duplicateChecker.loadLeads();
  const failedLeads = loadFailedLeads();

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Lead metrics
  const hotLeads = leads.filter((l) => l.leadPriority === "HOT");
  const warmLeads = leads.filter((l) => l.leadPriority === "WARM");
  const coldLeads = leads.filter((l) => l.leadPriority === "COLD");

  const todayLeads = leads.filter((l) => {
    const date = new Date(l.dateAdded);
    return date >= todayStart;
  });

  const weekLeads = leads.filter((l) => {
    const date = new Date(l.dateAdded);
    return date >= weekStart;
  });

  const monthLeads = leads.filter((l) => {
    const date = new Date(l.dateAdded);
    return date >= monthStart;
  });

  // Outreach metrics
  const emailSent = leads.filter((l) => l.emailStatus === "SENT").length;
  const emailFailed = leads.filter((l) => l.emailStatus === "FAILED").length;
  const whatsappSent = leads.filter((l) => l.whatsappStatus === "SENT").length;
  const whatsappFailed = leads.filter((l) => l.whatsappStatus === "FAILED").length;

  const pendingEmail = leads.filter(
    (l) => l.emails && l.emails.length > 0 && !l.emailStatus
  ).length;
  const pendingWhatsapp = leads.filter(
    (l) => l.phone && !l.whatsappStatus
  ).length;

  // Conversion tracking
  const contacted = emailSent + whatsappSent;
  const conversionRate = leads.length > 0 ? (contacted / leads.length) * 100 : 0;

  // Category breakdown
  const categoryMap = new Map<string, number>();
  leads.forEach((lead) => {
    const cat = lead.category || "Unknown";
    categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
  });
  const sources = Array.from(categoryMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Trend data (last 7 days)
  const trends: { date: string; leadsGenerated: number; emailsSent: number; whatsappSent: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split("T")[0];
    
    const dayLeads = leads.filter((l) => l.dateAdded.startsWith(dateStr));
    const dayEmails = leads.filter((l) => l.emailSentDate === dateStr);
    const dayWhatsapp = leads.filter((l) => l.whatsappSentDate === dateStr);

    trends.push({
      date: dateStr,
      leadsGenerated: dayLeads.length,
      emailsSent: dayEmails.length,
      whatsappSent: dayWhatsapp.length,
    });
  }

  return {
    leads: {
      total: leads.length,
      hot: hotLeads.length,
      warm: warmLeads.length,
      cold: coldLeads.length,
      today: todayLeads.length,
      thisWeek: weekLeads.length,
      thisMonth: monthLeads.length,
    },
    outreach: {
      emailSent,
      emailFailed,
      whatsappSent,
      whatsappFailed,
      pendingEmail,
      pendingWhatsapp,
    },
    conversion: {
      totalLeads: leads.length,
      contacted,
      conversionRate: Math.round(conversionRate * 10) / 10,
    },
    sources,
    trends,
  };
}

/**
 * Get user-specific analytics (requires database).
 */
export async function getUserAnalytics(userId: string): Promise<UserAnalytics | null> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;

    const leads = duplicateChecker.loadLeads();
    const avgScore =
      leads.length > 0
        ? leads.reduce((sum, l) => sum + (l.leadScore || 0), 0) / leads.length
        : 0;

    // Top categories
    const categoryMap = new Map<string, number>();
    leads.forEach((lead) => {
      const cat = lead.category || "Unknown";
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
    });
    const topCategories = Array.from(categoryMap.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Audit logs for campaign count (rough estimate)
    const campaignLogs = await prisma.auditLog.count({
      where: {
        userId,
        action: { contains: "campaign" },
      },
    });

    return {
      totalLeads: leads.length,
      leadsThisMonth: user.leadsUsed || 0,
      quotaUsed: user.leadsUsed || 0,
      quotaLimit: user.plan === "pro" || user.plan === "custom" ? Infinity : 100,
      quotaPercentage:
        user.plan === "pro" || user.plan === "custom"
          ? 0
          : Math.min(100, ((user.leadsUsed || 0) / 100) * 100),
      campaignsRun: campaignLogs,
      avgLeadScore: Math.round(avgScore * 10) / 10,
      topCategories,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Export analytics data to CSV format.
 */
export function exportToCSV(data: any[]): string {
  if (data.length === 0) return "";

  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers.map((header) => {
      const value = row[header];
      // Escape commas and quotes
      if (typeof value === "string" && (value.includes(",") || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    })
  );

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

/**
 * Performance metrics tracking.
 */
export class PerformanceMonitor {
  private metrics: Map<string, { count: number; totalTime: number; maxTime: number; minTime: number }> = new Map();

  track(operation: string, duration: number) {
    const existing = this.metrics.get(operation) || {
      count: 0,
      totalTime: 0,
      maxTime: 0,
      minTime: Infinity,
    };

    this.metrics.set(operation, {
      count: existing.count + 1,
      totalTime: existing.totalTime + duration,
      maxTime: Math.max(existing.maxTime, duration),
      minTime: Math.min(existing.minTime, duration),
    });
  }

  getMetrics() {
    const result: any[] = [];
    this.metrics.forEach((value, key) => {
      result.push({
        operation: key,
        count: value.count,
        avgTime: Math.round(value.totalTime / value.count),
        maxTime: value.maxTime,
        minTime: value.minTime === Infinity ? 0 : value.minTime,
      });
    });
    return result;
  }

  reset() {
    this.metrics.clear();
  }
}

export const performanceMonitor = new PerformanceMonitor();

/**
 * Middleware to track API endpoint performance.
 */
export function performanceMiddleware() {
  return (req: any, res: any, next: any) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      performanceMonitor.track(`${req.method} ${req.path}`, duration);
    });
    next();
  };
}
