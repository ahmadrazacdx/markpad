import { FileDown, History, Moon, Sun, Save } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { exportProject, useGetProjectStats, getGetProjectStatsQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

interface TopBarProps {
  projectId: number | null;
  selectedFile: string | null;
  onSave: () => void;
  onOpenHistory: () => void;
}

export function TopBar({ projectId, selectedFile, onSave, onOpenHistory }: TopBarProps) {
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  
  const { data: stats } = useGetProjectStats(projectId as number, { 
    query: { enabled: !!projectId, queryKey: getGetProjectStatsQueryKey(projectId as number) } 
  });

  const handleExport = async (format: "pdf" | "md" | "latex") => {
    if (!projectId) return;
    try {
      const blob = await exportProject(projectId, { format, file: selectedFile ?? undefined });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${selectedFile?.replace(/\.md$/, "") || "markpad"}.${format === "latex" ? "tex" : format}`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      toast({ title: `Exported as ${format.toUpperCase()}` });
    } catch (err) {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0 shadow-sm z-10">
      <div className="flex items-center gap-4">
        <h1 className="font-bold text-lg tracking-tight text-primary flex items-center gap-2">
          <div className="w-6 h-6 bg-primary rounded-sm flex items-center justify-center">
            <span className="text-primary-foreground text-xs">MP</span>
          </div>
          MarkPad
        </h1>
        {stats && (
          <div className="hidden md:flex items-center gap-4 text-xs text-muted-foreground ml-4 border-l border-border pl-4">
            <span>{stats.totalFiles} files</span>
            <span>{stats.totalWords} words total</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button 
          variant="outline" 
          size="sm" 
          className="gap-2" 
          disabled={!projectId || !selectedFile}
          onClick={onSave}
        >
          <Save className="w-4 h-4" />
          <span className="hidden sm:inline">Save</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2" disabled={!projectId}>
              <FileDown className="w-4 h-4" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleExport("pdf")}>Export as PDF</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("md")}>Export as Markdown</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("latex")}>Export as LaTeX</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button 
          variant="outline" 
          size="sm" 
          className="gap-2" 
          disabled={!projectId || !selectedFile}
          onClick={onOpenHistory}
        >
          <History className="w-4 h-4" />
          <span className="hidden sm:inline">History</span>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </div>
    </header>
  );
}
