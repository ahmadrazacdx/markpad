import { describe, expect, it } from "vitest";
import { getRenderEngineOrder, type RenderOptions } from "./renderer";

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
});
