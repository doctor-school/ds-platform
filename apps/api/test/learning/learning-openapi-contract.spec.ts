import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 024 EARS-13, EARS-15, EARS-18, EARS-25 (#4011) — every learning route types
// its success response in the generated contract, so the website, the mobile
// app (EARS-25) and the admin read the same shape from `@ds/api-client`.

interface Operation {
  responses?: Record<
    string,
    { content?: Record<string, { schema?: unknown }> }
  >;
}

const snapshot = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "..",
      "packages",
      "api-client",
      "openapi.snapshot.json",
    ),
    "utf8",
  ),
) as { paths: Record<string, Record<string, Operation>> };

const LEARNING = /^\/v1\/(me\/|admin\/)?learning\//;

const operations = Object.entries(snapshot.paths)
  .filter(([path]) => LEARNING.test(path))
  .flatMap(([path, ops]) =>
    Object.entries(ops).map(([method, op]) => ({ path, method, op })),
  );

describe("024 learning contract", () => {
  it("EARS-25: the learning routes are in the generated contract", () => {
    expect(operations.length).toBe(29);
  });

  it("EARS-25: every learning route types its success response body", () => {
    const untyped = operations
      .filter(({ op }) => {
        const success = Object.entries(op.responses ?? {}).find(([code]) =>
          /^2\d\d$/.test(code),
        );
        return !success?.[1].content?.["application/json"]?.schema;
      })
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);
    expect(untyped).toEqual([]);
  });
});
