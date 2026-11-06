import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CANVAS_ORIGIN,
  DESIGN_SOURCE,
  RUNTIME_VENDOR,
  decideCanvasRequest,
  runtimeConsoleFailure,
} from "./canvas-runtime.js";

/** `sha384-<base64>` as `support.js` pins it for `<script integrity>`. */
const sri = (path: string) =>
  `sha384-${createHash("sha384").update(readFileSync(path)).digest("base64")}`;

describe("#3793 the runtime canvas page answers every request locally", () => {
  it("serves vendored canvases and the runtime from design-source/", () => {
    expect(decideCanvasRequest(`${CANVAS_ORIGIN}/ds-shell.dc.html`)).toEqual({
      kind: "file",
      path: join(DESIGN_SOURCE, "ds-shell.dc.html"),
    });
    expect(decideCanvasRequest(`${CANVAS_ORIGIN}/support.js`)).toEqual({
      kind: "file",
      path: join(DESIGN_SOURCE, "support.js"),
    });
  });

  it("answers a file the folder does not carry, or a path outside it, with a 404", () => {
    expect(
      decideCanvasRequest(`${CANVAS_ORIGIN}/assets/ds-logo-white.svg`),
    ).toEqual({
      kind: "missing",
    });
    expect(decideCanvasRequest(`${CANVAS_ORIGIN}/%2E%2E/package.json`)).toEqual(
      { kind: "missing" },
    );
    expect(decideCanvasRequest(`${CANVAS_ORIGIN}/`)).toEqual({
      kind: "missing",
    });
  });

  it("serves an explicit files entry (a DS bundle built from the repo) before the folder", () => {
    const bundle = join(DESIGN_SOURCE, "ds-shell.dc.html");
    expect(
      decideCanvasRequest(`${CANVAS_ORIGIN}/_ds/x/_ds_bundle.js`, {
        files: { "_ds/x/_ds_bundle.js": bundle },
      }),
    ).toEqual({ kind: "file", path: bundle });
  });

  it("#3798: answers the DS bundle a DS-bundle canvas loads with the bundle built from the repo", () => {
    expect(
      decideCanvasRequest(
        `${CANVAS_ORIGIN}/_ds/doctor-school-design-system-1366789c-9a05-4137-952e-61147c7a9550/_ds_bundle.js`,
      ),
    ).toEqual({ kind: "ds-bundle" });
    // Its stylesheet is not built: the structure read carries no styling.
    expect(
      decideCanvasRequest(
        `${CANVAS_ORIGIN}/_ds/doctor-school-design-system-1366789c-9a05-4137-952e-61147c7a9550/_ds_bundle.css`,
      ),
    ).toEqual({ kind: "missing" });
  });

  it("serves React/ReactDOM 18.3.1 from the npm aliases, matching the SRI support.js pins", () => {
    const runtime = readFileSync(join(DESIGN_SOURCE, "support.js"), "utf8");
    const urls = Object.keys(RUNTIME_VENDOR);
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      const decision = decideCanvasRequest(url);
      expect(decision.kind).toBe("vendor");
      const path = (decision as { path: string }).path;
      expect(runtime).toContain(url);
      expect(runtime).toContain(sri(path));
    }
  });

  it("aborts Google Fonts silently and reports every other external request", () => {
    expect(
      decideCanvasRequest("https://fonts.googleapis.com/css2?family=Inter"),
    ).toEqual({
      kind: "abort",
      report: false,
    });
    expect(
      decideCanvasRequest("https://fonts.gstatic.com/s/inter.woff2"),
    ).toEqual({
      kind: "abort",
      report: false,
    });
    expect(
      decideCanvasRequest(
        "https://unpkg.com/@babel/standalone@7.29.0/babel.min.js",
      ),
    ).toEqual({
      kind: "abort",
      report: true,
    });
    expect(
      decideCanvasRequest(
        "https://unpkg.com/react@19.0.0/umd/react.production.min.js",
      ),
    ).toEqual({
      kind: "abort",
      report: true,
    });
  });
});

describe("#3798 a runtime console failure fails the canvas load", () => {
  it("fails on a dc-import sibling the runtime could not fetch", () => {
    const text =
      "[dc-runtime] sibling fetch for <unit-missing/> failed: ./unit-missing.dc.html returned 404";
    expect(runtimeConsoleFailure("error", text)).toBe(text);
  });

  it("fails on every runtime error and on an x-import whose component never appeared", () => {
    expect(
      runtimeConsoleFailure(
        "error",
        "[dc-runtime] template compile FAILED for x",
      ),
    ).not.toBeNull();
    expect(
      runtimeConsoleFailure("error", "[dc] failed to load React or boot:"),
    ).not.toBeNull();
    expect(
      runtimeConsoleFailure(
        "warning",
        '[dc-runtime] x-import: global "DsDesignSystem.Card" never appeared on window after 5000ms',
      ),
    ).not.toBeNull();
  });

  it("does not fail on an unresolved {{ }} hole warning or on a page's own console output", () => {
    expect(
      runtimeConsoleFailure(
        "warning",
        "[dc-runtime] doctor-feed: unresolved {{ x }}",
      ),
    ).toBeNull();
    expect(
      runtimeConsoleFailure("error", "Failed to load resource: 404"),
    ).toBeNull();
    expect(runtimeConsoleFailure("log", "[dc-runtime] booted")).toBeNull();
  });
});
