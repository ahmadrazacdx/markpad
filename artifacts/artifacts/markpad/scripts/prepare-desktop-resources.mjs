import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptsDir, "..");
const apiServerDistDir = path.resolve(appDir, "..", "api-server", "dist");
const backendResourceDir = path.resolve(appDir, "src-tauri", "resources", "backend", "dist");

await rm(backendResourceDir, { recursive: true, force: true });
await mkdir(backendResourceDir, { recursive: true });
await cp(apiServerDistDir, backendResourceDir, { recursive: true });

console.log(`Desktop resources staged at: ${backendResourceDir}`);
