import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptsDir, "..");
const apiServerDistDir = path.resolve(appDir, "..", "api-server", "dist");
const backendResourceRootDir = path.resolve(appDir, "src-tauri", "resources", "backend");
const backendResourceDir = path.resolve(appDir, "src-tauri", "resources", "backend", "dist");
const backendNodeModulesDir = path.resolve(backendResourceRootDir, "node_modules");
const requireFromApp = createRequire(import.meta.url);

const libsqlNativePackageByPlatform = {
  win32: {
    x64: "@libsql/win32-x64-msvc",
  },
  linux: {
    x64: "@libsql/linux-x64-gnu",
    arm64: "@libsql/linux-arm64-gnu",
  },
  darwin: {
    x64: "@libsql/darwin-x64",
    arm64: "@libsql/darwin-arm64",
  },
};

async function copyPackageToBackendNodeModules(packageName) {
  let packageJsonPath;
  try {
    packageJsonPath = requireFromApp.resolve(`${packageName}/package.json`);
  } catch {
    return false;
  }
  const packageDir = path.dirname(packageJsonPath);
  const packagePathParts = packageName.split("/");
  const packageDestDir = path.resolve(backendNodeModulesDir, ...packagePathParts);

  await rm(packageDestDir, { recursive: true, force: true });
  await mkdir(path.dirname(packageDestDir), { recursive: true });
  await cp(packageDir, packageDestDir, { recursive: true });
  return true;
}

await rm(backendResourceDir, { recursive: true, force: true });
await mkdir(backendResourceDir, { recursive: true });
await cp(apiServerDistDir, backendResourceDir, { recursive: true });

const libsqlNativePackage = libsqlNativePackageByPlatform[process.platform]?.[process.arch];
if (libsqlNativePackage) {
  const copied = await copyPackageToBackendNodeModules(libsqlNativePackage);
  if (copied) {
    console.log(`Copied ${libsqlNativePackage} into desktop backend resources`);
  } else {
    console.warn(
      `${libsqlNativePackage} is not installed in this environment; backend may require it at runtime`,
    );
  }
} else {
  console.warn(
    `No libsql native package mapping for ${process.platform}/${process.arch}; skipping copy`,
  );
}

console.log(`Desktop resources staged at: ${backendResourceDir}`);
