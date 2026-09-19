# Phase 8 — production reliability and operations

Phase 7 introduced the durable queue and a separate worker. Phase 8 hardened the
parts of that path that only fail in production: lease renewal during slow
provider calls, shutdown, database outages, compliance, and the reconciliation
between what was sent and what the product reports.

## Deployment topology

Three processes, one database. The API and the worker share no state except
MySQL, so either can be restarted or scaled without coordinating with the other.

```
API (Express, serves the dashboard)  ─┐
                                      ├─ MySQL (durable jobs, leases, reports)
Campaign worker (1..N replicas)      ─┘
```

### Exact deployment commands

```powershell
npm ci
npm run prisma:generate
npm run prisma:migrate        # prisma migrate deploy — run BEFORE starting either process
npm run verify:migrations     # asserts the migration history alone builds the schema
npm run build                 # landing (Next.js) + dashboard (Vite) + server.cjs + worker.cjs
npm start                     # API           (dist/server.cjs)
npm run worker                # worker        (dist/worker.cjs), repeat per replica
```

Local worker iteration: `npm run worker:dev`.

Render already declares both services (`nexaleadai`, `nexaleadai-campaign-worker`).
Scale the worker by raising its replica count; no configuration changes are
needed because replicas coordinate through database leases.

### Worker environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — | Required. Same database as the API. |
| `ENCRYPTION_KEY` | — | Required. Decrypts tenant integration credentials. |
| `WORKER_ID` | generated | Leave unset unless every replica gets a unique value. |
| `CAMPAIGN_WORKER_POLL_MS` | `2000` | Poll interval between cycles. |
| `CAMPAIGN_WORKER_DRAIN_MS` | `30000` | How long SIGTERM waits for the in-flight cycle. |
| `CAMPAIGN_LEASE_RENEW_MS` | `15000` | Lease renewal cadence; must stay well under the 45s lease. |

The worker binds no port and exposes no HTTP surface. Its readiness signal is the
log line `Campaign worker started`; its liveness signal is `Job.heartbeatAt`
advancing for the job it owns.

## Reliability semantics added in Phase 8

**Leases are renewed while work is in flight.** Both the job lease and the
message lease are extended every `CAMPAIGN_LEASE_RENEW_MS` for the duration of a
provider call and across the inter-message pacing delay. Before this, a send
slower than 45 seconds — or any `delayMs` above the lease — let the lease expire
while the work was still running, so another worker recovered the message as
stale and contacted the recipient a second time.

**One cycle per process.** The poll timer fires on a fixed schedule but a cycle
lasts as long as the campaign it is running. A single-flight guard stops the timer
stacking cycles, which would otherwise give one replica an unbounded number of
concurrent leases and database connections.

**Shutdown drains.** SIGTERM/SIGINT stop the timer, wait up to
`CAMPAIGN_WORKER_DRAIN_MS` for the in-flight cycle, then disconnect. A send is no
longer severed mid-flight by a deploy. If the drain times out the lease is left to
expire and another replica resumes.

**Database outages do not kill the worker.** A failed cycle backs off
exponentially to a 60-second ceiling and logs at `error` from the fifth
consecutive failure. Leases expire on their own, so work is picked up when the
database returns.

**Work is distributed.** A worker that loses a claim race tries the next
claimable job (up to ten candidates) instead of idling until the next tick, so N
replicas drain N jobs per cycle rather than one between them.

**Cancelling a queued run is immediate.** A queued job has no worker to observe a
cancellation request, so it is settled to `cancelled` at request time. A job
already claimed by a worker is cancelled cooperatively, between messages, so an
in-flight provider call is allowed to finish.

## Compliance: suppression and opt-out

`SuppressionEntry` is keyed `(tenantId, channel, contactKey)`, so opt-outs are per
workspace and per channel, and repeating one is idempotent. Contacts are matched
on a canonical key (lowercased email, digits-only phone).

Enforcement happens twice:

- **At generation.** Suppressed contacts are filtered out before copy is written,
  so they never reach the review queue and no AI tokens are spent on them.
- **At delivery.** Checked again for each message, because a contact can opt out
  after approval. The check fails closed: if the lookup errors the message is
  retried rather than sent.

A suppressed message ends as `CampaignMessage.status = "suppressed"` and counts
toward `Campaign.skippedCount`. It produces no `CampaignDispatch` row, because no
delivery was attempted and a compliance skip is not a delivery failure.

Inbound opt-outs are recorded automatically from WhatsApp Cloud webhooks and the
IMAP reply poller. Detection distinguishes unambiguous phrases ("unsubscribe",
"do not contact") from bare commands: a lone "stop" counts only when it is
essentially the whole message, so "can you stop by on Tuesday?" does not silence a
warm lead. Operators can list, add and clear entries at `/api/suppressions`.

## Reporting and CRM reconciliation

The worker now writes the same downstream records a manual send does: the lead's
`emailStatus`/`whatsappStatus` and sent date, plus an outbound message on the
tenant's conversation thread. Previously only the report row was written, so the
Leads table denied deliveries the report claimed, and a reply arrived in a thread
with no record of the outreach it answered.

`GET /api/campaign/status` is derived from the caller's durable job plus a
`groupBy` over that campaign's messages, so progress survives an API restart,
belongs to one workspace, and cannot disagree with the report. Reports support
list, filtered export, view, edit, delete and bulk delete against tenant-owned
`CampaignDispatch` rows; all six carry the tenant predicate and use
`updateMany`/`deleteMany` so a foreign id matches nothing instead of mutating
another workspace's audit trail.

## Backups

`npm run backup` (script) and the in-app `BackupService` both dump **every mapped
table**, discovered from the generated datamodel rather than a hand-written list.
The previous hard-coded list was frozen at the pre-tenancy schema: workspaces,
memberships, jobs, campaigns, messages, delivery reports, conversations,
suppressions, knowledge, ICP and scoring were absent from every backup while the
run reported success.

- Per-table JSON lands under `database/<table>.json` in the archive; the manifest
  records row counts, SHA-256 checksums and whether any table was truncated
  (ceiling: 100,000 rows per table).
- `.env` is archived only as `.env.masked`, and masking is now **deny by
  default**: every value is masked unless its key is a known operational setting.
  The old allow-list of secret names missed `ENCRYPTION_KEY`, which protects
  stored integration credentials, and wrote it out in clear text.
- Restore through the API writes back only the three allow-listed JSON stores and
  refuses path traversal. Table dumps are carried but never auto-restored:
  overwriting live workspaces and delivery history from an HTTP request is an
  outage, not a recovery. Restoring rows is a deliberate operator action against a
  chosen database.
- Scheduled backups run every `BACKUP_INTERVAL_HOURS` (default 24) in the API
  process.

## Migrations

```powershell
npm run prisma:migrate        # deploy
npm run prisma:migrate:status  # must print "Database schema is up to date!"
npm run verify:migrations      # migration history vs. datamodel
```

`npm run verify:migrations` replays the committed SQL symbolically and compares
tables, columns and indexes against the DDL Prisma would generate for the current
datamodel. It exists because a fresh deploy can be broken while the live database
looks perfectly healthy: Phase 8 found that `campaigns` was created by migration
with a `user_id` column while the datamodel expects `userId`, so a brand-new
database would have failed at runtime on the first campaign query even though
`migrate status` was clean. The check also rejects a UTF-8 BOM in a migration file
(MySQL fails the first statement) and identifiers over MySQL's 64-character limit.

Run it in CI alongside `prisma migrate status`.

## Observability

Operational log lines carry correlation fields as `key=value` pairs via
`logContext()`: `tenant`, `user`, `campaign`, `job`, `message`, `worker`,
`channel`, `attempt`, `providerMessageId`, `lead`. Example:

```
INFO: Campaign message delivered. [tenant=t_1 job=j_2 campaign=c_3 worker=w_4 message=m_5 channel=email attempt=1 providerMessageId=smtp-1]
```

Credentials are never passed to the logger, and the logger additionally redacts
password/token/key patterns as a safety net.

## Dashboard performance

Each dashboard tab is now a lazily loaded chunk, and the spreadsheet, PDF and Word
writers are imported at the moment an export button is used. Initial load dropped
from 2,734 kB (702 kB gzip) to 784 kB (178 kB gzip). The remaining large chunks
(`CampaignReport` with the charting library, `xlsx`, `jspdf`) are fetched on
demand, so Vite still prints its 500 kB chunk warning for them; that is expected
and is not part of the first paint.
