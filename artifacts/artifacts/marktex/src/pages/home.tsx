import { useEffect, useMemo, useState } from "react";
import { PanelLeftOpen } from "lucide-react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Sidebar } from "@/components/sidebar";
import { Editor } from "@/components/editor";
import { PDFPreview } from "@/components/pdf-preview";
import { TopBar } from "@/components/top-bar";
import { StatusBar } from "@/components/status-bar";
import { HistoryPanel } from "@/components/history-panel";
import { useGetFileContent, useSaveFileContent, getGetFileContentQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { AppPreferences, defaultPreferences } from "@/lib/preferences";
import { apiUrl } from "@/lib/runtime-api";

export default function Home() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [wordCount, setWordCount] = useState(0);
  const [renderStatus, setRenderStatus] = useState<"Rendering..." | "Ready" | "Error">("Ready");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [lastPersistedContent, setLastPersistedContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showSavedPopup, setShowSavedPopup] = useState(false);
  const [preferences, setPreferences] = useState<AppPreferences>(() => {
    if (typeof window === "undefined") return defaultPreferences;
    const raw = window.localStorage.getItem("marktex.preferences");
    if (!raw) return defaultPreferences;
    try {
      return { ...defaultPreferences, ...(JSON.parse(raw) as Partial<AppPreferences>) };
    } catch {
      return defaultPreferences;
    }
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: fileContent, isLoading: isLoadingFile } = useGetFileContent(
    projectId as number,
    selectedFile as string,
    { query: { enabled: !!projectId && !!selectedFile, queryKey: getGetFileContentQueryKey(projectId as number, selectedFile as string) } }
  );

  const saveFileMutation = useSaveFileContent();
  const isDirty = !!projectId && !!selectedFile && editorContent !== lastPersistedContent;

  const handleSave = async (contentToSave?: string, createCheckpoint = true) => {
    if (!projectId || !selectedFile) return;
    const content = contentToSave ?? editorContent;
    const previousPersisted = lastPersistedContent;
    const previousLastSaved = lastSaved;
    if (createCheckpoint) {
      setIsSaving(true);
    }

    // Optimistic feedback for a snappier checkpoint/autosave UX.
    setLastPersistedContent(content);
    setLastSaved(new Date().toLocaleTimeString());

    try {
      if (createCheckpoint) {
        await saveFileMutation.mutateAsync({
          projectId,
          filePath: selectedFile,
          data: { content },
        });
      } else {
        const response = await fetch(apiUrl(`/api/projects/${projectId}/files/${encodeURIComponent(selectedFile)}?checkpoint=false`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        if (!response.ok) {
          throw new Error("Autosave failed");
        }
      }

      queryClient.invalidateQueries({ queryKey: getGetFileContentQueryKey(projectId, selectedFile) });
      if (createCheckpoint) {
        setShowSavedPopup(true);
        window.setTimeout(() => setShowSavedPopup(false), 1600);
      }
    } catch (err) {
      setLastPersistedContent(previousPersisted);
      setLastSaved(previousLastSaved);
      toast({ title: "Failed to save file", variant: "destructive" });
    } finally {
      if (createCheckpoint) {
        setIsSaving(false);
      }
    }
  };

  const handleContentChange = (val: string) => {
    setEditorContent(val);
    setWordCount((val.match(/\S+/g) || []).length);
  };

  const handleFileSelect = (filePath: string) => {
    setSelectedFile(filePath);

    if (projectId) {
      const cached = queryClient.getQueryData<{ path: string; content: string }>(
        getGetFileContentQueryKey(projectId, filePath),
      );
      if (cached?.path === filePath) {
        setEditorContent(cached.content);
        setWordCount((cached.content.match(/\S+/g) || []).length);
        setLastPersistedContent(cached.content);
        return;
      }
    }

    if (fileContent?.path === filePath) {
      setEditorContent(fileContent.content);
      setWordCount((fileContent.content.match(/\S+/g) || []).length);
      setLastPersistedContent(fileContent.content);
    }
  };

  useEffect(() => {
    if (!selectedFile || !fileContent) return;
    if (fileContent.path === selectedFile) {
      setEditorContent(fileContent.content);
      setWordCount((fileContent.content.match(/\S+/g) || []).length);
      setLastPersistedContent(fileContent.content);
    }
  }, [fileContent, selectedFile]);

  useEffect(() => {
    if (!isDirty) return;

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  useEffect(() => {
    if (!projectId || !selectedFile) return;

    const intervalId = window.setInterval(() => {
      const hasPendingChanges = editorContent !== lastPersistedContent;
      if (!hasPendingChanges || isSaving) return;
      void handleSave(editorContent, false);
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [projectId, selectedFile, editorContent, lastPersistedContent, isSaving]);

  const previewContent = useMemo(() => {
    if (editorContent.trim().length > 0) return editorContent;
    if (fileContent?.path === selectedFile) return fileContent.content;
    return "";
  }, [editorContent, fileContent, selectedFile]);

  useEffect(() => {
    window.localStorage.setItem("marktex.preferences", JSON.stringify(preferences));
  }, [preferences]);

  return (
    <div className="flex flex-col h-screen max-h-screen w-full overflow-hidden bg-background text-foreground">
      <TopBar 
        projectId={projectId} 
        selectedFile={selectedFile} 
        content={editorContent}
        preferences={preferences}
        onSave={() => handleSave()} 
        onOpenHistory={() => setIsHistoryOpen(true)}
        isSaving={isSaving}
        showSavedToast={showSavedPopup}
      />

      <div className="flex-1 overflow-hidden">
        {isSidebarCollapsed && (
          <div className="absolute left-2 top-16 z-20">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsSidebarCollapsed(false)}
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </Button>
          </div>
        )}
        <ResizablePanelGroup direction="horizontal">
          {!isSidebarCollapsed && (
            <>
              <ResizablePanel defaultSize={20} minSize={15} maxSize={30} className="border-r border-border">
                <Sidebar 
                  onToggleCollapse={() => setIsSidebarCollapsed(true)}
                  projectId={projectId} 
                  preferences={preferences}
                  onPreferencesChange={setPreferences}
                  onProjectSelect={(id) => {
                    setProjectId(id);
                    setSelectedFile(null);
                    setEditorContent("");
                      setWordCount(0);
                    setLastPersistedContent("");
                  }} 
                  selectedFile={selectedFile}
                  onFileSelect={handleFileSelect}
                />
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          )}
          
          <ResizablePanel defaultSize={40}>
            {projectId && selectedFile ? (
              <Editor 
                value={editorContent}
                onChange={handleContentChange}
                onSave={(content) => handleSave(content, true)}
                fontFamily={preferences.editorFontFamily}
                fontSize={preferences.editorFontSize}
                lineHeight={preferences.editorLineHeight}
                disabled={isLoadingFile}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                {projectId ? "Select a file to edit" : "Select a project to begin"}
              </div>
            )}
          </ResizablePanel>

          <ResizableHandle withHandle />
          
          <ResizablePanel defaultSize={40}>
            <PDFPreview 
              projectId={projectId} 
              selectedFile={selectedFile}
              content={previewContent}
              preferences={preferences}
              onStatusChange={setRenderStatus} 
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <StatusBar 
        wordCount={wordCount}
        status={renderStatus} 
        lastSaved={lastSaved} 
      />

      <HistoryPanel 
        open={isHistoryOpen} 
        onOpenChange={setIsHistoryOpen} 
        projectId={projectId} 
        selectedFile={selectedFile}
        onRestored={(content, lastSavedAt) => {
          setEditorContent(content);
          setWordCount((content.match(/\S+/g) || []).length);
          setLastPersistedContent(content);
          setLastSaved(new Date(lastSavedAt).toLocaleTimeString());
        }}
      />
    </div>
  );
}
