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
import { handleRouteError, isPgUniqueViolation } from "../lib/http";

const router = Router();

const ASSET_MIME_ALLOWLIST = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
]);

function normalizeAssetPath(input: string) {
  const trimmed = input.trim().replace(/^\/+/, "");
  return trimmed.startsWith("assets/") ? trimmed : `assets/${trimmed}`;
}

function toFileName(path: string) {
  const cleaned = path.endsWith("/") ? path.slice(0, -1) : path;
  return cleaned.split("/").pop() || cleaned;
}

router.get("/projects/:projectId/files", async (req, res) => {
  try {
    const { projectId } = ListFilesParams.parse(req.params);
    const files = await db
      .select({
        path: filesTable.path,
        name: filesTable.name,
        size: sql<number>`char_length(${filesTable.content})`,
      })
      .from(filesTable)
      .where(eq(filesTable.projectId, projectId));

    const entries = files.map((f) => ({
      path: f.path,
      name: f.name,
      type: f.path.endsWith("/") ? ("directory" as "directory" | "file") : ("file" as "directory" | "file"),
      size: f.path.endsWith("/") ? undefined : Number(f.size),
    }));

    res.json(entries);
  } catch (err) {
    handleRouteError(req, res, err, {
      logMessage: "Failed to list files",
      publicMessage: "Failed to list files",
    });
  }
});

router.post("/projects/:projectId/files", async (req, res) => {
  try {
    const { projectId } = CreateFileParams.parse(req.params);
    const { path: filePath, content } = CreateFileBody.parse(req.body);
    if (filePath.endsWith("/")) {
      res.status(400).json({ error: "Path must point to a file" });
      return;
    }
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
    if (isPgUniqueViolation(err)) {
      res.status(409).json({ error: "File already exists" });
      return;
    }

    handleRouteError(req, res, err, {
      logMessage: "Failed to create file",
      publicMessage: "Failed to create file",
    });
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
    handleRouteError(req, res, err, {
      logMessage: "Failed to get file content",
      publicMessage: "Failed to get file content",
    });
  }
});

router.put("/projects/:projectId/files/:filePath", async (req, res) => {
  try {
    const { projectId, filePath } = SaveFileContentParams.parse(req.params);
    const { content } = SaveFileContentBody.parse(req.body);
    const shouldCreateCheckpoint = req.query.checkpoint !== "false";

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

    if (shouldCreateCheckpoint) {
      await db.insert(snapshotsTable).values({
        projectId,
        filePath,
        content,
        wordCount,
      });

      await pruneSnapshots(projectId, filePath);
    }

    res.json({
      path: file.path,
      content: file.content,
      wordCount,
      lastSavedAt: file.updatedAt.toISOString(),
    });
  } catch (err) {
    handleRouteError(req, res, err, {
      logMessage: "Failed to save file",
      publicMessage: "Failed to save file",
    });
  }
});

router.delete("/projects/:projectId/files/:filePath", async (req, res) => {
  try {
    const { projectId, filePath } = DeleteFileParams.parse(req.params);
    if (filePath.endsWith("/")) {
      const prefix = `${filePath}%`;
      await db
        .delete(filesTable)
        .where(
          and(
            eq(filesTable.projectId, projectId),
            sql`${filesTable.path} LIKE ${prefix}`,
          ),
        );
    } else {
      await db
        .delete(filesTable)
        .where(and(eq(filesTable.projectId, projectId), eq(filesTable.path, filePath)));
    }
    res.json({ success: true });
  } catch (err) {
    handleRouteError(req, res, err, {
      logMessage: "Failed to delete file",
      publicMessage: "Failed to delete file",
    });
  }
});

router.post("/projects/:projectId/assets/folders", async (req, res) => {
  try {
    const { projectId } = CreateFileParams.parse(req.params);
    const rawPath = typeof req.body?.path === "string" ? req.body.path : "";
    if (!rawPath.trim()) {
      res.status(400).json({ error: "Path is required" });
      return;
    }

    const path = `${normalizeAssetPath(rawPath).replace(/\/+$/, "")}/`;
    const name = toFileName(path);

    const [folder] = await db
      .insert(filesTable)
      .values({
        projectId,
        path,
        name,
        content: "",
      })
      .onConflictDoNothing()
      .returning();

    res.status(201).json({
      path: folder?.path ?? path,
      name: folder?.name ?? name,
      type: "directory",
    });
  } catch (err) {
    handleRouteError(req, res, err, {
      logMessage: "Failed to create assets folder",
      publicMessage: "Failed to create assets folder",
    });
  }
});

router.patch("/projects/:projectId/assets/rename", async (req, res) => {
  try {
    const { projectId } = CreateFileParams.parse(req.params);
    const fromPathRaw = typeof req.body?.fromPath === "string" ? req.body.fromPath : "";
    const toPathRaw = typeof req.body?.toPath === "string" ? req.body.toPath : "";

    if (!fromPathRaw.trim() || !toPathRaw.trim()) {
      res.status(400).json({ error: "fromPath and toPath are required" });
      return;
    }

    const fromPath = normalizeAssetPath(fromPathRaw);
    const toPath = normalizeAssetPath(toPathRaw);

    if (fromPath.endsWith("/")) {
      const fromPrefix = fromPath;
      const toPrefix = toPath.endsWith("/") ? toPath : `${toPath}/`;

      const rows = await db
        .select({ id: filesTable.id, path: filesTable.path })
        .from(filesTable)
        .where(
          and(
            eq(filesTable.projectId, projectId),
            sql`${filesTable.path} LIKE ${`${fromPrefix}%`}`,
          ),
        );

      for (const row of rows) {
        const nextPath = `${toPrefix}${row.path.slice(fromPrefix.length)}`;
        await db
          .update(filesTable)
          .set({ path: nextPath, name: toFileName(nextPath) })
          .where(eq(filesTable.id, row.id));
      }
    } else {
      const nextPath = toPath.endsWith("/") ? toPath.slice(0, -1) : toPath;
      const [updated] = await db
        .update(filesTable)
        .set({ path: nextPath, name: toFileName(nextPath) })
        .where(and(eq(filesTable.projectId, projectId), eq(filesTable.path, fromPath)))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Asset not found" });
        return;
      }
    }

    res.json({ success: true });
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      res.status(409).json({ error: "Destination path already exists" });
      return;
    }

    handleRouteError(req, res, err, {
      logMessage: "Failed to rename asset",
      publicMessage: "Failed to rename asset",
    });
  }
});

router.post("/projects/:projectId/assets/upload", async (req, res) => {
  try {
    const { projectId } = CreateFileParams.parse(req.params);
    const rawPath = typeof req.body?.path === "string" ? req.body.path : "";
    const contentBase64 = typeof req.body?.contentBase64 === "string" ? req.body.contentBase64 : "";
    const mimeType = typeof req.body?.mimeType === "string" ? req.body.mimeType : "";

    if (!rawPath.trim() || !contentBase64.trim() || !mimeType.trim()) {
      res.status(400).json({ error: "path, contentBase64 and mimeType are required" });
      return;
    }

    if (!ASSET_MIME_ALLOWLIST.has(mimeType)) {
      res.status(400).json({ error: "Unsupported file type" });
      return;
    }

    const path = normalizeAssetPath(rawPath).replace(/\/+$/, "");
    const name = toFileName(path);
    const content = `data:${mimeType};base64,${contentBase64}`;

    const [file] = await db
      .insert(filesTable)
      .values({
        projectId,
        path,
        name,
        content,
      })
      .onConflictDoUpdate({
        target: [filesTable.projectId, filesTable.path],
        set: {
          name,
          content,
        },
      })
      .returning();

    res.status(201).json({
      path: file.path,
      name: file.name,
      type: "file",
      size: contentBase64.length,
    });
  } catch (err) {
    handleRouteError(req, res, err, {
      logMessage: "Failed to upload asset",
      publicMessage: "Failed to upload asset",
    });
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
