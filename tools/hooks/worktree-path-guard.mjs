#!/usr/bin/env node
// PreToolUse guard on Edit/Write/MultiEdit. Two independent responsibilities:
//
// 1. Escape-BLOCK (exit 2, #359/#486): block a Write/Edit whose ABSOLUTE path
//    escapes the active git worktree back into the SHARED main tree (AGENTS.md
//    §6; memory `feedback_worktree_absolute_paths_escape_isolation`).
//    `EnterWorktree` changes the session cwd but does NOT redirect absolute
//    paths — an Edit/Write with an absolute main-tree `file_path` (carried over
//    from pre-worktree Read/Bash calls) silently writes to the main tree while a
//    parallel session may sweep it into the wrong PR, and any green observed
//    there is against the wrong checkout. Enforced at the moment the bad path is
//    issued.
//    A path inside a DIFFERENT registered worktree is a distinct verdict
//    (`wrong-worktree`, #1453), NOT a main-tree escape: the session sits in the
//    wrong checkout (typically a dispatch that inherited the lead's stale cwd),
//    and the prescribed fix is `EnterWorktree path:<target worktree>` — never
//    authoring the file elsewhere and copying it in.
//
// 2. Write-WARN (exit 0 + systemMessage, #854): the FIRST main-tree WRITE in a
//    NON-isolated session (cwd not in a worktree) while parallel sessions are
//    live fires the guard's FULL warning and records `mainTreeWriteSeen` in the
//    per-session state file. This is the write half of the #823 read-guard's
//    read-only orchestration carve-out (#854): a read-only lead sees one
//    softened notice, but the moment it edits main-tree files the full guard
//    resumes — the write itself warns, and subsequent reads warn at full
//    strength. WARN-level only — it never blocks (that is habituation, not the
//    escape hazard #1 guards).
//
// Contract: reads the PreToolUse hook JSON on stdin ({session_id, cwd,
// tool_name, tool_input:{file_path}}). Exit 2 + stderr = BLOCK. Exit 0 (+
// optional stdout systemMessage) = allow. FAIL-OPEN: any parse/logic error
// exits 0 — a guard bug must never wedge legitimate edits.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FLAG_REL,
  FRESH_WINDOW_MS,
  inWorktree,
  isUnder,
  norm,
  readState,
  stateFilePath,
  targetPath,
  writeState,
} from "./main-tree-state.mjs";
import { mutationPaths, projectRoot } from "./hook-compat.mjs";

/**
 * Absolute roots of every checkout git knows about (main tree + linked
 * worktrees), from `git worktree list --porcelain`. `exec` is an injected seam
 * so the spec never spawns a process. FAIL-OPEN to `[]` — when git is
 * unavailable the caller still classifies by path shape.
 */
export function gitWorktreeRoots(cwd, exec) {
  try {
    const out = exec
      ? exec(cwd)
      : execFileSync("git", ["worktree", "list", "--porcelain"], {
          cwd,
          encoding: "utf8",
          timeout: 5_000,
          stdio: ["ignore", "pipe", "ignore"],
        });
    return String(out)
      .split(/\r?\n/)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** The `<…>/.claude/worktrees/<name>` root a path sits in, or "" — shape-only
 * fallback for when `git worktree list` is unavailable. */
export function worktreeRootOfPath(p) {
  const m = String(p).match(/^(.*)[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/);
  return m ? `${m[1]}/.claude/worktrees/${m[2]}` : "";
}

/** The longest candidate root that contains `target`, or "" when none does. */
export function owningRoot(target, roots) {
  let best = "";
  for (const root of roots) {
    if (root && isUnder(target, root) && norm(root).length > norm(best).length)
      best = root;
  }
  return best;
}

/**
 * Verdict for ONE write path issued from a worktree-pinned session:
 *
 * - `ok` — inside the session's own worktree (or outside the repo entirely).
 * - `wrong-worktree` (#1453) — inside a DIFFERENT registered checkout. This is
 *   NOT a main-tree escape: the usual cause is a subagent dispatched against
 *   worktree A while its env cwd was inherited from the lead's stale worktree
 *   B. The fix is `EnterWorktree`; labelling it "main tree" pushed agents into
 *   the banned author-in-scratchpad-and-copy workaround.
 * - `main-tree-escape` (#359/#486) — inside the SHARED main tree.
 */
export function classifyWritePath({ target, mainRoot, worktreeRoot, roots }) {
  const known = (roots || []).filter(Boolean);
  // `.claude/worktrees/` holds no tracked main-tree content, so a
  // worktree-SHAPED path is a checkout even when `git worktree list` is
  // unavailable or the worktree was torn down — a stale target still deserves
  // the wrong-worktree verdict, not "you escaped into the main tree".
  const shaped = worktreeRootOfPath(target);
  const candidates = [mainRoot, worktreeRoot, ...known];
  if (shaped) candidates.push(shaped);
  const owner = owningRoot(target, candidates.filter(Boolean));
  if (!owner) return { verdict: "ok" };
  if (norm(owner) === norm(worktreeRoot)) return { verdict: "ok" };
  if (norm(owner) === norm(mainRoot)) return { verdict: "main-tree-escape" };
  return {
    verdict: "wrong-worktree",
    targetRoot: owner,
    registered: known.some((r) => norm(r) === norm(owner)),
  };
}

/** `EnterWorktree path:` argument for a checkout root — the repo-relative
 * `.claude/worktrees/<name>` when it is one, else the absolute root. */
export function enterWorktreeArg(root) {
  const m = String(root).match(/[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/);
  return m ? `.claude/worktrees/${m[1]}` : String(root);
}

export function wrongWorktreeMessage(
  target,
  targetRoot,
  currentRoot,
  registered = true,
) {
  const arg = enterWorktreeArg(targetRoot);
  const stale = registered
    ? ""
    : `That worktree is NOT registered right now (torn down, or never created) — ` +
      `create it first: \`pnpm task:worktree <N>\`.\n`;
  return (
    `BLOCKED (wrong-worktree): '${target}' belongs to ANOTHER worktree ` +
    `('${targetRoot}'), but this session is pinned to '${currentRoot}'.\n` +
    `This is NOT a main-tree escape — nothing is wrong with the path, the ` +
    `session is in the wrong checkout (a dispatch that inherited a stale cwd, ` +
    `#1453). Writing here would land the edit on the other worktree's branch.\n` +
    stale +
    `Switch the session to the target worktree, then re-issue the write: ` +
    `EnterWorktree path:${arg}\n` +
    `Do NOT author the file elsewhere (scratchpad, main tree) and copy it in — ` +
    `that is the banned workaround this message exists to prevent (AGENTS.md §6).\n`
  );
}

export function mainTreeEscapeMessage(target, mainRoot, worktreeRoot) {
  return (
    `BLOCKED: '${target}' targets the SHARED main tree, but this ` +
    `session is isolated in a worktree.\n` +
    `Escaping the worktree writes to the main tree (a parallel session can sweep ` +
    `it into the wrong PR; any green there is against the wrong checkout — ` +
    `AGENTS.md §6, memory feedback_worktree_absolute_paths_escape_isolation).\n` +
    `Use the worktree path instead: a repo-relative path, or the worktree prefix ` +
    `'${worktreeRoot}/...'.\n`
  );
}

export function writeWarnMessage(liveCount) {
  return (
    `⚠ main-tree write guard (#823/#854): ${liveCount} parallel session(s) are live and ` +
    `this session is WRITING repo source in the SHARED main tree without worktree ` +
    `isolation. The read-only orchestration carve-out has ended — the full guard is now ` +
    `active. Isolate before further edits: \`pnpm task:worktree <N>\` → ` +
    `\`EnterWorktree path:.claude/worktrees/<N>\` (a parallel session can sweep an ` +
    `un-isolated edit into the wrong PR — AGENTS.md §6, #418). Warn-level only.`
  );
}

/**
 * Pure decision seam (mirrors `decideWarn()` for the read side): should a
 * main-tree WRITE warn? True only when — the tool is Edit/Write/MultiEdit, the
 * session is NOT in a worktree (cwd + projectDir both outside `.claude/
 * worktrees/`), parallel sessions are still live (freshness re-check against the
 * flag), and the target is repo SOURCE (under projectDir, not `.claude/` or
 * `.git/`). Returns `{ warn: false }` or `{ warn: true, liveCount }`.
 */
export function decideWriteWarn({
  toolName,
  toolInput,
  cwd,
  sessionId,
  projectDir,
  flag,
  statMtimeMs,
  nowMs,
  freshWindowMs = FRESH_WINDOW_MS,
}) {
  if (!/^(Edit|Write|MultiEdit|apply_patch)$/.test(toolName || ""))
    return { warn: false };
  if (!cwd || !projectDir) return { warn: false };
  // A worktree-isolated session is exactly the compliant case — never warn.
  if (inWorktree(cwd) || inWorktree(projectDir)) return { warn: false };
  if (!flag || !Array.isArray(flag.sessions)) return { warn: false };

  const live = flag.sessions.filter((s) => {
    if (!s || !s.logPath || s.id === sessionId) return false;
    const m = statMtimeMs(s.logPath);
    return m != null && nowMs - m <= freshWindowMs;
  });
  if (live.length === 0) return { warn: false };

  const parsed = mutationPaths(toolName, toolInput, cwd);
  const targets = parsed.length > 0 ? parsed : [targetPath(toolInput, cwd)];
  const sourceTarget = targets.find(
    (target) =>
      isUnder(target, projectDir) &&
      !isUnder(target, `${projectDir}/.claude`) &&
      !isUnder(target, `${projectDir}/.git`),
  );
  if (!sourceTarget) return { warn: false };

  return { warn: true, liveCount: live.length };
}

function main() {
  try {
    const raw = readFileSync(0, "utf8");
    const payload = JSON.parse(raw);
    const tool = payload.tool_name || "";
    if (!/^(Edit|Write|MultiEdit|apply_patch)$/.test(tool)) process.exit(0);

    const cwd = payload.cwd || "";
    const filePaths = mutationPaths(tool, payload.tool_input, cwd);

    // --- (1) Escape-BLOCK: absolute main-tree path issued from inside a worktree.
    if (cwd && filePaths.length > 0) {
      const m = cwd.match(/^(.*)[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/);
      if (m) {
        const mainRoot = m[1];
        const worktreeRoot = `${m[1]}/.claude/worktrees/${m[2]}`;
        const roots = gitWorktreeRoots(cwd);
        for (const p of filePaths) {
          const { verdict, targetRoot, registered } = classifyWritePath({
            target: p,
            mainRoot,
            worktreeRoot,
            roots,
          });
          if (verdict === "wrong-worktree") {
            process.stderr.write(
              wrongWorktreeMessage(p, targetRoot, worktreeRoot, registered),
            );
            process.exit(2);
          }
          if (verdict === "main-tree-escape") {
            process.stderr.write(
              mainTreeEscapeMessage(p, mainRoot, worktreeRoot),
            );
            process.exit(2);
          }
        }
        // In a worktree with a compliant path → isolated session, nothing to warn.
        process.exit(0);
      }
      // cwd NOT in a worktree → fall through to the write-WARN branch.
    }

    // --- (2) Write-WARN: first main-tree write in a non-isolated parallel session.
    const projectDir = projectRoot(payload);
    let flag = null;
    try {
      flag = JSON.parse(readFileSync(resolve(projectDir, FLAG_REL), "utf8"));
    } catch {
      // No flag → bootstrap saw no parallel sessions (or never ran) → allow.
    }
    const decision = decideWriteWarn({
      toolName: tool,
      toolInput: payload.tool_input,
      cwd,
      sessionId: payload.session_id || "",
      projectDir,
      flag,
      statMtimeMs: (p) => {
        try {
          return statSync(p).mtimeMs;
        } catch {
          return null;
        }
      },
      nowMs: Date.now(),
    });
    if (decision.warn) {
      const statePath = stateFilePath(projectDir, payload.session_id || "");
      const state = readState(statePath);
      // Warn once — on the FIRST main-tree write. `mainTreeWriteSeen` then makes
      // the read guard warn at full strength for the rest of the session.
      if (!state.mainTreeWriteSeen) {
        const msg = writeWarnMessage(decision.liveCount);
        process.stdout.write(
          JSON.stringify({
            systemMessage: msg,
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "allow",
              permissionDecisionReason: msg,
            },
          }),
        );
        writeState(statePath, { ...state, mainTreeWriteSeen: true });
      }
    }
    process.exit(0);
  } catch {
    process.exit(0); // fail-open: never wedge a legitimate edit on a guard bug
  }
}

// Entry-point guard: run `main()` only when invoked directly, so the guard-tests
// spec can import the pure seams without firing stdin reads / process.exit.
const invoked = process.argv[1] ? norm(resolve(process.argv[1])) : "";
if (invoked && invoked === norm(fileURLToPath(import.meta.url))) {
  main();
}
