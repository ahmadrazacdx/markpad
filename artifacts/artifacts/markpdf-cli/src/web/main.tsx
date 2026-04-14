import React, { useState } from "react";
import { createRoot } from "react-dom/client";

type PageSize = "a4" | "letter" | "legal" | "a5" | "b5" | "executive";
type DocumentFont = "latin-modern" | "times-new-roman" | "palatino" | "helvetica" | "computer-modern";
type GeometryPreset = "compact" | "normal" | "comfortable";

type ConvertSettings = {
  pageSize: PageSize;
  documentFont: DocumentFont;
  fontSizePt: number;
  lineStretch: number;
  geometryPreset: GeometryPreset;
};

type LogEntry = {
  message: string;
  level: "info" | "error";
};

type UploadMode = "markdown" | "project";

const PAGE_SIZE_OPTIONS: Array<{ value: PageSize; label: string }> = [
  { value: "a4", label: "A4" },
  { value: "letter", label: "US Letter" },
  { value: "legal", label: "US Legal" },
  { value: "a5", label: "A5" },
  { value: "b5", label: "B5" },
  { value: "executive", label: "Executive" }
];

const DOCUMENT_FONT_OPTIONS: Array<{ value: DocumentFont; label: string }> = [
  { value: "latin-modern", label: "Latin Modern" },
  { value: "computer-modern", label: "Computer Modern" },
  { value: "times-new-roman", label: "Times New Roman" },
  { value: "palatino", label: "Palatino" },
  { value: "helvetica", label: "Helvetica" }
];

const GEOMETRY_OPTIONS: Array<{ value: GeometryPreset; label: string }> = [
  { value: "compact", label: "Compact" },
  { value: "normal", label: "Normal" },
  { value: "comfortable", label: "Comfortable" }
];

const DEFAULT_SETTINGS: ConvertSettings = {
  pageSize: "a4",
  documentFont: "latin-modern",
  fontSizePt: 11,
  lineStretch: 1.1,
  geometryPreset: "normal"
};

function IconFile() {
  return (
    <img className="brand-logo" src="/markpdf-logo.svg" alt="MarkPDF" width={34} height={34} />
  );
}

function IconGear() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" fill="none" stroke="#75beff" strokeWidth="1.7" />
      <path d="M20 13.2v-2.4l-2.1-.6a6.2 6.2 0 0 0-.6-1.5l1.1-1.9-1.7-1.7-1.9 1.1c-.5-.2-1-.4-1.5-.6L13.2 3h-2.4l-.6 2.1c-.5.2-1 .4-1.5.6L6.8 4.6 5.1 6.3l1.1 1.9c-.2.5-.4 1-.6 1.5L3.5 10.3v2.4l2.1.6c.2.5.4 1 .6 1.5l-1.1 1.9 1.7 1.7 1.9-1.1c.5.2 1 .4 1.5.6l.6 2.1h2.4l.6-2.1c.5-.2 1-.4 1.5-.6l1.9 1.1 1.7-1.7-1.1-1.9c.2-.5.4-1 .6-1.5l2.1-.6z" fill="none" stroke="#75beff" strokeWidth="1.4" />
    </svg>
  );
}

function IconConsole() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" style={{ color: "#75beff" }}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7 10l2.6 2.2L7 14.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.8 14.5h4.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconResult({ kind }: { kind: "pdf" | "zip" | "error" }) {
  if (kind === "zip") {
    return (
      <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 2h9l5 5v15H6z" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M15 2v5h5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 7v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M10.2 9h3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <rect x="10.5" y="12.5" width="3" height="3" rx="0.6" fill="currentColor" />
      </svg>
    );
  }

  if (kind === "error") {
    return (
      <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M9 9l6 6M15 9l-6 6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 2h9l5 5v15H6z" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M15 2v5h5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.6 16.8v-5.8h2.6a1.8 1.8 0 0 1 0 3.6H10v2.2z" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M13.2 16.8v-5.8h1.7c1.2 0 2 0.8 2 1.8 0 0.9-0.7 1.7-2 1.7h-1.7" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function IconRotateArrows({ spinning }: { spinning: boolean }) {
  return (
    <svg className={`convert-icon${spinning ? " spinning" : ""}`} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12a8 8 0 0 1 13.5-5.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17.8 3.8v3.9h-3.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 12a8 8 0 0 1-13.5 5.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6.2 20.2v-3.9h3.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function isMarkdownFileName(fileName: string): boolean {
  return /\.(md|markdown)$/i.test(fileName);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = value.indexOf(",");
      resolve(commaIndex >= 0 ? value.slice(commaIndex + 1) : value);
    };
    reader.readAsDataURL(file);
  });
}

function uploadedPath(file: File): string {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  const normalized = (relativePath && relativePath.length > 0 ? relativePath : file.name)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (relativePath && normalized.includes("/")) {
    const parts = normalized.split("/").filter((part) => part.length > 0);
    if (parts.length > 1) {
      return parts.slice(1).join("/");
    }
  }

  return normalized;
}

function App() {
  const [uploadMode, setUploadMode] = useState<UploadMode>("markdown");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [projectFiles, setProjectFiles] = useState<File[]>([]);
  const [projectZip, setProjectZip] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [downloadPath, setDownloadPath] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string>("");
  const [resultKind, setResultKind] = useState<"pdf" | "zip" | "error">("pdf");
  const [message, setMessage] = useState("Waiting for files");
  const [status, setStatus] = useState<"idle" | "ok" | "error" | "loading">("idle");
  const [settings, setSettings] = useState<ConvertSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const canConvert = uploadMode === "markdown"
    ? selectedFiles.length > 0
    : (projectZip !== null || projectFiles.length > 0);
  const isDone = status === "ok";

  const pushLog = (messageText: string, level: "info" | "error" = "info") => {
    if (!messageText.trim()) return;
    setLogs((prev) => {
      const next = [...prev, { message: messageText, level }];
      return next.slice(-320);
    });
  };

  const mergeBackendLogs = (data: Record<string, unknown>) => {
    if (Array.isArray(data.logs)) {
      for (const line of data.logs) {
        if (typeof line === "string") {
          pushLog(line, "info");
        }
      }
    }

    if (Array.isArray(data.details)) {
      for (const line of data.details) {
        if (typeof line === "string") {
          pushLog(line, "error");
        }
      }
    }
  };

  const normalizeFileList = (incoming: FileList | File[] | null | undefined) => {
    const arr = Array.from(incoming ?? []).filter((file): file is File => /\.(md|markdown)$/i.test(file.name));
    const capped = arr.slice(0, 50);
    setSelectedFiles(capped);
    setProjectFiles([]);
    setProjectZip(null);
    setDownloadPath(null);
    setDownloadName("");
    setResultKind("pdf");
    setMessage(capped.length ? `${capped.length} selected` : "No files selected");
    setStatus("idle");
  };

  const clearSelectedFiles = () => {
    normalizeFileList([]);
    setProjectFiles([]);
    setProjectZip(null);
    const input = document.getElementById("upload-input") as HTMLInputElement | null;
    const folderInput = document.getElementById("project-folder-input") as HTMLInputElement | null;
    const zipInput = document.getElementById("project-zip-input") as HTMLInputElement | null;
    if (input) {
      input.value = "";
    }
    if (folderInput) {
      folderInput.value = "";
    }
    if (zipInput) {
      zipInput.value = "";
    }
    pushLog("File selection cleared");
  };

  const normalizeProjectFolder = (incoming: FileList | File[] | null | undefined) => {
    const arr = Array.from(incoming ?? []);
    const markdownCount = arr.filter((file) => isMarkdownFileName(file.name)).length;
    if (markdownCount === 0) {
      setProjectFiles([]);
      setProjectZip(null);
      setMessage("Folder must include at least one markdown file");
      setStatus("error");
      return;
    }

    setUploadMode("project");
    setProjectFiles(arr);
    setProjectZip(null);
    setSelectedFiles([]);
    setDownloadPath(null);
    setDownloadName("");
    setResultKind("pdf");
    setStatus("idle");
    setMessage(`Project folder ready: ${markdownCount} markdown, ${arr.length - markdownCount} assets`);
  };

  const normalizeProjectZip = (incoming: FileList | File[] | null | undefined) => {
    const candidate = Array.from(incoming ?? []).find((file) => /\.zip$/i.test(file.name));
    if (!candidate) {
      setProjectZip(null);
      setMessage("Select a .zip project archive");
      setStatus("error");
      return;
    }

    setUploadMode("project");
    setProjectZip(candidate);
    setProjectFiles([]);
    setSelectedFiles([]);
    setDownloadPath(null);
    setDownloadName("");
    setResultKind("zip");
    setStatus("idle");
    setMessage(`Project archive ready: ${candidate.name}`);
  };

  const onDrop: React.DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    setIsDragging(false);
    if (uploadMode !== "markdown") {
      pushLog("Drag-drop is enabled for markdown mode only", "info");
      return;
    }
    normalizeFileList(event.dataTransfer.files);
  };

  const onConvert = async () => {
    if (!canConvert || isConverting || isDone) return;

    try {
      setIsConverting(true);
      setStatus("loading");
      setMessage("Converting...");
      setResultKind("pdf");
      setDownloadPath(null);
      setDownloadName("");
      pushLog(uploadMode === "markdown"
        ? `Conversion started for ${selectedFiles.length} markdown file(s)`
        : "Conversion started for project bundle");

      let payload: Record<string, unknown>;
      if (uploadMode === "markdown") {
        payload = {
          files: await Promise.all(
            selectedFiles.map(async (file) => ({
              name: file.name,
              path: file.name,
              content: await file.text()
            }))
          ),
          settings
        };
      } else if (projectZip) {
        payload = {
          archive: {
            name: projectZip.name,
            contentBase64: await fileToBase64(projectZip)
          },
          settings
        };
      } else {
        const markdownEntries: Array<{ name: string; path: string; content: string }> = [];
        const assetEntries: Array<{ path: string; contentBase64: string }> = [];

        for (const file of projectFiles) {
          const path = uploadedPath(file);
          if (isMarkdownFileName(file.name)) {
            markdownEntries.push({
              name: file.name,
              path,
              content: await file.text()
            });
          } else {
            assetEntries.push({
              path,
              contentBase64: await fileToBase64(file)
            });
          }
        }

        payload = {
          files: markdownEntries,
          assets: assetEntries,
          settings
        };
      }

      const response = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const raw = await response.text();
      const parsed = raw.trim() ? JSON.parse(raw) as Record<string, unknown> : {};
      mergeBackendLogs(parsed);

      if (!response.ok) {
        const errText = typeof parsed.error === "string" ? parsed.error : `Conversion failed (HTTP ${response.status})`;
        throw new Error(errText);
      }

      const kind = typeof parsed.kind === "string" ? parsed.kind : "pdf";
      setStatus("ok");
      setMessage("Ready to download");
      setResultKind(kind === "zip" ? "zip" : "pdf");
      setDownloadPath(typeof parsed.downloadPath === "string" ? parsed.downloadPath : null);
      setDownloadName(typeof parsed.fileName === "string" ? parsed.fileName : "output.pdf");
      pushLog("Conversion succeeded");
    } catch (error) {
      const errText = error instanceof Error ? error.message : "Unexpected error";
      setStatus("error");
      setMessage(errText);
      setResultKind("error");
      pushLog(errText, "error");
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <IconFile />
          <div>
            <h1>MarkPDF</h1>
            <p>Markdown to PDF, Fast and Local</p>
          </div>
        </div>
        <button className="icon-btn" type="button" onClick={() => setShowSettings((value) => !value)} title="Settings">
          <IconGear />
        </button>
      </header>

      {showSettings && (
        <section className="settings-panel">
          <div className="settings-grid">
            <div className="field">
              <label>Page size</label>
              <select
                value={settings.pageSize}
                onChange={(event) => setSettings((prev) => ({ ...prev, pageSize: event.currentTarget.value as PageSize }))}
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Document font</label>
              <select
                value={settings.documentFont}
                onChange={(event) => setSettings((prev) => ({ ...prev, documentFont: event.currentTarget.value as DocumentFont }))}
              >
                {DOCUMENT_FONT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Geometry</label>
              <select
                value={settings.geometryPreset}
                onChange={(event) => setSettings((prev) => ({ ...prev, geometryPreset: event.currentTarget.value as GeometryPreset }))}
              >
                {GEOMETRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Font size (pt)</label>
              <input
                type="number"
                min={9}
                max={16}
                step={1}
                value={settings.fontSizePt}
                onChange={(event) => setSettings((prev) => ({ ...prev, fontSizePt: Math.min(16, Math.max(9, Number(event.currentTarget.value) || 11)) }))}
              />
            </div>

            <div className="field">
              <label>Line stretch</label>
              <input
                type="number"
                min={1}
                max={2}
                step={0.1}
                value={settings.lineStretch}
                onChange={(event) => setSettings((prev) => ({ ...prev, lineStretch: Math.min(2, Math.max(1, Number(event.currentTarget.value) || 1.1)) }))}
              />
            </div>
          </div>
        </section>
      )}

      <section className="workspace">
        <article className="panel">
          <h2>Upload Markdown</h2>
          <div className="upload-mode-toggle" role="tablist" aria-label="Upload mode">
            <button
              type="button"
              className={`toggle-option ${uploadMode === "markdown" ? "active" : ""}`}
              onClick={() => setUploadMode("markdown")}
            >
              Markdown Files
            </button>
            <button
              type="button"
              className={`toggle-option ${uploadMode === "project" ? "active" : ""}`}
              onClick={() => setUploadMode("project")}
            >
              Project Bundle
            </button>
          </div>
          <p className="muted">
            {uploadMode === "markdown"
              ? "Drop .md files (up to 50) here."
              : "Use a project folder/.zip to preserve linked assets"}
          </p>
          <div
            className={`dropzone${isDragging ? " dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              if (uploadMode === "markdown") {
                setIsDragging(true);
              }
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            <div className="dropzone-inner">
              {uploadMode === "markdown" ? (
                <>
                  <button className="button" type="button" onClick={() => document.getElementById("upload-input")?.click()}>
                    Select File(s)
                  </button>
                  <input
                    id="upload-input"
                    type="file"
                    accept=".md,.markdown,text/markdown"
                    multiple
                    hidden
                    onChange={(event) => normalizeFileList(event.currentTarget.files)}
                  />
                  <p className="muted">{selectedFiles.length > 0 ? `${selectedFiles.length} selected` : "No files selected"}</p>
                </>
              ) : (
                <>
                  <div className="project-actions">
                    <button className="button" type="button" onClick={() => document.getElementById("project-folder-input")?.click()}>
                      Select Project Folder
                    </button>
                    <button className="button secondary" type="button" onClick={() => document.getElementById("project-zip-input")?.click()}>
                      Select Project ZIP
                    </button>
                  </div>
                  <input
                    id="project-folder-input"
                    type="file"
                    multiple
                    hidden
                    onChange={(event) => normalizeProjectFolder(event.currentTarget.files)}
                    {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                  />
                  <input
                    id="project-zip-input"
                    type="file"
                    accept=".zip,application/zip,application/x-zip-compressed"
                    hidden
                    onChange={(event) => normalizeProjectZip(event.currentTarget.files)}
                  />
                  <p className="muted">
                    {projectZip
                      ? `Archive selected: ${projectZip.name}`
                      : projectFiles.length > 0
                        ? `Folder selected: ${projectFiles.filter((file) => isMarkdownFileName(file.name)).length} markdown, ${projectFiles.filter((file) => !isMarkdownFileName(file.name)).length} assets`
                        : "No project selected"}
                  </p>
                </>
              )}
            </div>
          </div>
          <div className="upload-actions">
            <button className="button ghost" type="button" onClick={clearSelectedFiles} disabled={!canConvert}>
              Clear
            </button>
          </div>
        </article>

        <article className="panel">
          {status === "loading" ? (
            <div className="spinner-modern" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ) : (
            <div className="result-glyph"><IconResult kind={resultKind} /></div>
          )}
          <p className={`muted ${status === "ok" ? "status-ok" : ""} ${status === "error" ? "status-error" : ""}`}>{message}</p>
          <button className={`button secondary convert-button${isDone ? " done" : ""}`} type="button" onClick={onConvert} disabled={!canConvert || isConverting || isDone}>
            {isDone ? "Done" : <IconRotateArrows spinning={isConverting} />}
          </button>
          {downloadPath ? (
            <a className="button" href={downloadPath} download={downloadName}>Download</a>
          ) : (
            <button className="button" type="button" disabled>Download</button>
          )}
        </article>
      </section>

      <section className="log-dock">
        <button className="log-head" type="button" onClick={() => setShowLogs((value) => !value)}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
            <IconConsole />
            Logs
          </span>
        </button>
        {showLogs && (
          <div className="log-content">
            {logs.length === 0 ? (
              <p className="log-row">No logs yet.</p>
            ) : (
              logs.map((entry, index) => (
                <p key={`${index}-${entry.message}`} className={`log-row ${entry.level === "error" ? "error" : ""}`}>
                  {entry.message}
                </p>
              ))
            )}
          </div>
        )}
      </section>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
