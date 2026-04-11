import { Router } from "express";
import { db } from "@workspace/db";
import { filesTable, snapshotsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { ExportProjectParams, ExportProjectQueryParams, RenderPreviewParams, RenderPreviewBody } from "@workspace/api-zod";
import { renderMarkdownToPdf, renderMarkdownToLatex } from "../lib/renderer";

const router = Router();

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
      const pdfBytes = await renderMarkdownToPdf(fileRecord.content);
      const pdfFilename = filePath.replace(/\.md$/, ".pdf");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${pdfFilename}"`);
      res.send(Buffer.from(pdfBytes));
      return;
    }

    res.status(400).json({ error: "Invalid format" });
  } catch (err) {
    req.log.error({ err }, "Failed to export");
    res.status(500).json({ error: "Failed to export" });
  }
});

router.post("/projects/:projectId/render", async (req, res) => {
  try {
    const { content } = RenderPreviewBody.parse(req.body);
    const pdfBytes = await renderMarkdownToPdf(content);
    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    req.log.error({ err }, "Failed to render preview");
    res.status(500).json({ error: "Failed to render" });
  }
});

export default router;
