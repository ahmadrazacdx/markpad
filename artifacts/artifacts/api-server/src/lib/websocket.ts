import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { performance } from "node:perf_hooks";
import { renderMarkdownToPdf, RenderOptions } from "./renderer";
import { logger } from "./logger";

const DEFAULT_WS_PREVIEW_DEBOUNCE_MS = 70;

type PendingRequest = {
  projectId: number;
  content: string;
  options: RenderOptions;
  requestedAtMs: number;
};

export type WebSocketPreviewConfig = {
  debounceMs: number;
  cancelInFlight: boolean;
  metricsEnabled: boolean;
};

function parseIntegerSetting(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function resolveWebSocketPreviewConfig(env: NodeJS.ProcessEnv = process.env): WebSocketPreviewConfig {
  return {
    debounceMs: parseIntegerSetting(env.MARKPAD_PREVIEW_WS_DEBOUNCE_MS, DEFAULT_WS_PREVIEW_DEBOUNCE_MS, 0, 500),
    cancelInFlight: env.MARKPAD_PREVIEW_CANCEL_INFLIGHT !== "0",
    metricsEnabled: env.MARKPAD_PREVIEW_METRICS === "1",
  };
}

export function isAbortLikeError(err: unknown): boolean {
  const maybeErr = err as { name?: string; code?: string; message?: string };
  if (maybeErr?.name === "AbortError") return true;
  if (maybeErr?.code === "ABORT_ERR") return true;
  if (typeof maybeErr?.message === "string" && /aborted|abort/i.test(maybeErr.message)) return true;
  return false;
}

function parseRenderOptions(input: unknown): RenderOptions {
  if (!input || typeof input !== "object") return {};
  const raw = input as { pageSize?: unknown; documentFont?: unknown; fontSizePt?: unknown; lineStretch?: unknown };
  const pageSize =
    raw.pageSize === "a4" || raw.pageSize === "letter" || raw.pageSize === "legal" || raw.pageSize === "a5"
      ? raw.pageSize
      : undefined;
  const documentFont =
    raw.documentFont === "latin-modern" ||
    raw.documentFont === "times-new-roman" ||
    raw.documentFont === "palatino" ||
    raw.documentFont === "helvetica" ||
    raw.documentFont === "computer-modern"
      ? raw.documentFont
      : undefined;

  const fontSizePt =
    typeof raw.fontSizePt === "number" && Number.isFinite(raw.fontSizePt)
      ? Math.min(16, Math.max(9, raw.fontSizePt))
      : undefined;

  const lineStretch =
    typeof raw.lineStretch === "number" && Number.isFinite(raw.lineStretch)
      ? Math.min(1.6, Math.max(1, raw.lineStretch))
      : undefined;

  return { pageSize, documentFont, fontSizePt, lineStretch };
}

export function setupWebSocket(server: Server) {
  const config = resolveWebSocketPreviewConfig();
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = request.url || "";
    if (url === "/api/ws/preview" || url.startsWith("/api/ws/preview?")) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    logger.info("WebSocket preview client connected");

    let renderTimer: ReturnType<typeof setTimeout> | null = null;
    let isRendering = false;
    let pendingRequest: PendingRequest | null = null;
    let activeRenderAbortController: AbortController | null = null;
    let lastRequestedKey = "";
    let lastRenderedKey = "";

    async function doRender(projectId: number, content: string, options: RenderOptions, requestedAtMs: number) {
      const key = `${projectId}:${content}:${JSON.stringify(options)}`;
      if (key === lastRenderedKey) {
        return;
      }

      if (isRendering) {
        pendingRequest = { projectId, content, options, requestedAtMs };
        if (config.cancelInFlight && activeRenderAbortController && !activeRenderAbortController.signal.aborted) {
          activeRenderAbortController.abort();
        }
        return;
      }

      isRendering = true;
      const renderAbortController = new AbortController();
      activeRenderAbortController = renderAbortController;
      const renderStartedAt = performance.now();
      try {
        const pdfBytes = await renderMarkdownToPdf(content, options, projectId, {
          signal: renderAbortController.signal,
        });

        if (renderAbortController.signal.aborted) {
          return;
        }

        lastRenderedKey = key;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(pdfBytes, { binary: true });
        }

        if (config.metricsEnabled) {
          const finishedAt = performance.now();
          logger.info(
            {
              queueDelayMs: Number((renderStartedAt - requestedAtMs).toFixed(1)),
              renderMs: Number((finishedAt - renderStartedAt).toFixed(1)),
              totalMs: Number((finishedAt - requestedAtMs).toFixed(1)),
              contentLength: content.length,
            },
            "WebSocket preview render completed",
          );
        }
      } catch (err) {
        if (isAbortLikeError(err) || renderAbortController.signal.aborted) {
          if (config.metricsEnabled) {
            logger.debug({ contentLength: content.length }, "WebSocket preview render aborted");
          }
          return;
        }

        logger.error({ err }, "WebSocket render failed");
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ error: (err as Error).message }));
        }
      } finally {
        if (activeRenderAbortController === renderAbortController) {
          activeRenderAbortController = null;
        }
        isRendering = false;
        if (pendingRequest !== null) {
          const next = pendingRequest;
          pendingRequest = null;
          void doRender(next.projectId, next.content, next.options, next.requestedAtMs);
        }
      }
    }

    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        const projectId = typeof msg.projectId === "number" && Number.isInteger(msg.projectId) ? msg.projectId : null;
        if (typeof msg.content === "string" && projectId && projectId > 0) {
          const options = parseRenderOptions(msg.options);
          const requestKey = `${projectId}:${msg.content}:${JSON.stringify(options)}`;
          if (requestKey === lastRequestedKey) return;
          lastRequestedKey = requestKey;
          if (renderTimer) clearTimeout(renderTimer);
          renderTimer = setTimeout(() => {
            void doRender(projectId, msg.content, options, performance.now());
          }, config.debounceMs);
        }
      } catch {
        logger.warn("Invalid WebSocket message received");
      }
    });

    ws.on("close", () => {
      if (renderTimer) clearTimeout(renderTimer);
      if (activeRenderAbortController && !activeRenderAbortController.signal.aborted) {
        activeRenderAbortController.abort();
      }
      logger.info("WebSocket preview client disconnected");
    });

    ws.on("error", (err) => {
      logger.error({ err }, "WebSocket error");
    });
  });

  return wss;
}
