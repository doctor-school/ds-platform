import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { actorIdentity } from "./hook-compat.mjs";
export const OBSERVATION_REL = ".claude/hook-observations";
export function hookFingerprint(root) {
  const hash = createHash("sha256");
  for (const rel of [
    ".codex/hooks.json",
    ".codex/config.toml",
    ...readdirSync(resolve(root, "tools/hooks"))
      .filter((f) => f.endsWith(".mjs"))
      .sort()
      .map((f) => "tools/hooks/" + f),
  ]) {
    hash.update(rel);
    hash.update(readFileSync(resolve(root, rel)));
  }
  return hash.digest("hex");
}
/** Local execution evidence, not an attestation or the host's private trust DB.
 * No command arguments, prompts, transcripts or tool output are retained. */
export function recordObservation(root, payload, task, status, decision) {
  try {
    const dir = resolve(root, OBSERVATION_REL);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, actorIdentity(payload) + ".jsonl");
    if (existsSync(path) && statSync(path).size > 1024 * 1024) return;
    appendFileSync(
      path,
      JSON.stringify({
        at: new Date().toISOString(),
        fingerprint: hookFingerprint(root),
        session: payload.session_id || null,
        agent: payload.agent_id || null,
        event: payload.hook_event_name || null,
        tool: payload.tool_name || null,
        task,
        status,
        decision: decision || null,
      }) + "\n",
    );
  } catch {
    /* Evidence storage failure never changes a guard's decision. */
  }
}
export function readObservations(root) {
  const dir = resolve(root, OBSERVATION_REL);
  const rows = [];
  try {
    for (const f of readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .slice(-100)) {
      const path = join(dir, f);
      if (statSync(path).size > 1100000) continue;
      for (const line of readFileSync(path, "utf8").split("\n")) {
        try {
          rows.push(JSON.parse(line));
        } catch {
          /* partial append */
        }
      }
    }
  } catch {
    /* No evidence is not proof of absent configuration or trust. */
  }
  return rows;
}
