import app from "./app";
import { logger } from "./lib/logger";
import { prewarmPdfRenderer } from "./lib/renderer";
import { setupWebSocket } from "./lib/websocket";

function parseWarmupDelayMs(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(60_000, parsed));
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

setupWebSocket(server);

const disableRendererWarmup = process.env.MARKPAD_DISABLE_RENDERER_WARMUP === "1";
const warmupDelayMs = parseWarmupDelayMs(process.env.MARKPAD_RENDERER_WARMUP_DELAY_MS);

if (!disableRendererWarmup) {
  if (warmupDelayMs > 0) {
    logger.info({ warmupDelayMs }, "Scheduling delayed PDF renderer warmup");
    setTimeout(() => {
      void prewarmPdfRenderer();
    }, warmupDelayMs);
  } else {
    void prewarmPdfRenderer();
  }
} else {
  logger.info("PDF renderer warmup disabled by MARKPAD_DISABLE_RENDERER_WARMUP");
}
