import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/build/pdf.worker.mjs";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

// Set worker src
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

interface PDFPreviewProps {
  projectId: number | null;
  content: string;
  onStatusChange: (status: "Rendering..." | "Ready" | "Error") => void;
}

export function PDFPreview({ projectId, content, onStatusChange }: PDFPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  // WebSocket connection
  useEffect(() => {
    if (!projectId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/ws/preview`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected for preview");
    };

    ws.onmessage = async (event) => {
      if (event.data instanceof Blob) {
        const arrayBuffer = await event.data.arrayBuffer();
        setPdfData(new Uint8Array(arrayBuffer));
        onStatusChange("Ready");
      }
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      setError("Connection error");
      onStatusChange("Error");
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected");
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [projectId, onStatusChange]);

  // Debounced send
  useEffect(() => {
    if (!projectId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    onStatusChange("Rendering...");
    const timeout = setTimeout(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ projectId, content }));
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [content, projectId, onStatusChange]);

  // Render PDF
  useEffect(() => {
    if (!pdfData || !containerRef.current) return;

    let isMounted = true;
    const container = containerRef.current;

    const renderPdf = async () => {
      try {
        const loadingTask = pdfjsLib.getDocument({ data: pdfData });
        const pdf = await loadingTask.promise;
        
        if (!isMounted) return;

        // Clear existing canvas elements safely
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          if (!isMounted) return;

          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");

          if (!context) continue;

          canvas.height = viewport.height;
          canvas.width = viewport.width;
          canvas.className = "mb-4 shadow-md max-w-full bg-white";

          container.appendChild(canvas);

          await page.render({
            canvasContext: context,
            viewport: viewport,
          }).promise;
        }
      } catch (err) {
        console.error("Error rendering PDF:", err);
        if (isMounted) setError("Failed to render PDF");
      }
    };

    renderPdf();

    return () => {
      isMounted = false;
    };
  }, [pdfData]);

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a project to view preview
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
