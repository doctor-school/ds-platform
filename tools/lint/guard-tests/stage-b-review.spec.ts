import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runGuard } from "./run-guard";
import { validateStageB } from "../lib/stage-b-evidence";
const head = "a".repeat(40);
const path = "apps/admin/src/app/events/row.tsx";
function record(
  verdict = "GO",
  hour = "02",
  source = "owner-relay:session#message",
) {
  return `Stage-B: ${verdict}\nStage-B-head: ${head}\nStage-B-recorded-at: 2026-09-06T${hour}:00:00Z\nStage-B-owner-quote: Approved the live row\nStage-B-source: ${source}\nStage-B-live-url: http://localhost:3000/events\nStage-B-surfaces: ${path}`;
}
function fixture(
  files: string[],
  body: string,
  gateComments: object[] = [],
  artifacts: Record<string, unknown> = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "ds-stage-review-"));
  try {
    writeFileSync(
      join(dir, "pr-view-201.json"),
      JSON.stringify({
        number: 201,
        body,
        headRefOid: head,
        labels: [],
        files: files.map((path) => ({ path })),
      }),
    );
    writeFileSync(
      join(dir, "issue-view-700.json"),
      JSON.stringify({
        number: 700,
        body: `Stage-B-batch-approved: yes\nStage-B-new-section: no\nStage-B-owner-quote: Approved the decomposition\nStage-B-source: owner-relay:session#batch\nStage-B-deferred-prs: #201\nStage-B-surfaces: ${path}`,
        comments: gateComments,
      }),
    );
    for (const [id, artifact] of Object.entries(artifacts))
      writeFileSync(join(dir, `artifact-${id}.json`), JSON.stringify(artifact));
    return runGuard("stage-b-lint.ts", dir, {
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        PR_NUMBER: "201",
        LINT_GH_FIXTURE_DIR: dir,
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
describe("EARS-1920: independent review reproductions", () => {
  it("B3: loader preserves native REST updated_at when an earlier gate record is edited to NO", () => {
    const result = fixture([path], record("batched at #700", "00"), [
      {
        body: record("GO", "02"),
        created_at: "2026-09-06T02:00:00Z",
        updated_at: "2026-09-06T02:00:00Z",
      },
      {
        body: record("NO", "00"),
        created_at: "2026-09-06T00:00:00Z",
        updated_at: "2026-09-06T03:00:00Z",
      },
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("refused/revoked");
  });
  it("B1: fetches the winning gate-comment source, missing artifact fails", () => {
    const result = fixture([path], record("batched at #700", "00"), [
      {
        body: record(
          "GO",
          "02",
          "https://github.com/doctor-school/ds-platform/issues/700#issuecomment-999",
        ),
      },
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("artifact-999");
  });
  it("B1: fetches a winning lead-certification report, missing artifact fails", () => {
    const lead =
      record(
        "N/A (no visual surface) - lead-certified; harness: pnpm loadtest:room:verify; run UTC: 2026-09-06T02:00:00Z; report: https://github.com/doctor-school/ds-platform/issues/700#issuecomment-998",
      ) +
      `\nStage-B-authorization: autonomous-merge\nStage-B-visual-change: none\nStage-B-live-verified: yes\nStage-B-report-sha: ${head}\nStage-B-report-stdout: All verified`;
    const result = fixture([path], record("batched at #700", "00"), [
      { body: lead },
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("artifact-998");
  });
  it("B2: even a proven gate GO cannot expand the child batch surfaces", () => {
    const result = fixture(
      ["apps/admin/src/app/new-section/page.tsx"],
      record("batched at #700", "00"),
      [{ body: record() }],
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("bounded surface");
  });
  it("B1/B2: a proven scoped latest gate GO remains valid", () => {
    const result = fixture(
      [path],
      record("batched at #700", "00"),
      [
        {
          body: record(
            "GO",
            "02",
            "https://github.com/doctor-school/ds-platform/issues/700#issuecomment-999",
          ),
        },
      ],
      { "999": { body: "Approved the live row" } },
    );
    expect(result.code).toBe(0);
  });
  it("B3: native later edit revokes GO despite old recorded-at", () => {
    expect(
      validateStageB(
        [
          { body: record() },
          {
            body: record("NO", "00"),
            createdAt: "2026-09-06T00:00:00Z",
            updatedAt: "2026-09-06T03:00:00Z",
          },
        ],
        head,
        [],
        {},
      ).ok,
    ).toBe(false);
  });
  it("B4: DS render change with no feature label needs approval", () => {
    expect(
      fixture(["packages/design-system/src/primitives/button.tsx"], "").code,
    ).toBe(1);
  });
  it("B5: empty owner quote cannot consume the source line", () => {
    const body = record().replace(
      "Stage-B-owner-quote: Approved the live row",
      "Stage-B-owner-quote:",
    );
    expect(validateStageB([{ body }], head, [], {}).ok).toBe(false);
  });
});
