import { execFile } from "child_process";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import { logger } from "./logger";

const tmpDir = join(tmpdir(), "markpad-render");

let lastHash = "";
let lastPdf: Uint8Array | null = null;

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

export async function renderMarkdownToPdf(markdown: string): Promise<Uint8Array> {
  const hash = simpleHash(markdown);
  if (hash === lastHash && lastPdf) {
    return lastPdf;
  }

  await ensureTmpDir();
  const id = randomBytes(8).toString("hex");
  const mdFile = join(tmpDir, `${id}.md`);
  const pdfFile = join(tmpDir, `${id}.pdf`);

  try {
    await writeFile(mdFile, markdown, "utf-8");

    await new Promise<void>((resolve, reject) => {
      execFile(
        "pandoc",
        [mdFile, "--pdf-engine=typst", "-o", pdfFile, "--standalone"],
        { timeout: 15000 },
        (error, _stdout, stderr) => {
          if (error) {
            logger.error({ error: error.message, stderr }, "Pandoc render failed");
            reject(new Error(`Pandoc failed: ${stderr || error.message}`));
          } else {
            resolve();
          }
        }
      );
    });

    const pdfBytes = await readFile(pdfFile);
    const result = new Uint8Array(pdfBytes);

    lastHash = hash;
    lastPdf = result;

    return result;
  } finally {
    await unlink(mdFile).catch(() => {});
    await unlink(pdfFile).catch(() => {});
  }
}

export async function renderMarkdownToLatex(markdown: string): Promise<string> {
  await ensureTmpDir();
  const id = randomBytes(8).toString("hex");
  const mdFile = join(tmpDir, `${id}.md`);
  const texFile = join(tmpDir, `${id}.tex`);

  try {
    await writeFile(mdFile, markdown, "utf-8");

    await new Promise<void>((resolve, reject) => {
      execFile(
        "pandoc",
        [mdFile, "--to=latex", "-o", texFile, "--standalone"],
        { timeout: 15000 },
        (error, _stdout, stderr) => {
          if (error) {
            reject(new Error(`Pandoc failed: ${stderr || error.message}`));
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
  }
}
