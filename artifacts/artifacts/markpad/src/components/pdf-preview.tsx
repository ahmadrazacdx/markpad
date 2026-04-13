import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/build/pdf.worker.mjs";
import { ChevronDown, ChevronRight, CircleX, Loader2, ScrollText } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AppPreferences } from "@/lib/preferences";
import { getApiBaseUrl } from "@/lib/runtime-api";

// Set worker src
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

function parsePreviewInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function computePdfSignature(data: Uint8Array): string {
  let hash = 2166136261;
  for (let i = 0; i < data.length; i += 1) {
    hash ^= data[i] ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `${data.length}:${(hash >>> 0).toString(16)}`;
}

const previewMetricsEnabled = import.meta.env.VITE_PREVIEW_METRICS === "1";
const previewInitialPages = parsePreviewInt(import.meta.env.VITE_PREVIEW_INITIAL_PAGES, 2, 1, 10);
const previewRenderChunkSize = parsePreviewInt(import.meta.env.VITE_PREVIEW_RENDER_CHUNK_SIZE, 2, 1, 10);
const previewLivePageCap = parsePreviewInt(import.meta.env.VITE_PREVIEW_LIVE_PAGE_CAP, 40, 1, 500);

interface PDFPreviewProps {
  projectId: number | null;
  selectedFile: string | null;
  content: string;
  preferences: AppPreferences;
  onStatusChange: (status: "Rendering..." | "Ready" | "Error") => void;
}

type PreviewErrorLog = {
  id: number;
  timestamp: string;
  source: "websocket" | "renderer";
  message: string;
};

export function PDFPreview({ projectId, selectedFile, content, preferences, onStatusChange }: PDFPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const activeSessionRef = useRef(false);
  const latestPayloadRef = useRef<{
    projectId: number | null;
    content: string;
    options: { pageSize: string; documentFont: string; fontSizePt: number; lineStretch: number };
  }>({
    projectId,
    content,
    options: {
      pageSize: preferences.pageSize,
      documentFont: preferences.documentFont,
      fontSizePt: preferences.renderFontSizePt,
      lineStretch: preferences.renderLineStretch,
    },
  });
  const lastSentPayloadRef = useRef<string>("");
  const lastRenderedPdfSignatureRef = useRef<string>("");
  const requestSequenceRef = useRef(0);
  const lastRequestSentAtRef = useRef<number | null>(null);
  const lastPdfReceivedAtRef = useRef<number | null>(null);
  const renderVersionRef = useRef(0);
  const activeLoadingTaskRef = useRef<any>(null);
  const activePageTasksRef = useRef<any[]>([]);
  const [isPageVisible, setIsPageVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorLogs, setErrorLogs] = useState<PreviewErrorLog[]>([]);
  const [isErrorPanelOpen, setIsErrorPanelOpen] = useState(false);
  const [expandedLogIds, setExpandedLogIds] = useState<Set<number>>(() => new Set());

  const appendErrorLog = (source: PreviewErrorLog["source"], message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setErrorLogs((prev) => [
      ...prev,
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        timestamp,
        source,
        message,
      },
    ]);
  };

  const toggleExpandedLog = (id: number) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const resolvePreviewWebSocketUrl = () => {
    const apiBaseUrl = getApiBaseUrl();

    if (apiBaseUrl) {
      const url = new URL("/api/ws/preview", apiBaseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return url.toString();
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    return `${protocol}//${host}/api/ws/preview`;
  };

  useEffect(() => {
    latestPayloadRef.current = {
      projectId,
      content,
      options: {
        pageSize: preferences.pageSize,
        documentFont: preferences.documentFont,
        fontSizePt: preferences.renderFontSizePt,
        lineStretch: preferences.renderLineStretch,
      },
    };
  }, [
    projectId,
    content,
    preferences.pageSize,
    preferences.documentFont,
    preferences.renderFontSizePt,
    preferences.renderLineStretch,
  ]);

  const payloadKey = (
    pid: number | null,
    text: string,
    pageSize: string,
    documentFont: string,
    fontSizePt: number,
    lineStretch: number,
  ) => `${pid ?? "none"}:${pageSize}:${documentFont}:${fontSizePt}:${lineStretch}:${text}`;

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const sendPayload = (ws: WebSocket, force = false) => {
    const payload = latestPayloadRef.current;
    if (!payload.projectId || !selectedFile) return;

    const key = payloadKey(
      payload.projectId,
      payload.content,
      payload.options.pageSize,
      payload.options.documentFont,
      payload.options.fontSizePt,
      payload.options.lineStretch,
    );

    if (!force && key === lastSentPayloadRef.current) return;

    lastSentPayloadRef.current = key;
    const requestId = ++requestSequenceRef.current;
    lastRequestSentAtRef.current = performance.now();
    onStatusChange("Rendering...");
    setError(null);
    ws.send(
      JSON.stringify({
        projectId: payload.projectId,
        content: payload.content,
        options: payload.options,
        requestId,
      }),
    );
  };

  useEffect(() => {
    if (!projectId || !selectedFile) {
      setPdfData(null);
      setError(null);
      setErrorLogs([]);
      setIsErrorPanelOpen(false);
      setExpandedLogIds(new Set());
      onStatusChange("Ready");
    }
  }, [projectId, selectedFile, onStatusChange]);

  // WebSocket connection
  useEffect(() => {
    if (!projectId || !selectedFile) return;

    activeSessionRef.current = true;
    reconnectAttemptsRef.current = 0;
    const wsUrl = resolvePreviewWebSocketUrl();

    const scheduleReconnect = () => {
      if (!activeSessionRef.current) return;

      clearReconnectTimer();
      const attempt = Math.min(reconnectAttemptsRef.current, 6);
      const delayMs = Math.min(2000, 150 * (2 ** attempt));
      reconnectAttemptsRef.current += 1;

      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, delayMs);
    };

    const connect = () => {
      if (!activeSessionRef.current) return;

      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        scheduleReconnect();
        return;
      }

      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        clearReconnectTimer();
        setError(null);
        sendPayload(ws, true);
      };

      ws.onmessage = async (event) => {
        const handlePdfBinary = (buffer: ArrayBuffer) => {
          const safeBuffer = buffer.slice(0);
          const receivedAt = performance.now();
          lastPdfReceivedAtRef.current = receivedAt;
          if (previewMetricsEnabled && lastRequestSentAtRef.current !== null) {
            console.info("[preview-metrics] websocket roundtrip", {
              requestToBinaryMs: Number((receivedAt - lastRequestSentAtRef.current).toFixed(1)),
              bytes: safeBuffer.byteLength,
            });
          }
          setPdfData(new Uint8Array(safeBuffer));
          setError(null);
        };

        if (event.data instanceof ArrayBuffer) {
          handlePdfBinary(event.data);
          return;
        }

        if (event.data instanceof Blob) {
          handlePdfBinary(await event.data.arrayBuffer());
          return;
        }

        if (typeof event.data === "string") {
          try {
            const parsed = JSON.parse(event.data) as { error?: string };
            if (parsed.error) {
              setError(parsed.error);
              appendErrorLog("websocket", parsed.error);
              setIsErrorPanelOpen(true);
              onStatusChange("Error");
            }
          } catch {
            const fallbackMessage = event.data || "Preview render failed";
            setError(fallbackMessage);
            appendErrorLog("websocket", fallbackMessage);
            setIsErrorPanelOpen(true);
            onStatusChange("Error");
          }
        }
      };

      ws.onerror = () => {
        // Rely on onclose + backoff reconnect to avoid sticky error states.
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }

        if (!activeSessionRef.current) return;
        onStatusChange("Rendering...");
        scheduleReconnect();
      };
    };

    const handleVisibilityOrFocus = () => {
      const visible = typeof document === "undefined" || document.visibilityState === "visible";
      setIsPageVisible(visible);

      if (!activeSessionRef.current || !visible) return;

      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        connect();
        return;
      }

      if (ws.readyState === WebSocket.OPEN) {
        sendPayload(ws, true);
      }
    };

    connect();
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);

    return () => {
      activeSessionRef.current = false;
      clearReconnectTimer();
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);

      const ws = wsRef.current;
      if (ws) {
        ws.close();
      }
      wsRef.current = null;
    };
  }, [projectId, selectedFile, onStatusChange]);

  // Immediate send on content/options changes; backend debounce handles pacing.
  useEffect(() => {
    if (!projectId || !selectedFile) return;

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    sendPayload(ws);
  }, [
    content,
    projectId,
    selectedFile,
    onStatusChange,
    preferences.pageSize,
    preferences.documentFont,
    preferences.renderFontSizePt,
    preferences.renderLineStretch,
  ]);

  // Render PDF
  useEffect(() => {
    if (!pdfData || !containerRef.current || !isPageVisible) return;

    const signature = computePdfSignature(pdfData);
    if (signature === lastRenderedPdfSignatureRef.current) {
      onStatusChange("Ready");
      return;
    }
    lastRenderedPdfSignatureRef.current = signature;

    let isMounted = true;
    const container = containerRef.current;
    const currentVersion = ++renderVersionRef.current;
    let detachScrollListener: (() => void) | null = null;

    if (activeLoadingTaskRef.current) {
      activeLoadingTaskRef.current.destroy?.();
      activeLoadingTaskRef.current = null;
    }
    for (const task of activePageTasksRef.current) {
      task?.cancel?.();
    }
    activePageTasksRef.current = [];

    const renderPdf = async () => {
      try {
        const stablePdfData = pdfData.slice();
        const loadingTask = pdfjsLib.getDocument({ data: stablePdfData });
        activeLoadingTaskRef.current = loadingTask;
        const pdf = await loadingTask.promise;

        if (!isMounted || currentVersion !== renderVersionRef.current) return;

        // Clear existing canvas elements safely
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }

        const maxPreviewPages = Math.min(pdf.numPages, previewLivePageCap);
        let nextPageToRender = 1;
        let chunkInProgress = false;

        const renderSinglePage = async (pageNum: number) => {
          const page = await pdf.getPage(pageNum);
          if (!isMounted || currentVersion !== renderVersionRef.current) return false;

          const viewport = page.getViewport({ scale: 1.1 });
          const outputScale = Math.min(window.devicePixelRatio || 1, 1.5);
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");

          if (!context) return true;

          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          canvas.style.display = "block";
          canvas.className = "mb-4 block shadow-md max-w-full bg-white";

          context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

          const pageTask = page.render({
            canvasContext: context,
            viewport,
          });
          activePageTasksRef.current.push(pageTask);
          await pageTask.promise;

          if (!isMounted || currentVersion !== renderVersionRef.current) return false;
          container.appendChild(canvas);

          if (pageNum === 1) {
            onStatusChange("Ready");
            if (previewMetricsEnabled && lastPdfReceivedAtRef.current !== null) {
              console.info("[preview-metrics] first page paint", {
                binaryToFirstPaintMs: Number((performance.now() - lastPdfReceivedAtRef.current).toFixed(1)),
              });
            }
          }

          return true;
        };

        const renderChunk = async (targetPages: number) => {
          if (chunkInProgress || !isMounted || currentVersion !== renderVersionRef.current) {
            return;
          }

          chunkInProgress = true;
          try {
            let renderedInChunk = 0;
            while (renderedInChunk < targetPages && nextPageToRender <= maxPreviewPages) {
              const rendered = await renderSinglePage(nextPageToRender);
              if (!rendered) return;

              nextPageToRender += 1;
              renderedInChunk += 1;

              if (renderedInChunk < targetPages) {
                await new Promise((resolve) => window.setTimeout(resolve, 0));
              }
            }
          } finally {
            chunkInProgress = false;
          }
        };

        await renderChunk(previewInitialPages);

        if (!isMounted || currentVersion !== renderVersionRef.current) return;

        const viewportEl = container.closest("[data-radix-scroll-area-viewport]") as HTMLElement | null;
        const maybeRenderMore = () => {
          if (nextPageToRender > maxPreviewPages || chunkInProgress) return;

          if (!viewportEl) {
            void renderChunk(previewRenderChunkSize);
            return;
          }

          const nearBottom = viewportEl.scrollTop + viewportEl.clientHeight >= viewportEl.scrollHeight - 640;
          if (nearBottom) {
            void renderChunk(previewRenderChunkSize);
          }
        };

        if (viewportEl) {
          const onScroll = () => {
            maybeRenderMore();
          };

          viewportEl.addEventListener("scroll", onScroll, { passive: true });
          detachScrollListener = () => {
            viewportEl.removeEventListener("scroll", onScroll);
          };

          while (
            isMounted &&
            currentVersion === renderVersionRef.current &&
            nextPageToRender <= maxPreviewPages &&
            viewportEl.scrollHeight <= viewportEl.clientHeight + 48
          ) {
            await renderChunk(previewRenderChunkSize);
          }
        } else {
          while (
            isMounted &&
            currentVersion === renderVersionRef.current &&
            nextPageToRender <= maxPreviewPages
          ) {
            await renderChunk(previewRenderChunkSize);
          }
        }

        if (
          maxPreviewPages < pdf.numPages &&
          isMounted &&
          currentVersion === renderVersionRef.current
        ) {
          const notice = document.createElement("div");
          notice.className = "mb-2 rounded-md border border-border bg-background/70 px-3 py-2 text-xs text-muted-foreground";
          notice.textContent = `Live preview is capped to ${maxPreviewPages} pages while typing (${pdf.numPages} total). Export for the full PDF.`;
          container.appendChild(notice);
        }

        if (pdf.numPages === 0) {
          onStatusChange("Ready");
        }
      } catch (err) {
        const cancelled = (err as { name?: string })?.name === "RenderingCancelledException";
        if (!cancelled) {
          console.error("Error rendering PDF:", err);
          if (isMounted) {
            const renderMessage = err instanceof Error ? err.message : String(err ?? "Failed to render PDF");
            setError("Failed to render PDF");
            appendErrorLog("renderer", renderMessage);
            setIsErrorPanelOpen(true);
            onStatusChange("Error");
          }
        }
      }
    };

    void renderPdf();

    return () => {
      isMounted = false;
      if (detachScrollListener) {
        detachScrollListener();
        detachScrollListener = null;
      }
      if (activeLoadingTaskRef.current) {
        activeLoadingTaskRef.current.destroy?.();
        activeLoadingTaskRef.current = null;
      }
      for (const task of activePageTasksRef.current) {
        task?.cancel?.();
      }
      activePageTasksRef.current = [];
    };
  }, [pdfData, isPageVisible, onStatusChange]);

  if (!projectId || !selectedFile) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        {projectId ? "Select a file to view preview" : "Select a project to view preview"}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-secondary/30">
      <ScrollArea className={`h-full w-full ${isErrorPanelOpen ? "pr-[320px]" : ""}`}>
        <div className="p-8 flex flex-col items-center justify-start min-h-full">
          {error ? (
            <div className="flex h-40 w-full items-center justify-center">
              <CircleX className="h-12 w-12 text-destructive" aria-label="Preview failed" />
            </div>
          ) : !pdfData ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Waiting for preview...</span>
            </div>
          ) : (
            <div ref={containerRef} className="flex w-full flex-col items-center" />
          )}
        </div>
      </ScrollArea>

      <button
        type="button"
        onClick={() => setIsErrorPanelOpen((prev) => !prev)}
        className="absolute right-2 top-2 z-20 inline-flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-card-foreground shadow-sm hover:bg-accent hover:text-accent-foreground"
        aria-label="Toggle preview logs"
      >
        <span className="relative inline-flex">
          <ScrollText className="h-4 w-4" />
          {errorLogs.length > 0 ? (
            <span className="absolute -right-2 -top-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {errorLogs.length}
            </span>
          ) : null}
        </span>
        <span>Logs</span>
      </button>

      <aside
        className={`absolute right-0 top-0 z-10 h-full w-[320px] border-l border-border bg-card transition-transform duration-200 ${
          isErrorPanelOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h3 className="text-sm font-semibold">Preview Logs</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {errorLogs.length}
            </span>
          </div>
          <ScrollArea className="flex-1">
            <div className="space-y-2 p-3">
              {errorLogs.length === 0 ? (
                <p className="text-xs text-muted-foreground">No logs yet.</p>
              ) : (
                errorLogs.map((entry) => {
                  const isExpanded = expandedLogIds.has(entry.id);
                  const collapsedLine = entry.message.split(/\r?\n/, 1)[0] ?? "";

                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => toggleExpandedLog(entry.id)}
                      className="w-full rounded-md border border-border bg-background/70 p-2 text-left"
                    >
                      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1 uppercase tracking-wide">
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          {entry.source}
                        </span>
                        <span>{entry.timestamp}</span>
                      </div>
                      {isExpanded ? (
                        <pre className="whitespace-pre-wrap break-words text-xs text-foreground font-mono">
                          {entry.message}
                        </pre>
                      ) : (
                        <p className="truncate text-xs text-foreground font-mono">
                          {collapsedLine}
                        </p>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>
      </aside>
    </div>
  );
}
