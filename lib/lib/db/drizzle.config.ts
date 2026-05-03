import { defineConfig } from "drizzle-kit";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const defaultDbPath = path.resolve(process.cwd(), ".marktex", "marktex.db");
fs.mkdirSync(path.dirname(defaultDbPath), { recursive: true });

const dbUrl = process.env.DATABASE_URL ?? pathToFileURL(defaultDbPath).toString();

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "sqlite",
  dbCredentials: {
    url: dbUrl,
  },
});
