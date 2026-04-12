import { useEffect, useRef } from "react";
import { EditorState, Prec, type Range } from "@codemirror/state";
import { Decoration, EditorView, keymap, highlightActiveLine, highlightActiveLineGutter, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { useTheme } from "next-themes";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, startCompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { tags as t } from "@lezer/highlight";
import { EditorFontFamily, toEditorFontFamily } from "@/lib/preferences";

const latexCommandCompletions: Completion[] = [
  { label: "alpha", type: "keyword", apply: "\\alpha", detail: "Greek letter" },
  { label: "beta", type: "keyword", apply: "\\beta", detail: "Greek letter" },
  { label: "gamma", type: "keyword", apply: "\\gamma", detail: "Greek letter" },
  { label: "delta", type: "keyword", apply: "\\delta", detail: "Greek letter" },
  { label: "epsilon", type: "keyword", apply: "\\epsilon", detail: "Greek letter" },
  { label: "theta", type: "keyword", apply: "\\theta", detail: "Greek letter" },
  { label: "lambda", type: "keyword", apply: "\\lambda", detail: "Greek letter" },
  { label: "mu", type: "keyword", apply: "\\mu", detail: "Greek letter" },
  { label: "pi", type: "keyword", apply: "\\pi", detail: "Greek letter" },
  { label: "sigma", type: "keyword", apply: "\\sigma", detail: "Greek letter" },
  { label: "phi", type: "keyword", apply: "\\phi", detail: "Greek letter" },
  { label: "omega", type: "keyword", apply: "\\omega", detail: "Greek letter" },
  { label: "frac", type: "function", apply: "\\frac{}{}", detail: "Fraction" },
  { label: "sqrt", type: "function", apply: "\\sqrt{}", detail: "Square root" },
  { label: "sum", type: "function", apply: "\\sum", detail: "Summation" },
  { label: "int", type: "function", apply: "\\int", detail: "Integral" },
  { label: "lim", type: "function", apply: "\\lim", detail: "Limit" },
  { label: "log", type: "function", apply: "\\log", detail: "Logarithm" },
  { label: "sin", type: "function", apply: "\\sin", detail: "Sine" },
  { label: "cos", type: "function", apply: "\\cos", detail: "Cosine" },
  { label: "tan", type: "function", apply: "\\tan", detail: "Tangent" },
  { label: "textbf", type: "keyword", apply: "\\textbf{}", detail: "Bold text" },
  { label: "textit", type: "keyword", apply: "\\textit{}", detail: "Italic text" },
  { label: "emph", type: "keyword", apply: "\\emph{}", detail: "Emphasis" },
  { label: "underline", type: "keyword", apply: "\\underline{}", detail: "Underline" },
  { label: "begin", type: "keyword", apply: "\\begin{}", detail: "Begin environment" },
  { label: "end", type: "keyword", apply: "\\end{}", detail: "End environment" },
  { label: "left", type: "keyword", apply: "\\left(", detail: "Left delimiter" },
  { label: "right", type: "keyword", apply: "\\right)", detail: "Right delimiter" },
  { label: "cdot", type: "operator", apply: "\\cdot", detail: "Multiplication dot" },
  { label: "times", type: "operator", apply: "\\times", detail: "Multiplication sign" },
  { label: "leq", type: "operator", apply: "\\leq", detail: "Less than or equal" },
  { label: "geq", type: "operator", apply: "\\geq", detail: "Greater than or equal" },
  { label: "neq", type: "operator", apply: "\\neq", detail: "Not equal" },
];

const markdownSnippetCompletions: Completion[] = [
  { label: "Heading 1", type: "keyword", apply: "# ", detail: "Markdown heading" },
  { label: "Heading 2", type: "keyword", apply: "## ", detail: "Markdown heading" },
  { label: "Heading 3", type: "keyword", apply: "### ", detail: "Markdown heading" },
  { label: "Bullet list", type: "keyword", apply: "- ", detail: "Markdown list item" },
  { label: "Numbered list", type: "keyword", apply: "1. ", detail: "Markdown numbered item" },
  { label: "Task item", type: "keyword", apply: "- [ ] ", detail: "Markdown checkbox" },
  { label: "Blockquote", type: "keyword", apply: "> ", detail: "Markdown quote" },
  { label: "Code block", type: "keyword", apply: "```\n\n```", detail: "Markdown code block" },
  { label: "Link", type: "keyword", apply: "[title](url)", detail: "Markdown link" },
  { label: "Bold", type: "keyword", apply: "**text**", detail: "Bold text" },
  { label: "Italic", type: "keyword", apply: "*text*", detail: "Italic text" },
  { label: "Table", type: "keyword", apply: "| Column | Column |\n| --- | --- |\n|  |  |", detail: "Markdown table" },
  { label: "Horizontal rule", type: "keyword", apply: "---", detail: "Markdown separator" },
];

function latexCommandCompletionSource(context: CompletionContext) {
  const word = context.matchBefore(/\\[A-Za-z]*/);
  if (!word) return null;
  if (word.from === word.to && !context.explicit) return null;

  const query = word.text.slice(1).toLowerCase();
  const options = latexCommandCompletions.filter((completion) => completion.label.toLowerCase().startsWith(query));

  if (options.length === 0) return null;

  return {
    from: word.from,
    options,
    validFor: /^\\[A-Za-z]*$/,
  };
}

function markdownSnippetCompletionSource(context: CompletionContext) {
  const line = context.state.doc.lineAt(context.pos);
  const beforeCursor = context.state.sliceDoc(line.from, context.pos);
  const trimmed = beforeCursor.trim();

  const headingLevel = /^#{1,6}$/.test(trimmed);
  const listItem = /^[-*+]$/.test(trimmed);
  const taskItem = /^- \[[ xX]?\]$/.test(trimmed);
  const blockquote = /^>$/.test(trimmed);
  const codeFence = /^`{1,3}$/.test(trimmed);
  const linkStart = /^\[$/.test(trimmed);
  const tableStart = /^\|$/.test(trimmed);
  const plainLineStart = trimmed.length === 0;

  if (!context.explicit && !headingLevel && !listItem && !taskItem && !blockquote && !codeFence && !linkStart && !tableStart && !plainLineStart) {
    return null;
  }

  const options = headingLevel
    ? markdownSnippetCompletions.filter((completion) => completion.label.startsWith("Heading"))
    : taskItem
      ? markdownSnippetCompletions.filter((completion) => completion.label === "Task item")
      : listItem
        ? markdownSnippetCompletions.filter((completion) => completion.label === "Bullet list" || completion.label === "Numbered list")
        : blockquote
          ? markdownSnippetCompletions.filter((completion) => completion.label === "Blockquote")
          : codeFence
            ? markdownSnippetCompletions.filter((completion) => completion.label === "Code block")
            : linkStart
              ? markdownSnippetCompletions.filter((completion) => completion.label === "Link")
              : tableStart
                ? markdownSnippetCompletions.filter((completion) => completion.label === "Table")
                : markdownSnippetCompletions;

  return {
    from: line.from + beforeCursor.length - trimmed.length,
    options,
    validFor: /^(?:#{1,6}|[-*+]|- \[[ xX]?\]|>|`{1,3}|\[|\|)?$/,
  };
}

const frontmatterLineDecoration = Decoration.mark({ class: "cm-frontmatter-line" });
const frontmatterKeyDecoration = Decoration.mark({
  class: "cm-frontmatter-key",
  attributes: { style: "color:#dc2626 !important;font-weight:600;" },
});
const frontmatterValueDecoration = Decoration.mark({
  class: "cm-frontmatter-value",
  attributes: { style: "color:#16a34a !important;" },
});

function buildFrontmatterDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const firstLine = view.state.doc.line(1);
  if (firstLine.text.trim() !== "---") return Decoration.none;

  let inFrontmatter = true;
  for (let lineNumber = 2; lineNumber <= view.state.doc.lines; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    const trimmed = line.text.trim();

    if (trimmed === "---") {
      decorations.push(frontmatterLineDecoration.range(line.from, line.to));
      break;
    }

    decorations.push(frontmatterLineDecoration.range(line.from, line.to));

    if (!inFrontmatter || trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const colonIndex = line.text.indexOf(":");
    if (colonIndex <= 0) continue;

    const keyStart = line.from + line.text.search(/\S/);
    const keyEnd = line.from + colonIndex;
    const valueStart = line.from + colonIndex + 1;
    const valueText = line.text.slice(colonIndex + 1);
    const valueOffset = valueText.search(/\S/);

    if (keyEnd > keyStart) {
      decorations.push(frontmatterKeyDecoration.range(keyStart, keyEnd));
    }

    if (valueOffset >= 0) {
      decorations.push(frontmatterValueDecoration.range(valueStart + valueOffset, line.to));
    }
  }

  return decorations.length ? Decoration.set(decorations, true) : Decoration.none;
}

const frontmatterHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildFrontmatterDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildFrontmatterDecorations(update.view);
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
);

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave?: (content: string) => void;
  fontFamily?: EditorFontFamily;
  fontSize?: number;
  lineHeight?: number;
  disabled?: boolean;
}

export function Editor({ value, onChange, onSave, fontFamily = "space-mono", fontSize = 14, lineHeight = 1.6, disabled }: EditorProps) {
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
        run: (view) => {
          if (onSave) onSave(view.state.doc.toString());
          return true;
        },
      },
    ]);

    const extensions = [
      history(),
      EditorView.lineWrapping,
      highlightActiveLine(),
      highlightActiveLineGutter(),
      highlightSelectionMatches(),
      autocompletion({ override: [latexCommandCompletionSource, markdownSnippetCompletionSource], activateOnTyping: true }),
      closeBrackets(),
      EditorState.languageData.of(() => [{ closeBrackets: { brackets: ["$"] } }]),
      EditorView.inputHandler.of((view, from, to, text) => {
        if (text === "\\") {
          view.dispatch({
            changes: { from, to, insert: text },
          });
          window.requestAnimationFrame(() => startCompletion(view));
          return true;
        }

        return false;
      }),
      customKeymap,
      markdown({
        base: markdownLanguage,
      }),
      Prec.high(frontmatterHighlight),
      syntaxHighlighting(
        HighlightStyle.define([
          { tag: t.heading1, color: "#0078d4", fontWeight: "700" },
          { tag: t.heading2, color: "#0078d4", fontWeight: "700" },
          { tag: t.heading3, color: "#0078d4", fontWeight: "700" },
          { tag: t.heading4, color: "#0078d4", fontWeight: "700" },
          { tag: t.heading5, color: "#0078d4", fontWeight: "700" },
          { tag: t.heading6, color: "#0078d4", fontWeight: "700" },
          { tag: t.list, color: "#0078d4" },
          { tag: t.quote, color: "#0078d4" },
          { tag: t.link, color: "#0078d4" },
          { tag: t.url, color: "#0078d4" },
          { tag: t.emphasis, color: "#0078d4" },
          { tag: t.strong, color: "#0078d4", fontWeight: "700" },
          { tag: t.monospace, color: "#0078d4" },
          { tag: t.meta, color: "#0078d4" },
          { tag: t.keyword, color: "#0078d4" },
          { tag: t.operator, color: "#0078d4" },
          { tag: t.processingInstruction, color: "#0078d4" },
        ])
      ),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString());
          const typedByUser = update.transactions.some((transaction) => transaction.isUserEvent("input.type"));
          if (typedByUser) {
            const cursor = update.state.selection.main.head;
            const trigger = cursor > 0 ? update.state.sliceDoc(cursor - 1, cursor) : "";
            if (trigger === "\\" || trigger === "#" || trigger === "-" || trigger === ">" || trigger === "[" || trigger === "*" || trigger === "`") {
              window.setTimeout(() => startCompletion(update.view), 0);
            }
          }
        }
      }),
      EditorView.theme({
        "&": { height: "100%", outline: "none" },
        ".cm-scroller": {
          fontFamily: toEditorFontFamily(fontFamily),
          fontSize: `${fontSize}px`,
          lineHeight: String(lineHeight),
        },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: isDark ? "#ffffff20" : "#00000020" },
        ".cm-content": {
          color: isDark ? "#e5e7eb" : "#000000",
          maxWidth: "80ch",
          margin: "0 auto",
          padding: "0 1.5rem 2rem",
        },
        ".cm-line": { overflowWrap: "anywhere", wordBreak: "break-word" },
        ".cm-frontmatter-line": { color: "#64748b" },
        ".cm-frontmatter-key": { color: "#dc2626", fontWeight: "600" },
        ".cm-frontmatter-value": { color: "#16a34a" },
        ".cm-formatting": { color: "#0078d4", fontWeight: "700" },
        ".cm-formatting-header": { color: "#0078d4", fontWeight: "700" },
        ".cm-list": { color: "#0078d4" },
        ".cm-quote": { color: "#0078d4" },
        ".cm-strong": { color: "#0078d4", fontWeight: "700" },
        ".cm-emphasis": { color: "#0078d4" },
        ".cm-link": { color: "#0078d4" },
        ".cm-url": { color: "#0078d4" },
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
  }, [isDark, disabled, fontFamily, fontSize, lineHeight]); // Re-init on typography/theme/disabled change

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
