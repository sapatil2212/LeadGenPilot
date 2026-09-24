/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed fetch helper for the Phase 3 and Phase 4 APIs.
 *
 * The backend answers failures with a consistent envelope — `{ error, code }`,
 * plus `permission` on a 403 and `attempts` on a 503 — so one place can turn any
 * of them into a message worth showing. That matters more than usual here: these
 * endpoints refuse for several genuinely different reasons (no workspace, wrong
 * role, no AI provider configured, nothing set up yet) and "Request failed" would
 * hide the one thing the user needs to know.
 */

export interface ApiErrorBody {
  error?: string;
  code?: string;
  permission?: string;
  attempts?: { provider: string; message: string }[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly permission?: string;
  readonly attempts?: { provider: string; message: string }[];

  constructor(status: number, body: ApiErrorBody) {
    super(body.error || defaultMessage(status, body.code));
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.permission = body.permission;
    this.attempts = body.attempts;
  }

  /** True when the user's role is the problem, so the UI can say so plainly. */
  get isPermissionDenied(): boolean {
    return this.status === 403 && this.code === "permission_denied";
  }

  /** True when no AI provider answered — a retry may well work. */
  get isAiUnavailable(): boolean {
    return this.status === 503 && this.code === "ai_unavailable";
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

function defaultMessage(status: number, code?: string): string {
  if (code === "no_session") return "Your session has expired. Sign in again.";
  if (code === "no_tenant") return "No workspace is associated with this account.";
  if (code === "tenant_required") return "Choose which workspace to work in.";
  if (status === 0) return "Could not reach the server.";
  return `The request failed (${status}).`;
}

async function readBody(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 300) };
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "include",
      ...(body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, { error: "Could not reach the server." });
  }

  const parsed = await readBody(res);
  if (!res.ok) throw new ApiError(res.status, parsed ?? {});
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  del: <T>(path: string) => request<T>("DELETE", path),

  /**
   * Multipart upload. Deliberately does not set Content-Type: the browser has to
   * generate the multipart boundary itself, and setting the header by hand makes
   * multer reject the body.
   */
  async upload<T>(path: string, form: FormData): Promise<T> {
    let res: Response;
    try {
      res = await fetch(path, { method: "POST", credentials: "include", body: form });
    } catch {
      throw new ApiError(0, { error: "Could not reach the server." });
    }
    const parsed = await readBody(res);
    if (!res.ok) throw new ApiError(res.status, parsed ?? {});
    return parsed as T;
  },
};

/** Turns any thrown value into something displayable. */
export function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared response shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface BusinessProfileView {
  businessName: string | null;
  industry: string | null;
  businessType: string | null;
  website: string | null;
  description: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  locationsServed: string[];
  targetCustomerTypes: string[];
  targetIndustries: string[];
  uniqueSellingPoints: string[];
  certifications: string[];
  decisionMakerRoles: string[];
  brandVoice: string | null;
  salesObjectives: string | null;
  aiConfidence: number | null;
  missingInformation: string[];
  lastExtractedAt: string | null;
  completeness: number;
}

export interface ProductView {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  keyFeatures: string[];
  idealFor: string[];
  priceRange: string | null;
  status: string;
}

export interface ServiceView {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  idealFor: string[];
  priceRange: string | null;
  status: string;
}

export interface DocumentView {
  id: string;
  title: string;
  originalName: string;
  fileType: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  error: string | null;
  charCount: number | null;
  chunkCount: number | null;
  category: string | null;
  embedded: boolean;
  embeddingModel: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface KnowledgeStats {
  documents: number;
  ready: number;
  failed: number;
  processing: number;
  chunks: number;
  embeddedChunks: number;
  searchable: boolean;
  embeddingsAvailable: boolean;
}

export interface KnowledgeItemView {
  id: string;
  category: string;
  label: string;
  value: string;
  confidence: number;
  source: string;
  sourceDocumentId: string | null;
  createdAt: string;
}

export interface RetrievedChunkView {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  score: number;
  method: "embedding" | "keyword";
}

export interface ConversationView {
  id: string;
  title: string | null;
  kind: string;
  messageCount: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantMessageView {
  id: string;
  role: string;
  content: string;
  provider: string | null;
  model: string | null;
  promptName: string | null;
  promptVersion: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  citedChunkIds: string[];
  createdAt: string;
}

export interface AskResult {
  conversationId: string;
  answer: string;
  citations: {
    chunkId: string;
    documentId: string;
    documentTitle: string;
    score: number;
    method: string;
  }[];
  provider: string;
  model: string;
  promptName: string;
  promptVersion: number;
  totalTokens: number | null;
  latencyMs: number;
  messages: AssistantMessageView[];
}

export interface IcpView {
  id: string;
  name: string;
  description: string | null;
  targetCategories: string[];
  targetIndustries: string[];
  targetLocations: string[];
  decisionMakerRoles: string[];
  excludeCategories: string[];
  excludeKeywords: string[];
  requiredSignals: string[];
  preferredSignals: string[];
  minRating: number | null;
  minReviews: number | null;
  maxResults: number;
  radiusKm: number | null;
  deepAnalysis: boolean;
  isDefault: boolean;
  status: string;
  aiConfidence: number | null;
  lastSuggestedAt: string | null;
  completeness: number;
  readyForDiscovery: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IcpSuggestion {
  name: string | null;
  description: string | null;
  targetCategories: string[];
  targetIndustries: string[];
  targetLocations: string[];
  decisionMakerRoles: string[];
  excludeCategories: string[];
  excludeKeywords: string[];
  rationale: string | null;
  missingInformation: string[];
  confidence: number;
}

export interface SignalListing {
  id: string;
  label: string;
  category: string;
  description: string;
  exclusiveGroup?: string;
  thresholdLabel?: string;
  defaultThreshold?: number;
}

export interface ScoringRule {
  id: string;
  signal: string;
  label?: string;
  points: number;
  when?: number;
  enabled?: boolean;
}

export interface RuleSetView {
  id: string;
  name: string;
  description: string | null;
  version: number;
  rules: ScoringRule[];
  hotThreshold: number;
  warmThreshold: number;
  maxScore: number;
  hotAtPoints: number;
  warmAtPoints: number;
  isDefault: boolean;
  isBuiltIn: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScorePreview {
  score: number;
  max: number;
  ratio: number;
  priority: "HOT" | "WARM" | "COLD";
  breakdown: { signal: string; label: string; points: number }[];
  ruleSetVersion: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5: Campaign generation with approval
// ─────────────────────────────────────────────────────────────────────────────

export interface CampaignView {
  id: string;
  name: string;
  status: string;
  sourceType: string;
  sourceListId: string | null;
  channels: { email: boolean; whatsapp: boolean };
  totalMessages: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignMessageView {
  id: string;
  businessName: string;
  recipient: string;
  channel: string;
  subject: string | null;
  body: string;
  status: string;
  rejectionReason: string | null;
  errorMessage: string | null;
  leadId: string | null;
  createdAt: string;
}

export interface CampaignDetailView extends CampaignView {
  messages: CampaignMessageView[];
}
