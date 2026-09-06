---
title: "verify-base-ci-green"
description: "Procedural skill (inline): check whether the base branch's last CI run was green before pushing."
name: verify-base-ci-green
mode: inline
---

# verify-base-ci-green

**Execution contract:** Read [portable agent discipline](../../agent-discipline.md) before first use; map tools/models to the active harness and preserve its authorization, context and memory rules.

**Kind:** procedural · **Mode:** inline.

## Input

- Base branch name (typically `main`).

## Procedure

1. Run:

   ```bash
   gh run list --branch main --workflow ci.yml --limit 1 --json databaseId,status,conclusion,headSha,name -q '.[0]'
   ```

2. Confirm the run matches the current base SHA and read `.status` + `.conclusion`; no registered/current run is unknown, never green. Possible values: `success`, `failure`, `cancelled`, `null` (still in progress).
3. If `failure`, identify which jobs failed (`gh run view <run-id>` or the workflow logs) and record the baseline-red state.

## Output

- One-line status. If `success`, no further action.
- If `failure`, the lead agent adds a disclaimer to the PR description noting that the baseline CI was already red — this disambiguates pre-existing red checks from red checks the PR introduced.

## Failure mode

- Silent push without checking — the G11 finding F-23 pattern. Author-agent reads its own PR's red CI and treats it as an introduced regression, then spends a session "fixing" a baseline failure unrelated to the change.
