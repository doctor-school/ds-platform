#!/usr/bin/env tsx
/**
 * tools/lint/action-pin-lint.ts — WARN v1 tree guard (the `action-pin` step of
 * the `guards-warn` batch in ci.yml), #3005.
 *
 * Rule: every `uses:` reference in `.github/workflows/*.yml|yaml` and in
 * `.github/actions/**\/action.yml|yaml` that reaches another repository is pinned
 * to a full 40-hex commit SHA and carries the exact release tag as a trailing
 * comment, in the format Renovate's `github-actions` manager maintains:
 *
 *     uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
 *
 * A tag or branch is a moving pointer: whoever controls the upstream repository
 * can repoint it, and the next run executes the new code with this repository's
 * tokens. A commit SHA cannot be repointed. The comment keeps the pin readable
 * and is the anchor Renovate rewrites together with the SHA, so a missing
 * comment is a finding too. First-party `actions/*` follow the same rule — one
 * rule, no allowlist (OpenSSF Scorecard "Pinned-Dependencies").
 *
 * Exempt: local refs (`./…`, a composite action or reusable workflow in this
 * repository, pinned by the commit that runs it) and `docker://` image refs.
 *
 * Line-scanned rather than YAML-parsed: a `uses:` key is a single scalar line in
 * every form GitHub accepts (step or job level), and the scan reports the exact
 * file:line to fix.
 *
 * Seam: `LINT_FIXTURE_ROOT` (guard-tests harness) — points the scan at a fixture
 * tree. Inert in production.
 * Run: `pnpm lint:action-pin`. Findings: stderr + exit 1. Clean: stdout + exit 0.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[action-pin]";

// `uses:` as a mapping key, optionally as the first key of a sequence item.
const USES_RE = /^\s*(?:-\s+)?uses:\s*(.*)$/;
const SHA_RE = /^[0-9a-f]{40}$/;
// The exact release tag (`v7.0.1`, `v7.1.0-rc.1`), never a floating major (`v7`).
const VERSION_COMMENT_RE = /^#\s*v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\s|$)/;

const isYaml = (f: string) => f.endsWith(".yml") || f.endsWith(".yaml");

function workflowFiles(root: string): string[] {
  const dir = resolve(root, ".github", "workflows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isYaml)
    .sort()
    .map((f) => resolve(dir, f));
}

function actionFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...actionFiles(path));
    else if (entry.name === "action.yml" || entry.name === "action.yaml")
      out.push(path);
  }
  return out.sort();
}

/** Split `<value> # comment` into the ref (quotes stripped) and the comment. */
function splitValue(raw: string): { ref: string; comment: string } {
  const trimmed = raw.trim();
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const end = trimmed.indexOf(quote, 1);
    if (end > 0)
      return {
        ref: trimmed.slice(1, end),
        comment: trimmed.slice(end + 1).trim(),
      };
  }
  const hash = trimmed.search(/\s#/);
  return hash === -1
    ? { ref: trimmed, comment: "" }
    : { ref: trimmed.slice(0, hash), comment: trimmed.slice(hash).trim() };
}

const files = [
  ...workflowFiles(REPO_ROOT),
  ...actionFiles(resolve(REPO_ROOT, ".github", "actions")),
];
const findings: string[] = [];
let remote = 0;

for (const file of files) {
  const rel = relative(REPO_ROOT, file).split("\\").join("/");
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = line.match(USES_RE);
    if (!m) return;
    const { ref, comment } = splitValue(m[1]);
    if (ref === "" || ref.startsWith("./") || ref.startsWith("docker://"))
      return;
    remote += 1;
    const where = `${rel}:${i + 1}`;
    const at = ref.lastIndexOf("@");
    const version = at === -1 ? "" : ref.slice(at + 1);
    if (!SHA_RE.test(version)) {
      findings.push(
        `${where}: \`${ref}\` — ref is not a 40-hex commit SHA; pin it as \`<owner>/<repo>@<sha> # vX.Y.Z\``,
      );
      return;
    }
    if (!VERSION_COMMENT_RE.test(comment)) {
      findings.push(
        `${where}: \`${ref}\` — missing the trailing \`# vX.Y.Z\` exact release-tag comment`,
      );
    }
  });
}

if (findings.length > 0) {
  process.stderr.write(
    `${TAG} FAIL — ${findings.length} unpinned \`uses:\` ref(s):\n`,
  );
  for (const f of findings) process.stderr.write(`${TAG}   ${f}\n`);
  process.exit(1);
}
process.stdout.write(
  `${TAG} PASS — ${remote} remote \`uses:\` ref(s) across ${files.length} file(s), all SHA-pinned with a version comment\n`,
);
