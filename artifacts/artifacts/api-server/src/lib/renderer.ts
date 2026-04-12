import { execFile } from "child_process";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import { logger } from "./logger";

const tmpDir = join(tmpdir(), "markpad-render");

export interface RenderOptions {
  pageSize?: "a4" | "letter" | "legal" | "a5";
  documentFont?: "latin-modern" | "times-new-roman" | "palatino" | "helvetica" | "computer-modern";
  fontSizePt?: number;
  lineStretch?: number;
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

const titleLine = "\\title{$title$}";

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
\usepackage[protrusion=true,expansion=false]{microtype}
\usepackage{amsmath,amssymb}
\usepackage{booktabs,longtable,array,multirow}
\usepackage{graphicx}
\usepackage{float}
\usepackage{xcolor}
\usepackage{enumitem}
\usepackage[normalem]{ulem}
\usepackage{fancyvrb}
\usepackage{hyperref}
\usepackage{bookmark}
\usepackage{xurl}
\setlength{\emergencystretch}{3em}
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
  // Keep this heuristic narrow so normal markdown stays on the fast Typst path.
  return /(^|[^\\])\\(clearpage|newpage|pagebreak|nopagebreak|vspace|hspace|begin\{|end\{)/m.test(markdown);
}

export function getRenderEngineOrder(
  markdown: string,
  options: Required<RenderOptions>,
  isLatexUnavailable: boolean,
): Array<"typst" | "latex"> {
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

function normalizeMarkdownForPdf(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
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
  return configured && configured.length > 0 ? configured : "pandoc";
}

function resolvePdfEngineBinary(engine: "typst" | "latex"): string {
  if (engine === "latex") {
    return "pdflatex";
  }

  const configured = process.env.MARKPAD_TYPST_BIN?.trim();
  if (configured && configured.length > 0) {
    return configured;
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

async function runPandocToPdf(markdown: string, pdfFile: string, engine: "typst" | "latex", options: Required<RenderOptions>) {
  const templateFile = engine === "latex" ? join(tmpDir, `${randomBytes(8).toString("hex")}.template.tex`) : null;
  const fromArgs = engine === "latex" ? ["--from=markdown+raw_tex"] : [];
  const pandocBin = resolvePandocBinary();
  const engineBinary = resolvePdfEngineBinary(engine);
  const engineArgs = [`--pdf-engine=${engineBinary}`];
  const templateArgs = templateFile ? ["--template", templateFile] : [];
  const pageSizeArg = engine === "typst" ? ["-V", `papersize=${options.pageSize}`] : [];
  const typstLayoutArgs = engine === "typst"
    ? ["-V", `fontsize=${options.fontSizePt}pt`, "-V", `linestretch=${options.lineStretch}`]
    : [];

  try {
    if (templateFile) {
      await writeFile(templateFile, buildOverleafLikeLatexTemplate(options), "utf-8");
    }

    await new Promise<void>((resolve, reject) => {
      execFile(
        pandocBin,
        ["-", ...fromArgs, ...engineArgs, ...pageSizeArg, ...typstLayoutArgs, ...templateArgs, "-o", pdfFile, "--standalone"],
        { timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
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

export async function renderMarkdownToPdf(markdown: string, rawOptions?: RenderOptions): Promise<Uint8Array> {
  const options: Required<RenderOptions> = { ...DEFAULT_RENDER_OPTIONS, ...(rawOptions ?? {}) };
  const normalizedMarkdown = normalizeMarkdownForPdf(markdown);
  const hash = simpleHash(`${JSON.stringify(options)}:${normalizedMarkdown}`);
  if (hash === lastHash && lastPdf) {
    return lastPdf;
  }

  await ensureTmpDir();
  const id = randomBytes(8).toString("hex");
  const pdfFile = join(tmpDir, `${id}.pdf`);

  try {
    const engineOrder = getRenderEngineOrder(normalizedMarkdown, options, latexEngineUnavailable);
    let lastError: unknown = null;

    for (const engine of engineOrder) {
      try {
        await runPandocToPdf(normalizedMarkdown, pdfFile, engine, options);
        if (engine === "latex") {
          latexEngineUnavailable = false;
        }
        lastError = null;
        break;
      } catch (err) {
        if (engine === "latex") {
          const message = (err as Error)?.message ?? "";
          if (/pdflatex|not found|No such file or directory/i.test(message)) {
            latexEngineUnavailable = true;
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
    const result = new Uint8Array(pdfBytes);

    lastHash = hash;
    lastPdf = result;

    return result;
  } finally {
    await unlink(pdfFile).catch(() => {});
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
        [mdFile, "--from=markdown+raw_tex", "--to=latex", "--wrap=none", "--template", templateFile, "-o", texFile],
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
