import { Router } from "express";
import { db } from "@workspace/db";
import { filesTable, projectsTable, snapshotsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { ExportProjectParams, ExportProjectQueryParams, RenderPreviewParams, RenderPreviewBody } from "@workspace/api-zod";
import { zipSync } from "fflate";
import { renderMarkdownToPdf, renderMarkdownToLatex, RenderOptions } from "../lib/renderer";
import { handleRouteError } from "../lib/http";

const router = Router();
const FAST_ZIP_LEVEL = 0;

function sanitizeArchiveBaseName(name: string, fallback: string) {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned.length > 0 ? cleaned : fallback;
}

function decodeStoredAssetContent(content: string): Uint8Array {
  const dataUriMatch = content.match(/^data:[^;]+;base64,(.+)$/i);
  if (dataUriMatch) {
    return Buffer.from(dataUriMatch[1], "base64");
  }

  return Buffer.from(content, "utf8");
}

function parseRenderOptions(input: unknown): RenderOptions {
  if (!input || typeof input !== "object") return {};
  const raw = input as { pageSize?: unknown; documentFont?: unknown; fontSizePt?: unknown; lineStretch?: unknown };

  const pageSize =
    raw.pageSize === "a4" || raw.pageSize === "letter" || raw.pageSize === "legal" || raw.pageSize === "a5"
      ? raw.pageSize
      : undefined;
  const documentFont =
    raw.documentFont === "latin-modern" ||
    raw.documentFont === "times-new-roman" ||
    raw.documentFont === "palatino" ||
    raw.documentFont === "helvetica" ||
    raw.documentFont === "computer-modern"
      ? raw.documentFont
      : undefined;

  const fontSizePt =
    typeof raw.fontSizePt === "number" && Number.isFinite(raw.fontSizePt)
      ? Math.min(16, Math.max(9, raw.fontSizePt))
      : undefined;

  const lineStretch =
    typeof raw.lineStretch === "number" && Number.isFinite(raw.lineStretch)
      ? Math.min(1.6, Math.max(1, raw.lineStretch))
      : undefined;

  return { pageSize, documentFont, fontSizePt, lineStretch };
}

router.get("/projects/:projectId/export", async (req, res) => {
  try {
    const { projectId } = ExportProjectParams.parse(req.params);
    const { format, file } = ExportProjectQueryParams.parse(req.query);
    const filePath = file || "main.md";

    const [fileRecord] = await db
      .select()
      .from(filesTable)
      .where(and(eq(filesTable.projectId, projectId), eq(filesTable.path, filePath)));

    if (!fileRecord) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    if (format === "md") {
      res.setHeader("Content-Type", "text/markdown");
      res.setHeader("Content-Disposition", `attachment; filename="${filePath}"`);
      res.send(fileRecord.content);
      return;
    }

    if (format === "latex") {
      const latex = await renderMarkdownToLatex(fileRecord.content);
      const latexFilename = filePath.replace(/\.md$/, ".tex");
      res.setHeader("Content-Type", "application/x-latex");
      res.setHeader("Content-Disposition", `attachment; filename="${latexFilename}"`);
      res.send(latex);
      return;
    }

    if (format === "pdf") {
      const pdfBytes = await renderMarkdownToPdf(fileRecord.content, undefined, projectId);
      const pdfFilename = filePath.replace(/\.md$/, ".pdf");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${pdfFilename}"`);
      res.send(Buffer.from(pdfBytes));
      return;
    }

    res.status(400).json({ error: "Invalid format" });
  } catch (err) {
    handleRouteError(req, res, err, {
      logMessage: "Failed to export",
      publicMessage: "Failed to export",
    });
  }
});

router.get("/projects/:projectId/export/project-bundle", async (req, res) => {
  try {
    const { projectId } = ExportProjectParams.parse(req.params);

    const [project] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId));

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const rows = await db
      .select({ path: filesTable.path, content: filesTable.content })
      .from(filesTable)
      .where(eq(filesTable.projectId, projectId));

    const zipEntries: Record<string, Uint8Array> = {};
    for (const row of rows) {
      if (row.path.endsWith("/")) {
        continue;
      }

      zipEntries[row.path] = row.path.startsWith("assets/")
        ? decodeStoredAssetContent(row.content)
        : Buffer.from(row.content, "utf8");
    }

    const entryPaths = Object.keys(zipEntries);
    if (entryPaths.length === 0) {
      res.status(404).json({ error: "Project has no files to export" });
      return;
    }

    const zipBytes = zipSync(zipEntries, { level: FAST_ZIP_LEVEL });
    const baseName = sanitizeArchiveBaseName(project.name, `project-${projectId}`);
    const fileName = `${baseName}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(Buffer.from(zipBytes));
  } catch (err) {
    handleRouteError(req, res, err, {
      logMessage: "Failed to export project bundle",
      publicMessage: "Failed to export project bundle",
    });
  }
});

router.post("/projects/:projectId/render", async (req, res) => {
  try {
    const { projectId } = RenderPreviewParams.parse(req.params);
    const { content } = RenderPreviewBody.parse(req.body);
    const options = parseRenderOptions((req.body as { options?: unknown })?.options);
    const pdfBytes = await renderMarkdownToPdf(content, options, projectId);
    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    handleRouteError(req, res, err, {
      logMessage: "Failed to render preview",
      publicMessage: "Failed to render",
    });
  }
});

router.post("/projects/:projectId/export/latex", async (req, res) => {
  try {
    RenderPreviewParams.parse(req.params);
    const { content } = RenderPreviewBody.parse(req.body);
    const options = parseRenderOptions((req.body as { options?: unknown })?.options);
    const latex = await renderMarkdownToLatex(content, options);
    res.setHeader("Content-Type", "application/x-latex");
    res.setHeader("Content-Disposition", "attachment; filename=marktex.tex");
    res.send(latex);
  } catch (err) {
    handleRouteError(req, res, err, {
      logMessage: "Failed to export latex from current content",
      publicMessage: "Failed to export latex",
    });
  }
});

export default router;
