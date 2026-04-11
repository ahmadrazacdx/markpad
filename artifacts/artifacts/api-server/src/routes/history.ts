import { Router } from "express";
import { db } from "@workspace/db";
import { snapshotsTable, filesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  GetHistoryParams,
  GetHistoryQueryParams,
  RestoreSnapshotParams,
  PinSnapshotParams,
  PinSnapshotBody,
} from "@workspace/api-zod";

const router = Router();

router.get("/projects/:projectId/history", async (req, res) => {
  try {
    const { projectId } = GetHistoryParams.parse(req.params);
    const { file } = GetHistoryQueryParams.parse(req.query);

    const snapshots = await db
      .select({
        id: snapshotsTable.id,
        filePath: snapshotsTable.filePath,
        wordCount: snapshotsTable.wordCount,
        label: snapshotsTable.label,
        createdAt: snapshotsTable.createdAt,
      })
      .from(snapshotsTable)
      .where(
        and(
          eq(snapshotsTable.projectId, projectId),
          eq(snapshotsTable.filePath, file)
        )
      )
      .orderBy(desc(snapshotsTable.createdAt));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const groups = {
      pinned: [] as typeof formatted,
      today: [] as typeof formatted,
      yesterday: [] as typeof formatted,
      older: [] as typeof formatted,
    };

    const formatted = snapshots.map((s) => ({
      id: s.id,
      filePath: s.filePath,
      wordCount: s.wordCount,
      label: s.label,
      createdAt: s.createdAt.toISOString(),
    }));

    for (const snap of formatted) {
      const snapDate = new Date(snap.createdAt);
      if (snap.label) {
        groups.pinned.push(snap);
      } else if (snapDate >= today) {
        groups.today.push(snap);
      } else if (snapDate >= yesterday) {
        groups.yesterday.push(snap);
      } else {
        groups.older.push(snap);
      }
    }

    res.json(groups);
  } catch (err) {
    req.log.error({ err }, "Failed to get history");
    res.status(500).json({ error: "Failed to get history" });
  }
});

router.post("/projects/:projectId/history/:snapshotId/restore", async (req, res) => {
  try {
    const { projectId, snapshotId } = RestoreSnapshotParams.parse(req.params);

    const [snapshot] = await db
      .select()
      .from(snapshotsTable)
      .where(eq(snapshotsTable.id, snapshotId));

    if (!snapshot) {
      res.status(404).json({ error: "Snapshot not found" });
      return;
    }

    const [currentFile] = await db
      .select()
      .from(filesTable)
      .where(
        and(
          eq(filesTable.projectId, projectId),
          eq(filesTable.path, snapshot.filePath)
        )
      );

    if (currentFile) {
      const currentWordCount = (currentFile.content.match(/\w+/g) || []).length;
      await db.insert(snapshotsTable).values({
        projectId,
        filePath: snapshot.filePath,
        content: currentFile.content,
        wordCount: currentWordCount,
        label: `Before restore — ${new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
      });
    }

    await db
      .update(filesTable)
      .set({ content: snapshot.content })
      .where(
        and(
          eq(filesTable.projectId, projectId),
          eq(filesTable.path, snapshot.filePath)
        )
      );

    const wordCount = (snapshot.content.match(/\w+/g) || []).length;
    res.json({
      path: snapshot.filePath,
      content: snapshot.content,
      wordCount,
      lastSavedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to restore snapshot");
    res.status(500).json({ error: "Failed to restore snapshot" });
  }
});

router.post("/projects/:projectId/history/:snapshotId/pin", async (req, res) => {
  try {
    const { snapshotId } = PinSnapshotParams.parse(req.params);
    const { label } = PinSnapshotBody.parse(req.body);

    const [snapshot] = await db
      .update(snapshotsTable)
      .set({ label })
      .where(eq(snapshotsTable.id, snapshotId))
      .returning();

    if (!snapshot) {
      res.status(404).json({ error: "Snapshot not found" });
      return;
    }

    res.json({
      id: snapshot.id,
      filePath: snapshot.filePath,
      wordCount: snapshot.wordCount,
      label: snapshot.label,
      createdAt: snapshot.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to pin snapshot");
    res.status(500).json({ error: "Failed to pin snapshot" });
  }
});

export default router;
