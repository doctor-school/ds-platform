import { renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useViewerZone } from "./use-viewer-zone";

/**
 * 004 EARS-12 as amended (004-design §6.1 «Viewer zone») — the server render
 * and the first client render agree on Moscow; only after mount does the hook
 * swap in the browser's resolved IANA zone.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

function resolveZoneAs(timeZone: string) {
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    ...resolved,
    timeZone,
  });
}

function Probe() {
  return createElement("span", null, useViewerZone());
}

describe("useViewerZone (004 EARS-12)", () => {
  it("004 EARS-12: the server render reads Europe/Moscow whatever the resolved zone", () => {
    resolveZoneAs("Asia/Yekaterinburg");
    expect(renderToString(createElement(Probe))).toBe(
      "<span>Europe/Moscow</span>",
    );
  });

  it("004 EARS-12: the first client render reads Moscow, the resolved zone after mount", () => {
    resolveZoneAs("Asia/Yekaterinburg");
    const renders: string[] = [];
    const { result } = renderHook(() => {
      const zone = useViewerZone();
      renders.push(zone);
      return zone;
    });
    expect(renders[0]).toBe("Europe/Moscow");
    expect(result.current).toBe("Asia/Yekaterinburg");
  });
});
