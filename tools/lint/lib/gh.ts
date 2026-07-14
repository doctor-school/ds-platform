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
 *   A missing/invalid fixture file resolves to `{ ok: false }`, matching the
 *   real CLI's failure path so the guard's fail-closed branch is testable too.
 *
 * Inert in production: when `LINT_GH_FIXTURE_DIR` is unset the real `gh` runs
 * exactly as the inlined calls did before.
 *
 * The accessor returns a discriminated result rather than throwing or logging,
 * so each guard keeps its own TAG-prefixed diagnostics and control flow.
 */
import { execa } from "execa";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type GhResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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
): Promise<GhResult<T>> {
  const fixtureDir = process.env.LINT_GH_FIXTURE_DIR;
  if (fixtureDir) {
    const file = resolve(fixtureDir, `${kind}-view-${number}.json`);
    try {
      return {
        ok: true,
        data: withEventBody(
          kind,
          number,
          fields,
          JSON.parse(readFileSync(file, "utf8")) as T,
        ),
      };
    } catch (e) {
      return {
        ok: false,
        error: `fixture ${kind}-view-${number}.json unavailable: ${(e as Error).message.split("\n")[0]}`,
      };
    }
  }
  try {
    const { stdout } = await execa(
      "gh",
      [kind, "view", String(number), "--json", fields],
      { cwd },
    );
    return {
      ok: true,
      data: withEventBody(kind, number, fields, JSON.parse(stdout) as T),
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message.split("\n")[0] };
  }
}
