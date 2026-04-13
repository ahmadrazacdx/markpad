import { describe, expect, it } from "vitest";
import { isAbortLikeError, resolveWebSocketPreviewConfig } from "./websocket";

describe("resolveWebSocketPreviewConfig", () => {
  it("uses safe defaults", () => {
    const config = resolveWebSocketPreviewConfig({} as NodeJS.ProcessEnv);
    expect(config).toEqual({
      debounceMs: 70,
      cancelInFlight: true,
      metricsEnabled: false,
    });
  });

  it("parses and clamps debounce", () => {
    expect(resolveWebSocketPreviewConfig({ MARKPAD_PREVIEW_WS_DEBOUNCE_MS: "95" } as NodeJS.ProcessEnv).debounceMs).toBe(95);
    expect(resolveWebSocketPreviewConfig({ MARKPAD_PREVIEW_WS_DEBOUNCE_MS: "-12" } as NodeJS.ProcessEnv).debounceMs).toBe(0);
    expect(resolveWebSocketPreviewConfig({ MARKPAD_PREVIEW_WS_DEBOUNCE_MS: "9999" } as NodeJS.ProcessEnv).debounceMs).toBe(500);
    expect(resolveWebSocketPreviewConfig({ MARKPAD_PREVIEW_WS_DEBOUNCE_MS: "abc" } as NodeJS.ProcessEnv).debounceMs).toBe(70);
  });

  it("supports cancellation and metrics flags", () => {
    const config = resolveWebSocketPreviewConfig({
      MARKPAD_PREVIEW_CANCEL_INFLIGHT: "0",
      MARKPAD_PREVIEW_METRICS: "1",
    } as NodeJS.ProcessEnv);

    expect(config.cancelInFlight).toBe(false);
    expect(config.metricsEnabled).toBe(true);
  });
});

describe("isAbortLikeError", () => {
  it("detects AbortError-like values", () => {
    const byName = new Error("stopped") as Error & { name: string };
    byName.name = "AbortError";
    expect(isAbortLikeError(byName)).toBe(true);

    const byCode = new Error("stopped") as Error & { code?: string };
    byCode.code = "ABORT_ERR";
    expect(isAbortLikeError(byCode)).toBe(true);

    expect(isAbortLikeError(new Error("render aborted by newer request"))).toBe(true);
  });

  it("ignores non-abort errors", () => {
    expect(isAbortLikeError(new Error("pandoc failed"))).toBe(false);
    expect(isAbortLikeError({ message: "oops" })).toBe(false);
  });
});
