import { Check, FileDown, History, Loader2, Moon, Save, Sun } from "lucide-react";
import { useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useGetProjectStats, getGetProjectStatsQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { AppPreferences } from "@/lib/preferences";
import { apiUrl } from "@/lib/runtime-api";

async function isDesktopRuntime() {
  try {
    const { isTauri } = await import("@tauri-apps/api/core");
    return isTauri();
  } catch {
    return false;
  }
}

interface TopBarProps {
  projectId: number | null;
  selectedFile: string | null;
  content: string;
  preferences: AppPreferences;
  onSave: () => void;
  onOpenHistory: () => void;
  isSaving?: boolean;
  showSavedToast?: boolean;
}

export function TopBar({ projectId, selectedFile, content, preferences, onSave, onOpenHistory, isSaving = false, showSavedToast = false }: TopBarProps) {
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);

  const handleToggleTheme = () => {
    const root = document.documentElement;
    root.classList.add("theme-animate");
    setTheme(theme === "dark" ? "light" : "dark");
    window.setTimeout(() => root.classList.remove("theme-animate"), 180);
  };
  
  const { data: stats } = useGetProjectStats(projectId as number, { 
    query: { enabled: !!projectId, queryKey: getGetProjectStatsQueryKey(projectId as number) } 
  });

  const handleExport = async (format: "pdf" | "md" | "latex") => {
    if (!projectId) return;
    const startedAt = Date.now();
    setIsExporting(true);
    try {
      const baseName = selectedFile?.replace(/\.md$/, "") || "markpad";

      if (format === "md") {
        const desktop = await isDesktopRuntime();
        if (desktop) {
          const { invoke } = await import("@tauri-apps/api/core");
          const bytes = Array.from(new TextEncoder().encode(content));
          await invoke<string>("save_export_to_downloads", {
            baseName,
            extension: "md",
            bytes,
          });
          toast({ title: "Saved to Downloads" });
          return;
        }

        const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = `${baseName}.md`;
        anchor.click();
        URL.revokeObjectURL(objectUrl);
        toast({ title: "Exported as Markdown" });
        return;
      }

      const endpoint = format === "pdf"
        ? `/api/projects/${projectId}/render`
        : `/api/projects/${projectId}/export/latex`;

      const response = await fetch(apiUrl(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          options: {
            pageSize: preferences.pageSize,
            documentFont: preferences.documentFont,
              fontSizePt: preferences.renderFontSizePt,
              lineStretch: preferences.renderLineStretch,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Export failed: ${response.statusText}`);
      }

      const blob = await response.blob();
      const extension = format === "latex" ? "tex" : "pdf";
      const desktop = await isDesktopRuntime();

      if (desktop) {
        const { invoke } = await import("@tauri-apps/api/core");
        const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
        await invoke<string>("save_export_to_downloads", {
          baseName,
          extension,
          bytes,
        });
        toast({ title: "Saved to Downloads" });
        return;
      }

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${baseName}.${extension}`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      toast({ title: `Exported as ${format.toUpperCase()}` });
    } catch (err) {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 600) {
        await new Promise((resolve) => window.setTimeout(resolve, 600 - elapsed));
      }
      setIsExporting(false);
    }
  };

  return (
    <header className="relative h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0 shadow-sm z-10">
      <div className="flex items-center gap-4 min-w-0">
        <h1 className="font-bold text-lg tracking-tight text-primary flex items-center gap-2">
          <img src="/markpad_logo.svg" alt="MarkPad logo" className="h-6 w-6 shrink-0" />
          MarkPad
        </h1>
        {stats && (
          <div className="hidden md:flex items-center gap-4 text-xs text-muted-foreground ml-4 border-l border-border pl-4">
            <span>{stats.totalFiles} files</span>
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:flex md:flex-col md:items-center md:gap-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-muted-foreground/70">Markdown + LaTeX</span>
        <span className="text-xs text-muted-foreground">Markdown-first Writing, LaTeX-Ready Publishing</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <Button 
            variant="outline" 
            size="sm" 
            className="gap-2 border-primary bg-primary text-primary-foreground hover:opacity-90 transition-all duration-150 hover:scale-[1.02] active:scale-[0.99] shadow-sm text-[13.5px] font-semibold" 
            disabled={!projectId || !selectedFile || isSaving || isExporting}
            onClick={onSave}
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span className="hidden sm:inline">{isSaving ? "Saving..." : "Save"}</span>
          </Button>
          {showSavedToast && (
            <div className="absolute left-1/2 top-full mt-1 -translate-x-1/2 rounded-md bg-green-600 px-2 py-1 text-[11px] font-medium text-white shadow-sm">
              <span className="inline-flex items-center gap-1">
                <Check className="h-3 w-3" />
                Saved
              </span>
            </div>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-primary bg-primary text-primary-foreground hover:opacity-90 transition-all duration-150 hover:scale-[1.02] active:scale-[0.99] shadow-sm text-[13.5px] font-semibold"
              disabled={!projectId || !selectedFile || isExporting}
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
              <span className="hidden sm:inline">{isExporting ? "Exporting..." : "Export"}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void handleExport("pdf")}>Export as PDF</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handleExport("md")}>Export as Markdown</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handleExport("latex")}>Export as LaTeX</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button 
          variant="outline" 
          size="sm" 
          className="gap-2 border-primary bg-primary text-primary-foreground hover:opacity-90 transition-all duration-150 hover:scale-[1.02] active:scale-[0.99] shadow-sm text-[13.5px] font-semibold" 
          disabled={!projectId || !selectedFile}
          onClick={onOpenHistory}
        >
          <History className="w-4 h-4" />
          <span className="hidden sm:inline">History</span>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="relative transition-all duration-150 hover:scale-110 active:scale-95 hover:bg-accent/50"
          onClick={handleToggleTheme}
        >
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all duration-200 dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all duration-200 dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </div>
    </header>
  );
}
