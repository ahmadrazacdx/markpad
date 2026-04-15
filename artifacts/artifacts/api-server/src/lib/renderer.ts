import { execFile } from "child_process";
import { writeFile, readFile, unlink, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { dirname, isAbsolute, join, resolve } from "path";
import { randomBytes } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { filesTable } from "@workspace/db";
import { logger } from "./logger";

const tmpDir = join(tmpdir(), "markpad-render");

export interface RenderOptions {
  pageSize?: "a4" | "letter" | "legal" | "a5";
  documentFont?: "latin-modern" | "times-new-roman" | "palatino" | "helvetica" | "computer-modern";
  fontSizePt?: number;
  lineStretch?: number;
}

export interface RenderExecutionOptions {
  signal?: AbortSignal;
}

const DEFAULT_RENDER_OPTIONS: Required<RenderOptions> = {
  pageSize: "a4",
  documentFont: "latin-modern",
  fontSizePt: 11,
  lineStretch: 1.1,
};

let lastHash = "";
let lastPdf: Uint8Array | null = null;
let warmupPromise: Promise<void> | null = null;
let latexEngineUnavailable = false;
let typstLinkStyleIncludeFilePath: string | null = null;

function isLatexEngineDisabledByConfig(): boolean {
  const value = process.env.MARKPAD_PDF_DISABLE_LATEX?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function createAbortError(message: string): Error {
  const err = new Error(message) as Error & { name: string; code?: string };
  err.name = "AbortError";
  err.code = "ABORT_ERR";
  return err;
}

function isAbortLikeError(err: unknown): boolean {
  const maybeErr = err as { name?: string; code?: string; message?: string };
  if (maybeErr?.name === "AbortError") return true;
  if (maybeErr?.code === "ABORT_ERR") return true;
  if (typeof maybeErr?.message === "string" && /aborted|abort/i.test(maybeErr.message)) return true;
  return false;
}

const titleLine = "\\title{$title$}";
const markdownImageRefRegex = /!\[[^\]]*\]\(([^)]+)\)|<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
const typstImageRefRegex = /(?:^|[^\w])image\(\s*(?:"([^"]+)"|'([^']+)')\s*(?:,|\))/gim;
const rawTypstImageFenceRegex = /```\{=typst\}\s*#(?:figure|box)\(\s*image\(\s*(?:"([^"]+)"|'([^']+)')\s*\)\s*(?:,\s*caption:\s*\[([\s\S]*?)\])?\s*\)\s*```/gim;

function normalizeDimension(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return `${value}px`;
  if (/^\d+(?:\.\d+)?(?:px|pt|cm|mm|in|%)$/i.test(value)) return value.toLowerCase();
  return null;
}

function parseHtmlTagAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(tag)) !== null) {
    const name = (match[1] ?? "").toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (name) {
      attributes[name] = value;
    }
  }

  return attributes;
}

function extractWidthFromStyle(style: string | undefined): string | null {
  if (!style) return null;
  const widthMatch = style.match(/(?:^|;)\s*width\s*:\s*([^;]+)/i);
  if (!widthMatch) return null;
  return normalizeDimension(widthMatch[1] ?? "");
}

function normalizeMarkdownImageTarget(rawTarget: string): string {
  const trimmed = rawTarget.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("<")) {
    const closingIndex = trimmed.indexOf(">");
    if (closingIndex > 0) {
      return trimmed.slice(0, closingIndex + 1);
    }
  }

  const titleStart = trimmed.search(/\s(?=["'])/);
  if (titleStart >= 0) {
    return trimmed.slice(0, titleStart).trim();
  }

  return trimmed;
}

function normalizeAssetPathLikeReference(rawRef: string): string {
  const trimmed = rawRef.trim();
  if (!trimmed) return "";

  const noQuotes = trimmed.replace(/^["']|["']$/g, "");
  const noAngles = noQuotes.replace(/^<|>$/g, "");
  const noQueryOrHash = noAngles.split(/[?#]/, 1)[0]?.trim() ?? "";
  const normalizedSlashes = noQueryOrHash.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  return normalizedSlashes.replace(/^\.\//, "").replace(/^\//, "");
}

function isDirectoryAssetReference(path: string): boolean {
  return path === "assets" || path === "assets/" || (path.startsWith("assets/") && path.endsWith("/"));
}

function normalizeAssetReference(rawRef: string): string | null {
  const normalizedLeading = normalizeAssetPathLikeReference(rawRef);
  if (!normalizedLeading.startsWith("assets/")) return null;
  if (isDirectoryAssetReference(normalizedLeading)) return null;

  return normalizedLeading;
}

export function extractInvalidDirectoryAssetReferences(markdown: string): string[] {
  const invalidRefs = new Set<string>();
  markdownImageRefRegex.lastIndex = 0;
  typstImageRefRegex.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = markdownImageRefRegex.exec(markdown)) !== null) {
    const candidate = match[1] ? normalizeMarkdownImageTarget(match[1]) : (match[2] ?? "");
    const normalized = normalizeAssetPathLikeReference(candidate);
    if (isDirectoryAssetReference(normalized)) {
      invalidRefs.add(normalized);
    }
  }

  while ((match = typstImageRefRegex.exec(markdown)) !== null) {
    const candidate = match[1] ?? match[2] ?? "";
    const normalized = normalizeAssetPathLikeReference(candidate);
    if (isDirectoryAssetReference(normalized)) {
      invalidRefs.add(normalized);
    }
  }

  return Array.from(invalidRefs).sort();
}

export function extractReferencedAssetPaths(markdown: string): string[] {
  const paths = new Set<string>();
  markdownImageRefRegex.lastIndex = 0;
  typstImageRefRegex.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = markdownImageRefRegex.exec(markdown)) !== null) {
    const candidate = match[1] ? normalizeMarkdownImageTarget(match[1]) : (match[2] ?? "");
    const normalized = normalizeAssetReference(candidate);
    if (normalized) {
      paths.add(normalized);
    }
  }

  while ((match = typstImageRefRegex.exec(markdown)) !== null) {
    const candidate = match[1] ?? match[2] ?? "";
    const normalized = normalizeAssetReference(candidate);
    if (normalized) {
      paths.add(normalized);
    }
  }

  return Array.from(paths);
}

function decodeAssetDataUri(value: string): Buffer | null {
  const match = /^data:[^;]+;base64,(.+)$/i.exec(value.trim());
  if (!match) return null;

  try {
    return Buffer.from(match[1], "base64");
  } catch {
    return null;
  }
}

async function materializeProjectAssets(projectId: number, markdown: string, renderDir: string): Promise<string> {
  const referencedAssets = extractReferencedAssetPaths(markdown);
  if (referencedAssets.length === 0) {
    return "";
  }

  const rows = await db
    .select({
      path: filesTable.path,
      content: filesTable.content,
    })
    .from(filesTable)
    .where(and(eq(filesTable.projectId, projectId), inArray(filesTable.path, referencedAssets)));

  const assetByPath = new Map(rows.map((row) => [row.path, row.content]));
  const signatureParts: string[] = [];
  const missingAssetPaths: string[] = [];
  const invalidAssetContentPaths: string[] = [];

  for (const assetPath of referencedAssets) {
    const content = assetByPath.get(assetPath);
    if (!content) {
      missingAssetPaths.push(assetPath);
      continue;
    }

    const bytes = decodeAssetDataUri(content);
    if (!bytes) {
      invalidAssetContentPaths.push(assetPath);
      continue;
    }

    const outputPath = join(renderDir, assetPath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, bytes);
    signatureParts.push(`${assetPath}:${bytes.length}`);
  }

  if (missingAssetPaths.length > 0) {
    logger.warn({ projectId, assets: missingAssetPaths }, "Referenced assets were not found in project files");
  }

  if (invalidAssetContentPaths.length > 0) {
    logger.warn(
      { projectId, assets: invalidAssetContentPaths },
      "Referenced assets have invalid or unsupported encoded content",
    );
  }

  signatureParts.sort();
  return signatureParts.join("|");
}

function latexFontBlock(font: Required<RenderOptions>["documentFont"]): string {
  switch (font) {
    case "times-new-roman":
      return "\\usepackage{newtxtext,newtxmath}";
    case "palatino":
      return "\\usepackage{mathpazo}";
    case "helvetica":
      return "\\usepackage[scaled=0.95]{helvet}\\n\\renewcommand{\\familydefault}{\\sfdefault}";
    case "computer-modern":
      return "% computer modern default";
    case "latin-modern":
    default:
      return "\\usepackage{lmodern}";
  }
}

function geometryForPageSize(pageSize: Required<RenderOptions>["pageSize"]): string {
  switch (pageSize) {
    case "letter":
      return "letterpaper,margin=1in";
    case "legal":
      return "legalpaper,margin=1in";
    case "a5":
      return "a5paper,margin=1in";
    case "a4":
    default:
      return "a4paper,margin=1in";
  }
}

function buildOverleafLikeLatexTemplate(options: Required<RenderOptions>): string {
  return String.raw`\documentclass[${options.fontSizePt}pt]{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage[${geometryForPageSize(options.pageSize)}]{geometry}
${latexFontBlock(options.documentFont)}
\usepackage{setspace}
\usepackage{amsmath,amssymb}
\usepackage{booktabs,longtable,array}
\usepackage{graphicx}
\IfFileExists{float.sty}{\usepackage{float}}{}
\usepackage[table]{xcolor}
\usepackage[colorlinks=true,linkcolor=blue,urlcolor=blue,citecolor=blue]{hyperref}
\setlength{\emergencystretch}{3em}
\setlength{\tabcolsep}{7pt}
\renewcommand{\arraystretch}{1.2}
\urlstyle{same}
\let\markpadhref\href
\renewcommand{\href}[2]{\markpadhref{#1}{\textcolor{blue}{\underline{#2}}}}
\sloppy
\setstretch{${options.lineStretch}}
\providecommand{\tightlist}{\setlength{\itemsep}{0pt}\setlength{\parskip}{0pt}}
$if(title)$
${titleLine}
$endif$
$if(author)$
\author{$author$}
$endif$
$if(date)$
\date{$date$}
$endif$
\begin{document}
$if(title)$
\maketitle
$endif$
$body$
\end{document}
`;
}

async function ensureTmpDir() {
  await mkdir(tmpDir, { recursive: true });
}

async function ensureTypstLinkStyleIncludeFile(): Promise<string> {
  await ensureTmpDir();

  if (typstLinkStyleIncludeFilePath) {
    return typstLinkStyleIncludeFilePath;
  }

  const includePath = join(tmpDir, "typst-link-style.include.typ");
  await writeFile(includePath, "#show link: set text(fill: rgb(\"#1e64c8\"))\n", "utf-8");
  typstLinkStyleIncludeFilePath = includePath;
  return includePath;
}

function simpleHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

function needsLatexEngine(markdown: string): boolean {
  // Force LaTeX only when raw LaTeX commands are explicitly present.
  return /(^|[^\\])\\(clearpage|newpage|pagebreak|nopagebreak|vspace|hspace|textbf\{|textit\{|texttt\{|begin\{|end\{)/m.test(markdown);
}

export function getRenderEngineOrder(
  markdown: string,
  options: Required<RenderOptions>,
  isLatexUnavailable: boolean,
): Array<"typst" | "latex"> {
  if (isLatexEngineDisabledByConfig()) {
    return ["typst"];
  }

  const requiresLatex = needsLatexEngine(markdown);
  const prefersLatexByOptions = options.documentFont !== "latin-modern";

  if (requiresLatex || prefersLatexByOptions) {
    return isLatexUnavailable ? ["typst"] : ["latex", "typst"];
  }

  return isLatexUnavailable ? ["typst"] : ["typst", "latex"];
}

function insertSoftHyphens(token: string, chunkSize = 18): string {
  if (token.length <= chunkSize) return token;
  if (/^https?:\/\//i.test(token)) return token;

  const parts: string[] = [];
  for (let i = 0; i < token.length; i += chunkSize) {
    parts.push(token.slice(i, i + chunkSize));
  }

  return parts.join("\u00ad");
}

function stripHtmlTags(input: string): string {
  return input
    .replace(/<\/?[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function normalizeHtmlBlocks(chunk: string): string {
  let normalized = chunk;

  normalized = normalized.replace(
    /<details>\s*<summary>([\s\S]*?)<\/summary>\s*([\s\S]*?)<\/details>/gi,
    (_whole, rawSummary: string, rawBody: string) => {
      const summary = stripHtmlTags(rawSummary);
      const bodyLines = stripHtmlTags(rawBody)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (bodyLines.length === 0) {
        return `> **${summary}**`;
      }

      return `> **${summary}**\n>\n> ${bodyLines.join("\n> ")}`;
    },
  );

  normalized = normalized.replace(/<img\b[^>]*>/gi, (imgTag) => {
    const attrs = parseHtmlTagAttributes(imgTag);
    const src = (attrs.src ?? "").trim();
    if (!src) return imgTag;

    const alt = (attrs.alt ?? "").trim();
    const directWidth = normalizeDimension(attrs.width ?? "");
    const styleWidth = extractWidthFromStyle(attrs.style);
    const width = directWidth ?? styleWidth;
    const widthAttributes = width ? `{width=${width}}` : "";

    return `![${alt}](${src})${widthAttributes}`;
  });

  normalized = normalized.replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  normalized = normalized.replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  normalized = normalized.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  normalized = normalized.replace(/<br\s*\/?\s*>/gi, "\n");

  normalized = normalized.replace(/<p\b[^>]*>/gi, "");
  normalized = normalized.replace(/<\/p>/gi, "\n\n");

  normalized = normalized.replace(/<\/?div\b[^>]*>/gi, "");
  normalized = normalized.replace(/<\/?details\b[^>]*>/gi, "");
  normalized = normalized.replace(/<\/?summary\b[^>]*>/gi, "");

  return normalized.replace(/\n{3,}/g, "\n\n");
}

function normalizeLatexCompatibility(chunk: string): string {
  let normalized = chunk;

  // Keep raw LaTeX page breaks functional on both Typst and LaTeX paths.
  normalized = normalized.replace(/(^|\n)\s*\\(clearpage|newpage)\s*(?=\n|$)/g, (_whole, prefix: string, command: string) => {
    const latexCommand = command === "clearpage" ? "\\clearpage" : "\\newpage";
    const dualEnginePageBreak = [
      "```{=latex}",
      latexCommand,
      "```",
      "",
      "```{=typst}",
      "#pagebreak()",
      "```",
    ].join("\n");

    return `${prefix}${dualEnginePageBreak}`;
  });

  // Normalize simple inline LaTeX text formatting to markdown equivalents.
  normalized = normalized.replace(/\\textbf\{([^{}]+)\}/g, "**$1**");
  normalized = normalized.replace(/\\textit\{([^{}]+)\}/g, "*$1*");
  normalized = normalized.replace(/\\texttt\{([^{}]+)\}/g, "`$1`");

  return normalized;
}

function normalizeRawTypstImageFences(markdown: string): string {
  return markdown.replace(rawTypstImageFenceRegex, (_whole, rawSrcDouble: string, rawSrcSingle: string, rawCaption: string) => {
    const src = (rawSrcDouble ?? rawSrcSingle ?? "").trim();
    if (!src) return _whole;

    const caption = (rawCaption ?? "").replace(/\s+/g, " ").trim();
    const alt = caption.length > 0 ? caption : "Typst image";
    return `![${alt}](${src})`;
  });
}

function transformOutsideFences(markdown: string, transform: (chunk: string) => string): string {
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  const chunkBuffer: string[] = [];
  let inFence = false;

  const flushChunk = () => {
    if (chunkBuffer.length === 0) return;
    output.push(transform(chunkBuffer.join("\n")));
    chunkBuffer.length = 0;
  };

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (/^(```|~~~)/.test(trimmed)) {
      if (!inFence) {
        flushChunk();
        inFence = true;
        output.push(line);
      } else {
        inFence = false;
        output.push(line);
      }
      continue;
    }

    if (inFence) {
      output.push(line);
    } else {
      chunkBuffer.push(line);
    }
  }

  flushChunk();
  return output.join("\n");
}

export function normalizeMarkdownForPdf(markdown: string): string {
  const shouldNormalizeTypstFences = markdown.includes("```{=typst}") && markdown.includes("image(");
  const shouldNormalizeHtml = markdown.includes("<") && markdown.includes(">");
  const shouldNormalizeLatex = markdown.includes("\\");

  const markdownWithPortableTypstImages = shouldNormalizeTypstFences
    ? normalizeRawTypstImageFences(markdown)
    : markdown;
  const markdownWithNormalizedHtml = shouldNormalizeHtml
    ? transformOutsideFences(markdownWithPortableTypstImages, normalizeHtmlBlocks)
    : markdownWithPortableTypstImages;
  const markdownWithLatexCompatibility = shouldNormalizeLatex
    ? transformOutsideFences(markdownWithNormalizedHtml, normalizeLatexCompatibility)
    : markdownWithNormalizedHtml;

  const lines = markdownWithLatexCompatibility.split(/\r?\n/);
  const normalized: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      normalized.push(line);
      continue;
    }

    if (inFence || /^\s{4}/.test(line)) {
      normalized.push(line);
      continue;
    }

    normalized.push(line.replace(/\S{45,}/g, (token) => insertSoftHyphens(token)));
  }

  return normalized.join("\n");
}

function resolvePandocBinary(): string {
  const configured = process.env.MARKPAD_PANDOC_BIN?.trim();
  if (configured && configured.length > 0) {
    return isAbsolute(configured) ? configured : resolve(configured);
  }

  return "pandoc";
}

function resolvePdfEngineBinary(engine: "typst" | "latex"): string {
  if (engine === "latex") {
    return "pdflatex";
  }

  const configured = process.env.MARKPAD_TYPST_BIN?.trim();
  if (configured && configured.length > 0) {
    return isAbsolute(configured) ? configured : resolve(configured);
  }

  return process.platform === "win32" ? "typst.exe" : "typst";
}

function summarizeRenderError(engine: "typst" | "latex", error: Error, stdout: string, stderr: string): Error {
  const chunks = [
    stderr?.trim(),
    stdout?.trim(),
    error.message,
  ].filter((value): value is string => Boolean(value && value.trim().length > 0));

  const details = chunks.join("\n");
  return new Error(`${engine.toUpperCase()} render failed: ${details}`);
}

async function runPandocToPdf(
  markdown: string,
  pdfFile: string,
  engine: "typst" | "latex",
  options: Required<RenderOptions>,
  workingDir?: string,
  signal?: AbortSignal,
) {
  const templateFile = engine === "latex" ? join(tmpDir, `${randomBytes(8).toString("hex")}.template.tex`) : null;
  const fromArgs = engine === "latex"
    ? ["--from=markdown+raw_tex+raw_html+autolink_bare_uris+pipe_tables+footnotes+link_attributes"]
    : ["--from=markdown+raw_html+autolink_bare_uris+pipe_tables+footnotes+link_attributes"];
  const pandocBin = resolvePandocBinary();
  const engineBinary = resolvePdfEngineBinary(engine);
  const engineArgs = [`--pdf-engine=${engineBinary}`];
  const templateArgs = templateFile ? ["--template", templateFile] : [];
  let includeBeforeBodyArgs: string[] = [];
  const pageSizeArg = engine === "typst" ? ["-V", `papersize=${options.pageSize}`] : [];
  const typstLayoutArgs = engine === "typst"
    ? ["-V", `fontsize=${options.fontSizePt}pt`, "-V", `linestretch=${options.lineStretch}`]
    : [];

  try {
    if (templateFile) {
      await writeFile(templateFile, buildOverleafLikeLatexTemplate(options), "utf-8");
    }

    if (engine === "typst") {
      const typstIncludeBeforeBodyFile = await ensureTypstLinkStyleIncludeFile();
      includeBeforeBodyArgs = ["--include-before-body", typstIncludeBeforeBodyFile];
    }

    await new Promise<void>((resolve, reject) => {
      execFile(
        pandocBin,
        [
          "-",
          ...fromArgs,
          ...engineArgs,
          ...pageSizeArg,
          ...typstLayoutArgs,
          ...templateArgs,
          ...includeBeforeBodyArgs,
          "-o",
          pdfFile,
          "--standalone",
        ],
        { timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, cwd: workingDir, signal },
        (error, stdout, stderr) => {
          if (error) {
            if (signal?.aborted || isAbortLikeError(error)) {
              reject(createAbortError("Pandoc render aborted"));
              return;
            }
            reject(summarizeRenderError(engine, error, stdout, stderr));
          } else {
            resolve();
          }
        }
      ).stdin?.end(markdown);
    });
  } finally {
    if (templateFile) {
      await unlink(templateFile).catch(() => {});
    }
  }
}

export async function renderMarkdownToPdf(
  markdown: string,
  rawOptions?: RenderOptions,
  projectId?: number,
  executionOptions?: RenderExecutionOptions,
): Promise<Uint8Array> {
  const signal = executionOptions?.signal;
  if (signal?.aborted) {
    throw createAbortError("PDF render aborted before start");
  }

  const options: Required<RenderOptions> = { ...DEFAULT_RENDER_OPTIONS, ...(rawOptions ?? {}) };
  const normalizedMarkdown = normalizeMarkdownForPdf(markdown);
  const invalidDirectoryReferences = extractInvalidDirectoryAssetReferences(normalizedMarkdown);
  if (invalidDirectoryReferences.length > 0) {
    const sample = invalidDirectoryReferences.slice(0, 4).join(", ");
    throw new Error(
      `Invalid image path points to an assets directory: ${sample}. Use a file path under assets/ (for example assets/image.png).`,
    );
  }

  await ensureTmpDir();
  const id = randomBytes(8).toString("hex");
  const renderDir = projectId ? join(tmpDir, `${id}-workspace`) : undefined;

  if (renderDir) {
    await mkdir(renderDir, { recursive: true });
  }

  const assetSignature = renderDir && projectId
    ? await materializeProjectAssets(projectId, normalizedMarkdown, renderDir)
    : "";

  if (signal?.aborted) {
    throw createAbortError("PDF render aborted before execution");
  }

  const hash = simpleHash(`${projectId ?? "none"}:${assetSignature}:${JSON.stringify(options)}:${normalizedMarkdown}`);
  if (hash === lastHash && lastPdf) {
    if (renderDir) {
      await rm(renderDir, { recursive: true, force: true }).catch(() => {});
    }
    return lastPdf;
  }

  const pdfFile = join(renderDir ?? tmpDir, `${id}.pdf`);

  try {
    const engineOrder = getRenderEngineOrder(normalizedMarkdown, options, latexEngineUnavailable);
    let lastError: unknown = null;

    for (const engine of engineOrder) {
      try {
        await runPandocToPdf(normalizedMarkdown, pdfFile, engine, options, renderDir, signal);

        if (signal?.aborted) {
          throw createAbortError("PDF render aborted after engine execution");
        }

        if (engine === "latex") {
          latexEngineUnavailable = false;
        }
        lastError = null;
        break;
      } catch (err) {
        if (signal?.aborted || isAbortLikeError(err)) {
          throw err;
        }

        if (engine === "latex") {
          const message = (err as Error)?.message ?? "";
          if (/pdflatex|not found|No such file or directory|LaTeX Error: File `[^`]+\.sty' not found|Emergency stop/i.test(message)) {
            latexEngineUnavailable = true;
            logger.warn({ err }, "Disabling LaTeX engine for subsequent preview renders due environment failure");
          }
        }
        lastError = err;
        logger.warn({ err, engine }, "PDF render attempt failed, trying fallback engine if available");
      }
    }

    if (lastError) {
      throw lastError;
    }

    const pdfBytes = await readFile(pdfFile);

    if (signal?.aborted) {
      throw createAbortError("PDF render aborted after output generation");
    }

    const result = new Uint8Array(pdfBytes);

    lastHash = hash;
    lastPdf = result;

    return result;
  } finally {
    await unlink(pdfFile).catch(() => {});
    if (renderDir) {
      await rm(renderDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export function prewarmPdfRenderer() {
  if (warmupPromise) return warmupPromise;

  warmupPromise = renderMarkdownToPdf("# MarkPad\n\nPreview warmup.", DEFAULT_RENDER_OPTIONS)
    .then(() => {
      logger.info("PDF renderer warmup completed");
    })
    .catch((err) => {
      logger.warn({ err }, "PDF renderer warmup failed");
    });

  return warmupPromise;
}

export async function renderMarkdownToLatex(markdown: string, rawOptions?: RenderOptions): Promise<string> {
  const options: Required<RenderOptions> = { ...DEFAULT_RENDER_OPTIONS, ...(rawOptions ?? {}) };
  const normalizedMarkdown = normalizeMarkdownForPdf(markdown);
  const pandocBin = resolvePandocBinary();
  await ensureTmpDir();
  const id = randomBytes(8).toString("hex");
  const mdFile = join(tmpDir, `${id}.md`);
  const texFile = join(tmpDir, `${id}.tex`);
  const templateFile = join(tmpDir, `${id}.template.tex`);

  try {
    await writeFile(mdFile, normalizedMarkdown, "utf-8");
    await writeFile(templateFile, buildOverleafLikeLatexTemplate(options), "utf-8");

    await new Promise<void>((resolve, reject) => {
      execFile(
        pandocBin,
        [
          mdFile,
          "--from=markdown+raw_tex+raw_html+autolink_bare_uris+pipe_tables+footnotes+link_attributes",
          "--to=latex",
          "--wrap=none",
          "--template",
          templateFile,
          "-o",
          texFile,
        ],
        { timeout: 15000, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`Pandoc failed: ${[stderr?.trim(), stdout?.trim(), error.message].filter(Boolean).join("\n")}`));
          } else {
            resolve();
          }
        }
      );
    });

    return await readFile(texFile, "utf-8");
  } finally {
    await unlink(mdFile).catch(() => {});
    await unlink(texFile).catch(() => {});
    await unlink(templateFile).catch(() => {});
  }
}
