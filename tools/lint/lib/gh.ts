/**
 * tools/lint/lib/gh.ts — shared `gh` CLI accessor + test seam for the
 * external-context lint guards (registry-research, spec-link).
 *
 * Why this exists: those guards reach the outside world through `gh pr view` /
 * `gh issue view`. That call cannot be exercised by the `LINT_FIXTURE_ROOT`
 * filesystem seam — it needs a stub for GitHub. This module centralises the two
 * `execa("gh", …)` shapes the guards duplicated and adds one injectable seam:
 *
 *   TEST SEAM `LINT_GH_FIXTURE_DIR` — when set, `gh <kind> view <n> --json …`
 *   is served from a canned JSON file in that dir instead of spawning the real
 *   `gh` binary, so the guard's env-resolution + artifact-extraction logic runs
 *   under test with no GitHub round-trip, no auth, and deterministically in CI.
 *
 *   File naming (mirrors the subcommand):
 *     gh pr view <n>    → <dir>/pr-view-<n>.json
 *     gh issue view <n> → <dir>/issue-view-<n>.json
 *     PR file pages    → <dir>/pr-files-<n>.json (REST --paginate --slurp shape)
 *   A missing/invalid fixture file resolves to `{ ok: false }`, matching the
 *   real CLI's failure path so the guard's fail-closed branch is testable too.
 *
 * Inert in production: when `LINT_GH_FIXTURE_DIR` is unset the real `gh` runs.
 * A files projection uses the canonical paginated REST listing, exact count and
 * distinct path validation, then rereads the head before any guard can exempt it.
 *
 * The accessor returns a discriminated result rather than throwing or logging,
 * so each guard keeps its own TAG-prefixed diagnostics and control flow.
 */
import { execa } from "execa";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flattenApiPages } from "../../gh/merge-gate.mjs";
import { normalizeTierFiles } from "./change-tier";

export type GhResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * CI SEAM `PR_BODY` (Issue #651): when the workflow passes the event payload's
 * PR body via env (`PR_BODY: ${{ github.event.pull_request.body }}`), it
 * overrides the `body` field fetched by `gh pr view` for THAT PR. Rationale:
 * the payload body is always current for its triggering event, while a fresh
 * REST read right after PR creation has returned a stale/absent body and
 * produced a false-red with no body edit at all (PR #685). A retry cannot fix
 * that class — a stale read still succeeds — so the payload is authoritative.
 *
 * Deliberately narrow: applies only when (a) the view is a PR (never an
 * issue), (b) the viewed number IS the PR under test (`PR_NUMBER` — spec-link
 * also views linked issues), and (c) the caller asked for `body` at all.
 * `pnpm pr:preflight` never sets `PR_BODY`, so local behavior is unchanged.
 * Applied on the fixture path too, so guard-tests can exercise the seam.
 */
function withEventBody<T>(
  kind: "pr" | "issue",
  number: string | number,
  fields: string,
  data: T,
): T {
  const body = process.env.PR_BODY;
  if (
    kind !== "pr" ||
    body === undefined ||
    String(number) !== process.env.PR_NUMBER ||
    !fields
      .split(",")
      .map((f) => f.trim())
      .includes("body")
  ) {
    return data;
  }
  return { ...(data as object), body } as T;
}

/**
 * Run `gh <kind> view <number> --json <fields>` and parse its JSON, or serve a
 * canned fixture when `LINT_GH_FIXTURE_DIR` is set. `fields` is ignored under
 * the fixture seam (the file already holds the projected shape) but is passed
 * verbatim to the real CLI. `cwd` likewise only matters on the real path (it
 * sets where `gh` resolves the repo from); under the fixture seam it is unused.
 */
export async function ghViewJson<T>(
  kind: "pr" | "issue",
  number: string | number,
  fields: string,
  cwd?: string,
  liveBody = false,
): Promise<GhResult<T>> {
  const fixtureDir = process.env.LINT_GH_FIXTURE_DIR;
  const needsFiles =
    kind === "pr" &&
    fields.split(",").some((field) => field.trim() === "files");
  const viewFields = needsFiles
    ? [
        ...new Set([
          ...fields.split(",").map((field) => field.trim()),
          "changedFiles",
          "headRefOid",
        ]),
      ].join(",")
    : fields;
  const readView = async (
    projection: string,
  ): Promise<Record<string, unknown>> => {
    if (fixtureDir) {
      const file = resolve(fixtureDir, `${kind}-view-${number}.json`);
      try {
        return JSON.parse(readFileSync(file, "utf8")) as Record<
          string,
          unknown
        >;
      } catch (e) {
        throw new Error(
          `fixture ${kind}-view-${number}.json unavailable: ${(e as Error).message.split("\n")[0]}`,
          { cause: e },
        );
      }
    }
    const { stdout } = await execa(
      "gh",
      [kind, "view", String(number), "--json", projection],
      { cwd },
    );
    return JSON.parse(stdout) as Record<string, unknown>;
  };
  try {
    const data = await readView(viewFields);
    if (needsFiles) {
      const head = data.headRefOid;
      const count = data.changedFiles;
      if (typeof head !== "string" || !/^[a-f0-9]{40}$/i.test(head))
        throw new Error(
          "Missing or invalid PR head for changed-file enumeration",
        );
      if (
        typeof count !== "number" ||
        !Number.isSafeInteger(count) ||
        count < 0
      )
        throw new Error("Missing or invalid PR changedFiles count");
      const raw = fixtureDir
        ? readFileSync(resolve(fixtureDir, `pr-files-${number}.json`), "utf8")
        : (
            await execa(
              "gh",
              [
                "api",
                `repos/{owner}/{repo}/pulls/${number}/files?per_page=100`,
                "--paginate",
                "--slurp",
              ],
              { cwd },
            )
          ).stdout;
      const pages = JSON.parse(raw) as unknown;
      const rows: unknown[] = flattenApiPages(pages);
      if (
        !Array.isArray(pages) ||
        !pages.length ||
        pages.some(
          (page, index) =>
            page.length > 100 ||
            (index < pages.length - 1 && page.length !== 100),
        )
      )
        throw new Error("Incomplete or oversized GitHub changed-file page");
      const paths = new Set<string>();
      const validPath = (value: unknown): value is string =>
        typeof value === "string" &&
        !!value.trim() &&
        !value.startsWith("/") &&
        !/[:\\]/.test(value) &&
        ![...value].some((character) => character.charCodeAt(0) < 32) &&
        value
          .split("/")
          .every(
            (segment) => segment !== "" && segment !== "." && segment !== "..",
          );
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row))
          throw new Error("Malformed GitHub changed-file row");
        const file = row as Record<string, unknown>;
        const path = file.path ?? file.filename;
        if (!validPath(path))
          throw new Error("Missing or invalid changed-file path");
        if (paths.has(path))
          throw new Error("Duplicate GitHub changed-file path");
        paths.add(path);
        const previous = file.previousPath ?? file.previous_filename;
        if (previous !== undefined && !validPath(previous))
          throw new Error("Invalid renamed-file source path");
        if (
          String(file.status ?? file.changeType ?? "").toLowerCase() ===
            "renamed" &&
          previous === undefined
        )
          throw new Error("Missing renamed-file source path");
      }
      if (rows.length !== count || paths.size !== count)
        throw new Error(
          `Incomplete changed-file set: expected ${count}, received ${rows.length} distinct ${paths.size}`,
        );
      const after = await readView("headRefOid");
      if (after.headRefOid !== head)
        throw new Error("Changed-file set is not bound to the current PR head");
      const rawFiles = rows as Record<string, unknown>[];
      const normalized = normalizeTierFiles(rawFiles);
      data.files = normalized.map((file, index) => ({
        ...rawFiles[index],
        ...file,
        changeType:
          file.status === "removed" ? "DELETED" : file.status?.toUpperCase(),
      }));
    }
    return {
      ok: true,
      data: liveBody
        ? (data as T)
        : withEventBody(kind, number, fields, data as T),
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message.split("\n")[0] };
  }
}
