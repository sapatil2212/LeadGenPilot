/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * In-memory Prisma double with REAL conditional-write semantics.
 *
 * The campaign worker's safety properties are not expressed in its control flow;
 * they are expressed in the `where` clauses of its writes. "Only one worker may
 * claim this job" is `updateMany({ where: { status: "queued" }, ... }).count === 1`.
 * A mock that returns `{ count: 1 }` unconditionally would make every one of
 * those tests pass while the guarantee was broken.
 *
 * So this double evaluates predicates against stored rows and applies updates the
 * way Prisma does:
 *   - `updateMany` only touches rows matching the predicate and returns the count
 *   - `undefined` in `data` means "leave the column alone" (not "set to null")
 *   - `{ increment: n }` is applied to the stored value
 *   - operations are serialised, so two concurrent claims cannot both win
 *
 * It is deliberately small: only the operations the executor actually issues are
 * implemented, and anything unexpected throws rather than silently succeeding.
 */

export interface FakeDbState {
  jobs: any[];
  campaigns: any[];
  campaignMessages: any[];
  campaignDispatches: any[];
  suppressions: any[];
  leads: any[];
}

function toComparable(value: any): any {
  return value instanceof Date ? value.getTime() : value;
}

function matchCondition(actual: any, condition: any): boolean {
  if (condition === null) return actual === null || actual === undefined;
  if (condition instanceof Date) return toComparable(actual) === toComparable(condition);
  if (typeof condition === "object" && condition !== null) {
    for (const [operator, operand] of Object.entries(condition)) {
      switch (operator) {
        case "in":
          if (!(operand as any[]).some((candidate) => toComparable(candidate) === toComparable(actual))) return false;
          break;
        case "notIn":
          if ((operand as any[]).some((candidate) => toComparable(candidate) === toComparable(actual))) return false;
          break;
        case "lt":
          if (!(actual !== null && actual !== undefined && toComparable(actual) < toComparable(operand))) return false;
          break;
        case "lte":
          if (!(actual !== null && actual !== undefined && toComparable(actual) <= toComparable(operand))) return false;
          break;
        case "gt":
          if (!(actual !== null && actual !== undefined && toComparable(actual) > toComparable(operand))) return false;
          break;
        case "gte":
          if (!(actual !== null && actual !== undefined && toComparable(actual) >= toComparable(operand))) return false;
          break;
        case "not":
          if (matchCondition(actual, operand)) return false;
          break;
        case "contains":
          if (!String(actual ?? "").toLowerCase().includes(String(operand).toLowerCase())) return false;
          break;
        default:
          throw new Error(`fakeCampaignDb: unsupported filter operator "${operator}"`);
      }
    }
    return true;
  }
  return toComparable(actual) === toComparable(condition);
}

export function matchWhere(row: any, where: any): boolean {
  if (!where) return true;
  for (const [field, condition] of Object.entries(where)) {
    if (field === "OR") {
      if (!(condition as any[]).some((clause) => matchWhere(row, clause))) return false;
      continue;
    }
    if (field === "AND") {
      if (!(condition as any[]).every((clause) => matchWhere(row, clause))) return false;
      continue;
    }
    if (field === "NOT") {
      if (matchWhere(row, condition)) return false;
      continue;
    }
    if (!matchCondition(row[field], condition)) return false;
  }
  return true;
}

function applyData(row: any, data: any): void {
  for (const [field, value] of Object.entries(data ?? {})) {
    // Prisma ignores undefined; treating it as null would wipe columns the
    // caller deliberately left alone (for example sentAt on a failed send).
    if (value === undefined) continue;
    if (value && typeof value === "object" && !(value instanceof Date) && "increment" in (value as any)) {
      row[field] = (row[field] ?? 0) + (value as any).increment;
      continue;
    }
    row[field] = value;
  }
  row.updatedAt = new Date();
}

function sortRows(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const [[field, direction]] = Object.entries(orderBy);
  return [...rows].sort((a, b) => {
    const left = toComparable(a[field]) ?? 0;
    const right = toComparable(b[field]) ?? 0;
    if (left === right) return 0;
    return (left < right ? -1 : 1) * (direction === "desc" ? -1 : 1);
  });
}

let idSequence = 0;
function nextId(prefix: string): string {
  idSequence += 1;
  return `${prefix}-${idSequence}`;
}

/**
 * Serialises every operation through a single promise chain. Real MySQL gives
 * the same guarantee for a single conditional statement; without it, JavaScript
 * interleaving could let two "atomic" claims both observe the pre-claim row.
 */
function createSerializer() {
  let tail: Promise<unknown> = Promise.resolve();
  return function serialize<T>(operation: () => T): Promise<T> {
    const result = tail.then(() => operation());
    tail = result.catch(() => undefined);
    return result;
  };
}

export function createFakeCampaignDb(seed: Partial<FakeDbState> = {}) {
  const state: FakeDbState = {
    jobs: seed.jobs ?? [],
    campaigns: seed.campaigns ?? [],
    campaignMessages: seed.campaignMessages ?? [],
    campaignDispatches: seed.campaignDispatches ?? [],
    suppressions: seed.suppressions ?? [],
    leads: seed.leads ?? [],
  };
  const serialize = createSerializer();

  function model(rows: () => any[], prefix: string, defaults: Record<string, unknown> = {}) {
    return {
      findFirst: ({ where, orderBy, select }: any = {}) =>
        serialize(() => {
          const matches = sortRows(rows().filter((row) => matchWhere(row, where)), orderBy);
          const found = matches[0];
          if (!found) return null;
          if (!select) return { ...found };
          const projected: any = {};
          for (const key of Object.keys(select)) projected[key] = found[key];
          return projected;
        }),
      findMany: ({ where, orderBy, skip = 0, take }: any = {}) =>
        serialize(() => {
          const matches = sortRows(rows().filter((row) => matchWhere(row, where)), orderBy);
          const page = matches.slice(skip, take ? skip + take : undefined);
          return page.map((row) => ({ ...row }));
        }),
      count: ({ where }: any = {}) => serialize(() => rows().filter((row) => matchWhere(row, where)).length),
      create: ({ data }: any) =>
        serialize(() => {
          const row = { id: data.id ?? nextId(prefix), createdAt: new Date(), updatedAt: new Date(), ...defaults, ...data };
          rows().push(row);
          return { ...row };
        }),
      updateMany: ({ where, data }: any) =>
        serialize(() => {
          const matches = rows().filter((row) => matchWhere(row, where));
          for (const row of matches) applyData(row, data);
          return { count: matches.length };
        }),
      upsert: ({ where, create, update }: any) =>
        serialize(() => {
          // Supports both a single-column unique key and Prisma's compound-key
          // form, `{ tenantId_channel_contactKey: { tenantId, channel, ... } }`.
          const [[field, value]] = Object.entries(where);
          const predicate =
            value && typeof value === "object" && !(value instanceof Date)
              ? (value as Record<string, unknown>)
              : { [field]: value };
          const existing = rows().find((row) => matchWhere(row, predicate));
          if (existing) {
            applyData(existing, update);
            return { ...existing };
          }
          const row = { id: nextId(prefix), createdAt: new Date(), updatedAt: new Date(), ...defaults, ...create };
          rows().push(row);
          return { ...row };
        }),
      groupBy: ({ by, where }: any) =>
        serialize(() => {
          const matches = rows().filter((row) => matchWhere(row, where));
          const buckets = new Map<string, any>();
          for (const row of matches) {
            const key = by.map((field: string) => String(row[field])).join("\u0000");
            if (!buckets.has(key)) {
              const entry: any = { _count: 0 };
              by.forEach((field: string) => (entry[field] = row[field]));
              buckets.set(key, entry);
            }
            buckets.get(key)._count += 1;
          }
          return Array.from(buckets.values());
        }),
      deleteMany: ({ where }: any) =>
        serialize(() => {
          const list = rows();
          let count = 0;
          for (let index = list.length - 1; index >= 0; index--) {
            if (matchWhere(list[index], where)) {
              list.splice(index, 1);
              count += 1;
            }
          }
          return { count };
        }),
    };
  }

  const prisma: any = {
    job: model(() => state.jobs, "job", { attempt: 0 }),
    campaign: model(() => state.campaigns, "campaign"),
    campaignMessage: model(() => state.campaignMessages, "message", { attemptCount: 0 }),
    campaignDispatch: model(() => state.campaignDispatches, "dispatch"),
    suppressionEntry: model(() => state.suppressions, "suppression"),
    lead: model(() => state.leads, "lead"),
    conversationThread: model(() => [], "thread"),
    conversationMessage: model(() => [], "conversation-message"),
    $transaction: async (fn: any) => (typeof fn === "function" ? fn(prisma) : Promise.all(fn)),
  };

  return { prisma, state };
}

/** A campaign message row with the columns the worker reads. */
export function messageRow(overrides: Partial<Record<string, any>> = {}): any {
  return {
    id: overrides.id ?? nextId("message"),
    campaignId: "campaign-a",
    tenantId: "tenant-a",
    leadId: null,
    businessName: "Acme Dental",
    recipient: "owner@acme.test",
    channel: "email",
    subject: "Hello",
    body: "Body copy",
    status: "approved",
    attemptCount: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    errorMessage: null,
    externalMessageId: null,
    sentAt: null,
    createdAt: new Date(Date.now() - 1_000),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function jobRow(overrides: Partial<Record<string, any>> = {}): any {
  return {
    id: overrides.id ?? nextId("job"),
    tenantId: "tenant-a",
    userId: "user-a",
    kind: "campaign",
    status: "queued",
    params: JSON.stringify({ campaignId: "campaign-a", delayMs: 0, batchSize: 25 }),
    progress: JSON.stringify({ stage: "queued", current: 0, total: 0, sent: 0, failed: 0 }),
    result: null,
    error: null,
    attempt: 0,
    workerId: null,
    leaseToken: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    cancelRequestedAt: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(Date.now() - 1_000),
    updatedAt: new Date(),
    ...overrides,
  };
}
