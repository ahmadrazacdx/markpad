import { CheckCircle2, Loader2, Type } from "lucide-react";

interface StatusBarProps {
  wordCount: number;
  status: "Rendering..." | "Ready" | "Error";
  lastSaved: string | null;
}

export function StatusBar({ wordCount, status, lastSaved }: StatusBarProps) {
  return (
    <footer className="h-8 border-t border-border bg-card flex items-center justify-between px-4 shrink-0 text-xs text-muted-foreground z-10">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Type className="w-3.5 h-3.5" />
          {wordCount} words
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        {lastSaved && (
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            Saved at {lastSaved}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {status === "Rendering..." ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : status === "Ready" ? (
            <div className="w-2 h-2 rounded-full bg-green-500" />
          ) : (
            <div className="w-2 h-2 rounded-full bg-destructive" />
          )}
          {status}
        </div>
      </div>
    </footer>
  );
}
