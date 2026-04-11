import { describe, expect, it } from "vitest";
import {
  getDeleteFileUrl,
  getGetFileContentUrl,
  getSaveFileContentUrl,
} from "./api";

describe("file route URL encoding", () => {
  it("encodes nested path for get-file-content", () => {
    expect(getGetFileContentUrl(7, "notes/chapter 1.md")).toBe(
      "/api/projects/7/files/notes%2Fchapter%201.md",
    );
  });

  it("encodes nested path for save-file-content", () => {
    expect(getSaveFileContentUrl(7, "notes/chapter 1.md")).toBe(
      "/api/projects/7/files/notes%2Fchapter%201.md",
    );
  });

  it("encodes nested path for delete-file", () => {
    expect(getDeleteFileUrl(7, "notes/chapter 1.md")).toBe(
      "/api/projects/7/files/notes%2Fchapter%201.md",
    );
  });
});
