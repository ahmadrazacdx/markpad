let diagnosticsInitialized = false;

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

export async function writeFrontendDiagnostic(level: "info" | "warn" | "error", message: string) {
  await invokeDesktop("write_frontend_log", { level, message });
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
}
