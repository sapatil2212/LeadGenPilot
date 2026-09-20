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

**Every attempt carries one identity.** Each message gets a derived
`idempotencyKey` (`sha256(tenantId:messageId)`, persisted on first use) that never
changes across retries or recovery. For email it becomes the `Message-ID` header,
so a resend after an unknown outcome carries the id the first attempt used and
receiving servers that deduplicate on it collapse the duplicate. The key is also
written to the delivery report, so a duplicate is identifiable afterwards.

This narrows at-least-once delivery; it does not eliminate it. A crash between
"the provider accepted this" and "the database recorded it" is unobservable from
our side, and WhatsApp Cloud exposes no equivalent key, so a WhatsApp duplicate
after a crash in that window remains possible. Choosing a possible duplicate over
a possible silent non-delivery is deliberate.

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
warm lead.

Operators work with the list on the **Do Not Contact** tab: search and filter by
channel, see when and how each opt-out was recorded, add one that arrived by phone,
and remove one that was recorded in error. The same operations are available at
`/api/suppressions` for scripted use.

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
npm run prisma:migrate         # deploy
npm run prisma:migrate:status  # must print "Database schema is up to date!"
npm run verify:migrations      # migration history vs. datamodel, no database needed
npm run verify:fresh-db -- --url "mysql://root:@127.0.0.1:3307/freshtest"
```

`verify:migrations` replays the committed SQL symbolically and compares tables,
columns and indexes against the DDL Prisma would generate for the current
datamodel. `verify:fresh-db` goes further: it deploys the history to an empty
database and asserts `prisma migrate diff` between the result and the datamodel is
empty. It refuses to run against anything that is not empty, so it cannot be
pointed at production by accident.

Both exist because a fresh deploy can be broken while the live database looks
perfectly healthy. That was real here: `campaigns` was created by migration with a
`user_id` column while the datamodel expects `userId`, so every existing
deployment worked and a brand-new one would have failed on its first campaign
query — with `migrate status` reporting a clean schema throughout. The checks also
reject a UTF-8 BOM in a migration file (MySQL fails the first statement) and
identifiers over MySQL's 64-character limit.

Run both in CI alongside `prisma migrate status`.

## Test suites

| Command | Needs | Covers |
| --- | --- | --- |
| `npm run test:run` | nothing | Unit and API-level tests, all doubles |
| `npm run test:integration` | `TEST_DATABASE_URL` | Real Prisma queries against a real schema |
| `npm run test:e2e` | `E2E_DATABASE_URL` | The built dashboard in Chromium against the built server |
| `npm run test:all` | both | All three in order |

`test:run` is the suite that must stay green on every machine, so it depends on no
infrastructure and a failure always means a real defect. The other two declare
their dependency and refuse to run without a disposable database named explicitly,
because they delete rows during setup.

### A disposable MySQL for the two database suites

Any empty MySQL works. To get one from an existing MySQL installation without
touching its service or data (Windows paths shown; adjust for your install):

```powershell
$mysql = "C:\Program Files\MySQL\MySQL Server 8.4\bin"
$dir   = "$env:TEMP\leadgen-testdb"

& "$mysql\mysqld.exe" --initialize-insecure --datadir="$dir\data"
Start-Process "$mysql\mysqld.exe" -ArgumentList @(
  "--datadir=$dir\data", "--port=3307", "--mysqlx=0",
  "--socket=$dir\my.sock", "--pid-file=$dir\my.pid"
)
& "$mysql\mysql.exe" -u root -h 127.0.0.1 -P 3307 -e @"
CREATE DATABASE leadgen_test;
CREATE DATABASE leadgen_e2e;
"@

$env:TEST_DATABASE_URL = "mysql://root:@127.0.0.1:3307/leadgen_test"
$env:E2E_DATABASE_URL  = "mysql://root:@127.0.0.1:3307/leadgen_e2e"
npx prisma migrate deploy   # with DATABASE_URL pointed at leadgen_test
npm run test:integration
npm run test:e2e            # applies migrations and seeds leadgen_e2e itself
```

Shut it down with `& "$mysql\mysqladmin.exe" -u root -h 127.0.0.1 -P 3307 shutdown`
and delete `$dir`.

### The browser suite

`npm run test:e2e` builds the production bundle, applies migrations to
`E2E_DATABASE_URL`, seeds two workspaces (`tests/e2e/seed.mjs`), starts
`dist/server.cjs`, and drives Chromium against it. It tests the built artefact
rather than the dev server, so it is a deployment check.

Note that `vite build` empties `dist/`, so running it alone removes the server
bundle esbuild wrote there. `npm run build` does both in the correct order, which
is why it runs automatically before the browser suite.

The suite deliberately raises the API rate limit for its own server: 24 specs
signing in, each with a dashboard polling status and inbox on timers, exceeds the
production limit of 300 requests/minute from one address. The limiter itself is
covered by `tests/security.middleware.test.ts`.

What the browser adds over the layers beneath it: a lazily loaded panel whose
dynamic import fails, a fetch that omits its credentials, and a route the UI calls
with a shape the API rejects all typecheck, build and pass unit tests. One spec
walks every sidebar destination and fails on a chunk-load error or a Suspense
fallback that never resolves.

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

Three changes, in order of effect:

1. Each dashboard tab is a lazily loaded chunk, so opening the app no longer
   downloads the code for twelve screens nobody is looking at.
2. The spreadsheet, PDF and Word writers are imported at the moment an export
   button is used, and the ~560 lines of lead-export layout live in
   `src/exports/leadExports.ts` rather than in `App.tsx`.
3. The React runtime and the icon set are their own chunks, so a deploy does not
   invalidate them and no single chunk sits above Rollup's 500 kB warning.

| | Before Phase 8 | Now |
| --- | --- | --- |
| Largest application chunk | 2,734 kB | 357 kB |
| First-load JavaScript (gzip) | 702 kB | 178 kB |
| Chunks over 500 kB | 1 | 0 |

Everything above 400 kB that remains (`CampaignReport` with the charting library,
`xlsx`, `jspdf`, `docx`) is fetched on demand and is not part of the first paint.
