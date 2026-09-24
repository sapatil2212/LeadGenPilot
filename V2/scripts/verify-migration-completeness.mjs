/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Verifies that the committed migration history alone can build the schema the
 * application expects — i.e. that `prisma migrate deploy` on an empty database is
 * sufficient and no `prisma db push` was ever needed to fill a gap.
 *
 * How it works: Prisma is asked for the DDL that would create the current
 * datamodel from nothing (`migrate diff --from-empty`). That is the target. The
 * committed migration SQL is then replayed symbolically — tables, columns and
 * indexes are added and removed statement by statement — and the resulting shape
 * is compared against the target. A column present in schema.prisma but absent
 * from every migration is the signature of a hand-pushed change, and it is
 * exactly what breaks a fresh production deploy.
 *
 * This does not replace running `migrate deploy` against a real empty database,
 * which additionally proves the SQL executes in order on the target MySQL
 * version. It is the check that can run anywhere, including CI, and without the
 * CREATE DATABASE privilege that a managed MySQL account usually lacks.
 *
 * Usage: node scripts/verify-migration-completeness.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationsDir = path.join(root, "prisma", "migrations");

function targetDdl() {
  // Invoke Prisma's own entry point with the current Node binary rather than the
  // npx shim, which cannot be spawned directly on Windows.
  const cli = path.join(root, "node_modules", "prisma", "build", "index.js");
  if (!fs.existsSync(cli)) throw new Error("Prisma CLI not found. Run `npm install` first.");
  return execFileSync(
    process.execPath,
    [cli, "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
}

function readMigrations() {
  if (!fs.existsSync(migrationsDir)) throw new Error("No prisma/migrations directory found.");
  const folders = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const files = [];
  for (const folder of folders) {
    const file = path.join(migrationsDir, folder, "migration.sql");
    if (fs.existsSync(file)) files.push({ folder, sql: fs.readFileSync(file, "utf8") });
  }
  return { folders, files };
}

/** Strips `--` and `/* *\/` comments, then splits into statements on `;`. */
function statementsOf(sql) {
  const withoutComments = sql
    // Normalise line endings first: a `\r` is not matched by `.` in JavaScript,
    // so a CRLF file would keep every `-- CreateTable` marker and hide the
    // statement behind it.
    .replace(/\r\n?/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, "")
    .replace(/#[^\n]*/g, "");
  return withoutComments
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/** Returns the text inside the outermost parentheses of a CREATE TABLE statement. */
function tableBody(statement) {
  const open = statement.indexOf("(");
  if (open < 0) return "";
  let depth = 0;
  for (let index = open; index < statement.length; index++) {
    const character = statement[index];
    if (character === "(") depth++;
    else if (character === ")") {
      depth--;
      if (depth === 0) return statement.slice(open + 1, index);
    }
  }
  return statement.slice(open + 1);
}

/** Splits a table body on top-level commas so definitions stay intact. */
function definitionsOf(body) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const character of body) {
    if (character === "(") depth++;
    if (character === ")") depth--;
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Replays DDL symbolically. Order matters: a column added in migration 3 and
 * dropped in migration 7 must not count as present.
 */
function replay(sql) {
  const tables = new Map();
  const indexes = new Set();

  for (const statement of statementsOf(sql)) {
    const normalized = statement.replace(/\s+/g, " ");

    const create = /^CREATE TABLE(?: IF NOT EXISTS)? `([^`]+)`/i.exec(normalized);
    if (create) {
      const table = create[1];
      const columns = tables.get(table) ?? new Set();
      for (const definition of definitionsOf(tableBody(statement))) {
        const column = /^`([^`]+)`\s/.exec(definition.trim());
        if (column) {
          columns.add(column[1]);
          continue;
        }
        const index = /^(?:UNIQUE\s+|FULLTEXT\s+|SPATIAL\s+)?(?:INDEX|KEY)\s+`([^`]+)`/i.exec(definition.trim());
        if (index) indexes.add(index[1]);
        const constraint = /^CONSTRAINT\s+`([^`]+)`/i.exec(definition.trim());
        if (constraint) indexes.add(constraint[1]);
      }
      tables.set(table, columns);
      continue;
    }

    const alter = /^ALTER TABLE `([^`]+)` ([\s\S]+)$/i.exec(normalized);
    if (alter) {
      const [, table, rest] = alter;
      if (!tables.has(table)) tables.set(table, new Set());
      const columns = tables.get(table);
      // One ALTER may carry several clauses: ADD COLUMN a, ADD COLUMN b, ...
      for (const clause of definitionsOf(rest)) {
        const addColumn = /^ADD(?: COLUMN)? `([^`]+)`/i.exec(clause);
        if (addColumn && !/^ADD (?:CONSTRAINT|INDEX|KEY|UNIQUE|PRIMARY|FULLTEXT|SPATIAL)/i.test(clause)) {
          columns.add(addColumn[1]);
          continue;
        }
        const addIndex = /^ADD (?:UNIQUE )?(?:INDEX|KEY) `([^`]+)`/i.exec(clause);
        if (addIndex) {
          indexes.add(addIndex[1]);
          continue;
        }
        // A foreign key constraint implicitly creates the index of the same name
        // in MySQL, which is how Prisma's target DDL reports it.
        const addConstraint = /^ADD CONSTRAINT `([^`]+)`/i.exec(clause);
        if (addConstraint) {
          indexes.add(addConstraint[1]);
          continue;
        }
        const renameColumn = /^RENAME COLUMN `([^`]+)` TO `([^`]+)`/i.exec(clause);
        if (renameColumn) {
          columns.delete(renameColumn[1]);
          columns.add(renameColumn[2]);
          continue;
        }
        const changeColumn = /^CHANGE(?: COLUMN)? `([^`]+)` `([^`]+)`/i.exec(clause);
        if (changeColumn) {
          columns.delete(changeColumn[1]);
          columns.add(changeColumn[2]);
          continue;
        }
        const dropColumn = /^DROP(?: COLUMN)? `([^`]+)`/i.exec(clause);
        if (dropColumn && !/^DROP (?:INDEX|KEY|CONSTRAINT|FOREIGN KEY|PRIMARY)/i.test(clause)) {
          columns.delete(dropColumn[1]);
          continue;
        }
        const dropIndex = /^DROP (?:INDEX|KEY|CONSTRAINT|FOREIGN KEY) `([^`]+)`/i.exec(clause);
        if (dropIndex) indexes.delete(dropIndex[1]);
        const renameTable = /^RENAME TO `([^`]+)`/i.exec(clause);
        if (renameTable) {
          tables.set(renameTable[1], columns);
          tables.delete(table);
        }
      }
      continue;
    }

    const createIndex = /^CREATE (?:UNIQUE )?INDEX `([^`]+)`/i.exec(normalized);
    if (createIndex) {
      indexes.add(createIndex[1]);
      continue;
    }

    const dropIndexStatement = /^DROP INDEX `([^`]+)`/i.exec(normalized);
    if (dropIndexStatement) {
      indexes.delete(dropIndexStatement[1]);
      continue;
    }

    const dropTable = /^DROP TABLE(?: IF EXISTS)? `([^`]+)`/i.exec(normalized);
    if (dropTable) tables.delete(dropTable[1]);
  }

  return { tables, indexes };
}

function main() {
  const { folders, files } = readMigrations();
  const combined = files.map((file) => file.sql).join(";\n");

  // A BOM makes MySQL reject the first statement of a migration, which fails the
  // deploy with a confusing syntax error. Catch it here instead.
  const withBom = files.filter((file) => file.sql.charCodeAt(0) === 0xfeff).map((file) => file.folder);

  const target = replay(targetDdl());
  const applied = replay(combined);

  const missingTables = [];
  const missingColumns = [];
  for (const [table, columns] of target.tables) {
    if (!applied.tables.has(table)) {
      missingTables.push(table);
      continue;
    }
    const present = applied.tables.get(table);
    for (const column of columns) if (!present.has(column)) missingColumns.push(`${table}.${column}`);
  }
  const missingIndexes = [...target.indexes].filter((index) => !applied.indexes.has(index));
  const longIdentifiers = [...applied.indexes].filter((index) => index.length > 64);

  console.log(`Migrations found: ${folders.length}`);
  console.log(`Tables required by the datamodel: ${target.tables.size}`);
  console.log(`Tables created by migrations: ${applied.tables.size}`);
  console.log(
    `Columns required: ${[...target.tables.values()].reduce((sum, columns) => sum + columns.size, 0)}`
  );
  console.log(`Indexes and constraints required: ${target.indexes.size}`);
  console.log(`Indexes and constraints created by migrations: ${applied.indexes.size}`);

  const problems = [];
  if (withBom.length) problems.push(`Migration files starting with a UTF-8 BOM: ${withBom.join(", ")}`);
  if (missingTables.length) problems.push(`Tables no migration creates: ${missingTables.join(", ")}`);
  if (missingColumns.length) problems.push(`Columns no migration creates: ${missingColumns.join(", ")}`);
  if (missingIndexes.length) problems.push(`Indexes no migration creates: ${missingIndexes.join(", ")}`);
  if (longIdentifiers.length) problems.push(`Identifiers longer than MySQL's 64-character limit: ${longIdentifiers.join(", ")}`);
  if (!fs.existsSync(path.join(migrationsDir, "migration_lock.toml"))) problems.push("prisma/migrations/migration_lock.toml is missing.");

  if (problems.length) {
    console.error("\nMigration history is NOT sufficient for a fresh deploy:");
    for (const problem of problems) console.error(` - ${problem}`);
    process.exit(1);
  }

  console.log("\nMigration history reproduces the full datamodel. `prisma migrate deploy` is sufficient on an empty database.");
}

main();
