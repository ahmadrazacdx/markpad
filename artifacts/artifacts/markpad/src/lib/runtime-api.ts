import { setBaseUrl } from "@workspace/api-client-react";
import { writeFrontendDiagnostic } from "@/lib/diagnostics";

const DEFAULT_DEV_API_PORT = 8080;
const DEFAULT_DESKTOP_API_PORT = 18080;
const BACKEND_PORT_DISCOVERY_ATTEMPTS = 8;
const BACKEND_PORT_DISCOVERY_DELAY_MS = 80;

let resolvedApiBaseUrl: string | null = null;
let initialized = false;

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function looksLikeDesktopRuntime() {
  if (typeof window === "undefined") return false;
  if (window.location.protocol === "tauri:") return true;
  if (window.location.hostname === "tauri.localhost") return true;
  if (/\bTauri\b/i.test(window.navigator.userAgent)) return true;
  return false;
}

async function readBackendPortFromTauri() {
  const { invoke } = await import("@tauri-apps/api/core");

  for (let attempt = 0; attempt < BACKEND_PORT_DISCOVERY_ATTEMPTS; attempt += 1) {
    try {
      const port = await invoke<number>("get_backend_port");
      if (Number.isInteger(port) && port > 0) {
        return port;
      }
    } catch {
      // Keep trying briefly while desktop runtime initializes.
    }

    if (attempt < BACKEND_PORT_DISCOVERY_ATTEMPTS - 1) {
      await delay(BACKEND_PORT_DISCOVERY_DELAY_MS);
    }
  }

  return null;
}

async function resolveDesktopApiBaseUrl() {
  if (!looksLikeDesktopRuntime()) return null;

  try {
    const discoveredPort = await readBackendPortFromTauri();
    if (discoveredPort) {
      return `http://127.0.0.1:${discoveredPort}`;
    }
  } catch {
    // Fall through to deterministic desktop fallback.
  }

  return `http://127.0.0.1:${DEFAULT_DESKTOP_API_PORT}`;
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
    void writeFrontendDiagnostic("info", `Using explicit API base URL: ${explicitApiBase}`);
    initialized = true;
    return resolvedApiBaseUrl;
  }

  resolvedApiBaseUrl = await resolveDesktopApiBaseUrl();
  if (!resolvedApiBaseUrl && import.meta.env.DEV) {
    resolvedApiBaseUrl = `http://127.0.0.1:${DEFAULT_DEV_API_PORT}`;
  }

  if (resolvedApiBaseUrl) {
    void writeFrontendDiagnostic("info", `Resolved API base URL: ${resolvedApiBaseUrl}`);
  } else {
    void writeFrontendDiagnostic("warn", "API base URL could not be resolved; using relative requests.");
  }

  setBaseUrl(resolvedApiBaseUrl);
  initialized = true;
  return resolvedApiBaseUrl;
}
