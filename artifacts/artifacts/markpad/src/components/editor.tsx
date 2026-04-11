import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { useTheme } from "next-themes";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  disabled?: boolean;
}

export function Editor({ value, onChange, onSave, disabled }: EditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { theme, systemTheme } = useTheme();

  const isDark = theme === "dark" || (theme === "system" && systemTheme === "dark");

  useEffect(() => {
    if (!editorRef.current) return;

    const customKeymap = keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap,
      ...closeBracketsKeymap,
      {
        key: "Mod-s",
        run: () => {
          if (onSave) onSave();
          return true;
        },
      },
    ]);

    const extensions = [
      history(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      highlightSelectionMatches(),
      autocompletion(),
      closeBrackets(),
      customKeymap,
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString());
        }
      }),
      EditorView.theme({
        "&": { height: "100%", outline: "none" },
        ".cm-scroller": { fontFamily: "var(--app-font-mono)", fontSize: "14px" },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: isDark ? "#ffffff20" : "#00000020" },
      }),
      EditorState.readOnly.of(disabled || false),
    ];

    if (isDark) {
      extensions.push(oneDark);
    }

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // We intentionally don't re-run this when value changes, only update it below
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark, disabled]); // Re-init on theme/disabled change

  useEffect(() => {
    if (viewRef.current && viewRef.current.state.doc.toString() !== value) {
      viewRef.current.dispatch({
        changes: { from: 0, to: viewRef.current.state.doc.length, insert: value }
      });
    }
  }, [value]);

  return (
    <div className="h-full w-full overflow-hidden bg-background">
      <div ref={editorRef} className="h-full w-full outline-none border-none" />
    </div>
  );
}
