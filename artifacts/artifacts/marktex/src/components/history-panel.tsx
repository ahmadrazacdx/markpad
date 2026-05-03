import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, Loader2, Pin, RotateCcw } from "lucide-react";
import { useGetHistory, usePinSnapshot, useRestoreSnapshot, getGetHistoryQueryKey, getGetFileContentQueryKey, Snapshot } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";

interface HistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number | null;
  selectedFile: string | null;
  onRestored?: (content: string, lastSavedAt: string) => void;
}

export function HistoryPanel({ open, onOpenChange, projectId, selectedFile, onRestored }: HistoryPanelProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [restoringSnapshotId, setRestoringSnapshotId] = useState<number | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const { data: history } = useGetHistory(
    projectId as number,
    { file: selectedFile as string },
    { query: { enabled: open && !!projectId && !!selectedFile, queryKey: getGetHistoryQueryKey(projectId as number, { file: selectedFile as string }) } }
  );

  const pinMutation = usePinSnapshot();
  const restoreMutation = useRestoreSnapshot();

  const orderedSnapshots = useMemo(() => {
    if (!history) return [] as Snapshot[];
    return [...history.pinned, ...history.today, ...history.yesterday, ...history.older].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [history]);

  const snapshotMeta = useMemo(() => {
    const meta = new Map<number, { versionNumber: number; deltaWords: number | null }>();
    orderedSnapshots.forEach((snap, index) => {
      const older = orderedSnapshots[index + 1];
      const deltaWords = older ? snap.wordCount - older.wordCount : null;
      meta.set(snap.id, { versionNumber: index + 1, deltaWords });
    });
    return meta;
  }, [orderedSnapshots]);

  const groupedByDay = useMemo(() => {
    const groups = new Map<string, Snapshot[]>();
    orderedSnapshots.forEach((snap) => {
      const dayKey = format(new Date(snap.createdAt), "yyyy-MM-dd");
      const existing = groups.get(dayKey) ?? [];
      existing.push(snap);
      groups.set(dayKey, existing);
    });

    return Array.from(groups.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([dayKey, snapshots]) => ({ dayKey, snapshots }));
  }, [orderedSnapshots]);

  useEffect(() => {
    if (!open) return;
    // Keep day groups collapsed by default for cleaner scan.
    setExpandedDays(new Set());
  }, [open]);

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
    setRestoringSnapshotId(id);
    try {
      const restored = await restoreMutation.mutateAsync({
        projectId: projectId as number,
        snapshotId: id,
      });

      onRestored?.(restored.content, restored.lastSavedAt);

      // Apply restored content immediately so the editor updates without waiting for refetch.
      queryClient.setQueryData(
        getGetFileContentQueryKey(projectId as number, selectedFile as string),
        restored,
      );

      queryClient.invalidateQueries({ queryKey: getGetHistoryQueryKey(projectId as number, { file: selectedFile as string }) });
      // Invalidate file content so it reloads from server
      queryClient.invalidateQueries({ queryKey: getGetFileContentQueryKey(projectId as number, selectedFile as string) });
      toast({ title: "Version restored" });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Failed to restore version", variant: "destructive" });
    } finally {
      setRestoringSnapshotId(null);
    }
  };

  const formatVersionTitle = (snap: Snapshot) => {
    if (snap.label?.trim()) return snap.label;
    const meta = snapshotMeta.get(snap.id);
    return `Version ${meta?.versionNumber ?? "-"}`;
  };

  const formatSnapshotMetaLine = (snap: Snapshot) => {
    const meta = snapshotMeta.get(snap.id);
    const distance = formatDistanceToNowStrict(new Date(snap.createdAt), { addSuffix: true });
    const delta = meta?.deltaWords;
    const deltaText = delta == null ? "baseline" : `${delta > 0 ? "+" : ""}${delta} words`;
    return `${distance} • ${snap.wordCount} words • ${deltaText}`;
  };

  const dayLabel = (dayKey: string) => {
    const date = new Date(`${dayKey}T00:00:00`);
    if (isToday(date)) return "Today";
    if (isYesterday(date)) return "Yesterday";
    return format(date, "EEEE");
  };

  const toggleDay = (dayKey: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
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
                <span className="font-medium">{formatVersionTitle(snap)}</span>
                <Badge variant="secondary">{format(new Date(snap.createdAt), "h:mm a")}</Badge>
              </div>
              <div className="text-muted-foreground text-xs mb-3">
                {formatSnapshotMetaLine(snap)}
              </div>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs flex-1 gap-1"
                  onClick={() => handleRestore(snap.id)}
                  disabled={restoringSnapshotId !== null}
                >
                  {restoringSnapshotId === snap.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  {restoringSnapshotId === snap.id ? "Restoring..." : "Restore"}
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
              {groupedByDay.map(({ dayKey, snapshots }) => {
                const isExpanded = expandedDays.has(dayKey);
                return (
                  <div key={dayKey} className="mb-4 rounded-lg border border-border bg-card/50">
                    <button
                      className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-accent/40 transition-colors"
                      onClick={() => toggleDay(dayKey)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
                        <span className="text-sm font-medium">{dayLabel(dayKey)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{format(new Date(`${dayKey}T00:00:00`), "MMM d, yyyy")}</span>
                        <Badge variant="secondary">{snapshots.length}</Badge>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3">
                        <div className="space-y-3">
                          {snapshots.map((snap) => (
                            <div key={snap.id} className="p-3 border border-border rounded-lg bg-card text-sm group hover:border-primary transition-colors">
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-medium">{formatVersionTitle(snap)}</span>
                                <Badge variant="secondary">{format(new Date(snap.createdAt), "h:mm a")}</Badge>
                              </div>
                              <div className="text-muted-foreground text-xs mb-3">
                                {formatSnapshotMetaLine(snap)}
                              </div>
                              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs flex-1 gap-1"
                                  onClick={() => handleRestore(snap.id)}
                                  disabled={restoringSnapshotId !== null}
                                >
                                  {restoringSnapshotId === snap.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                                  {restoringSnapshotId === snap.id ? "Restoring..." : "Restore"}
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
                    )}
                  </div>
                );
              })}
              
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
