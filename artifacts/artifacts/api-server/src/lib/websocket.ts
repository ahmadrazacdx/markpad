import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { renderMarkdownToPdf } from "./renderer";
import { logger } from "./logger";

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
    let pendingContent: string | null = null;

    async function doRender(content: string) {
      if (isRendering) {
        pendingContent = content;
        return;
      }

      isRendering = true;
      try {
        const pdfBytes = await renderMarkdownToPdf(content);
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
        if (pendingContent !== null) {
          const next = pendingContent;
          pendingContent = null;
          doRender(next);
        }
      }
    }

    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.content !== undefined) {
          if (renderTimer) clearTimeout(renderTimer);
          renderTimer = setTimeout(() => {
            doRender(msg.content);
          }, 100);
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
