import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/build/pdf.worker.mjs";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AppPreferences } from "@/lib/preferences";
import { getApiBaseUrl } from "@/lib/runtime-api";

// Set worker src
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

interface PDFPreviewProps {
  projectId: number | null;
  selectedFile: string | null;
  content: string;
  preferences: AppPreferences;
  onStatusChange: (status: "Rendering..." | "Ready" | "Error") => void;
}

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
  const renderVersionRef = useRef(0);
  const activeLoadingTaskRef = useRef<any>(null);
  const activePageTasksRef = useRef<any[]>([]);
  const [isPageVisible, setIsPageVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    onStatusChange("Rendering...");
    ws.send(
      JSON.stringify({
        projectId: payload.projectId,
        content: payload.content,
        options: payload.options,
      }),
    );
  };

  useEffect(() => {
    if (!projectId || !selectedFile) {
      setPdfData(null);
      setError(null);
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
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        clearReconnectTimer();
        setError(null);
        sendPayload(ws, true);
      };

      ws.onmessage = async (event) => {
        if (event.data instanceof Blob) {
          const arrayBuffer = await event.data.arrayBuffer();
          setPdfData(new Uint8Array(arrayBuffer));
          setError(null);
          onStatusChange("Ready");
          return;
        }

        if (typeof event.data === "string") {
          try {
            const parsed = JSON.parse(event.data) as { error?: string };
            if (parsed.error) {
              setError(parsed.error);
              onStatusChange("Error");
            }
          } catch {
            setError(event.data || "Preview render failed");
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

  // Debounced send
  useEffect(() => {
    if (!projectId || !selectedFile || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const key = payloadKey(
      projectId,
      content,
      preferences.pageSize,
      preferences.documentFont,
      preferences.renderFontSizePt,
      preferences.renderLineStretch,
    );
    if (key === lastSentPayloadRef.current) return;

    onStatusChange("Rendering...");
    setError(null);
    const timeout = setTimeout(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        lastSentPayloadRef.current = key;
        wsRef.current.send(JSON.stringify({
          projectId,
          content,
          options: {
            pageSize: preferences.pageSize,
            documentFont: preferences.documentFont,
            fontSizePt: preferences.renderFontSizePt,
            lineStretch: preferences.renderLineStretch,
          },
        }));
      }
    }, 180);

    return () => clearTimeout(timeout);
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

    const signature = `${pdfData.length}:${pdfData[0] ?? 0}:${pdfData[1] ?? 0}:${pdfData[pdfData.length - 1] ?? 0}`;
    if (signature === lastRenderedPdfSignatureRef.current) {
      onStatusChange("Ready");
      return;
    }
    lastRenderedPdfSignatureRef.current = signature;

    let isMounted = true;
    const container = containerRef.current;
    const currentVersion = ++renderVersionRef.current;

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
        const loadingTask = pdfjsLib.getDocument({ data: pdfData });
        activeLoadingTaskRef.current = loadingTask;
        const pdf = await loadingTask.promise;
        
        if (!isMounted || currentVersion !== renderVersionRef.current) return;

        // Clear existing canvas elements safely
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          if (!isMounted || currentVersion !== renderVersionRef.current) return;

          const viewport = page.getViewport({ scale: 1.1 });
          const outputScale = Math.min(window.devicePixelRatio || 1, 1.5);
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");

          if (!context) continue;

          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          canvas.className = "mb-4 shadow-md max-w-full bg-white";

          context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

          const pageTask = page.render({
            canvasContext: context,
            viewport: viewport,
          });
          activePageTasksRef.current.push(pageTask);
          await pageTask.promise;

          if (!isMounted || currentVersion !== renderVersionRef.current) return;
          container.appendChild(canvas);
        }
      } catch (err) {
        const cancelled = (err as { name?: string })?.name === "RenderingCancelledException";
        if (!cancelled) {
          console.error("Error rendering PDF:", err);
          if (isMounted) setError("Failed to render PDF");
        }
      }
    };

    renderPdf();

    return () => {
      isMounted = false;
      if (activeLoadingTaskRef.current) {
        activeLoadingTaskRef.current.destroy?.();
        activeLoadingTaskRef.current = null;
      }
      for (const task of activePageTasksRef.current) {
        task?.cancel?.();
      }
      activePageTasksRef.current = [];
    };
  }, [pdfData, isPageVisible]);

  if (!projectId || !selectedFile) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        {projectId ? "Select a file to view preview" : "Select a project to view preview"}
      </div>
    );
  }

  return (
    <ScrollArea className="h-full w-full bg-secondary/30">
      <div className="p-8 flex flex-col items-center justify-start min-h-full">
        {error ? (
          <div className="text-destructive">{error}</div>
        ) : !pdfData ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Waiting for preview...</span>
          </div>
        ) : (
          <div ref={containerRef} className="flex flex-col items-center w-full" />
        )}
      </div>
    </ScrollArea>
  );
}
