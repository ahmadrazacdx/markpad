import { Router } from "express";
import { db } from "@workspace/db";
import { filesTable, snapshotsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { ExportProjectParams, ExportProjectQueryParams, RenderPreviewParams, RenderPreviewBody } from "@workspace/api-zod";
import { renderMarkdownToPdf, renderMarkdownToLatex, RenderOptions } from "../lib/renderer";
import { handleRouteError } from "../lib/http";

const router = Router();

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
    res.setHeader("Content-Disposition", "attachment; filename=markpad.tex");
    res.send(latex);
  } catch (err) {
    handleRouteError(req, res, err, {
      logMessage: "Failed to export latex from current content",
      publicMessage: "Failed to export latex",
    });
  }
});

export default router;
