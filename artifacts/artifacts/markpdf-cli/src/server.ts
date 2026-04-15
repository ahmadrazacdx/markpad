import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { unzipSync, zipSync } from "fflate";
import { lintAndFixMarkdown } from "./markdown.js";

class RequestError extends Error {
  statusCode: number;
  details?: string[];
  logs?: string[];

  constructor(message: string, statusCode = 400, options?: { details?: string[]; logs?: string[] }) {
    super(message);
    this.name = "RequestError";
    this.statusCode = statusCode;
    this.details = options?.details;
    this.logs = options?.logs;
  }
}

type UploadFile = {
  name: string;
  content: string;
  path: string;
};

type UploadAsset = {
  path: string;
  contentBase64: string;
};

type UploadArchive = {
  name: string;
  contentBase64: string;
};

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

type ConvertRequest = {
  files: UploadFile[];
  assets: UploadAsset[];
  archive?: UploadArchive;
  settings: ConvertSettings;
};

type DownloadArtifact = {
  id: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  createdAt: number;
  tempDir: string;
};

const MAX_FILES = 50;
const MAX_ASSETS = 500;
const MAX_ARCHIVE_ENTRIES = 1500;
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_BODY_BYTES = 30 * 1024 * 1024;
const DOWNLOAD_TTL_MS = 10 * 60 * 1000;
const FILE_EXTENSIONS = new Set([".md", ".markdown"]);
const DEFAULT_CONCURRENCY = 4;
const ARCHIVE_EXTRACT_CONCURRENCY = 16;
const FAST_ZIP_LEVEL = 0;
const DEFAULT_PDF_ENGINES = ["pdflatex", "xelatex", "lualatex", "tectonic"];
const LATEX_ENGINES = new Set(["xelatex", "lualatex", "pdflatex", "tectonic"]);
const DEFAULT_SETTINGS: ConvertSettings = {
  pageSize: "a4",
  documentFont: "latin-modern",
  fontSizePt: 11,
  lineStretch: 1.1,
  geometryPreset: "normal"
};
const UNICODE_FALLBACK_MAP: Record<string, string> = {
  "✅": "[OK]",
  "❌": "[X]",
  "⚠": "[!]",
  "–": "-",
  "—": "-",
  "“": '"',
  "”": '"',
  "’": "'"
};
const artifacts = new Map<string, DownloadArtifact>();
let pandocLatexHeaderPath: string | null = null;
let availablePdfEnginesCache: string[] | null = null;
let lastSuccessfulPdfEngine: string | null = null;

const modulePath = typeof __dirname === "string" ? __dirname : process.cwd();

function publicCandidates(fileName: string): string[] {
  return [
    join(dirname(process.execPath), "public", fileName),
    join(modulePath, "../public", fileName),
    join(modulePath, "../../public", fileName),
    join(process.cwd(), "public", fileName)
  ];
}

function normalizeRelativePath(input: string, label: string): string {
  if (typeof input !== "string" || input.trim() === "") {
    throw new RequestError(`${label} path is required`);
  }

  const unixPath = input.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (unixPath.length === 0 || unixPath.includes("\0")) {
    throw new RequestError(`Invalid ${label} path`);
  }

  if (/^[A-Za-z]:/.test(unixPath)) {
    throw new RequestError(`Invalid ${label} path`);
  }

  const parts = unixPath.split("/").filter((part) => part.length > 0);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new RequestError(`Invalid ${label} path`);
  }

  return parts.join("/");
}

function decodeBase64(input: string, label: string): Buffer {
  if (typeof input !== "string" || input.trim() === "") {
    throw new RequestError(`${label} is required`);
  }

  try {
    return Buffer.from(input, "base64");
  } catch {
    throw new RequestError(`Invalid ${label}`);
  }
}

function isPathInsideAssets(relativePath: string): boolean {
  return relativePath === "assets" || relativePath.startsWith("assets/");
}

function validateProjectLayout(markdownPaths: string[], assetPaths: string[]): string[] {
  const violations: string[] = [];

  for (const markdownPath of markdownPaths) {
    if (isPathInsideAssets(markdownPath)) {
      violations.push(`Markdown must be outside assets/: ${markdownPath}`);
    }
  }

  for (const assetPath of assetPaths) {
    if (!isPathInsideAssets(assetPath)) {
      violations.push(`Asset must be under assets/: ${assetPath}`);
    }

    if (FILE_EXTENSIONS.has(extname(assetPath).toLowerCase())) {
      violations.push(`Markdown file cannot be inside assets/: ${assetPath}`);
    }
  }

  return violations;
}

function findPandocBinary(): string {
  const envPath = process.env.MARKPDF_PANDOC_BIN;
  if (envPath) {
    if (existsSync(envPath)) {
      return envPath;
    }

    throw new Error(`MARKPDF_PANDOC_BIN points to a missing file: ${envPath}`);
  }

  const executableFolder = dirname(process.execPath);
  const localCandidates = process.platform === "win32"
    ? [
        join(executableFolder, "pandoc.exe"),
        join(executableFolder, "bin", "pandoc.exe")
      ]
    : [
        join(executableFolder, "pandoc"),
        join(executableFolder, "bin", "pandoc")
      ];

  for (const candidate of localCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const isLikelyInstalledCli =
    process.platform === "win32" &&
    (basename(process.execPath).toLowerCase() === "markpdf.exe" || typeof (process as NodeJS.Process & { pkg?: unknown }).pkg !== "undefined");

  // Installed Windows builds must use the bundled pandoc.exe to avoid picking arbitrary global installations.
  if (isLikelyInstalledCli) {
    throw new Error("Bundled pandoc.exe was not found next to markpdf.exe. Reinstall MarkPDF CLI.");
  }

  return "pandoc";
}

function resolvePdfEngineBinary(engine: string): string {
  const normalizedEngine = engine.trim();
  if (normalizedEngine.length === 0) {
    return engine;
  }

  const envKey = `MARKPDF_${normalizedEngine.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_BIN`;
  const envPath = process.env[envKey];
  if (typeof envPath === "string" && envPath.trim().length > 0) {
    const candidate = resolve(envPath.trim());
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const executableFolder = dirname(process.execPath);
  const localCandidates = process.platform === "win32"
    ? [
        join(executableFolder, `${normalizedEngine}.exe`),
        join(executableFolder, "bin", `${normalizedEngine}.exe`)
      ]
    : [
        join(executableFolder, normalizedEngine),
        join(executableFolder, "bin", normalizedEngine)
      ];

  for (const candidate of localCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return normalizedEngine;
}

function isEngineAvailable(engine: string): boolean {
  const resolvedBinary = resolvePdfEngineBinary(engine);
  if (resolvedBinary !== engine) {
    return true;
  }

  const commandLocator = process.platform === "win32" ? "where" : "which";
  const probe = spawnSync(commandLocator, [engine], {
    stdio: "ignore",
    timeout: 800
  });

  return probe.status === 0;
}

function appendResourcePaths(args: string[], resourcePaths?: string[]): void {
  if (!resourcePaths || resourcePaths.length === 0) {
    return;
  }

  const uniquePaths = [...new Set(resourcePaths.map((entry) => entry.trim()).filter((entry) => entry.length > 0))];
  if (uniquePaths.length === 0) {
    return;
  }

  const delimiter = process.platform === "win32" ? ";" : ":";
  args.push("--resource-path", uniquePaths.join(delimiter));
}

function resolveProjectPath(root: string, relativePath: string, label: string): string {
  const fullPath = resolve(root, relativePath);
  const normalizedRoot = resolve(root);
  const rootWithSeparator = `${normalizedRoot}${sep}`;
  if (fullPath !== normalizedRoot && !fullPath.startsWith(rootWithSeparator)) {
    throw new RequestError(`${label} path escapes project directory`);
  }

  return fullPath;
}

function toPdfFileName(relativeMarkdownPath: string): string {
  const withoutExt = relativeMarkdownPath.replace(/\.(md|markdown)$/i, "");
  const flattened = withoutExt
    .replace(/[\\/]+/g, "__")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const base = flattened.length > 0 ? flattened.slice(-140) : "document";
  return `${base}.pdf`;
}

function buildResourcePaths(projectRoot: string, markdownPath: string): string[] {
  const markdownFolder = dirname(markdownPath);
  return markdownFolder === projectRoot
    ? [projectRoot]
    : [projectRoot, markdownFolder];
}

async function runPandoc(
  markdownPath: string,
  pdfPath: string,
  settings: ConvertSettings,
  cwd?: string,
  resourcePaths?: string[]
): Promise<void> {
  const pandocBin = findPandocBinary();
  const args = [
    "--from",
    "markdown+pipe_tables+grid_tables+multiline_tables+table_captions+tex_math_dollars+raw_tex",
    markdownPath,
    "-o",
    pdfPath,
    ...pandocVariableArgs(settings)
  ];
  appendResourcePaths(args, resourcePaths);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(pandocBin, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `pandoc failed with exit code ${code ?? "unknown"}`));
    });
  });
}

function normalizePageSize(pageSize: PageSize): string {
  switch (pageSize) {
    case "letter":
      return "letter";
    case "legal":
      return "legal";
    case "a5":
      return "a5";
    case "b5":
      return "b5";
    case "executive":
      return "executive";
    case "a4":
    default:
      return "a4";
  }
}

function geometryMarginFromPreset(preset: GeometryPreset): string {
  switch (preset) {
    case "compact":
      return "0.75in";
    case "comfortable":
      return "1.25in";
    case "normal":
    default:
      return "1in";
  }
}

function mainFontFromSetting(font: DocumentFont): string {
  switch (font) {
    case "times-new-roman":
      return "Times New Roman";
    case "palatino":
      return "Palatino";
    case "helvetica":
      return "Helvetica";
    case "computer-modern":
      return "Latin Modern Roman";
    case "latin-modern":
    default:
      return "Latin Modern Roman";
  }
}

function pandocVariableArgs(settings: ConvertSettings, engine?: string): string[] {
  const args = [
    "-V", `papersize=${normalizePageSize(settings.pageSize)}`,
    "-V", `fontsize=${settings.fontSizePt}pt`,
    "-V", `linestretch=${settings.lineStretch}`,
    "-V", `geometry:margin=${geometryMarginFromPreset(settings.geometryPreset)}`
  ];

  if (engine === "xelatex" || engine === "lualatex") {
    args.push("-V", `mainfont=${mainFontFromSetting(settings.documentFont)}`);
  }

  return args;
}

function resolvePdfEngines(): string[] {
  const envValue = process.env.MARKPDF_PDF_ENGINES;
  if (!envValue) {
    if (availablePdfEnginesCache) {
      return availablePdfEnginesCache;
    }

    const available = DEFAULT_PDF_ENGINES.filter((engine) => isEngineAvailable(engine));

    availablePdfEnginesCache = available;
    return availablePdfEnginesCache;
  }

  const parsed = envValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return parsed.length > 0 ? [...new Set(parsed)] : DEFAULT_PDF_ENGINES;
}

function sanitizeForPdfLatex(input: string): string {
  return input.replace(/[^\x00-\x7F]/g, (char) => UNICODE_FALLBACK_MAP[char] ?? " ");
}

function isLatexEngine(engine: string): boolean {
  return LATEX_ENGINES.has(engine);
}

function buildEngineFallbackChain(): string[] {
  const candidates = [...new Set(resolvePdfEngines())];
  if (candidates.length === 0) {
    return [];
  }

  let primary = candidates[0];
  if (lastSuccessfulPdfEngine && candidates.includes(lastSuccessfulPdfEngine)) {
    primary = lastSuccessfulPdfEngine;
  } else if (candidates.includes("pdflatex")) {
    primary = "pdflatex";
  }

  const chain = [primary];
  if (primary === "pdflatex") {
    for (const preferredFallback of ["xelatex", "lualatex", "tectonic"]) {
      if (candidates.includes(preferredFallback) && !chain.includes(preferredFallback)) {
        chain.push(preferredFallback);
      }
    }
  }

  for (const engine of candidates) {
    if (!chain.includes(engine)) {
      chain.push(engine);
    }
  }

  return chain;
}

function shouldFallbackToNextEngine(engine: string, reason: string): boolean {
  const lower = reason.toLowerCase();
  const missingEngine =
    lower.includes("unknown pdf engine") ||
    lower.includes("not found") ||
    lower.includes("no such file") ||
    lower.includes("is not recognized as an internal or external command") ||
    lower.includes("could not find executable");

  if (missingEngine) {
    return true;
  }

  if (engine === "pdflatex") {
    return (
      lower.includes("unicode character") ||
      lower.includes("inputenc") ||
      lower.includes("utf-8") ||
      lower.includes("utf8") ||
      lower.includes("not set up for use with latex") ||
      lower.includes("missing character")
    );
  }

  return false;
}

function summarizePandocFailure(reason: string): string {
  const lines = reason
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return "Unknown rendering error";
  }

  const nonWarningLines = lines.filter((line) => !/^\[warning\]/i.test(line));
  const severityPattern = /(not found|unknown pdf engine|could not find executable|fatal|error|failed|no such file|not recognized)/i;

  const candidates = nonWarningLines.length > 0 ? nonWarningLines : lines;
  return candidates.find((line) => severityPattern.test(line)) ?? candidates[0];
}

async function ensurePandocLatexHeaderFile(): Promise<string> {
  if (pandocLatexHeaderPath) {
    return pandocLatexHeaderPath;
  }

  const headerPath = join(tmpdir(), "markpdf-pandoc-header.tex");
  const header = [
    "\\usepackage{amsmath,amssymb,mathtools}",
    "\\usepackage{microtype}",
    "\\usepackage{xurl}",
    "\\usepackage{graphicx}",
    "\\usepackage{longtable,booktabs,array,tabularx}",
    "\\usepackage{etoolbox}",
    "\\setlength{\\emergencystretch}{3em}",
    "\\sloppy",
    "\\allowdisplaybreaks",
    "\\setlength{\\LTleft}{0pt}",
    "\\setlength{\\LTright}{0pt}",
    "\\renewcommand{\\arraystretch}{1.12}",
    "\\setkeys{Gin}{width=\\linewidth,keepaspectratio}",
    "\\AtBeginEnvironment{longtable}{\\small}"
  ].join("\n");

  await writeFile(headerPath, `${header}\n`, "utf8");
  pandocLatexHeaderPath = headerPath;
  return headerPath;
}

async function runPandocWithEngine(
  markdownPath: string,
  pdfPath: string,
  engine: string,
  settings: ConvertSettings,
  cwd?: string,
  resourcePaths?: string[]
): Promise<void> {
  const pandocBin = findPandocBinary();
  const engineBinary = resolvePdfEngineBinary(engine);
  const latexHeaderPath = isLatexEngine(engine) ? await ensurePandocLatexHeaderFile() : null;
  const args = [
    "--from",
    "markdown+pipe_tables+grid_tables+multiline_tables+table_captions+tex_math_dollars+raw_tex",
    markdownPath,
    "-o",
    pdfPath,
    "--pdf-engine",
    engineBinary,
    ...pandocVariableArgs(settings, engine)
  ];
  appendResourcePaths(args, resourcePaths);

  if (latexHeaderPath) {
    args.push("--include-in-header", latexHeaderPath);
    args.push("--pdf-engine-opt=-interaction=nonstopmode");
    args.push("--pdf-engine-opt=-file-line-error");
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(pandocBin, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `pandoc failed with exit code ${code ?? "unknown"}`));
    });
  });
}

async function runPandocWithFallback(
  markdownPath: string,
  pdfPath: string,
  fileName: string,
  logs: string[],
  settings: ConvertSettings,
  cwd?: string,
  resourcePaths?: string[]
): Promise<string> {
  const engines = buildEngineFallbackChain();
  const errors: string[] = [];

  if (engines.length === 0) {
    logs.push(`[${fileName}] no available PDF engines detected`);
    throw new RequestError(
      `Error producing PDF for ${fileName}`,
      422,
      {
        details: ["No supported PDF engine was detected. Install one of: pdflatex, xelatex, lualatex, tectonic."],
        logs
      }
    );
  }

  logs.push(`[${fileName}] engine chain: ${engines.join(" -> ")}`);

  for (let i = 0; i < engines.length; i += 1) {
    const engine = engines[i];
    const hasNextEngine = i < engines.length - 1;

    try {
      await runPandocWithEngine(markdownPath, pdfPath, engine, settings, cwd, resourcePaths);
      lastSuccessfulPdfEngine = engine;
      logs.push(`[${fileName}] rendered with ${engine}`);
      return engine;
    } catch (error) {
      const fullReason = error instanceof Error ? error.message : String(error);
      const reason = summarizePandocFailure(fullReason);
      errors.push(`${engine}: ${reason}`);

      if (engine === "pdflatex" && /unicode character/i.test(fullReason)) {
        if (hasNextEngine) {
          logs.push(`[${fileName}] ${engine} unicode issue, falling back to ${engines[i + 1]}`);
          continue;
        }

        try {
          const original = await readFile(markdownPath, "utf8");
          const sanitized = sanitizeForPdfLatex(original);
          const fallbackMarkdownPath = `${markdownPath}.pdflatex-sanitized.md`;
          await writeFile(fallbackMarkdownPath, sanitized, "utf8");
          await runPandocWithEngine(fallbackMarkdownPath, pdfPath, "pdflatex", settings, cwd, resourcePaths);
          lastSuccessfulPdfEngine = "pdflatex";
          logs.push(`[${fileName}] rendered with pdflatex after unicode sanitization`);
          return "pdflatex-sanitized";
        } catch (sanitizeError) {
          const sanitizeReason = sanitizeError instanceof Error ? sanitizeError.message.split("\n")[0] : String(sanitizeError);
          errors.push(`pdflatex-sanitized: ${sanitizeReason}`);
        }
      }

      if (hasNextEngine && shouldFallbackToNextEngine(engine, fullReason)) {
        logs.push(`[${fileName}] ${engine} failed, falling back to ${engines[i + 1]}`);
        continue;
      }

      throw new RequestError(
        `Error producing PDF for ${fileName}`,
        422,
        {
          details: errors.slice(0, 8),
          logs
        }
      );
    }
  }

  throw new RequestError(
    `Error producing PDF for ${fileName}`,
    422,
    {
      details: errors.slice(0, 8),
      logs
    }
  );
}

function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (items.length === 0) {
    return Promise.resolve([]);
  }

  const safeLimit = Math.max(1, Math.min(limit, items.length));
  const output = new Array<R>(items.length);
  let index = 0;

  const workers = new Array(safeLimit).fill(0).map(async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      output[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  });

  return Promise.all(workers).then(() => output);
}

function decodeUtf8(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    const succeed = (payload: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(payload);
    };

    req.on("data", (chunk) => {
      if (settled) {
        return;
      }

      const nextChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += nextChunk.length;
      if (total > MAX_BODY_BYTES) {
        fail(new RequestError("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(nextChunk);
    });

    req.on("error", (error) => fail(error));

    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        if (text.trim() === "") {
          fail(new RequestError("Request body is empty"));
          return;
        }

        succeed(JSON.parse(text));
      } catch (error) {
        fail(new RequestError("Invalid JSON request body"));
      }
    });
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function sendStatic(res: ServerResponse, fileName: string, contentType: string): Promise<void> {
  let content: Buffer | null = null;
  let lastError: unknown = null;

  for (const candidate of publicCandidates(fileName)) {
    try {
      content = await readFile(candidate);
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!content) {
    throw new Error(
      `Static asset '${fileName}' is unavailable. Reinstall MarkPDF to ensure public assets were deployed.${lastError instanceof Error ? ` (${lastError.message})` : ""}`
    );
  }

  res.writeHead(200, {
    "Content-Type": `${contentType}; charset=utf-8`,
    "Cache-Control": "no-store"
  });
  res.end(content);
}

function asConvertRequest(value: unknown): ConvertRequest {
  if (typeof value !== "object" || value === null) {
    throw new RequestError("Request body must be an object");
  }

  const rawFiles = Array.isArray((value as { files?: unknown }).files)
    ? (value as { files: unknown[] }).files
    : [];

  const rawAssets = Array.isArray((value as { assets?: unknown }).assets)
    ? (value as { assets: unknown[] }).assets
    : [];

  const rawArchive = (value as { archive?: unknown }).archive;

  const normalizedFiles = rawFiles.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw new RequestError("Invalid markdown file payload");
    }

    const name = (item as { name?: unknown }).name;
    const content = (item as { content?: unknown }).content;
    const requestedPath = (item as { path?: unknown }).path;

    if (typeof name !== "string" || typeof content !== "string") {
      throw new RequestError("Each markdown file must include string name and content");
    }

    const path = normalizeRelativePath(typeof requestedPath === "string" ? requestedPath : name, `Markdown file ${name}`);
    const extension = extname(path).toLowerCase();
    if (!FILE_EXTENSIONS.has(extension)) {
      throw new RequestError(`Unsupported markdown file type for ${name}. Only .md and .markdown are allowed`);
    }

    if (content.trim() === "") {
      throw new RequestError(`File ${name} is empty`);
    }

    return { name, content, path };
  });

  if (normalizedFiles.length > MAX_FILES) {
    throw new RequestError(`Maximum ${MAX_FILES} markdown files are allowed`);
  }

  let estimatedAssetBytes = 0;
  const normalizedAssets = rawAssets.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw new RequestError("Invalid asset payload");
    }

    const path = normalizeRelativePath(String((item as { path?: unknown }).path ?? ""), "Asset");
    const contentBase64 = (item as { contentBase64?: unknown }).contentBase64;
    if (typeof contentBase64 !== "string" || contentBase64.trim() === "") {
      throw new RequestError(`Asset ${path} is missing content`);
    }

    estimatedAssetBytes += Math.floor((contentBase64.length * 3) / 4);
    if (estimatedAssetBytes > MAX_ASSET_BYTES) {
      throw new RequestError(`Asset payload is too large (max ${MAX_ASSET_BYTES / (1024 * 1024)} MB decoded)`);
    }

    return { path, contentBase64 };
  });

  if (normalizedAssets.length > MAX_ASSETS) {
    throw new RequestError(`Maximum ${MAX_ASSETS} asset files are allowed`);
  }

  let archive: UploadArchive | undefined;
  if (rawArchive !== undefined) {
    if (typeof rawArchive !== "object" || rawArchive === null) {
      throw new RequestError("Invalid archive payload");
    }

    const name = (rawArchive as { name?: unknown }).name;
    const contentBase64 = (rawArchive as { contentBase64?: unknown }).contentBase64;
    if (typeof name !== "string" || typeof contentBase64 !== "string") {
      throw new RequestError("Archive must include name and contentBase64");
    }

    const extension = extname(name).toLowerCase();
    if (extension !== ".zip") {
      throw new RequestError("Project archive must be a .zip file");
    }

    const archiveBytes = Math.floor((contentBase64.length * 3) / 4);
    if (archiveBytes > MAX_ARCHIVE_BYTES) {
      throw new RequestError(`Archive is too large (max ${MAX_ARCHIVE_BYTES / (1024 * 1024)} MB)`);
    }

    archive = { name, contentBase64 };
  }

  if (archive && (normalizedFiles.length > 0 || normalizedAssets.length > 0)) {
    throw new RequestError("Use either archive mode or files/assets mode, not both");
  }

  if (!archive && normalizedFiles.length === 0) {
    throw new RequestError("Please provide at least one Markdown file or a project .zip archive");
  }

  const rawSettings = (value as { settings?: unknown }).settings;
  const settingsRecord = typeof rawSettings === "object" && rawSettings !== null
    ? rawSettings as Record<string, unknown>
    : {};

  const pageSize =
    settingsRecord.pageSize === "a4" ||
    settingsRecord.pageSize === "letter" ||
    settingsRecord.pageSize === "legal" ||
    settingsRecord.pageSize === "a5" ||
    settingsRecord.pageSize === "b5" ||
    settingsRecord.pageSize === "executive"
      ? settingsRecord.pageSize
      : DEFAULT_SETTINGS.pageSize;

  const documentFont =
    settingsRecord.documentFont === "latin-modern" ||
    settingsRecord.documentFont === "times-new-roman" ||
    settingsRecord.documentFont === "palatino" ||
    settingsRecord.documentFont === "helvetica" ||
    settingsRecord.documentFont === "computer-modern"
      ? settingsRecord.documentFont
      : DEFAULT_SETTINGS.documentFont;

  const fontSizePt =
    typeof settingsRecord.fontSizePt === "number" && Number.isFinite(settingsRecord.fontSizePt)
      ? Math.min(16, Math.max(9, settingsRecord.fontSizePt))
      : DEFAULT_SETTINGS.fontSizePt;

  const lineStretch =
    typeof settingsRecord.lineStretch === "number" && Number.isFinite(settingsRecord.lineStretch)
      ? Math.min(2, Math.max(1, settingsRecord.lineStretch))
      : DEFAULT_SETTINGS.lineStretch;

  const geometryPreset =
    settingsRecord.geometryPreset === "compact" ||
    settingsRecord.geometryPreset === "normal" ||
    settingsRecord.geometryPreset === "comfortable"
      ? settingsRecord.geometryPreset
      : DEFAULT_SETTINGS.geometryPreset;

  return {
    files: normalizedFiles,
    assets: normalizedAssets,
    archive,
    settings: {
      pageSize,
      documentFont,
      fontSizePt,
      lineStretch,
      geometryPreset
    }
  };
}

function cleanupArtifacts(): void {
  const now = Date.now();
  for (const artifact of artifacts.values()) {
    if (now - artifact.createdAt < DOWNLOAD_TTL_MS) {
      continue;
    }

    artifacts.delete(artifact.id);
    void rm(artifact.tempDir, { recursive: true, force: true });
  }
}

function resolveConcurrency(fileCount: number): number {
  const envValue = Number.parseInt(process.env.MARKPDF_CONCURRENCY ?? "", 10);
  if (Number.isFinite(envValue) && envValue > 0) {
    return Math.max(1, Math.min(fileCount, envValue));
  }

  return Math.max(1, Math.min(fileCount, DEFAULT_CONCURRENCY));
}

async function materializeProjectInput(
  tempDir: string,
  request: ConvertRequest,
  log: (message: string) => void
): Promise<{ projectRoot: string; markdownFiles: UploadFile[] }> {
  const projectRoot = join(tempDir, "project");
  await mkdir(projectRoot, { recursive: true });

  const markdownFiles: UploadFile[] = [];
  const seenPaths = new Set<string>();

  if (request.archive) {
    const archiveBytes = decodeBase64(request.archive.contentBase64, "Archive content");
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(archiveBytes);
    } catch {
      throw new RequestError("Project archive could not be unpacked");
    }

    const entryNames = Object.keys(entries);
    if (entryNames.length === 0) {
      throw new RequestError("Project archive is empty");
    }

    if (entryNames.length > MAX_ARCHIVE_ENTRIES) {
      throw new RequestError(`Project archive has too many entries (max ${MAX_ARCHIVE_ENTRIES})`);
    }

    const extractedEntries: Array<{ path: string; bytes: Uint8Array; isMarkdown: boolean }> = [];
    const archiveMarkdownPaths: string[] = [];
    const archiveAssetPaths: string[] = [];

    for (const entryName of entryNames) {
      if (entryName.endsWith("/")) {
        continue;
      }

      const normalizedPath = normalizeRelativePath(entryName, "Archive entry");
      if (seenPaths.has(normalizedPath)) {
        continue;
      }

      seenPaths.add(normalizedPath);
      const bytes = entries[entryName];
      const isMarkdown = FILE_EXTENSIONS.has(extname(normalizedPath).toLowerCase());
      extractedEntries.push({ path: normalizedPath, bytes, isMarkdown });

      if (isMarkdown) {
        archiveMarkdownPaths.push(normalizedPath);
      } else {
        archiveAssetPaths.push(normalizedPath);
      }
    }

    const archiveViolations = validateProjectLayout(archiveMarkdownPaths, archiveAssetPaths);
    if (archiveViolations.length > 0) {
      throw new RequestError(
        "Project structure is invalid. Put all assets under assets/ and keep markdown outside assets/.",
        422,
        { details: archiveViolations.slice(0, 25) }
      );
    }

    const extractedMarkdownFiles = await mapLimit(
      extractedEntries,
      Math.min(ARCHIVE_EXTRACT_CONCURRENCY, extractedEntries.length),
      async (entry) => {
        const targetPath = resolveProjectPath(projectRoot, entry.path, "Archive entry");
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, entry.bytes);

        if (!entry.isMarkdown) {
          return null;
        }

        return {
          name: basename(entry.path),
          path: entry.path,
          content: decodeUtf8(entry.bytes)
        } satisfies UploadFile;
      }
    );

    for (const markdown of extractedMarkdownFiles) {
      if (markdown) {
        markdownFiles.push(markdown);
      }
    }

    log(`Loaded project archive with ${seenPaths.size} file(s)`);
  } else {
    const layoutViolations = validateProjectLayout(
      request.files.map((file) => file.path),
      request.assets.map((asset) => asset.path)
    );

    if (layoutViolations.length > 0) {
      throw new RequestError(
        "Project structure is invalid. Put all assets under assets/ and keep markdown outside assets/.",
        422,
        { details: layoutViolations.slice(0, 25) }
      );
    }

    for (const markdown of request.files) {
      if (seenPaths.has(markdown.path)) {
        throw new RequestError(`Duplicate markdown path detected: ${markdown.path}`);
      }

      seenPaths.add(markdown.path);
      const markdownPath = resolveProjectPath(projectRoot, markdown.path, `Markdown file ${markdown.name}`);
      await mkdir(dirname(markdownPath), { recursive: true });
      await writeFile(markdownPath, markdown.content, "utf8");
      markdownFiles.push({
        name: basename(markdown.path),
        path: markdown.path,
        content: markdown.content
      });
    }

    for (const asset of request.assets) {
      if (seenPaths.has(asset.path)) {
        throw new RequestError(`Duplicate project path detected: ${asset.path}`);
      }

      seenPaths.add(asset.path);
      const assetPath = resolveProjectPath(projectRoot, asset.path, `Asset ${asset.path}`);
      await mkdir(dirname(assetPath), { recursive: true });
      const assetBytes = decodeBase64(asset.contentBase64, `Asset ${asset.path}`);
      await writeFile(assetPath, assetBytes);
    }

    log(`Loaded project payload with ${request.files.length} markdown and ${request.assets.length} asset file(s)`);
  }

  if (markdownFiles.length === 0) {
    throw new RequestError("No markdown files found in project input");
  }

  if (markdownFiles.length > MAX_FILES) {
    throw new RequestError(`Maximum ${MAX_FILES} markdown files are allowed`);
  }

  markdownFiles.sort((left, right) => left.path.localeCompare(right.path));
  return { projectRoot, markdownFiles };
}

async function convert(request: ConvertRequest): Promise<{
  id: string;
  fileName: string;
  kind: "pdf" | "zip";
  durationMs: number;
  logs: string[];
}> {
  const startedAt = Date.now();
  const tempDir = await mkdtemp(join(tmpdir(), "markpdf-"));
  const logs: string[] = [];

  const log = (message: string) => {
    if (logs.length < 220) {
      logs.push(message);
    }
  };

  try {
    const { projectRoot, markdownFiles } = await materializeProjectInput(tempDir, request, log);
    const settings = request.settings;
    const concurrency = resolveConcurrency(markdownFiles.length);
    log(`Start conversion for ${markdownFiles.length} file(s)`);
    log(`Concurrency set to ${concurrency}`);
    log(`Render settings: page=${settings.pageSize}, font=${settings.documentFont}, size=${settings.fontSizePt}pt, line=${settings.lineStretch}, geometry=${settings.geometryPreset}`);

    const outputRoot = join(tempDir, "out");
    await mkdir(outputRoot, { recursive: true });

    const usedOutputNames = new Map<string, number>();
    const outputNameByPath = new Map<string, string>();
    for (const file of markdownFiles) {
      const baseName = toPdfFileName(file.path);
      const seenCount = usedOutputNames.get(baseName) ?? 0;
      usedOutputNames.set(baseName, seenCount + 1);

      const outputName = seenCount === 0
        ? baseName
        : `${baseName.replace(/\.pdf$/i, "")}-${seenCount + 1}.pdf`;

      outputNameByPath.set(file.path, outputName);
    }

    const outputs = await mapLimit(markdownFiles, concurrency, async (file) => {
      const lintResult = lintAndFixMarkdown(file.content);
      const { fixed, issues, initialIssueCount, finalIssueCount, autoFixPasses } = lintResult;

      if (initialIssueCount > 0) {
        const fixedCount = Math.max(0, initialIssueCount - finalIssueCount);
        log(`[${file.name}] markdownlint fixed ${fixedCount}/${initialIssueCount} issue(s) in ${autoFixPasses} pass(es)`);
      }

      if (issues.length > 0) {
        throw new RequestError(
          `Markdown issues remain in ${file.path}: ${issues.slice(0, 3).join("; ")}`,
          422,
          {
            details: issues.slice(0, 25),
            logs
          }
        );
      }

      const mdPath = resolveProjectPath(projectRoot, file.path, `Markdown file ${file.path}`);
      const pdfName = outputNameByPath.get(file.path) ?? `${basename(file.path).replace(/\.(md|markdown)$/i, "") || "document"}.pdf`;
      const pdfPath = join(outputRoot, pdfName);

      await writeFile(mdPath, fixed, "utf8");
      const resourcePaths = buildResourcePaths(projectRoot, mdPath);
      await runPandocWithFallback(mdPath, pdfPath, file.path, logs, settings, projectRoot, resourcePaths);

      const fileStat = await stat(pdfPath);
      if (!fileStat.isFile() || fileStat.size < 32) {
        throw new Error(`Pandoc output is empty for ${file.path}`);
      }

      log(`[${file.path}] output ready`);

      return { pdfName, pdfPath };
    });

    const id = randomUUID();

    if (outputs.length === 1) {
      const only = outputs[0];
      artifacts.set(id, {
        id,
        filePath: only.pdfPath,
        fileName: only.pdfName,
        mimeType: "application/pdf",
        createdAt: Date.now(),
        tempDir
      });
      log("Single-file conversion completed");
      return { id, fileName: only.pdfName, kind: "pdf", durationMs: Date.now() - startedAt, logs };
    }

    const zipFileName = "markpdf-batch.zip";
    const zipPath = join(tempDir, zipFileName);
    const zipEntries: Record<string, Uint8Array> = {};

    await Promise.all(outputs.map(async (item) => {
      zipEntries[item.pdfName] = await readFile(item.pdfPath);
    }));

    const zipBytes = zipSync(zipEntries, { level: FAST_ZIP_LEVEL });
    await writeFile(zipPath, zipBytes);

    artifacts.set(id, {
      id,
      filePath: zipPath,
      fileName: zipFileName,
      mimeType: "application/zip",
      createdAt: Date.now(),
      tempDir
    });

    log("Batch conversion completed");
    return { id, fileName: zipFileName, kind: "zip", durationMs: Date.now() - startedAt, logs };
  } catch (error) {
    if (error instanceof RequestError && !error.logs) {
      error.logs = logs;
    }
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function sendDownload(res: ServerResponse, id: string): void {
  const artifact = artifacts.get(id);
  if (!artifact) {
    sendJson(res, 404, { error: "Download not found or expired" });
    return;
  }

  const stream = createReadStream(artifact.filePath);
  stream.on("error", () => {
    sendJson(res, 500, { error: "Could not read output file" });
  });

  res.writeHead(200, {
    "Content-Type": artifact.mimeType,
    "Content-Disposition": `attachment; filename=\"${artifact.fileName}\"`,
    "Cache-Control": "no-store"
  });
  stream.pipe(res);
}

export async function startHttpUi(startPort = 17600): Promise<{ port: number; close: () => Promise<void> }> {
  cleanupArtifacts();
  const cleanupTimer = setInterval(cleanupArtifacts, 60 * 1000);

  const server = createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        sendJson(res, 400, { error: "Invalid request" });
        return;
      }

      if (req.method === "GET" && req.url === "/") {
        await sendStatic(res, "index.html", "text/html");
        return;
      }

      if (req.method === "GET" && req.url === "/styles.css") {
        await sendStatic(res, "styles.css", "text/css");
        return;
      }

      if (req.method === "GET" && req.url === "/app.js") {
        await sendStatic(res, "app.js", "text/javascript");
        return;
      }

      if (req.method === "GET" && req.url === "/markpdf-logo.svg") {
        await sendStatic(res, "markpdf-logo.svg", "image/svg+xml");
        return;
      }

      if (req.method === "GET" && req.url === "/api/health") {
        sendJson(res, 200, { status: "ok" });
        return;
      }

      if (req.method === "POST" && req.url === "/api/convert") {
        const body = await readJsonBody(req);
        const parsed = asConvertRequest(body);
        const output = await convert(parsed);

        sendJson(res, 200, {
          status: "ok",
          kind: output.kind,
          fileName: output.fileName,
          downloadPath: `/api/download/${output.id}`,
          durationMs: output.durationMs,
          logs: output.logs,
          message: output.kind === "pdf" ? "Conversion done" : "Batch conversion done"
        });
        return;
      }

      if (req.method === "GET" && req.url.startsWith("/api/download/")) {
        const id = req.url.replace("/api/download/", "").trim();
        sendDownload(res, id);
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      const statusCode = error instanceof RequestError ? error.statusCode : 500;
      sendJson(res, statusCode, {
        error: error instanceof Error ? error.message : "Unexpected error",
        details: error instanceof RequestError ? error.details : undefined,
        logs: error instanceof RequestError ? error.logs : undefined
      });
    }
  });

  const listen = (port: number): Promise<number> => new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      if (error.code === "EADDRINUSE") {
        resolve(-1);
        return;
      }
      reject(error);
    };

    const onListening = () => {
      server.off("error", onError);
      resolve(port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });

  let chosenPort = -1;
  for (let port = startPort; port < startPort + 50; port += 1) {
    chosenPort = await listen(port);
    if (chosenPort !== -1) {
      break;
    }
  }

  if (chosenPort === -1) {
    clearInterval(cleanupTimer);
    throw new Error("No available localhost ports were found in range 17600-17649");
  }

  return {
    port: chosenPort,
    close: () => new Promise((resolveClose, rejectClose) => {
      clearInterval(cleanupTimer);
      server.close((error) => {
        if (error) {
          rejectClose(error);
          return;
        }
        resolveClose();
      });
    })
  };
}
