import { applyFixes } from "markdownlint";
import { lint as lintSync } from "markdownlint/sync";

const LINT_CONFIG = {
  default: false,
  MD009: true,
  MD012: true,
  MD018: true,
  MD019: true,
  MD022: true,
  MD030: true,
  MD032: true,
  MD047: true
};

type LintEntry = {
  ruleNames?: string[];
  lineNumber?: number;
  errorDetail?: string;
};

function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function lintEntries(content: string): LintEntry[] {
  const raw = lintSync({
    strings: { document: content },
    config: LINT_CONFIG
  }) as Record<string, LintEntry[]>;

  return raw.document ?? [];
}

function toIssueList(entries: LintEntry[]): string[] {
  return entries.map((entry) => {
    const name = entry.ruleNames?.[0] ?? "MD000";
    const lineNumber = entry.lineNumber ?? 0;
    const detail = entry.errorDetail ? ` (${entry.errorDetail})` : "";
    return `${name} at line ${lineNumber}${detail}`;
  });
}

export function lintAndFixMarkdown(input: string): {
  fixed: string;
  issues: string[];
  initialIssueCount: number;
  finalIssueCount: number;
  autoFixPasses: number;
} {
  const normalized = ensureTrailingNewline(normalizeLineEndings(input));
  const firstPass = lintEntries(normalized);
  const initialIssueCount = firstPass.length;

  if (firstPass.length === 0) {
    return {
      fixed: normalized,
      issues: [],
      initialIssueCount: 0,
      finalIssueCount: 0,
      autoFixPasses: 0
    };
  }

  let current = normalized;
  let autoFixPasses = 0;

  for (let i = 0; i < 6; i += 1) {
    const issues = lintEntries(current);
    if (issues.length === 0) {
      break;
    }

    const next = ensureTrailingNewline(applyFixes(current, issues as any[]));
    autoFixPasses += 1;

    if (next === current) {
      break;
    }

    current = next;
  }

  const finalPass = lintEntries(current);
  return {
    fixed: current,
    issues: toIssueList(finalPass),
    initialIssueCount,
    finalIssueCount: finalPass.length,
    autoFixPasses
  };
}
