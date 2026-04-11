import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pin, RotateCcw } from "lucide-react";
import { useGetHistory, usePinSnapshot, useRestoreSnapshot, getGetHistoryQueryKey, Snapshot } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface HistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number | null;
  selectedFile: string | null;
}

export function HistoryPanel({ open, onOpenChange, projectId, selectedFile }: HistoryPanelProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: history } = useGetHistory(
    projectId as number,
    { file: selectedFile as string },
    { query: { enabled: open && !!projectId && !!selectedFile, queryKey: getGetHistoryQueryKey(projectId as number, { file: selectedFile as string }) } }
  );

  const pinMutation = usePinSnapshot();
  const restoreMutation = useRestoreSnapshot();

  const handlePin = async (id: number) => {
    const label = prompt("Enter a label for this version:");
    if (!label) return;
    try {
      await pinMutation.mutateAsync({
        projectId: projectId as number,
        snapshotId: id,
        data: { label },
      });
      queryClient.invalidateQueries({ queryKey: getGetHistoryQueryKey(projectId as number, { file: selectedFile as string }) });
      toast({ title: "Version pinned" });
    } catch (err) {
      toast({ title: "Failed to pin version", variant: "destructive" });
    }
  };

  const handleRestore = async (id: number) => {
    if (!confirm("Are you sure you want to restore this version? Current unsaved changes will be lost.")) return;
    try {
      await restoreMutation.mutateAsync({
        projectId: projectId as number,
        snapshotId: id,
      });
      queryClient.invalidateQueries({ queryKey: getGetHistoryQueryKey(projectId as number, { file: selectedFile as string }) });
      toast({ title: "Version restored" });
      onOpenChange(false);
      // Invalidate file content
    } catch (err) {
      toast({ title: "Failed to restore version", variant: "destructive" });
    }
  };

  const renderSnapshotList = (snapshots: Snapshot[], title: string) => {
    if (!snapshots || snapshots.length === 0) return null;
    
    return (
      <div className="mb-6">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{title}</h4>
        <div className="space-y-3">
          {snapshots.map(snap => (
            <div key={snap.id} className="p-3 border border-border rounded-lg bg-card text-sm group hover:border-primary transition-colors">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">{format(new Date(snap.createdAt), "h:mm a")}</span>
                {snap.label && <Badge variant="secondary">{snap.label}</Badge>}
              </div>
              <div className="text-muted-foreground text-xs mb-3">
                {snap.wordCount} words
              </div>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="outline" size="sm" className="h-7 text-xs flex-1 gap-1" onClick={() => handleRestore(snap.id)}>
                  <RotateCcw className="w-3 h-3" /> Restore
                </Button>
                {!snap.label && (
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => handlePin(snap.id)}>
                    <Pin className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[300px] sm:w-[400px] flex flex-col p-0 border-l border-border">
        <SheetHeader className="p-6 border-b border-border text-left">
          <SheetTitle>Version History</SheetTitle>
        </SheetHeader>
        <ScrollArea className="flex-1 p-6">
          {history ? (
            <>
              {renderSnapshotList(history.pinned, "Pinned")}
              {renderSnapshotList(history.today, "Today")}
              {renderSnapshotList(history.yesterday, "Yesterday")}
              {renderSnapshotList(history.older, "Older")}
              
              {(!history.pinned?.length && !history.today?.length && !history.yesterday?.length && !history.older?.length) && (
                <div className="text-center text-muted-foreground py-8">
                  No history available yet. Save your document to create a version.
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              Loading history...
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
