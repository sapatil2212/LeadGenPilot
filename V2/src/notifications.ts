/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { prisma } from "./prisma";
import { env } from "./env";

export type NotificationType = "success" | "info" | "warning" | "error";
export type NotificationCategory = "scraper" | "campaign" | "auth" | "system" | "outreach";

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
  read: boolean;
  createdAt: Date;
}

/**
 * In-app notification system for user alerts and updates.
 * Stores notifications in memory for fast access, with database persistence.
 */
class NotificationService {
  private notifications: Map<string, Notification[]> = new Map();

  /**
   * Create a new notification for a user.
   */
  async create(
    userId: string,
    type: NotificationType,
    category: NotificationCategory,
    title: string,
    message: string,
    options?: { actionUrl?: string; actionLabel?: string }
  ): Promise<Notification> {
    const notification: Notification = {
      id: this.generateId(),
      userId,
      type,
      category,
      title,
      message,
      actionUrl: options?.actionUrl,
      actionLabel: options?.actionLabel,
      read: false,
      createdAt: new Date(),
    };

    // Store in memory
    const userNotifications = this.notifications.get(userId) || [];
    userNotifications.unshift(notification);
    
    // Keep only last 100 notifications per user in memory
    if (userNotifications.length > 100) {
      userNotifications.pop();
    }
    
    this.notifications.set(userId, userNotifications);

    // Persist to audit log if database is configured
    if (env.isDatabaseConfigured()) {
      try {
        await prisma.auditLog.create({
          data: {
            action: `notification:${category}:${type}`,
            userId,
            metadata: JSON.stringify({
              title,
              message,
              actionUrl: options?.actionUrl,
              actionLabel: options?.actionLabel,
            }),
          },
        });
      } catch (error) {
        // Silent fail - notifications are not critical
      }
    }

    return notification;
  }

  /**
   * Get all notifications for a user.
   */
  async getForUser(userId: string, unreadOnly = false): Promise<Notification[]> {
    const userNotifications = this.notifications.get(userId) || [];
    return unreadOnly ? userNotifications.filter((n) => !n.read) : userNotifications;
  }

  /**
   * Mark a notification as read.
   */
  async markAsRead(userId: string, notificationId: string): Promise<boolean> {
    const userNotifications = this.notifications.get(userId);
    if (!userNotifications) return false;

    const notification = userNotifications.find((n) => n.id === notificationId);
    if (!notification) return false;

    notification.read = true;
    return true;
  }

  /**
   * Mark all notifications as read for a user.
   */
  async markAllAsRead(userId: string): Promise<number> {
    const userNotifications = this.notifications.get(userId);
    if (!userNotifications) return 0;

    let count = 0;
    userNotifications.forEach((n) => {
      if (!n.read) {
        n.read = true;
        count++;
      }
    });
    return count;
  }

  /**
   * Delete a notification.
   */
  async delete(userId: string, notificationId: string): Promise<boolean> {
    const userNotifications = this.notifications.get(userId);
    if (!userNotifications) return false;

    const index = userNotifications.findIndex((n) => n.id === notificationId);
    if (index === -1) return false;

    userNotifications.splice(index, 1);
    return true;
  }

  /**
   * Clear all notifications for a user.
   */
  async clearAll(userId: string): Promise<number> {
    const userNotifications = this.notifications.get(userId);
    if (!userNotifications) return 0;

    const count = userNotifications.length;
    this.notifications.set(userId, []);
    return count;
  }

  /**
   * Get notification count (total and unread).
   */
  async getCount(userId: string): Promise<{ total: number; unread: number }> {
    const userNotifications = this.notifications.get(userId) || [];
    return {
      total: userNotifications.length,
      unread: userNotifications.filter((n) => !n.read).length,
    };
  }

  private generateId(): string {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ── Convenience methods for common notification types ──

  async notifyScraperComplete(userId: string, leadsCount: number) {
    await this.create(
      userId,
      "success",
      "scraper",
      "Scraping Complete",
      `Successfully scraped ${leadsCount} lead${leadsCount === 1 ? "" : "s"} from Google Maps.`,
      { actionUrl: "/leads", actionLabel: "View Leads" }
    );
  }

  async notifyScraperError(userId: string, error: string) {
    await this.create(
      userId,
      "error",
      "scraper",
      "Scraping Failed",
      `Scraper encountered an error: ${error}`,
      { actionUrl: "/settings", actionLabel: "Check Settings" }
    );
  }

  async notifyCampaignComplete(userId: string, stats: { sent: number; failed: number }) {
    await this.create(
      userId,
      "success",
      "campaign",
      "Campaign Complete",
      `Outreach campaign completed. ${stats.sent} sent, ${stats.failed} failed.`,
      { actionUrl: "/campaigns", actionLabel: "View Results" }
    );
  }

  async notifyQuotaWarning(userId: string, remaining: number, limit: number) {
    await this.create(
      userId,
      "warning",
      "system",
      "Quota Warning",
      `You've used ${limit - remaining} of ${limit} leads this month. ${remaining} remaining.`,
      { actionUrl: "/pricing", actionLabel: "Upgrade Plan" }
    );
  }

  async notifyQuotaExceeded(userId: string) {
    await this.create(
      userId,
      "error",
      "system",
      "Quota Exceeded",
      "You've reached your monthly lead limit. Upgrade to Pro for unlimited leads.",
      { actionUrl: "/pricing", actionLabel: "Upgrade Now" }
    );
  }

  async notifyWelcome(userId: string, userName?: string) {
    await this.create(
      userId,
      "info",
      "auth",
      `Welcome${userName ? ", " + userName : ""}!`,
      "Your LeadGenPilot account is ready. Start by configuring your first scraper.",
      { actionUrl: "/settings", actionLabel: "Get Started" }
    );
  }
}

export const notificationService = new NotificationService();
