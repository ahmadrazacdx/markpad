import { useEffect, useMemo, useRef, useState } from "react";
import {
  Trash2,
  Edit2,
  Check,
  X,
  ChevronDown,
  Upload,
  ArrowLeft,
  PanelLeftClose,
  Archive,
  Loader2,
  Settings2,
  Folder as FolderGlyph,
  FileText,
  FileCode2,
  Image as ImageGlyph,
  File as FileGlyph,
  PlusCircle,
  LayoutGrid,
} from "lucide-react";
import { useListProjects, useCreateProject, useDeleteProject, useUpdateProject, useListFiles, useCreateFile, useDeleteFile, useListTemplates, getListProjectsQueryKey, getListFilesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  AppPreferences,
  DOCUMENT_FONT_OPTIONS,
  EDITOR_FONT_OPTIONS,
  PAGE_SIZE_OPTIONS,
} from "@/lib/preferences";
import { apiUrl } from "@/lib/runtime-api";

async function isDesktopRuntime() {
  try {
    const { isTauri } = await import("@tauri-apps/api/core");
    return isTauri();
  } catch {
    return false;
  }
}

interface SidebarProps {
  onToggleCollapse: () => void;
  projectId: number | null;
  preferences: AppPreferences;
  onPreferencesChange: (next: AppPreferences) => void;
  onProjectSelect: (id: number | null) => void;
  selectedFile: string | null;
  onFileSelect: (path: string) => void;
}

type FileEntry = {
  path: string;
  name: string;
  type: "file" | "directory";
  size?: number;
};

const FALLBACK_TEMPLATES: Array<{ id: string; name: string }> = [
  { id: "plain", name: "Plain" },
  { id: "academic", name: "Academic Paper" },
  { id: "report", name: "Report" },
  { id: "letter", name: "Letter" },
];

function normalizeTemplates(input: unknown) {
  if (!Array.isArray(input)) return FALLBACK_TEMPLATES;

  const normalized = input
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const maybeId = "id" in item ? (item as { id?: unknown }).id : undefined;
      const maybeName = "name" in item ? (item as { name?: unknown }).name : undefined;

      if (typeof maybeId !== "string" || maybeId.trim().length === 0) return null;
      if (typeof maybeName !== "string" || maybeName.trim().length === 0) return null;

      return {
        ...(item as Record<string, unknown>),
        id: maybeId,
        name: maybeName,
      };
    })
    .filter((item): item is { id: string; name: string } => item !== null);

  return normalized.length > 0 ? normalized : FALLBACK_TEMPLATES;
}

function normalizeAssetPath(path: string) {
  const trimmed = path.trim().replace(/^\/+/, "");
  return trimmed.startsWith("assets/") ? trimmed : `assets/${trimmed}`;
}

function nextUntitledFileName(entries: FileEntry[]) {
  const existing = new Set(
    entries
      .filter((entry) => !entry.path.startsWith("assets/") && entry.type === "file")
      .map((entry) => entry.path.toLowerCase()),
  );

  if (!existing.has("untitled.md")) return "untitled.md";

  let index = 2;
  while (existing.has(`untitled${index}.md`)) {
    index += 1;
  }

  return `untitled${index}.md`;
}

function splitBaseAndExtension(fileName: string) {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return { base: fileName, extension: "" };
  }

  return {
    base: fileName.slice(0, lastDot),
    extension: fileName.slice(lastDot),
  };
}

function colorFromName(name: string) {
  const palette = ["#f59e0b", "#f97316", "#60a5fa", "#22c55e", "#a78bfa", "#fb7185"];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash << 5) - hash + name.charCodeAt(i);
  return palette[Math.abs(hash) % palette.length];
}

function FileTypeIcon({ path, type, size = 16, className = "" }: { path: string; type: "file" | "directory"; size?: number; className?: string }) {
  const classes = `${className} leading-none`;
  if (type === "directory") {
    return <FolderGlyph className={classes} style={{ width: size, height: size }} aria-hidden />;
  }

  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md") {
    return <FileText className={classes} style={{ width: size, height: size, color: "#0078d4" }} aria-hidden />;
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
    return <ImageGlyph className={classes} style={{ width: size, height: size }} aria-hidden />;
  }
  if (ext === "pdf") {
    return <FileText className={classes} style={{ width: size, height: size }} aria-hidden />;
  }
  if (["ts", "tsx", "js", "jsx", "json", "yaml", "yml"].includes(ext)) {
    return <FileCode2 className={classes} style={{ width: size, height: size }} aria-hidden />;
  }
  return <FileGlyph className={classes} style={{ width: size, height: size }} aria-hidden />;
}

function MarkdownIcon() {
  return <FileText className="h-4 w-4 leading-none text-[#0078d4]" aria-hidden />;
}

function AddActionIcon() {
  return <PlusCircle className="h-[18px] w-[18px] leading-none text-sky-500" aria-hidden />;
}

function ProjectsIcon() {
  return <LayoutGrid className="h-[17px] w-[17px] leading-none text-sky-500" aria-hidden />;
}

function FolderIcon({ color = "#f59e0b", size = 16, className = "" }: { color?: string; size?: number; className?: string }) {
  return (
    <FolderGlyph
      className={`leading-none ${className}`}
      style={{
        color,
        fill: color,
        fillOpacity: 0.2,
        stroke: color,
        width: size,
        height: size,
      }}
      aria-hidden
    />
  );
}

export function Sidebar({ onToggleCollapse, projectId, preferences, onPreferencesChange, onProjectSelect, selectedFile, onFileSelect }: SidebarProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const getErrorMessage = (error: unknown, fallback: string) => {
    if (error && typeof error === "object" && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim().length > 0) {
        return message;
      }
    }
    return fallback;
  };

  const getApiErrorMessage = async (response: Response, fallback: string) => {
    try {
      const payload = await response.json() as { error?: unknown; message?: unknown };
      if (typeof payload?.error === "string" && payload.error.trim()) {
        return payload.error;
      }
      if (typeof payload?.message === "string" && payload.message.trim()) {
        return payload.message;
      }
    } catch {
      // Ignore non-JSON responses and fall back to default error message.
    }
    return fallback;
  };
  
  const projectsQuery = useListProjects();
  const filesQuery = useListFiles(projectId as number, { query: { enabled: !!projectId, queryKey: getListFilesQueryKey(projectId as number) } });
  const templatesQuery = useListTemplates();

  const projects = Array.isArray(projectsQuery.data) ? projectsQuery.data : [];
  const files = (Array.isArray(filesQuery.data) ? filesQuery.data : []) as FileEntry[];
  const templates = normalizeTemplates(templatesQuery.data);
  const selectedProject = projects.find((p) => p.id === projectId) ?? null;

  useEffect(() => {
    if (!projectsQuery.error) return;
    toast({ title: "Failed to load projects", variant: "destructive" });
  }, [projectsQuery.error, toast]);

  useEffect(() => {
    if (!filesQuery.error) return;
    toast({ title: "Failed to load files", variant: "destructive" });
  }, [filesQuery.error, toast]);

  useEffect(() => {
    if (!templatesQuery.error) return;
    toast({
      title: "Failed to load templates",
      description: getErrorMessage(templatesQuery.error, "Backend may be unavailable. Check desktop logs."),
      variant: "destructive",
    });
  }, [templatesQuery.error, toast]);

  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const updateProject = useUpdateProject();
  const createFile = useCreateFile();
  const deleteFile = useDeleteFile();

  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectTemplate, setNewProjectTemplate] = useState("plain");

  const [isCreatingFileInline, setIsCreatingFileInline] = useState(false);
  const [inlineFileName, setInlineFileName] = useState("untitled.md");

  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editProjectName, setEditProjectName] = useState("");

  const [isAssetsExpanded, setIsAssetsExpanded] = useState(false);
  const [isNewAssetFolderOpen, setIsNewAssetFolderOpen] = useState(false);
  const [newAssetFolderName, setNewAssetFolderName] = useState("");
  const [renamingFilePath, setRenamingFilePath] = useState<string | null>(null);
  const [renameFileName, setRenameFileName] = useState("");
  const [renamingAssetPath, setRenamingAssetPath] = useState<string | null>(null);
  const [renameAssetName, setRenameAssetName] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [draftPreferences, setDraftPreferences] = useState<AppPreferences>(preferences);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inlineFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isCreatingFileInline) return;
    const id = window.requestAnimationFrame(() => inlineFileInputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [isCreatingFileInline]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    setDraftPreferences(preferences);
  }, [isSettingsOpen, preferences]);

  const rootFiles = useMemo(
    () => files.filter((f) => !f.path.startsWith("assets/")).sort((a, b) => {
      if (a.path === "main.md") return -1;
      if (b.path === "main.md") return 1;
      return a.path.localeCompare(b.path);
    }),
    [files],
  );
  const suggestedUntitledName = useMemo(() => nextUntitledFileName(files), [files]);

  const assetChildren = useMemo(
    () => files
      .filter((f) => f.path !== "assets/" && f.path.startsWith("assets/"))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.path.localeCompare(b.path);
      }),
    [files],
  );

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;

    const projectsKey = getListProjectsQueryKey();
    const previousProjects = queryClient.getQueryData(projectsKey) as unknown[] | undefined;
    const tempId = -Date.now();
    const nowIso = new Date().toISOString();

    setIsNewProjectOpen(false);
    setNewProjectName("");

    queryClient.setQueryData(projectsKey, (old: unknown) => {
      const items = Array.isArray(old) ? old : [];
      return [
        ...items,
        {
          id: tempId,
          name,
          template: newProjectTemplate,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ];
    });

    try {
      const proj = await createProject.mutateAsync({
        data: { name, template: newProjectTemplate as any }
      });

      queryClient.setQueryData(projectsKey, (old: unknown) => {
        const items = Array.isArray(old) ? old : [];
        const replaced = items.map((item) => {
          if (typeof item === "object" && item !== null && "id" in item && (item as { id: unknown }).id === tempId) {
            return proj;
          }
          return item;
        });
        return replaced;
      });

      onProjectSelect(proj.id);
      toast({ title: "Project created" });
    } catch (e) {
      queryClient.setQueryData(projectsKey, previousProjects ?? []);
      toast({ title: getErrorMessage(e, "Error creating project"), variant: "destructive" });
    } finally {
      queryClient.invalidateQueries({ queryKey: projectsKey });
    }
  };

  const handleCreateFile = async (nameInput?: string) => {
    if (!projectId) return;
    const raw = (nameInput ?? inlineFileName).trim();
    if (!raw) {
      setIsCreatingFileInline(false);
      return;
    }

    const filesKey = getListFilesQueryKey(projectId);
    const previousFiles = queryClient.getQueryData(filesKey) as unknown[] | undefined;
    const name = raw.endsWith(".md") ? raw : `${raw}.md`;

    setIsCreatingFileInline(false);
    setInlineFileName(suggestedUntitledName);

    queryClient.setQueryData(filesKey, (old: unknown) => {
      const items = Array.isArray(old) ? old : [];
      return [
        ...items,
        {
          path: name,
          name,
          type: "file",
          size: 0,
        },
      ];
    });
    onFileSelect(name);

    try {
      const created = await createFile.mutateAsync({
        projectId,
        data: { path: name, content: "# " + name.replace(".md", "") }
      });

      queryClient.setQueryData(filesKey, (old: unknown) => {
        const items = Array.isArray(old) ? old : [];
        return items.map((item) => {
          if (typeof item === "object" && item !== null && "path" in item && (item as { path: unknown }).path === name) {
            return created;
          }
          return item;
        });
      });

      toast({ title: "File created" });
    } catch (e) {
      queryClient.setQueryData(filesKey, previousFiles ?? []);
      toast({ title: "Error creating file", variant: "destructive" });
    } finally {
      queryClient.invalidateQueries({ queryKey: filesKey });
    }
  };

  const handleCreateAssetFolder = async () => {
    if (!projectId || !newAssetFolderName.trim()) return;
    const filesKey = getListFilesQueryKey(projectId);
    const previousFiles = queryClient.getQueryData(filesKey) as unknown[] | undefined;
    const folderPath = `${normalizeAssetPath(newAssetFolderName).replace(/\/+$/, "")}/`;
    const folderName = folderPath.split("/").filter(Boolean).pop() ?? "folder";

    setIsNewAssetFolderOpen(false);
    setNewAssetFolderName("");
    setIsAssetsExpanded(true);

    queryClient.setQueryData(filesKey, (old: unknown) => {
      const items = Array.isArray(old) ? old : [];
      return [
        ...items,
        {
          path: folderPath,
          name: folderName,
          type: "directory",
        },
      ];
    });

    try {
      const response = await fetch(apiUrl(`/api/projects/${projectId}/assets/folders`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderPath }),
      });

      if (!response.ok) {
        throw new Error("Failed to create folder");
      }

      toast({ title: "Folder created" });
    } catch (e) {
      queryClient.setQueryData(filesKey, previousFiles ?? []);
      toast({ title: "Error creating folder", variant: "destructive" });
    } finally {
      queryClient.invalidateQueries({ queryKey: filesKey });
    }
  };

  const handleAssetUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!projectId) return;
    const files = e.currentTarget.files;
    if (!files || files.length === 0) return;

    const filesKey = getListFilesQueryKey(projectId);
    const previousFiles = queryClient.getQueryData(filesKey) as unknown[] | undefined;

    for (const file of Array.from(files)) {
      const mimeType = file.type;
      const reader = new FileReader();

      reader.onload = async () => {
        const base64 = reader.result?.toString().split(",")[1] || "";
        const path = `assets/${file.name}`;

        queryClient.setQueryData(filesKey, (old: unknown) => {
          const items = Array.isArray(old) ? old : [];
          return [
            ...items,
            { path, name: file.name, type: "file", size: file.size },
          ];
        });

        try {
            const response = await fetch(apiUrl(`/api/projects/${projectId}/assets/upload`), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path,
              contentBase64: base64,
              mimeType,
            }),
          });

            if (!response.ok) {
              throw new Error("Failed to upload asset");
            }

          toast({ title: `Uploaded ${file.name}` });
        } catch (err) {
          queryClient.setQueryData(filesKey, previousFiles ?? []);
          toast({ title: `Failed to upload ${file.name}`, variant: "destructive" });
        } finally {
          queryClient.invalidateQueries({ queryKey: filesKey });
        }
      };

      reader.readAsDataURL(file);
    }

    e.currentTarget.value = "";
  };

  const handleDeleteAsset = async (filePath: string) => {
    if (!projectId) return;
    if (!confirm(`Delete ${filePath.endsWith("/") ? "folder" : "file"} \"${filePath.replace(/^assets\//, "")}\"?`)) {
      return;
    }

    const filesKey = getListFilesQueryKey(projectId);
    const previousFiles = queryClient.getQueryData(filesKey) as unknown[] | undefined;

    queryClient.setQueryData(filesKey, (old: unknown) => {
      const items = (Array.isArray(old) ? old : []) as FileEntry[];
      if (filePath.endsWith("/")) {
        return items.filter((f) => !f.path.startsWith(filePath));
      }
      return items.filter((f) => f.path !== filePath);
    });

    try {
      await deleteFile.mutateAsync({ projectId, filePath });
      toast({ title: "Asset deleted" });
    } catch (err) {
      queryClient.setQueryData(filesKey, previousFiles ?? []);
      toast({ title: "Error deleting asset", variant: "destructive" });
    } finally {
      queryClient.invalidateQueries({ queryKey: filesKey });
    }
  };

  const handleRenameAsset = async (oldPath: string) => {
    if (!projectId || !renameAssetName.trim()) {
      setRenamingAssetPath(null);
      return;
    }

    const trimmedName = renameAssetName.trim();
    if (trimmedName.includes("/")) {
      toast({ title: "Name cannot include /", variant: "destructive" });
      return;
    }

    const isFolder = oldPath.endsWith("/");
    const oldParts = oldPath.split("/").filter(Boolean);
    const parentParts = oldParts.slice(0, -1);
    const previousName = oldParts[oldParts.length - 1] ?? "";

    let normalizedName = trimmedName;
    if (!isFolder) {
      const { extension: oldExtension } = splitBaseAndExtension(previousName);
      const { base: requestedBaseName } = splitBaseAndExtension(trimmedName);
      const baseName = requestedBaseName.trim();
      if (!baseName) {
        toast({ title: "Name cannot be empty", variant: "destructive" });
        return;
      }
      normalizedName = `${baseName}${oldExtension}`;
    } else if (!normalizedName.trim()) {
      toast({ title: "Name cannot be empty", variant: "destructive" });
      return;
    }

    const newPath = isFolder
      ? `${[...parentParts, normalizedName].join("/")}/`
      : [...parentParts, normalizedName].join("/");

    const filesKey = getListFilesQueryKey(projectId);
    const previousFiles = queryClient.getQueryData(filesKey) as FileEntry[] | undefined;

    queryClient.setQueryData(filesKey, (old: unknown) => {
      const items = (Array.isArray(old) ? old : []) as FileEntry[];
      if (isFolder) {
        return items.map((entry) => {
          if (!entry.path.startsWith(oldPath)) return entry;
          const nextPath = `${newPath}${entry.path.slice(oldPath.length)}`;
          return {
            ...entry,
            path: nextPath,
            name: nextPath.endsWith("/")
              ? (nextPath.split("/").filter(Boolean).pop() ?? entry.name)
              : (nextPath.split("/").pop() ?? entry.name),
          };
        });
      }

      return items.map((entry) => {
        if (entry.path !== oldPath) return entry;
        return {
          ...entry,
          path: newPath,
          name: newPath.split("/").pop() ?? entry.name,
        };
      });
    });

    setRenamingAssetPath(null);

    try {
      const response = await fetch(apiUrl(`/api/projects/${projectId}/assets/rename`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromPath: oldPath, toPath: normalizedName }),
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(response, "Rename failed");
        throw new Error(message);
      }
      toast({ title: "Asset renamed" });
    } catch (err) {
      queryClient.setQueryData(filesKey, previousFiles ?? []);
      toast({ title: getErrorMessage(err, "Error renaming asset"), variant: "destructive" });
    } finally {
      queryClient.invalidateQueries({ queryKey: filesKey });
    }
  };

  const handleDeleteRootFile = async (filePath: string) => {
    if (!projectId) return;
    if (!confirm(`Delete file \"${filePath}\"?`)) {
      return;
    }

    const filesKey = getListFilesQueryKey(projectId);
    const previousFiles = queryClient.getQueryData(filesKey) as unknown[] | undefined;
    const previousSelectedFile = selectedFile;
    const fallbackPath = rootFiles
      .filter((entry) => entry.path !== filePath)
      .sort((a, b) => {
        if (a.path === "main.md") return -1;
        if (b.path === "main.md") return 1;
        return a.path.localeCompare(b.path);
      })[0]?.path;

    queryClient.setQueryData(filesKey, (old: unknown) => {
      const items = (Array.isArray(old) ? old : []) as FileEntry[];
      return items.filter((entry) => entry.path !== filePath);
    });

    if (selectedFile === filePath) {
      if (fallbackPath) {
        onFileSelect(fallbackPath);
      } else {
        onProjectSelect(projectId);
      }
    }

    try {
      await deleteFile.mutateAsync({ projectId, filePath });
      toast({ title: "File deleted" });
    } catch (err) {
      queryClient.setQueryData(filesKey, previousFiles ?? []);
      if (previousSelectedFile) {
        onFileSelect(previousSelectedFile);
      }
      toast({ title: "Error deleting file", variant: "destructive" });
    } finally {
      queryClient.invalidateQueries({ queryKey: filesKey });
    }
  };

  const handleRenameRootFile = async (oldPath: string) => {
    if (!projectId || !renameFileName.trim()) {
      setRenamingFilePath(null);
      return;
    }

    const trimmedName = renameFileName.trim();
    if (trimmedName.includes("/")) {
      toast({ title: "Name cannot include /", variant: "destructive" });
      return;
    }

    const oldParts = oldPath.split("/").filter(Boolean);
    const parentParts = oldParts.slice(0, -1);
    const previousName = oldParts[oldParts.length - 1] ?? "";
    const { extension: previousExtension } = splitBaseAndExtension(previousName);
    const { base: requestedBaseName } = splitBaseAndExtension(trimmedName);
    const baseName = requestedBaseName.trim();
    if (!baseName) {
      toast({ title: "Name cannot be empty", variant: "destructive" });
      return;
    }

    const normalizedName = `${baseName}${previousExtension}`;
    const newPath = [...parentParts, normalizedName].join("/");

    if (!newPath || newPath === oldPath) {
      setRenamingFilePath(null);
      return;
    }

    const filesKey = getListFilesQueryKey(projectId);
    const previousFiles = queryClient.getQueryData(filesKey) as FileEntry[] | undefined;

    queryClient.setQueryData(filesKey, (old: unknown) => {
      const items = (Array.isArray(old) ? old : []) as FileEntry[];
      return items.map((entry) => {
        if (entry.path !== oldPath) return entry;
        return {
          ...entry,
          path: newPath,
          name: newPath.split("/").pop() ?? entry.name,
        };
      });
    });

    setRenamingFilePath(null);

    try {
      const response = await fetch(apiUrl(`/api/projects/${projectId}/files/rename`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromPath: oldPath, toPath: normalizedName }),
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(response, "Rename failed");
        throw new Error(message);
      }

      const payload = await response.json() as { path?: unknown };
      const resolvedPath = typeof payload.path === "string" && payload.path.trim().length > 0
        ? payload.path
        : newPath;

      if (resolvedPath !== newPath) {
        queryClient.setQueryData(filesKey, (old: unknown) => {
          const items = (Array.isArray(old) ? old : []) as FileEntry[];
          return items.map((entry) => {
            if (entry.path !== newPath) return entry;
            return {
              ...entry,
              path: resolvedPath,
              name: resolvedPath.split("/").pop() ?? entry.name,
            };
          });
        });
      }

      if (selectedFile === oldPath) {
        onFileSelect(resolvedPath);
      }

      toast({ title: "File renamed" });
    } catch (err) {
      queryClient.setQueryData(filesKey, previousFiles ?? []);
      toast({ title: getErrorMessage(err, "Error renaming file"), variant: "destructive" });
    } finally {
      queryClient.invalidateQueries({ queryKey: filesKey });
    }
  };

  const handleDeleteProject = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this project?")) return;

    const projectsKey = getListProjectsQueryKey();
    const previousProjects = queryClient.getQueryData(projectsKey) as unknown[] | undefined;

    queryClient.setQueryData(projectsKey, (old: unknown) => {
      const items = Array.isArray(old) ? old : [];
      return items.filter((item) => !(typeof item === "object" && item !== null && "id" in item && (item as { id: unknown }).id === id));
    });
    if (projectId === id) onProjectSelect(null);

    try {
      await deleteProject.mutateAsync({ projectId: id });
      toast({ title: "Project deleted" });
    } catch (err) {
      queryClient.setQueryData(projectsKey, previousProjects ?? []);
      toast({ title: "Error deleting project", variant: "destructive" });
    } finally {
      queryClient.invalidateQueries({ queryKey: projectsKey });
    }
  };

  const handleUpdateProject = async (id: number) => {
    if (!editProjectName.trim()) {
      setEditingProjectId(null);
      return;
    }

    const projectsKey = getListProjectsQueryKey();
    const previousProjects = queryClient.getQueryData(projectsKey) as unknown[] | undefined;
    const nextName = editProjectName.trim();

    queryClient.setQueryData(projectsKey, (old: unknown) => {
      const items = Array.isArray(old) ? old : [];
      return items.map((item) => {
        if (typeof item === "object" && item !== null && "id" in item && (item as { id: unknown }).id === id) {
          return { ...(item as object), name: nextName };
        }
        return item;
      });
    });

    try {
      await updateProject.mutateAsync({ projectId: id, data: { name: nextName } });
      setEditingProjectId(null);
    } catch (err) {
      queryClient.setQueryData(projectsKey, previousProjects ?? []);
      toast({ title: "Error renaming project", variant: "destructive" });
    } finally {
      queryClient.invalidateQueries({ queryKey: projectsKey });
    }
  };

  const extractFileNameFromDisposition = (headerValue: string | null) => {
    if (!headerValue) return null;
    const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match && utf8Match[1]) {
      return decodeURIComponent(utf8Match[1]);
    }

    const plainMatch = headerValue.match(/filename="?([^";]+)"?/i);
    return plainMatch?.[1] ?? null;
  };

  const handleSaveProject = async () => {
    if (!projectId) return;
    const startedAt = Date.now();
    setIsSavingProject(true);

    try {
      const response = await fetch(apiUrl(`/api/projects/${projectId}/export/project-bundle`), {
        method: "GET",
      });

      if (!response.ok) {
        throw new Error(`Save project failed: ${response.statusText}`);
      }

      const blob = await response.blob();
      const downloadName = extractFileNameFromDisposition(response.headers.get("content-disposition")) ?? `project-${projectId}.zip`;
      const desktop = await isDesktopRuntime();

      if (desktop) {
        const { invoke } = await import("@tauri-apps/api/core");
        const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
        const lastDot = downloadName.lastIndexOf(".");
        const baseName = lastDot > 0 ? downloadName.slice(0, lastDot) : downloadName;
        const extension = lastDot > 0 ? downloadName.slice(lastDot + 1) : "zip";

        await invoke<string>("save_export_to_downloads", {
          baseName,
          extension,
          bytes,
        });
        toast({ title: "Project saved to Downloads" });
        return;
      }

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = downloadName;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      toast({ title: "Project ZIP downloaded" });
    } catch {
      toast({ title: "Save project failed", variant: "destructive" });
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 600) {
        await new Promise((resolve) => window.setTimeout(resolve, 600 - elapsed));
      }
      setIsSavingProject(false);
    }
  };

  const renderSettingsFooter = () => (
    <div className="mt-auto border-t border-sidebar-border p-2">
      {projectId && (
        <Button
          variant="outline"
          size="sm"
          className="mb-2 w-full justify-start gap-3 border-primary bg-primary px-3 py-2 text-[13.5px] font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
          disabled={isSavingProject}
          onClick={() => void handleSaveProject()}
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary-foreground/20 text-primary-foreground">
            {isSavingProject ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
          </span>
          <span className="flex flex-col items-start leading-tight">
            <span className="text-sm font-semibold text-primary-foreground">{isSavingProject ? "Saving Project..." : "Save Project"}</span>
            <span className="text-[11px] text-primary-foreground/80">Download project ZIP</span>
          </span>
        </Button>
      )}
      <Dialog
        open={isSettingsOpen}
        onOpenChange={(open) => {
          setIsSettingsOpen(open);
          if (!open) setDraftPreferences(preferences);
        }}
      >
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-3 border-foreground bg-foreground px-3 py-2 text-[13.5px] font-semibold text-background shadow-sm transition-opacity hover:opacity-90 dark:border-primary dark:bg-primary dark:text-primary-foreground"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-background/20 text-background dark:text-primary-foreground">
              <Settings2 className="w-4 h-4" />
            </span>
            <span className="flex flex-col items-start leading-tight">
              <span className="text-sm font-semibold text-background dark:text-primary-foreground">Settings</span>
              <span className="text-[11px] text-background/80 dark:text-primary-foreground/80">Preview, Export</span>
            </span>
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Document & Editor Settings</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <label className="text-xs text-muted-foreground">Page Size (Preview/Export)</label>
              <Select
                value={draftPreferences.pageSize}
                onValueChange={(value) => setDraftPreferences({ ...draftPreferences, pageSize: value as AppPreferences["pageSize"] })}
              >
                <SelectTrigger><SelectValue placeholder="Select page size" /></SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <label className="text-xs text-muted-foreground">Document Font (Overleaf/Reports)</label>
              <Select
                value={draftPreferences.documentFont}
                onValueChange={(value) => setDraftPreferences({ ...draftPreferences, documentFont: value as AppPreferences["documentFont"] })}
              >
                <SelectTrigger><SelectValue placeholder="Select document font" /></SelectTrigger>
                <SelectContent>
                  {DOCUMENT_FONT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label} • {opt.group}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <label className="text-xs text-muted-foreground">Preview/Export Font Size (pt)</label>
                <Input
                  type="number"
                  min={9}
                  max={16}
                  value={draftPreferences.renderFontSizePt ?? 11}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isNaN(next)) return;
                    setDraftPreferences({ ...draftPreferences, renderFontSizePt: Math.min(16, Math.max(9, next)) });
                  }}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-xs text-muted-foreground">Preview/Export Line Stretch</label>
                <Input
                  type="number"
                  min={1}
                  max={1.6}
                  step={0.05}
                  value={draftPreferences.renderLineStretch ?? 1.1}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isNaN(next)) return;
                    setDraftPreferences({ ...draftPreferences, renderLineStretch: Math.min(1.6, Math.max(1, next)) });
                  }}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-xs text-muted-foreground">Editor Font Family</label>
              <Select
                value={draftPreferences.editorFontFamily}
                onValueChange={(value) => setDraftPreferences({ ...draftPreferences, editorFontFamily: value as AppPreferences["editorFontFamily"] })}
              >
                <SelectTrigger><SelectValue placeholder="Select editor font" /></SelectTrigger>
                <SelectContent>
                  {EDITOR_FONT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <label className="text-xs text-muted-foreground">Editor Font Size</label>
                <Input
                  type="number"
                  min={10}
                  max={28}
                  value={draftPreferences.editorFontSize}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isNaN(next)) return;
                    setDraftPreferences({ ...draftPreferences, editorFontSize: Math.min(28, Math.max(10, next) )});
                  }}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-xs text-muted-foreground">Line Height</label>
                <Input
                  type="number"
                  min={1.2}
                  max={2}
                  step={0.05}
                  value={draftPreferences.editorLineHeight}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isNaN(next)) return;
                    setDraftPreferences({ ...draftPreferences, editorLineHeight: Math.min(2, Math.max(1.2, next)) });
                  }}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setDraftPreferences(preferences);
                  setIsSettingsOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  onPreferencesChange({
                    ...draftPreferences,
                    renderFontSizePt: draftPreferences.renderFontSizePt ?? 11,
                    renderLineStretch: draftPreferences.renderLineStretch ?? 1.1,
                  });
                  setIsSettingsOpen(false);
                  toast({ title: "Settings Saved" });
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

  if (!projectId) {
    return (
      <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
        <div className="p-4 border-b border-sidebar-border font-medium flex items-center justify-between">
          <span className="flex items-center gap-2"><ProjectsIcon /> Projects</span>
          <div className="flex items-center gap-1">
            <Dialog open={isNewProjectOpen} onOpenChange={setIsNewProjectOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 transition-transform hover:scale-105"><AddActionIcon /></Button>
              </DialogTrigger>
              <DialogContent className="max-w-[360px] p-5">
                <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
                <div className="grid gap-3 py-2">
                  <Input
                    placeholder="Project Name"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleCreateProject();
                      }
                    }}
                  />
                  <Select value={newProjectTemplate} onValueChange={setNewProjectTemplate}>
                    <SelectTrigger><SelectValue placeholder="Select Template" /></SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={handleCreateProject}>Create</Button>
                </div>
              </DialogContent>
            </Dialog>
            <Button variant="ghost" size="icon" className="h-6 w-6 transition-transform hover:scale-105" onClick={onToggleCollapse} aria-label="Collapse sidebar">
              <PanelLeftClose className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {projects.map((p) => (
              <div
                key={p.id}
                className="group flex items-center justify-between p-2 rounded-md cursor-pointer text-sm transition-colors hover:bg-sidebar-accent/50"
                onClick={() => onProjectSelect(p.id)}
              >
                {editingProjectId === p.id ? (
                  <div className="flex items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
                    <Input
                      value={editProjectName}
                      onChange={(e) => setEditProjectName(e.target.value)}
                      className="h-6 py-0 px-1 text-xs"
                      autoFocus
                      onKeyDown={(e) => e.key === "Enter" && handleUpdateProject(p.id)}
                    />
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleUpdateProject(p.id)}><Check className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setEditingProjectId(null)}><X className="w-3 h-3" /></Button>
                  </div>
                ) : (
                  <>
                    <span className="flex items-center gap-2 truncate">
                      <FolderIcon color={colorFromName(p.name)} className="transition-transform group-hover:scale-110" />
                      <span className="truncate">{p.name}</span>
                    </span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-5 w-5 hover:bg-sidebar-accent" onClick={(e) => { e.stopPropagation(); setEditingProjectId(p.id); setEditProjectName(p.name); }}><Edit2 className="w-3 h-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-5 w-5 hover:bg-destructive hover:text-destructive-foreground" onClick={(e) => handleDeleteProject(p.id, e)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {projects.length === 0 && <div className="text-sm text-muted-foreground p-2 text-center">No projects yet</div>}
          </div>
        </ScrollArea>
        {renderSettingsFooter()}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      <div className="p-4 border-b border-sidebar-border font-medium flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onProjectSelect(null)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <FolderIcon color={colorFromName(selectedProject?.name ?? "project")} />
          <span className="truncate">{selectedProject?.name ?? "Project"}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 transition-transform hover:scale-105"
            onClick={() => {
              setInlineFileName(suggestedUntitledName);
              setIsCreatingFileInline(true);
            }}
            aria-label="Create new file"
          >
            <AddActionIcon />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 transition-transform hover:scale-105" onClick={onToggleCollapse} aria-label="Collapse sidebar">
            <PanelLeftClose className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          <div className="group flex items-center gap-2 p-2 rounded-md hover:bg-sidebar-accent/50 transition-colors text-sm">
            <button onClick={() => setIsAssetsExpanded((v) => !v)} className="flex items-center gap-2 flex-1 min-w-0">
              <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${isAssetsExpanded ? "" : "-rotate-90"}`} />
              <FolderIcon color="#f59e0b" />
              <span className="truncate">assets</span>
            </button>
            <Dialog open={isNewAssetFolderOpen} onOpenChange={setIsNewAssetFolderOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-5 w-5 transition-transform hover:scale-105" onClick={(e) => e.stopPropagation()}><AddActionIcon /></Button>
              </DialogTrigger>
              <DialogContent className="max-w-[360px] p-5">
                <DialogHeader><DialogTitle>New Asset Folder</DialogTitle></DialogHeader>
                <div className="grid gap-3 py-2">
                  <Input placeholder="Folder path (e.g. images/icons)" value={newAssetFolderName} onChange={(e) => setNewAssetFolderName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreateAssetFolder()} />
                  <Button onClick={handleCreateAssetFolder}>Create</Button>
                </div>
              </DialogContent>
            </Dialog>
            <Button variant="ghost" size="icon" className="h-5 w-5 transition-transform hover:scale-105" onClick={() => fileInputRef.current?.click()}>
              <Upload className="w-3 h-3" />
            </Button>
          </div>

          <input ref={fileInputRef} type="file" multiple accept="image/*,.svg,.pdf" onChange={handleAssetUpload} className="hidden" />

          {isAssetsExpanded && (
            <div className="pl-5 space-y-1">
              {assetChildren.map((entry) => (
                <div key={entry.path} className="group flex items-center gap-2 p-1.5 rounded-md hover:bg-sidebar-accent/50 text-xs">
                  {entry.type === "directory" ? (
                    <FolderIcon color="#f59e0b" size={14} className="transition-transform group-hover:scale-110" />
                  ) : (
                    <FileTypeIcon path={entry.path} type={entry.type} size={14} className="text-muted-foreground" />
                  )}
                  {renamingAssetPath === entry.path ? (
                    <>
                      <Input
                        className="h-6 text-xs"
                        value={renameAssetName}
                        onChange={(e) => setRenameAssetName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void handleRenameAsset(entry.path)}
                        autoFocus
                      />
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => void handleRenameAsset(entry.path)}><Check className="w-3 h-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setRenamingAssetPath(null)}><X className="w-3 h-3" /></Button>
                    </>
                  ) : (
                    <>
                      <span className="truncate flex-1">{entry.path.replace(/^assets\//, "")}</span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setRenamingAssetPath(entry.path); setRenameAssetName(entry.path.split("/").filter(Boolean).pop() ?? entry.name); }}><Edit2 className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-5 w-5 hover:bg-destructive hover:text-destructive-foreground" onClick={() => void handleDeleteAsset(entry.path)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {assetChildren.length === 0 && <div className="text-xs text-muted-foreground px-2 py-1">No assets yet</div>}
            </div>
          )}

          {isCreatingFileInline && (
            <div className="flex items-center gap-2 p-2 rounded-md bg-sidebar-accent/50 border border-sidebar-border">
              <MarkdownIcon />
              <Input
                ref={inlineFileInputRef}
                className="h-7 text-sm"
                value={inlineFileName}
                onChange={(e) => setInlineFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreateFile(inlineFileName);
                  if (e.key === "Escape") setIsCreatingFileInline(false);
                }}
                onBlur={() => {
                  if (inlineFileName.trim()) {
                    void handleCreateFile(inlineFileName);
                  } else {
                    setIsCreatingFileInline(false);
                  }
                }}
              />
            </div>
          )}

          {rootFiles.map((f) => (
            <div
              key={f.path}
              className={`group flex items-center gap-2 p-2 rounded-md cursor-pointer text-sm transition-colors ${selectedFile === f.path ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "hover:bg-sidebar-accent/50"}`}
              onClick={() => onFileSelect(f.path)}
            >
              {f.path.endsWith(".md") ? (
                <MarkdownIcon />
              ) : (
                <FileTypeIcon path={f.path} type={f.type} size={16} className="text-muted-foreground" />
              )}

              {renamingFilePath === f.path ? (
                <>
                  <Input
                    className="h-6 text-xs"
                    value={renameFileName}
                    onChange={(e) => setRenameFileName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") void handleRenameRootFile(f.path);
                      if (e.key === "Escape") setRenamingFilePath(null);
                    }}
                    autoFocus
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRenameRootFile(f.path);
                    }}
                  >
                    <Check className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingFilePath(null);
                    }}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="truncate flex-1">{f.name}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingFilePath(f.path);
                        setRenameFileName(f.path.split("/").pop() ?? f.name);
                      }}
                    >
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 hover:bg-destructive hover:text-destructive-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteRootFile(f.path);
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
      {renderSettingsFooter()}
    </div>
  );
}
