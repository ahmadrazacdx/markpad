import { setBaseUrl } from "@workspace/api-client-react";

const DEFAULT_DEV_API_PORT = 8080;

let resolvedApiBaseUrl: string | null = null;
let initialized = false;

function isDesktopRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function resolveDesktopApiBaseUrl(): Promise<string | null> {
  if (!isDesktopRuntime()) return null;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const port = await invoke<number>("get_backend_port");

    if (Number.isInteger(port) && port > 0) {
      return `http://127.0.0.1:${port}`;
    }
  } catch {
    // Fall through to default behavior below.
  }

  if (import.meta.env.DEV) {
    return `http://127.0.0.1:${DEFAULT_DEV_API_PORT}`;
  }

  return null;
}

function normalizeApiPath(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith("/") ? path : `/${path}`;
}

export function getApiBaseUrl() {
  return resolvedApiBaseUrl;
}

export function apiUrl(path: string) {
  const normalizedPath = normalizeApiPath(path);

  if (resolvedApiBaseUrl) {
    return new URL(normalizedPath, resolvedApiBaseUrl).toString();
  }

  return normalizedPath;
}

export async function initializeApiBaseUrl() {
  if (initialized) return resolvedApiBaseUrl;

  const explicitApiBase = import.meta.env.VITE_API_BASE_URL?.trim();

  if (explicitApiBase) {
    resolvedApiBaseUrl = explicitApiBase;
    setBaseUrl(explicitApiBase);
    initialized = true;
    return resolvedApiBaseUrl;
  }

  resolvedApiBaseUrl = await resolveDesktopApiBaseUrl();
  setBaseUrl(resolvedApiBaseUrl);
  initialized = true;
  return resolvedApiBaseUrl;
}
