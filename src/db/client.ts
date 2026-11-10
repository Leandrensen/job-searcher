import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../drizzle");

export function openDb(opts: { url?: string; migrate?: boolean } = {}): Db {
  const raw = opts.url ?? process.env.DATABASE_URL ?? "./data/jobs.db";
  const file = raw.replace(/^file:/, "");
  const inMemory = file === ":memory:";
  if (!inMemory) fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });

  const sqlite = new Database(file);
  if (!inMemory) sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  if (opts.migrate) migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
