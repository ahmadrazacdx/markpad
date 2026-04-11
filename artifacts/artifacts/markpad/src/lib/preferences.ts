export type PageSize = "a4" | "letter" | "legal" | "a5";
export type DocumentFont =
  | "latin-modern"
  | "times-new-roman"
  | "palatino"
  | "helvetica"
  | "computer-modern";

export type EditorFontFamily = "space-mono" | "fira-code" | "source-code-pro" | "georgia";

export interface AppPreferences {
  pageSize: PageSize;
  documentFont: DocumentFont;
  renderFontSizePt: number;
  renderLineStretch: number;
  editorFontFamily: EditorFontFamily;
  editorFontSize: number;
  editorLineHeight: number;
}

export const defaultPreferences: AppPreferences = {
  pageSize: "a4",
  documentFont: "latin-modern",
  renderFontSizePt: 11,
  renderLineStretch: 1.1,
  editorFontFamily: "space-mono",
  editorFontSize: 14,
  editorLineHeight: 1.6,
};

export const PAGE_SIZE_OPTIONS: Array<{ value: PageSize; label: string }> = [
  { value: "a4", label: "A4" },
  { value: "letter", label: "US Letter" },
  { value: "legal", label: "US Legal" },
  { value: "a5", label: "A5" },
];

export const DOCUMENT_FONT_OPTIONS: Array<{ value: DocumentFont; label: string; group: string }> = [
  { value: "latin-modern", label: "Latin Modern", group: "Overleaf Standard" },
  { value: "computer-modern", label: "Computer Modern", group: "Overleaf Standard" },
  { value: "times-new-roman", label: "Times New Roman", group: "Office & Reports" },
  { value: "palatino", label: "Palatino", group: "Office & Reports" },
  { value: "helvetica", label: "Helvetica", group: "Office & Reports" },
];

export const EDITOR_FONT_OPTIONS: Array<{ value: EditorFontFamily; label: string }> = [
  { value: "space-mono", label: "Space Mono" },
  { value: "fira-code", label: "Fira Code" },
  { value: "source-code-pro", label: "Source Code Pro" },
  { value: "georgia", label: "Georgia" },
];

export function toEditorFontFamily(font: EditorFontFamily): string {
  switch (font) {
    case "fira-code":
      return "'Fira Code', var(--app-font-mono), monospace";
    case "source-code-pro":
      return "'Source Code Pro', var(--app-font-mono), monospace";
    case "georgia":
      return "Georgia, serif";
    case "space-mono":
    default:
      return "var(--app-font-mono), monospace";
  }
}
