import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { mkdir } from "fs/promises";
import path from "path";
import * as schema from "./schema";

const dataDir = path.resolve(process.env.MARKPAD_DATA_DIR ?? ".markpad");
const dbPath = path.resolve(process.env.MARKPAD_DB_PATH ?? path.join(dataDir, "markpad.db"));
const databaseUrl = process.env.DATABASE_URL ?? `file:${dbPath}`;

if (databaseUrl.startsWith("file:")) {
  await mkdir(path.dirname(dbPath), { recursive: true });
}

const client = createClient({ url: databaseUrl });

async function ensureSchema() {
  await client.execute("PRAGMA foreign_keys = ON;");

  await client.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      template TEXT NOT NULL DEFAULT 'plain',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);

  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS files_project_path_unique ON files(project_id, path);",
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      content TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      label TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);
}

await ensureSchema();

export const db = drizzle(client, { schema });

export * from "./schema";
