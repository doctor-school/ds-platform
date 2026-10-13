import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = vi.hoisted(() => vi.fn());
vi.mock("execa", () => ({ execa: cli }));
import { ghViewJson } from "../lib/gh";
import { normalizeTierFiles, resolveTier } from "../lib/change-tier";
import { runGuard } from "./run-guard";

const HEAD = "d".repeat(40);
const UI = "packages/design-system/src/primitives/fields/password-field.tsx";
const files = Array.from({ length: 354 }, (_, index) => ({
  filename: index === 353 ? UI : `.github/ui-evidence/2905/${index}.png`,
  status: "modified",
  additions: 1,
  deletions: 1,
}));
const pages = (rows: unknown[]) =>
  Array.from({ length: Math.ceil(rows.length / 100) }, (_, index) =>
    rows.slice(index * 100, (index + 1) * 100),
  );
const metadata = () => ({
  number: 2905,
  body: "Change-tier: ask — approved password field correction",
  headRefOid: HEAD,
  changedFiles: files.length,
  files: files.slice(0, 100).map(({ filename }) => ({ path: filename })),
});
const roots: string[] = [];
afterAll(() =>
  roots.forEach((root) => rmSync(root, { recursive: true, force: true })),
);

beforeEach(() => {
  cli.mockReset();
  vi.unstubAllEnvs();
  vi.stubEnv("LINT_GH_FIXTURE_DIR", undefined);
  vi.stubEnv("PR_BODY", undefined);
  vi.stubEnv("PR_NUMBER", "2905");
});

function responses(
  before: Record<string, unknown> = metadata(),
  listing: unknown = pages(files),
  after: Record<string, unknown> = { headRefOid: HEAD },
  failure?: "before" | "pages" | "after",
) {
  let views = 0;
  cli.mockImplementation(async (_binary: string, args: string[]) => {
    const phase =
      args[0] === "api" ? "pages" : views++ === 0 ? "before" : "after";
    if (phase === failure) throw new Error(`native GitHub ${phase} failure`);
    return {
      stdout: JSON.stringify(
        phase === "pages" ? listing : phase === "before" ? before : after,
      ),
    };
  });
}

const read = () =>
  ghViewJson<Record<string, unknown>>(
    "pr",
    2905,
    "number,body,files",
    "/owned/repo",
  );

describe("#2905 complete PR file retrieval", () => {
  it("reads all354 files rather than the first100 before a path exemption", async () => {
    responses();
    const result = await read();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.files).toHaveLength(354);
    expect(result.data.files).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: UI })]),
    );
    expect(cli.mock.calls[0][1][4]).toContain("changedFiles");
    expect(cli.mock.calls[0][1][4]).toContain("headRefOid");
    expect(cli.mock.calls[1][1]).toEqual([
      "api",
      "repos/{owner}/{repo}/pulls/2905/files?per_page=100",
      "--paginate",
      "--slurp",
    ]);
    expect(cli.mock.calls.every((call) => call[2].cwd === "/owned/repo")).toBe(
      true,
    );
  });

  it.each([
    ["missing head", { headRefOid: undefined }],
    ["invalid head", { headRefOid: "invalid" }],
    ["missing count", { changedFiles: undefined }],
    ["string count", { changedFiles: "354" }],
    ["negative count", { changedFiles: -1 }],
    ["fractional count", { changedFiles: 354.5 }],
  ])("fails closed on %s before classification", async (_name, override) => {
    responses({ ...metadata(), ...override });
    expect((await read()).ok).toBe(false);
  });

  it.each([
    ["truncated listing", pages(files.slice(0, 353))],
    ["duplicate path", pages([...files.slice(0, 353), files[0]])],
    ["malformed page", [files.slice(0, 100), {}]],
    ["flat rather than slurped pages", files],
    ["null file row", pages([...files.slice(0, 353), null])],
    [
      "missing filename",
      pages([...files.slice(0, 353), { status: "modified" }]),
    ],
    ["empty filename", pages([...files.slice(0, 353), { filename: "" }])],
    [
      "unsafe filename",
      pages([...files.slice(0, 353), { filename: "../outside.tsx" }]),
    ],
    ["oversized page", [files]],
    [
      "incomplete nonfinal page",
      [
        files.slice(0, 50),
        files.slice(50, 150),
        files.slice(150, 250),
        files.slice(250),
      ],
    ],
  ])("fails closed on %s", async (_name, listing) => {
    responses(metadata(), listing);
    expect((await read()).ok).toBe(false);
  });

  it.each([undefined, "invalid", "e".repeat(40)])(
    "fails closed when the head after enumeration is %s",
    async (headRefOid) => {
      responses(metadata(), pages(files), { headRefOid });
      expect((await read()).ok).toBe(false);
    },
  );

  it.each(["before", "pages", "after"] as const)(
    "fails closed on native %s read failure",
    async (phase) => {
      responses(metadata(), pages(files), { headRefOid: HEAD }, phase);
      const result = await read();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("native GitHub");
    },
  );

  it("preserves rename source, status and patch for canonical tier classification", async () => {
    const renamed = {
      filename: "packages/e2e/moved.txt",
      previous_filename: "apps/portal/lib/auth/session.ts",
      status: "renamed",
      additions: 2,
      deletions: 3,
      patch: "@@ -1 +1 @@\n-before\n+after",
    };
    responses(
      {
        ...metadata(),
        changedFiles: 1,
        body: "Change-tier: ship — test-only: move test",
        files: [],
      },
      [[renamed]],
    );
    const result = await read();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const actual = result.data.files as Record<string, unknown>[];
    expect(actual).toEqual([
      expect.objectContaining({
        path: renamed.filename,
        previousPath: renamed.previous_filename,
        status: "renamed",
        changeType: "RENAMED",
        patch: renamed.patch,
      }),
    ]);
    expect(
      resolveTier(String(result.data.body), normalizeTierFiles(actual), 1)
        .effective,
    ).toBeNull();
  });

  it("preserves PR_BODY override and liveBody independently of complete file reads", async () => {
    vi.stubEnv("PR_BODY", "event body");
    responses();
    const event = await read();
    expect(event.ok && event.data.body).toBe("event body");
    responses();
    const live = await ghViewJson<Record<string, unknown>>(
      "pr",
      2905,
      "body,files",
      "/owned/repo",
      true,
    );
    expect(live.ok && live.data.body).toBe(metadata().body);
  });

  it("leaves issue and non-file PR projections on their existing single read", async () => {
    responses({ number: 2905, body: "issue body" });
    expect((await ghViewJson("issue", 2905, "body", "/owned/repo")).ok).toBe(
      true,
    );
    expect(cli).toHaveBeenCalledTimes(1);
    responses({ number: 2905, body: "live body" });
    expect((await ghViewJson("pr", 2905, "body", "/owned/repo")).ok).toBe(true);
    expect(cli).toHaveBeenCalledTimes(2);
  });
});

describe("#2905 actual guards cannot skip hidden rendering file354", () => {
  it.each(["stage-b-lint.ts", "ui-parity-lint.ts"])(
    "%s classifies the complete file set before any no-surface exemption",
    (guard) => {
      const root = mkdtempSync(join(tmpdir(), "guard-files-2905-"));
      roots.push(root);
      const gh = join(root, "gh");
      mkdirSync(gh);
      writeFileSync(join(gh, "pr-view-2905.json"), JSON.stringify(metadata()));
      writeFileSync(
        join(gh, "pr-files-2905.json"),
        JSON.stringify(pages(files)),
      );
      const result = runGuard(guard, root, {
        completeLegacyGhFixtures: false,
        env: {
          GITHUB_EVENT_NAME: "pull_request",
          PR_NUMBER: "2905",
          PR_BODY: "",
          LINT_GH_FIXTURE_DIR: gh,
        },
      });
      expect(result.code).toBe(1);
      expect(result.stdout).not.toContain("rule does not apply");
      expect(result.stderr).toMatch(/Stage-B|approved-source parity/);
    },
  );
});
