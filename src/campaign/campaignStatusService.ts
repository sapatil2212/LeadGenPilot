/**
 * Campaign execution status for the dashboard.
 *
 * Read from the caller's own durable job row plus the campaign's message rows,
 * never from process globals. That matters for three reasons the old globals
 * could not satisfy: progress survives an API restart, one workspace can never
 * observe another's run, and the numbers shown in the status panel are derived
 * from the same rows the report is derived from, so the two cannot disagree.
 */
import { prisma } from "../prisma";
import { getLatestJob, isTerminal } from "../tenancy/jobService";
import type { TenantContext } from "../tenancy/context";

export interface CampaignProgressView {
  current: number;
  total: number;
  status: string;
  secondsRemaining: number;
  emailsSent: number;
  emailsFailed: number;
  whatsappSent: number;
  whatsappFailed: number;
  skipped: number;
}

export interface CampaignStatusView {
  isRunning: boolean;
  jobId: string | null;
  jobStatus: string | null;
  campaignId: string | null;
  cancelRequested: boolean;
  progress: CampaignProgressView;
}

export const IDLE_PROGRESS: CampaignProgressView = {
  current: 0,
  total: 0,
  status: "Idle",
  secondsRemaining: 0,
  emailsSent: 0,
  emailsFailed: 0,
  whatsappSent: 0,
  whatsappFailed: 0,
  skipped: 0,
};

function labelFor(jobStatus: string, current: number, total: number, error: string | null): string {
  switch (jobStatus) {
    case "queued":
      return "Queued — waiting for a worker";
    case "running":
      return `Sending ${current}/${total}`;
    case "cancelling":
      return "Cancelling…";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return `Failed: ${error || "unknown error"}`;
    default:
      return "Completed";
  }
}

export async function getCampaignStatus(ctx: TenantContext): Promise<CampaignStatusView> {
  const job = await getLatestJob(ctx, "campaign");
  const campaignId = typeof job?.params?.campaignId === "string" ? (job.params.campaignId as string) : null;

  if (!job || !campaignId) {
    return { isRunning: false, jobId: null, jobStatus: null, campaignId: null, cancelRequested: false, progress: { ...IDLE_PROGRESS } };
  }

  const grouped = await prisma.campaignMessage.groupBy({
    by: ["channel", "status"],
    where: { campaignId, tenantId: ctx.tenantId },
    _count: true,
  });
  const countOf = (channel: string, status: string) =>
    grouped.find((row: any) => row.channel === channel && row.status === status)?._count || 0;

  const emailsSent = countOf("email", "sent");
  const emailsFailed = countOf("email", "failed");
  const whatsappSent = countOf("whatsapp", "sent");
  const whatsappFailed = countOf("whatsapp", "failed");
  const skipped = countOf("email", "suppressed") + countOf("whatsapp", "suppressed");
  // Rejected and not-yet-reviewed messages were never part of this run, so they
  // must not inflate the denominator the progress bar divides by.
  const total = grouped
    .filter((row: any) => row.status !== "rejected" && row.status !== "pending_review")
    .reduce((sum: number, row: any) => sum + row._count, 0);
  const current = emailsSent + emailsFailed + whatsappSent + whatsappFailed + skipped;

  return {
    isRunning: !isTerminal(job.status),
    jobId: job.id,
    jobStatus: job.status,
    campaignId,
    cancelRequested: job.cancelRequested,
    progress: {
      ...IDLE_PROGRESS,
      status: labelFor(job.status, current, total, job.error),
      current,
      total,
      emailsSent,
      emailsFailed,
      whatsappSent,
      whatsappFailed,
      skipped,
    },
  };
}
