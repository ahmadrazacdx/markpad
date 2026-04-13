import { describe, expect, it } from "vitest";
import {
  extractReferencedAssetPaths,
  getRenderEngineOrder,
  normalizeMarkdownForPdf,
  type RenderOptions,
} from "./renderer";

const defaultOptions: Required<RenderOptions> = {
  pageSize: "a4",
  documentFont: "latin-modern",
  fontSizePt: 11,
  lineStretch: 1.1,
};

describe("getRenderEngineOrder", () => {
  it("prefers typst for normal markdown", () => {
    expect(getRenderEngineOrder("# Hello", defaultOptions, false)).toEqual([
      "typst",
      "latex",
    ]);
  });

  it("prefers latex when markdown uses raw latex commands", () => {
    expect(
      getRenderEngineOrder("# Doc\\n\\n\\newpage\\n\\nNext", defaultOptions, false),
    ).toEqual(["latex", "typst"]);
  });

  it("falls back to typst when latex is unavailable", () => {
    expect(
      getRenderEngineOrder("# Doc\\n\\n\\newpage\\n\\nNext", defaultOptions, true),
    ).toEqual(["typst"]);
  });

  it("prefers latex for non-default document fonts", () => {
    expect(
      getRenderEngineOrder(
        "# Styled",
        { ...defaultOptions, documentFont: "palatino" },
        false,
      ),
    ).toEqual(["latex", "typst"]);
  });

  it("keeps typst first for markdown tables to preserve live-preview speed", () => {
    const markdown = [
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n");

    expect(getRenderEngineOrder(markdown, defaultOptions, false)).toEqual([
      "typst",
      "latex",
    ]);
  });

  it("keeps typst first for html blocks after html normalization", () => {
    const markdown = "<div><strong>Hello</strong></div>";
    expect(getRenderEngineOrder(markdown, defaultOptions, false)).toEqual([
      "typst",
      "latex",
    ]);
  });
});

describe("extractReferencedAssetPaths", () => {
  it("extracts markdown and html asset references", () => {
    const markdown = [
      "![Chart](assets/chart.png)",
      "![Diagram](./assets/diagram.svg \"Diagram\")",
      "<img src=\"assets/photo.webp\" alt=\"Photo\" />",
    ].join("\n");

    expect(extractReferencedAssetPaths(markdown)).toEqual([
      "assets/chart.png",
      "assets/diagram.svg",
      "assets/photo.webp",
    ]);
  });

  it("extracts raw typst image references and normalizes slashes", () => {
    const markdown = [
      "```{=typst}",
      "#box(image(\"assets\\\\i.png\"))",
      "#figure(image('assets/chart.png'))",
      "```",
    ].join("\n");

    expect(extractReferencedAssetPaths(markdown)).toEqual([
      "assets/i.png",
      "assets/chart.png",
    ]);
  });

  it("ignores non-asset references", () => {
    const markdown = [
      "![Remote](https://example.com/img.png)",
      "<img src=\"/images/logo.png\" />",
      "```{=typst}",
      "#image(\"cover.png\")",
      "```",
    ].join("\n");

    expect(extractReferencedAssetPaths(markdown)).toEqual([]);
  });
});

describe("normalizeMarkdownForPdf", () => {
  it("normalizes supported html blocks outside fences", () => {
    const markdown = [
      "<div><strong>Inline HTML block:</strong> works</div>",
      "<details>",
      "  <summary>More</summary>",
      "  <p>Nested content</p>",
      "</details>",
      "<img src=\"assets/chart.png\" alt=\"Chart\" width=\"20\" />",
    ].join("\n");

    const normalized = normalizeMarkdownForPdf(markdown);

    expect(normalized).toContain("**Inline HTML block:** works");
    expect(normalized).toContain("> **More**");
    expect(normalized).toContain("![Chart](assets/chart.png){width=20px}");
  });

  it("converts raw typst image fences to markdown image syntax", () => {
    const markdown = [
      "```{=typst}",
      "#figure(",
      "  image(\"assets/chart.png\"),",
      "  caption: [Typst image call should resolve from assets/]",
      ")",
      "```",
    ].join("\n");

    const normalized = normalizeMarkdownForPdf(markdown);
    expect(normalized).toContain("![Typst image call should resolve from assets/](assets/chart.png)");
  });

  it("keeps clearpage/newpage portable for both latex and typst outputs", () => {
    const markdown = [
      "Before",
      "\\clearpage",
      "After",
      "\\newpage",
      "Done",
    ].join("\n");

    const normalized = normalizeMarkdownForPdf(markdown);
    expect(normalized).toContain("```{=latex}\n\\clearpage\n```");
    expect(normalized).toContain("```{=latex}\n\\newpage\n```");
    expect(normalized).toContain("```{=typst}\n#pagebreak()\n```");
  });

  it("converts simple inline latex text commands to markdown", () => {
    const markdown = "Text with \\textbf{bold}, \\textit{italic}, and \\texttt{code}.";
    const normalized = normalizeMarkdownForPdf(markdown);
    expect(normalized).toContain("**bold**");
    expect(normalized).toContain("*italic*");
    expect(normalized).toContain("`code`");
  });

  it("does not mutate html inside fenced code blocks", () => {
    const markdown = [
      "```html",
      "<div><strong>Do not touch</strong></div>",
      "```",
    ].join("\n");

    const normalized = normalizeMarkdownForPdf(markdown);
    expect(normalized).toContain("<div><strong>Do not touch</strong></div>");
  });
});
