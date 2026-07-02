#!/usr/bin/env tsx
/**
 * tools/lint/events-lint.ts — BASELINE hard-red guard (job `events-drift`) for the
 * ADR-0006 §7 "Events drift" row: "`@OutboxEmit` calls ↔ spec's `events.md`"
 * (Custom AST). Implemented per Issue #448 (was a 5-line exit-0 stub that gated
 * merge vacuously once #440 wired the job into the `ci` needs-list).
 *
 * ── The rule (exact) ──────────────────────────────────────────────────────────
 * The set of event names EMITTED in code (each `@OutboxEmit('<name>')` call-site
 * string literal, across `apps/** /src` + `packages/** /src` `*.ts`) must equal
 * the set of event names DOCUMENTED in the spec event manifests (`events.md`
 * under `apps/docs/content/specs/**`). Any asymmetry is drift:
 *   - emitted but not documented → an event ships with no contract row → FAIL.
 *   - documented but not emitted → a contract row with no emitter (stale/typo) → FAIL.
 *
 * ── Empty-state = REAL evaluated emptiness (NOT a hardcoded exit 0) ────────────
 * The events SSOT does not exist yet: there is no `@OutboxEmit` decorator, no
 * emitter call-site, and no `events.md` manifest anywhere in the repo today. So
 * the guard SCANS, finds zero emitters AND zero manifests, and reports "no event
 * contract inputs — nothing to check" (exit 0) — the same vacuously-green
 * semantics as `endpoint-authz` when there are no routes to classify. This is
 * evaluated emptiness, not a stub: the moment the FIRST `@OutboxEmit(...)` call
 * or the FIRST `events.md` manifest lands, the guard bites (an emitter with no
 * manifest fails as "undocumented"; a manifest with no emitter fails as "stale").
 *
 * ── events.md contract shape (assumed until the first manifest lands) ─────────
 * An `events.md` documents each event as an inline-code token of the dotted
 * event-name shape ``` `bounded.context.event` ``` (≥1 dot). The guard extracts
 * those tokens as the documented set. Revisit this extraction when the first real
 * manifest defines the convention concretely (tracked with the guard).
 *
 * ── Posture (recorded on the ci.yml job header) ───────────────────────────────
 * KEPT hard-red (BLOCK, in the `ci` needs-list). It is a deterministic set
 * comparison over literal string tokens — no heuristic, no false-positive class —
 * and it is clean (empty) on `main`. ADR-0006 §7.0 does not phase events-drift
 * into the Pilot tier (unlike the two glossary checks), so there is no phasing
 * pressure to burn it in. It can only fire on a genuine emitter↔manifest mismatch.
 *
 * Seam: `LINT_FIXTURE_ROOT` (guard-tests harness) — inert in production.
 * Run: `pnpm lint:events`. Findings: stderr + exit 1. Clean/empty: stdout + exit 0.
 */
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[events-drift]";

// `@OutboxEmit('user.registered')` / `@OutboxEmit("user.registered")` — the
// first string-literal argument is the emitted event name.
const EMIT_RE = /@OutboxEmit\(\s*['"]([^'"]+)['"]/g;
// A documented event token in an `events.md`: an inline-code dotted name.
const DOTTED_TOKEN_RE = /`([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)`/g;

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

interface Located {
  name: string;
  file: string;
}

async function collectEmitters(): Promise<Located[]> {
  const files = await fg(["apps/*/src/**/*.ts", "packages/*/src/**/*.ts"], {
    cwd: REPO_ROOT,
    ignore: ["**/node_modules/**", "**/*.d.ts"],
  });
  const out: Located[] = [];
  for (const rel of files) {
    const posix = rel.replace(/\\/g, "/");
    const raw = await readFile(resolve(REPO_ROOT, rel), "utf8");
    EMIT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = EMIT_RE.exec(raw)) !== null) out.push({ name: m[1], file: posix });
  }
  return out;
}

async function collectDocumented(): Promise<Located[]> {
  const files = await fg("apps/docs/content/specs/**/events.md", {
    cwd: REPO_ROOT,
    ignore: ["**/node_modules/**"],
  });
  const out: Located[] = [];
  for (const rel of files) {
    const posix = rel.replace(/\\/g, "/");
    const raw = await readFile(resolve(REPO_ROOT, rel), "utf8");
    DOTTED_TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DOTTED_TOKEN_RE.exec(raw)) !== null) out.push({ name: m[1], file: posix });
  }
  return out;
}

async function main(): Promise<void> {
  const emitters = await collectEmitters();
  const documented = await collectDocumented();

  // Real evaluated emptiness: no contract inputs at all → nothing to check.
  if (emitters.length === 0 && documented.length === 0) {
    info(
      "no event contract inputs found (no @OutboxEmit call-sites, no specs/**/events.md manifests) — nothing to check. " +
        "Bites when the first emitter or manifest lands (ADR-0006 §7).",
    );
    process.exit(0);
  }

  const emittedSet = new Map<string, string>();
  for (const e of emitters) if (!emittedSet.has(e.name)) emittedSet.set(e.name, e.file);
  const docSet = new Map<string, string>();
  for (const d of documented) if (!docSet.has(d.name)) docSet.set(d.name, d.file);

  info(
    `found ${emittedSet.size} emitted event(s) across ${emitters.length} @OutboxEmit call-site(s); ` +
      `${docSet.size} documented event(s) across ${documented.length} manifest token(s).`,
  );

  const undocumented: string[] = [];
  for (const [name, file] of emittedSet) {
    if (!docSet.has(name)) undocumented.push(`${name}  (emitted in ${file}, not in any events.md)`);
  }
  const unemitted: string[] = [];
  for (const [name, file] of docSet) {
    if (!emittedSet.has(name)) unemitted.push(`${name}  (documented in ${file}, no @OutboxEmit emitter)`);
  }

  if (undocumented.length === 0 && unemitted.length === 0) {
    info(`PASS — emitted events and documented events are in lockstep (${emittedSet.size}).`);
    process.exit(0);
  }

  for (const u of undocumented) process.stderr.write(`${TAG} undocumented event  ${u}\n`);
  for (const u of unemitted) process.stderr.write(`${TAG} unemitted event  ${u}\n`);
  process.stderr.write(
    `${TAG} FAIL — ${undocumented.length} emitted-but-undocumented, ${unemitted.length} documented-but-unemitted. ` +
      `Per ADR-0006 §7 every emitted event carries a contract row: document each ` +
      `@OutboxEmit event in the feature spec's events.md, and remove stale rows.\n`,
  );
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(`${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
});
