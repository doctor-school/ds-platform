import { readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { isUnder, norm } from "../hooks/main-tree-state.mjs";

/** Read only metadata prefix; never load or print conversation bodies. */
export function codexSessionMetadata(logPath) {
  const fd = openSync(logPath, "r");
  try {
    const buffer = Buffer.alloc(65536);
    const n = readSync(fd, buffer, 0, buffer.length, 0);
    for (const line of buffer.subarray(0, n).toString("utf8").split("\n")) {
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (row.type === "session_meta") {
        const meta = row.payload;
        if (typeof meta?.id === "string" && typeof meta?.cwd === "string")
          return { id: meta.id, cwd: meta.cwd };
        return null;
      }
    }
    return null;
  } finally {
    closeSync(fd);
  }
}
/** Recent file activity is a conservative hint, not proof a process is alive. */
export function scanHarnessSessions({
  roots,
  home = homedir(),
  codexHome = process.env.CODEX_HOME || join(home, ".codex"),
  nowMs = Date.now(),
  windowMs = 600000,
  limit = 10000,
}) {
  const logs = [];
  const warnings = [];
  const known = roots.filter(Boolean).sort((a, b) => b.length - a.length);
  const main = roots[0];
  let visited = 0;
  function inspect(logPath, harness, root) {
    try {
      if (++visited > limit) return;
      const mtimeMs = statSync(logPath).mtimeMs;
      if (nowMs - mtimeMs > windowMs) return;
      const meta =
        harness === "codex"
          ? codexSessionMetadata(logPath)
          : {
              id: logPath
                .split(/[\\/]/)
                .at(-1)
                .replace(/\.jsonl$/, ""),
              cwd: root,
            };
      if (!meta) {
        warnings.push("Recent Codex session metadata unavailable");
        return;
      }
      const owner = known.find((r) => isUnder(meta.cwd, r));
      if (owner)
        logs.push({
          id: meta.id,
          harness,
          mtimeMs,
          inSharedMainTree: norm(owner) === norm(main),
          logPath,
        });
    } catch {
      warnings.push(`${harness} session metadata unreadable`);
    }
  }
  const projects = join(home, ".claude", "projects");
  for (const root of known) {
    const slug = root.replace(/[^a-zA-Z0-9]/g, "-");
    try {
      for (const f of readdirSync(join(projects, slug)))
        if (f.endsWith(".jsonl"))
          inspect(join(projects, slug, f), "claude", root);
    } catch (error) {
      if (error.code !== "ENOENT")
        warnings.push("Claude session directory unreadable");
    }
  }
  // Codex sessions/YYYY/MM/DD; resumed old rollouts can be freshly modified,
  // so do not restrict by directory date. Bound depth and total entries.
  function walk(path, depth = 0) {
    if (depth > 3 || visited > limit) return;
    let entries;
    try {
      entries = readdirSync(path, { withFileTypes: true });
    } catch (error) {
      if (error.code !== "ENOENT")
        warnings.push("Codex session directory unreadable");
      return;
    }
    for (const e of entries) {
      if (++visited > limit) break;
      if (e.isDirectory()) walk(join(path, e.name), depth + 1);
      else if (e.isFile() && e.name.endsWith(".jsonl"))
        inspect(join(path, e.name), "codex");
    }
  }
  walk(resolve(codexHome, "sessions"));
  if (visited > limit)
    warnings.push(
      `Session scan reached ${limit}-entry limit; concurrency coverage incomplete`,
    );
  return { logs, warnings: [...new Set(warnings)] };
}
