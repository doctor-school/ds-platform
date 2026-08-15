#!/usr/bin/env node
import {
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const BRIDGE_REL = ".agents/skills";
export const TARGET_REL = "../apps/docs/content/skills";

function norm(value) {
  return String(value).replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

export function bridgeKind(stat, placeholderText) {
  if (stat?.isSymbolicLink?.()) return "link";
  if (stat?.isDirectory?.()) return "directory";
  if (stat?.isFile?.() && String(placeholderText).trim() === TARGET_REL) {
    return "git-placeholder";
  }
  return "invalid";
}

function markSkipWorktree(root) {
  execFileSync("git", ["update-index", "--skip-worktree", "--", BRIDGE_REL], {
    cwd: root,
    stdio: "ignore",
  });
}

/**
 * Bring the TRACKED bridge entry back into the working tree.
 *
 * Materialisation marks `.agents/skills` `--skip-worktree`, so once the path is
 * removed by hand (`rm -rf .agents/skills`) git considers the worktree state
 * authoritative-and-unchanged and will never restore it — every later
 * `pnpm install` would then die on the `lstat` below. Un-skipping plus a checkout
 * restores the tracked placeholder (Windows) or symlink (POSIX) so the normal
 * materialisation path can run again.
 */
export function restoreTrackedBridge(root) {
  execFileSync("git", ["update-index", "--no-skip-worktree", "--", BRIDGE_REL], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["checkout", "--", BRIDGE_REL], {
    cwd: root,
    stdio: "ignore",
  });
}

export function ensureCodexSkillBridge(
  root = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."),
) {
  const bridge = resolve(root, BRIDGE_REL);
  const target = resolve(root, "apps/docs/content/skills");
  let stat;
  try {
    stat = lstatSync(bridge);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    restoreTrackedBridge(root);
    stat = lstatSync(bridge);
  }
  const kind = bridgeKind(
    stat,
    stat.isFile() ? readFileSync(bridge, "utf8") : "",
  );

  if (kind === "link" || kind === "directory") {
    if (norm(realpathSync(bridge)) !== norm(realpathSync(target))) {
      throw new Error(
        `${BRIDGE_REL} resolves outside the canonical skill catalog`,
      );
    }
    if (kind === "directory" && process.platform === "win32") {
      markSkipWorktree(root);
    }
    return { kind, materialized: false };
  }
  if (kind !== "git-placeholder" || process.platform !== "win32") {
    throw new Error(
      `${BRIDGE_REL} is neither the tracked symlink nor a valid Windows placeholder`,
    );
  }

  const backup = resolve(root, ".agents/.skills-git-placeholder");
  renameSync(bridge, backup);
  try {
    symlinkSync(target, bridge, "junction");
    markSkipWorktree(root);
    unlinkSync(backup);
  } catch (error) {
    try {
      rmdirSync(bridge);
    } catch {
      // The original error remains authoritative; rollback is best effort.
    }
    try {
      renameSync(backup, bridge);
    } catch {
      // Preserve the original failure and its stack.
    }
    throw error;
  }
  return { kind: "junction", materialized: true };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = ensureCodexSkillBridge();
  if (result.materialized) {
    process.stdout.write("Codex skill bridge materialized for Windows.\n");
  }
}
