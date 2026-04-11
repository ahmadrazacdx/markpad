import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { renderMarkdownToPdf, RenderOptions } from "./renderer";
import { logger } from "./logger";

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
    let pendingRequest: { content: string; options: RenderOptions } | null = null;
    let lastRequestedKey = "";
    let lastRenderedKey = "";

    async function doRender(content: string, options: RenderOptions) {
      const key = `${content}:${JSON.stringify(options)}`;
      if (key === lastRenderedKey) {
        return;
      }

      if (isRendering) {
        pendingRequest = { content, options };
        return;
      }

      isRendering = true;
      try {
        const pdfBytes = await renderMarkdownToPdf(content, options);
        lastRenderedKey = key;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(pdfBytes, { binary: true });
        }
      } catch (err) {
        logger.error({ err }, "WebSocket render failed");
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ error: (err as Error).message }));
        }
      } finally {
        isRendering = false;
        if (pendingRequest !== null) {
          const next = pendingRequest;
          pendingRequest = null;
          doRender(next.content, next.options);
        }
      }
    }

    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.content !== undefined) {
          const options = parseRenderOptions(msg.options);
          const requestKey = `${msg.content}:${JSON.stringify(options)}`;
          if (requestKey === lastRequestedKey) return;
          lastRequestedKey = requestKey;
          if (renderTimer) clearTimeout(renderTimer);
          renderTimer = setTimeout(() => {
            doRender(msg.content, options);
          }, 140);
        }
      } catch {
        logger.warn("Invalid WebSocket message received");
      }
    });

    ws.on("close", () => {
      if (renderTimer) clearTimeout(renderTimer);
      logger.info("WebSocket preview client disconnected");
    });

    ws.on("error", (err) => {
      logger.error({ err }, "WebSocket error");
    });
  });

  return wss;
}
