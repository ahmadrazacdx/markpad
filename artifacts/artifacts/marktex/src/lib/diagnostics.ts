let diagnosticsInitialized = false;
const MAX_LOG_RETRY_ATTEMPTS = 12;
const LOG_RETRY_DELAY_MS = 250;

type PendingDiagnostic = {
  level: "info" | "warn" | "error";
  message: string;
  attempts: number;
};

let pendingDiagnostics: PendingDiagnostic[] = [];
let retryTimer: number | null = null;
let flushInProgress = false;

function serializeUnknown(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>) {
  try {
    const { invoke, isTauri } = await import("@tauri-apps/api/core");
    if (!isTauri()) return null;
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

function looksLikeDesktopRuntime() {
  if (typeof window === "undefined") return false;
  if (window.location.protocol === "tauri:") return true;
  if (window.location.hostname === "tauri.localhost") return true;
  if (/\bTauri\b/i.test(window.navigator.userAgent)) return true;
  return false;
}

function scheduleDiagnosticFlush() {
  if (retryTimer !== null || typeof window === "undefined") return;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void flushPendingDiagnostics();
  }, LOG_RETRY_DELAY_MS);
}

async function flushPendingDiagnostics() {
  if (flushInProgress || pendingDiagnostics.length === 0) return;
  flushInProgress = true;

  try {
    const remaining: PendingDiagnostic[] = [];

    for (const item of pendingDiagnostics) {
      const result = await invokeDesktop("write_frontend_log", {
        level: item.level,
        message: item.message,
      });

      if (result !== null) {
        continue;
      }

      if (item.attempts + 1 < MAX_LOG_RETRY_ATTEMPTS) {
        remaining.push({ ...item, attempts: item.attempts + 1 });
      }
    }

    pendingDiagnostics = remaining;
  } finally {
    flushInProgress = false;
    if (pendingDiagnostics.length > 0) {
      scheduleDiagnosticFlush();
    }
  }
}

export async function writeFrontendDiagnostic(level: "info" | "warn" | "error", message: string) {
  const result = await invokeDesktop("write_frontend_log", { level, message });
  if (result !== null) {
    return;
  }

  if (!looksLikeDesktopRuntime()) {
    return;
  }

  pendingDiagnostics.push({ level, message, attempts: 0 });
  scheduleDiagnosticFlush();
}

export async function initializeDesktopDiagnostics() {
  if (diagnosticsInitialized || typeof window === "undefined") return;
  diagnosticsInitialized = true;

  const logPaths = await invokeDesktop<string[]>("get_log_paths");
  if (Array.isArray(logPaths) && logPaths.length >= 2) {
    console.info(`Desktop log paths: backend=${logPaths[0]} frontend=${logPaths[1]}`);
    await writeFrontendDiagnostic("info", `Desktop log paths: backend=${logPaths[0]} frontend=${logPaths[1]}`);
  }

  window.addEventListener("error", (event) => {
    const location = event.filename
      ? `${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0}`
      : "unknown-location";
    const details = event.error ? serializeUnknown(event.error) : event.message;
    void writeFrontendDiagnostic("error", `window.error at ${location} - ${details}`);
  });

  window.addEventListener("unhandledrejection", (event) => {
    void writeFrontendDiagnostic("error", `window.unhandledrejection - ${serializeUnknown(event.reason)}`);
  });

  void flushPendingDiagnostics();
}
