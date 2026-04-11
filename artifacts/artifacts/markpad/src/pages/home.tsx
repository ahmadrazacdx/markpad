import { useState } from "react";
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

export default function Home() {
  const [projectId, setProjectId] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [renderStatus, setRenderStatus] = useState<"Rendering..." | "Ready" | "Error">("Ready");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: fileContent, isLoading: isLoadingFile } = useGetFileContent(
    projectId as number,
    selectedFile as string,
    { query: { enabled: !!projectId && !!selectedFile, queryKey: getGetFileContentQueryKey(projectId as number, selectedFile as string) } }
  );

  const saveFileMutation = useSaveFileContent();

  const handleSave = async (contentToSave?: string) => {
    if (!projectId || !selectedFile) return;
    const content = contentToSave ?? editorContent;
    try {
      await saveFileMutation.mutateAsync({
        projectId,
        filePath: selectedFile,
        data: { content },
      });
      setLastSaved(new Date().toLocaleTimeString());
      queryClient.invalidateQueries({ queryKey: getGetFileContentQueryKey(projectId, selectedFile) });
    } catch (err) {
      toast({ title: "Failed to save file", variant: "destructive" });
    }
  };

  const handleContentChange = (val: string) => {
    setEditorContent(val);
  };

  const handleFileSelect = (filePath: string) => {
    setSelectedFile(filePath);
    if (fileContent?.path === filePath) {
      setEditorContent(fileContent.content);
    }
  };

  return (
    <div className="flex flex-col h-screen max-h-screen w-full overflow-hidden bg-background text-foreground">
      <TopBar 
        projectId={projectId} 
        selectedFile={selectedFile} 
        onSave={() => handleSave()} 
        onOpenHistory={() => setIsHistoryOpen(true)} 
      />

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={20} minSize={15} maxSize={30} className="border-r border-border">
            <Sidebar 
              projectId={projectId} 
              onProjectSelect={(id) => {
                setProjectId(id);
                setSelectedFile(null);
                setEditorContent("");
              }} 
              selectedFile={selectedFile}
              onFileSelect={handleFileSelect}
            />
          </ResizablePanel>
          
          <ResizableHandle withHandle />
          
          <ResizablePanel defaultSize={40}>
            {projectId && selectedFile ? (
              <Editor 
                value={editorContent || fileContent?.content || ""} 
                onChange={handleContentChange}
                onSave={() => handleSave()}
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
              content={editorContent} 
              onStatusChange={setRenderStatus} 
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <StatusBar 
        wordCount={editorContent.split(/\s+/).filter(Boolean).length} 
        status={renderStatus} 
        lastSaved={lastSaved} 
      />

      <HistoryPanel 
        open={isHistoryOpen} 
        onOpenChange={setIsHistoryOpen} 
        projectId={projectId} 
        selectedFile={selectedFile} 
      />
    </div>
  );
}
