import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CANVAS_ORIGIN,
  DESIGN_SOURCE,
  RUNTIME_VENDOR,
  decideCanvasRequest,
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
