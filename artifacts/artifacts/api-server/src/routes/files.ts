import { Router } from "express";
import { db } from "@workspace/db";
import { filesTable, snapshotsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import {
  ListFilesParams,
  CreateFileParams,
  CreateFileBody,
  GetFileContentParams,
  SaveFileContentParams,
  SaveFileContentBody,
  DeleteFileParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/projects/:projectId/files", async (req, res) => {
  try {
    const { projectId } = ListFilesParams.parse(req.params);
    const files = await db
      .select({
        path: filesTable.path,
        name: filesTable.name,
        content: filesTable.content,
      })
      .from(filesTable)
      .where(eq(filesTable.projectId, projectId));

    const entries = files.map((f) => ({
      path: f.path,
      name: f.name,
      type: "file" as const,
      size: f.content.length,
    }));

    res.json(entries);
  } catch (err) {
    req.log.error({ err }, "Failed to list files");
    res.status(500).json({ error: "Failed to list files" });
  }
});

router.post("/projects/:projectId/files", async (req, res) => {
  try {
    const { projectId } = CreateFileParams.parse(req.params);
    const { path: filePath, content } = CreateFileBody.parse(req.body);
    const name = filePath.split("/").pop() || filePath;

    const [file] = await db
      .insert(filesTable)
      .values({
        projectId,
        path: filePath,
        name,
        content: content || "",
      })
      .returning();

    res.status(201).json({
      path: file.path,
      name: file.name,
      type: "file",
      size: file.content.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create file");
    res.status(500).json({ error: "Failed to create file" });
  }
});

router.get("/projects/:projectId/files/:filePath", async (req, res) => {
  try {
    const { projectId, filePath } = GetFileContentParams.parse(req.params);
    const [file] = await db
      .select()
      .from(filesTable)
      .where(and(eq(filesTable.projectId, projectId), eq(filesTable.path, filePath)));

    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const wordCount = (file.content.match(/\w+/g) || []).length;
    res.json({
      path: file.path,
      content: file.content,
      wordCount,
      lastSavedAt: file.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get file content");
    res.status(500).json({ error: "Failed to get file content" });
  }
});

router.put("/projects/:projectId/files/:filePath", async (req, res) => {
  try {
    const { projectId, filePath } = SaveFileContentParams.parse(req.params);
    const { content } = SaveFileContentBody.parse(req.body);

    const [file] = await db
      .update(filesTable)
      .set({ content })
      .where(and(eq(filesTable.projectId, projectId), eq(filesTable.path, filePath)))
      .returning();

    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const wordCount = (content.match(/\w+/g) || []).length;

    await db.insert(snapshotsTable).values({
      projectId,
      filePath,
      content,
      wordCount,
    });

    await pruneSnapshots(projectId, filePath);

    res.json({
      path: file.path,
      content: file.content,
      wordCount,
      lastSavedAt: file.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to save file");
    res.status(500).json({ error: "Failed to save file" });
  }
});

router.delete("/projects/:projectId/files/:filePath", async (req, res) => {
  try {
    const { projectId, filePath } = DeleteFileParams.parse(req.params);
    await db
      .delete(filesTable)
      .where(and(eq(filesTable.projectId, projectId), eq(filesTable.path, filePath)));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete file");
    res.status(500).json({ error: "Failed to delete file" });
  }
});

async function pruneSnapshots(projectId: number, filePath: string) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  await db.execute(sql`
    DELETE FROM snapshots WHERE id IN (
      SELECT id FROM snapshots
      WHERE project_id = ${projectId}
        AND file_path = ${filePath}
        AND label IS NULL
        AND created_at < ${sevenDaysAgo}
        AND id NOT IN (
          SELECT MAX(id) FROM snapshots
          WHERE project_id = ${projectId}
            AND file_path = ${filePath}
            AND created_at < ${sevenDaysAgo}
          GROUP BY DATE(created_at)
        )
    )
  `);

  const allSnapshots = await db
    .select({ id: snapshotsTable.id, label: snapshotsTable.label })
    .from(snapshotsTable)
    .where(
      and(
        eq(snapshotsTable.projectId, projectId),
        eq(snapshotsTable.filePath, filePath)
      )
    )
    .orderBy(desc(snapshotsTable.createdAt));

  if (allSnapshots.length > 500) {
    const toDelete = allSnapshots
      .slice(500)
      .filter((s) => !s.label)
      .map((s) => s.id);

    if (toDelete.length > 0) {
      await db.execute(
        sql`DELETE FROM snapshots WHERE id = ANY(${toDelete})`
      );
    }
  }
}

export default router;
