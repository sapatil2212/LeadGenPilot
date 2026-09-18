# Database workflow

## Current state

| | |
|---|---|
| Engine | MySQL (remote), accessed via Prisma |
| Active database | `leadgenerationtool` — configured in `DATABASE_URL` |
| Schema source of truth | `prisma/schema.prisma` |
| Migration history | `prisma/migrations/` — `0_init` applied |
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

1. Edit `prisma/schema.prisma`.
2. `npm run prisma:migrate:dev -- --name describe_the_change`
   Review the generated SQL in `prisma/migrations/<timestamp>_.../migration.sql`
   before it is applied.
3. `npm run prisma:generate` if the client needs regenerating.
4. `npm run verify`.
5. Commit the migration directory together with the schema change. A schema
   change without its migration will fail on the next deploy.

Additive changes only, wherever there is a choice: add a nullable column,
backfill it, verify, and only then make it required. Dropping or renaming a
column in the same migration that reads it will lose data.

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

**The database is remote and occasionally refuses connections.** A
`prisma migrate status` call returned `P1001 Can't reach database server` while
TCP 3306 was demonstrably reachable, and the immediately following call
succeeded. Treat single connection failures as transient. Anything that runs
unattended — the campaign worker and job queue in Phase 6 — needs connect-level
retry with backoff, not just query-level error handling.

**There is no automated backup.** `scheduleAutomaticBackups()` exists in
`src/backup.ts` but is imported and never called, and the backup archive covers
only the JSON stores, not MySQL. Take `npm run backup` manually before any
migration until Phase 10 addresses this.

**A fresh database has no admin.** Roles come from the `users` table, and the
first account whose email appears in `ADMIN_EMAILS` is promoted to `admin` on
sign-in (`src/authService.ts`). Sign up with that address to get an
administrator. The separate env-based superadmin console at `/superadmin` needs
no database row at all.
