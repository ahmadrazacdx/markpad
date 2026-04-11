import { Router } from "express";
import { db } from "@workspace/db";
import { projectsTable, filesTable, snapshotsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  CreateProjectBody,
  DeleteProjectParams,
  UpdateProjectParams,
  UpdateProjectBody,
  GetProjectStatsParams,
  ListTemplatesResponseItem,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router = Router();

const TEMPLATES: Record<string, { name: string; description: string; content: string }> = {
  plain: {
    name: "Plain",
    description: "A blank document with minimal frontmatter",
    content: `---
title: Untitled Document
author: ""
date: "${new Date().toISOString().split("T")[0]}"
---

# Untitled Document

Start writing here...
`,
  },
  academic: {
    name: "Academic Paper",
    description: "Structured academic paper with abstract and sections",
    content: `---
title: "Research Paper Title"
author: "Author Name"
date: "${new Date().toISOString().split("T")[0]}"
abstract: "Brief summary of the paper."
---

# Introduction

Provide background and motivation for the research.

# Methods

Describe the methodology used.

# Results

Present the findings.

# Discussion

Interpret the results and discuss implications.

# Conclusion

Summarize the key findings and future work.

# References
`,
  },
  report: {
    name: "Report",
    description: "Professional report with executive summary",
    content: `---
title: "Report Title"
author: "Author Name"
date: "${new Date().toISOString().split("T")[0]}"
---

# Executive Summary

Brief overview of the report's findings and recommendations.

# Background

Context and background information.

# Analysis

Detailed analysis of the subject matter.

# Recommendations

Actionable recommendations based on the analysis.

# Appendix
`,
  },
  letter: {
    name: "Letter",
    description: "Formal letter template",
    content: `---
title: ""
author: "Your Name"
date: "${new Date().toISOString().split("T")[0]}"
---

Your Name  
Your Address  
City, State ZIP

Date

Recipient Name  
Recipient Address  
City, State ZIP

Dear Recipient,

I am writing to...

Sincerely,

Your Name
`,
  },
};

router.get("/projects", async (req, res) => {
  try {
    const projects = await db
      .select()
      .from(projectsTable)
      .orderBy(projectsTable.updatedAt);
    res.json(projects);
  } catch (err) {
    req.log.error({ err }, "Failed to list projects");
    res.status(500).json({ error: "Failed to list projects" });
  }
});

router.post("/projects", async (req, res) => {
  try {
    const parsed = CreateProjectBody.parse(req.body);
    const [project] = await db
      .insert(projectsTable)
      .values({ name: parsed.name, template: parsed.template })
      .returning();

    const templateContent = TEMPLATES[parsed.template]?.content || TEMPLATES.plain.content;
    const content = templateContent.replace(
      /title: ".*"/,
      `title: "${parsed.name}"`
    );

    await db.insert(filesTable).values({
      projectId: project.id,
      path: "main.md",
      name: "main.md",
      content,
    });

    res.status(201).json(project);
  } catch (err) {
    req.log.error({ err }, "Failed to create project");
    res.status(500).json({ error: "Failed to create project" });
  }
});

router.delete("/projects/:projectId", async (req, res) => {
  try {
    const { projectId } = DeleteProjectParams.parse(req.params);
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete project");
    res.status(500).json({ error: "Failed to delete project" });
  }
});

router.patch("/projects/:projectId", async (req, res) => {
  try {
    const { projectId } = UpdateProjectParams.parse(req.params);
    const { name } = UpdateProjectBody.parse(req.body);
    const [project] = await db
      .update(projectsTable)
      .set({ name })
      .where(eq(projectsTable.id, projectId))
      .returning();
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(project);
  } catch (err) {
    req.log.error({ err }, "Failed to update project");
    res.status(500).json({ error: "Failed to update project" });
  }
});

router.get("/projects/:projectId/stats", async (req, res) => {
  try {
    const { projectId } = GetProjectStatsParams.parse(req.params);

    const files = await db
      .select()
      .from(filesTable)
      .where(eq(filesTable.projectId, projectId));

    const [snapshotCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(snapshotsTable)
      .where(eq(snapshotsTable.projectId, projectId));

    let totalWords = 0;
    let lastEditedAt = new Date(0).toISOString();

    for (const file of files) {
      totalWords += (file.content.match(/\w+/g) || []).length;
      if (file.updatedAt.toISOString() > lastEditedAt) {
        lastEditedAt = file.updatedAt.toISOString();
      }
    }

    res.json({
      totalFiles: files.length,
      totalWords,
      totalSnapshots: Number(snapshotCount.count),
      lastEditedAt,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get project stats");
    res.status(500).json({ error: "Failed to get project stats" });
  }
});

router.get("/templates", async (_req, res) => {
  const templates = Object.entries(TEMPLATES).map(([id, t]) => ({
    id,
    name: t.name,
    description: t.description,
    content: t.content,
  }));
  res.json(templates);
});

export default router;
