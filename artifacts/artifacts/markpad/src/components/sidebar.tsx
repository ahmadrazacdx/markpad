import { useState } from "react";
import { Folder, File, Plus, Trash2, Edit2, Check, X, FileText, Settings, Archive } from "lucide-react";
import { useListProjects, useCreateProject, useDeleteProject, useUpdateProject, useListFiles, useCreateFile, useDeleteFile, useListTemplates, getListProjectsQueryKey, getListFilesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface SidebarProps {
  projectId: number | null;
  onProjectSelect: (id: number) => void;
  selectedFile: string | null;
  onFileSelect: (path: string) => void;
}

export function Sidebar({ projectId, onProjectSelect, selectedFile, onFileSelect }: SidebarProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: projects = [] } = useListProjects();
  const { data: files = [] } = useListFiles(projectId as number, { query: { enabled: !!projectId, queryKey: getListFilesQueryKey(projectId as number) } });
  const { data: templates = [] } = useListTemplates();

  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const updateProject = useUpdateProject();
  const createFile = useCreateFile();
  const deleteFile = useDeleteFile();

  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectTemplate, setNewProjectTemplate] = useState("plain");

  const [isNewFileOpen, setIsNewFileOpen] = useState(false);
  const [newFileName, setNewFileName] = useState("");

  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editProjectName, setEditProjectName] = useState("");

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      const proj = await createProject.mutateAsync({
        data: { name: newProjectName, template: newProjectTemplate as any }
      });
      setIsNewProjectOpen(false);
      setNewProjectName("");
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      onProjectSelect(proj.id);
      toast({ title: "Project created" });
    } catch (e) {
      toast({ title: "Error creating project", variant: "destructive" });
    }
  };

  const handleCreateFile = async () => {
    if (!projectId || !newFileName.trim()) return;
    try {
      const name = newFileName.endsWith(".md") ? newFileName : `${newFileName}.md`;
      await createFile.mutateAsync({
        projectId,
        data: { path: name, content: "# " + name.replace(".md", "") }
      });
      setIsNewFileOpen(false);
      setNewFileName("");
      queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
      onFileSelect(name);
      toast({ title: "File created" });
    } catch (e) {
      toast({ title: "Error creating file", variant: "destructive" });
    }
  };

  const handleDeleteProject = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this project?")) return;
    try {
      await deleteProject.mutateAsync({ projectId: id });
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      if (projectId === id) onProjectSelect(0);
      toast({ title: "Project deleted" });
    } catch (err) {
      toast({ title: "Error deleting project", variant: "destructive" });
    }
  };

  const handleUpdateProject = async (id: number) => {
    if (!editProjectName.trim()) {
      setEditingProjectId(null);
      return;
    }
    try {
      await updateProject.mutateAsync({ projectId: id, data: { name: editProjectName } });
      setEditingProjectId(null);
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    } catch (err) {
      toast({ title: "Error renaming project", variant: "destructive" });
    }
  };

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      <div className="p-4 border-b border-sidebar-border font-medium flex items-center justify-between">
        <span className="flex items-center gap-2"><Folder className="w-4 h-4 text-primary" /> Projects</span>
        <Dialog open={isNewProjectOpen} onOpenChange={setIsNewProjectOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6"><Plus className="w-4 h-4" /></Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-4">
              <Input placeholder="Project Name" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} />
              <Select value={newProjectTemplate} onValueChange={setNewProjectTemplate}>
                <SelectTrigger><SelectValue placeholder="Select Template" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="plain">Plain</SelectItem>
                  <SelectItem value="academic">Academic</SelectItem>
                  <SelectItem value="report">Report</SelectItem>
                  <SelectItem value="letter">Letter</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleCreateProject}>Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <ScrollArea className="flex-1 border-b border-sidebar-border">
        <div className="p-2 space-y-1">
          {projects.map((p) => (
            <div 
              key={p.id} 
              className={`group flex items-center justify-between p-2 rounded-md cursor-pointer text-sm transition-colors ${projectId === p.id ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "hover:bg-sidebar-accent/50"}`}
              onClick={() => onProjectSelect(p.id)}
            >
              {editingProjectId === p.id ? (
                <div className="flex items-center gap-1 w-full" onClick={e => e.stopPropagation()}>
                  <Input 
                    value={editProjectName} 
                    onChange={e => setEditProjectName(e.target.value)} 
                    className="h-6 py-0 px-1 text-xs" 
                    autoFocus 
                    onKeyDown={e => e.key === "Enter" && handleUpdateProject(p.id)}
                  />
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleUpdateProject(p.id)}><Check className="w-3 h-3" /></Button>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setEditingProjectId(null)}><X className="w-3 h-3" /></Button>
                </div>
              ) : (
                <>
                  <span className="truncate">{p.name}</span>
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

      {projectId && (
        <>
          <div className="p-4 border-b border-sidebar-border font-medium flex items-center justify-between">
            <span className="flex items-center gap-2"><FileText className="w-4 h-4 text-primary" /> Files</span>
            <Dialog open={isNewFileOpen} onOpenChange={setIsNewFileOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6"><Plus className="w-4 h-4" /></Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New File</DialogTitle></DialogHeader>
                <div className="grid gap-4 py-4">
                  <Input placeholder="File name (e.g. intro.md)" value={newFileName} onChange={(e) => setNewFileName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleCreateFile()} />
                  <Button onClick={handleCreateFile}>Create</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {files.map((f) => (
                <div 
                  key={f.path} 
                  className={`group flex items-center gap-2 p-2 rounded-md cursor-pointer text-sm transition-colors ${selectedFile === f.path ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "hover:bg-sidebar-accent/50"}`}
                  onClick={() => onFileSelect(f.path)}
                >
                  <File className="w-4 h-4 text-muted-foreground" />
                  <span className="truncate flex-1">{f.name}</span>
                </div>
              ))}
              {files.length === 0 && <div className="text-sm text-muted-foreground p-2 text-center">No files in project</div>}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}
