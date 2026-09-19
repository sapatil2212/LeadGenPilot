# Database workflow

## Current state

| | |
|---|---|
| Engine | MySQL (remote), accessed via Prisma |
| Active database | `leadgenerationtool` — configured in `DATABASE_URL` |
| Schema source of truth | `prisma/schema.prisma` |
| Migration history | `prisma/migrations/` — 3 applied: `0_init`, `add_tenancy_and_jobs`, `add_business_knowledge` |
| Drift | none (`prisma migrate diff` returns an empty migration) |
| Data | empty, aside from Prisma's `_prisma_migrations` bookkeeping |

The previous database, `nexaleadai`, is on the same host and is **left intact**
as a fallback. It holds 2 users, 5 lead lists, 52 leads and ~24k page views. It
is no longer referenced by the application.

## Commands

```bash
npm run prisma:migrate:status     # what is applied where
npm run prisma:migrate:dev        # create a migration from schema changes (dev)
npm run prisma:migrate            # apply pending migrations (deploy/prod)
npm run prisma:generate           # regenerate the client after a schema change
npm run db:studio                 # browse data
npm run backup                    # read-only backup to backups/<stamp>/
npm run verify                    # typecheck + tests + migration status
```

`npm run prisma:push` deliberately **refuses to run**. `db push` mutates the
database without recording a migration, which is how the schema and the database
drifted apart before Phase 0. Use `prisma:migrate:dev` instead. If you genuinely
need it, `npx prisma db push` still works and the refusal is only on the script.

## Making a schema change

**`prisma migrate dev` does not work against this database.** It needs to create
a temporary "shadow database" to verify migrations, and the MySQL user has no
`CREATE DATABASE` grant on this shared host:

```
Error: P3014  Prisma Migrate could not create the shadow database.
Original error: P1010  User was denied access on the database
                       `prisma_migrate_shadow_db_...`
```

Use the supported no-shadow-database workaround instead. `migrate diff` compares
the live schema against `schema.prisma` and needs no extra privileges:

```bash
# 1. Edit prisma/schema.prisma, then:
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$dir = "prisma/migrations/${stamp}_describe_the_change"
New-Item -ItemType Directory -Force -Path $dir
npx prisma migrate diff `
  --from-schema-datasource prisma/schema.prisma `
  --to-schema-datamodel  prisma/schema.prisma `
  --script > "$dir/migration.sql"

# 2. READ THE SQL. Reject anything with DROP that you did not intend.
# 3. Apply and regenerate:
npm run prisma:migrate
npm run prisma:generate
npm run verify
```

PowerShell's `>` writes UTF-16. Re-save `migration.sql` as UTF-8 without a BOM,
or Prisma may fail to parse it.

Commit the migration directory together with the schema change. A schema change
without its migration will fail on the next deploy.

Additive changes only, wherever there is a choice: add a nullable column,
backfill it, verify, and only then make it required. Dropping or renaming a
column in the same migration that reads it will lose data.

### Always declare an index behind a foreign key

MySQL requires an index on every foreign key column and **creates one silently**
if the schema does not declare it. Prisma then reports that index as drift,
because `schema.prisma` never asked for it. This has bitten twice:

| Column | Index MySQL created |
|---|---|
| `email_otps.user_id` | `email_otps_user_id_fkey` |
| `jobs.user_id` | `jobs_user_id_fkey` |

The fix is to declare it with the name MySQL already chose, so schema and
database agree and nothing is created or dropped:

```prisma
@@index([userId], map: "jobs_user_id_fkey")
```

A composite index counts as long as the FK column is its **leading** column —
`@@index([tenantId, kind, status])` covers a foreign key on `tenant_id`, which is
why the other eight FK columns in this schema never drifted.

Run the drift check after every migration:

```bash
npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma `
                        --to-schema-datasource prisma/schema.prisma --script
# expected output: "-- This is an empty migration."
```

## Tenancy

The tenancy tables (`tenants`, `tenant_members`, `jobs`) and the `tenant_id`
columns arrived in `20260918210049_add_tenancy_and_jobs`. Two things to know
when working with them:

**`tenant_id` is nullable, deliberately and temporarily.** The pre-existing
`user_id` columns are still written alongside it, because some code paths (the
scraper's lead persistence, the Google Sheets sync) still read `user_id`. Reads
go through `src/tenancy/repository.ts`, whose predicate accepts either — matching
`tenant_id`, or `tenant_id IS NULL` **together with** the caller's own `user_id`.
Once every reader has moved over, the `user_id` half of that predicate is deleted
and `tenant_id` becomes required.

**Restored data needs the backfill.** A backup taken before tenancy has no
`tenant_id` values and no workspaces:

```bash
node scripts/import-backup-data.mjs <dir> --confirm
node scripts/backfill-tenants.mjs               # dry run
node scripts/backfill-tenants.mjs --confirm     # creates one workspace per user
node scripts/verify-tenant-ownership.mjs
```

The backfill is idempotent and reports anything it cannot attribute rather than
guessing. Rehearsed against the real Phase 0 backup: 2 workspaces, 5 lists, 52
leads and 30 audit entries attributed, 9 audit entries correctly left
platform-level because they have no owning user (failed sign-in attempts).

## Business intelligence tables

`20260919104624_add_business_knowledge` added eight tables, all `tenant_id`-scoped
and all cascading from `tenants`, so deleting a workspace leaves none of its
business data behind.

| Table | Holds |
|---|---|
| `business_profiles` | one row per workspace: company facts, target customers, differentiators |
| `business_products` / `business_services` | the catalogue, used for product-to-lead fit in Phase 4 |
| `knowledge_documents` | an upload and its processing lifecycle |
| `knowledge_chunks` | retrievable slices of a document, with embeddings |
| `knowledge_items` | arbitrary labelled facts that have no column of their own |
| `ai_conversations` / `ai_messages` | assistant threads, with per-turn provenance |

Four things about the design are load-bearing rather than incidental:

**Industry and business type are free text, never enums.** The platform has to
work for any category, so "Medical Equipment Manufacturer" and "Dental Clinic"
must be equally valid. Any hardcoded category list is a bug.

**List fields are JSON string arrays on the parent row**, not child tables, because
they are always read with the profile and never queried individually. `null` and
`[]` mean different things: `null` is "the tenant has not told us", `[]` is "they
told us there are none". The assistant asks in the first case and not the second.

**`knowledge_chunks.embedding` is a JSON number array and similarity is computed
in the application.** MySQL has no vector type and no ANN index, and at the scale
this serves — hundreds of chunks per workspace — a scan is cheaper than adding a
vector database to the deployment. Each chunk also stores `embedding_model`:
vectors from different models are not comparable, so retrieval embeds the query
and then compares **only** against chunks carrying the same model. Changing the
embedding model is therefore a re-embed of old rows (`POST
/api/knowledge/documents/:id/reprocess`) rather than silently broken search.

**`knowledge_documents.status` is a status column, not a boolean.** Extraction,
chunking and embedding are separate failure points with different fixes, and
"which step failed" is the first thing anyone asks. `extracted_text` is kept so
re-chunking never needs the original file — which is why the original bytes are
not retained at all.

## Backups

```bash
npm run backup                                    # -> backups/backup-<stamp>/
node scripts/verify-tenant-ownership.mjs          # ownership reconciliation
```

`scripts/backup-data.mjs` dumps every table to JSON with SHA-256 checksums and
copies the file-based operational stores. It never copies `.env*` or the
WhatsApp session directory, so a backup directory is less sensitive than the
repository root — but it still contains lead PII. `backups/` is gitignored.

### Restoring a backup

```bash
node scripts/import-backup-data.mjs                       # dry run, latest backup
node scripts/import-backup-data.mjs --confirm             # write it
node scripts/import-backup-data.mjs <dir> --confirm       # a specific backup
```

Ids are preserved so foreign keys line up, tables are written in dependency
order, and writes use `skipDuplicates`, so a partial run can be repeated.

Two guards worth knowing:

- It refuses to write to a table that already has rows unless you pass
  `--merge`, so a second run cannot silently interleave with live data.
- It skips `page_views` unless you pass `--include-page-views`. That table is
  bulk analytics PII with no retention policy and no tenant scoping.

To restore the pre-switch data into the current database:

```bash
node scripts/import-backup-data.mjs backups/phase0-20260918-133348 --confirm
```

## Operational notes

**The database is remote and intermittently refuses connections.** Observed
twice in one session: a Prisma command returned `P1001 Can't reach database
server` while TCP 3306 was demonstrably reachable, and the immediately following
identical command succeeded both times. Treat single connection failures as
transient and retry once before believing them.

This is not a curiosity, it is a design constraint. Anything running unattended —
the campaign worker and job queue in Phase 6 — needs **connect-level** retry with
backoff, not just query-level error handling, or a two-hour campaign will die on
a one-second network blip and mark its remaining recipients failed.

**There is no automated backup.** `scheduleAutomaticBackups()` exists in
`src/backup.ts` but is imported and never called, and the backup archive covers
only the JSON stores, not MySQL. Take `npm run backup` manually before any
migration until Phase 10 addresses this.

**A fresh database has no admin.** Roles come from the `users` table, and the
first account whose email appears in `ADMIN_EMAILS` is promoted to `admin` on
sign-in (`src/authService.ts`). Sign up with that address to get an
administrator. The separate env-based superadmin console at `/superadmin` needs
no database row at all.
