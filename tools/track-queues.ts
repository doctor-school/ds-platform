/**
 * Owner-ordered track queues (#3942) — the single reader of
 * `apps/docs/content/product/track-queues.md`, shared by `pnpm bootstrap` and
 * `pnpm backlog:triage` `## Tracks`. The file stores order only (per track a
 * goal and Issue numbers); state, titles, claims and blockers are resolved from
 * live GitHub here. Pure parse / resolve / render seams + one I/O loader.
 *
 * Convention (as in `## Epics`): `null` = the source could not be read —
 * rendered as «unknown — see Warnings», never as an empty queue.
 */
import { execa } from "execa";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import {
  claimLabel,
  detectClaim,
  fetchClaimComments,
  worktreeClaimMtime,
  type ClaimSignal,
} from "./backlog-triage";

export const TRACK_QUEUES_PATH = "apps/docs/content/product/track-queues.md";

export interface Warn {
  source: string;
  message: string;
}

export interface TrackQueue {
  /** File key — the track label without `track:`. */
  key: string;
  label: string;
  goal: string;
  items: number[];
}

export type ParseResult =
  { ok: true; tracks: TrackQueue[] } | { ok: false; error: string };

/** `raw === null` = the file is missing. */
export function parseTrackQueues(raw: string | null): ParseResult {
  if (raw === null)
    return { ok: false, error: `${TRACK_QUEUES_PATH} is missing` };
  const block = raw.match(/^```ya?ml\r?\n([\s\S]*?)^```/m)?.[1];
  if (block === undefined)
    return { ok: false, error: "no ```yaml queue block in the file" };
  let data: unknown;
  try {
    data = parseYaml(block);
  } catch (e) {
    return {
      ok: false,
      error: `queue block is not YAML: ${(e as Error).message.split("\n")[0]}`,
    };
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    return {
      ok: false,
      error: "queue block must map track keys to { goal, queue }",
    };
  const tracks: TrackQueue[] = [];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const v = value as { goal?: unknown; queue?: unknown } | null;
    if (
      !/^[a-z][a-z0-9-]*$/.test(key) ||
      !v ||
      typeof v.goal !== "string" ||
      v.goal.trim() === "" ||
      !Array.isArray(v.queue) ||
      !v.queue.every((n) => Number.isInteger(n) && n > 0)
    )
      return {
        ok: false,
        error: `track "${key}" needs a goal string and a queue of Issue numbers`,
      };
    tracks.push({
      key,
      label: `track:${key}`,
      goal: v.goal.trim(),
      items: v.queue as number[],
    });
  }
  return { ok: true, tracks };
}

export interface QueueIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  /** The Issue's `track:*` labels. */
  tracks: string[];
}

export interface Blocker {
  number: number;
  title: string;
  track: string | null;
}

export interface TrackQueueData {
  /** Absent = unreadable; `null` = no such Issue. */
  issues: Map<number, QueueIssue | null>;
  claims: Map<number, ClaimSignal>;
  /** Open native `blocked_by` blockers of open queue items; `null` = unreadable. */
  blockers: Map<number, Blocker[] | null>;
  /** Claimed / in-progress open Issues per product track label. */
  claimedOnTrack: Map<string, Array<{ number: number; title: string }>>;
}

export interface ResolvedTrack {
  label: string;
  goal: string;
  inWork: Array<{ number: number; title: string; claim: ClaimSignal }>;
  /** `null` = queue empty; `undefined` = an earlier item is unreadable. */
  next:
    | { number: number; title: string; blockers: Blocker[] | null }
    | null
    | undefined;
}

export function resolveTrackQueues(
  tracks: TrackQueue[],
  data: TrackQueueData,
): { tracks: ResolvedTrack[]; warnings: Warn[] } {
  const warnings: Warn[] = [];
  const queued = new Set(tracks.flatMap((t) => t.items));
  const blocking = new Set(
    [...data.blockers.values()].flatMap((bs) => bs ?? []).map((b) => b.number),
  );
  const resolved = tracks.map((t): ResolvedTrack => {
    const source = `track queue ${t.label}`;
    const r: ResolvedTrack = {
      label: t.label,
      goal: t.goal,
      inWork: [],
      next: null,
    };
    let open = 0;
    let unknownSeen = false;
    for (const n of t.items) {
      if (!data.issues.has(n)) {
        warnings.push({
          source,
          message: `#${n} unreadable — its state is unknown`,
        });
        unknownSeen = true;
        continue;
      }
      const i = data.issues.get(n);
      if (i === null || i === undefined) {
        warnings.push({
          source,
          message: `#${n} does not exist — fix the queue file`,
        });
        continue;
      }
      if (!i.tracks.includes(t.label))
        warnings.push({
          source,
          message: `#${n} carries ${i.tracks.join(", ") || "no track:* label"}, not ${t.label} — fix the queue or the label`,
        });
      if (i.state !== "open") continue;
      open++;
      const claim = data.claims.get(n);
      if (claim) r.inWork.push({ number: n, title: i.title, claim });
      else if (r.next === null)
        r.next = unknownSeen
          ? undefined
          : {
              number: n,
              title: i.title,
              blockers: data.blockers.has(n) ? data.blockers.get(n)! : [],
            };
    }
    if (r.next === null && unknownSeen) r.next = undefined;
    if (open < 2 && !unknownSeen)
      warnings.push({
        source,
        message: `${open} open item${open === 1 ? "" : "s"} left — ask the owner for the next order`,
      });
    const outside = (data.claimedOnTrack.get(t.label) ?? []).filter(
      (c) => !queued.has(c.number) && !blocking.has(c.number),
    );
    if (outside.length > 0)
      warnings.push({
        source,
        message: `work outside the queue: ${outside.map((c) => `#${c.number} ${c.title}`).join("; ")}`,
      });
    return r;
  });
  return { tracks: resolved, warnings };
}

const TITLE_MAX = 70;
const clip = (s: string) =>
  s.length > TITLE_MAX ? `${s.slice(0, TITLE_MAX - 1)}…` : s;

/** `tracks === null` = the queue file could not be read. */
export function renderTracksSection(
  tracks: ResolvedTrack[] | null,
  fileDate: string | null,
): string[] {
  const head = "## Tracks";
  if (tracks === null) return [head, "(unknown — see Warnings)"];
  const out = [
    head,
    `Owner order: \`${TRACK_QUEUES_PATH}\` (last commit ${fileDate ?? "uncommitted"}). Given a track and no task, take its next item without asking.`,
  ];
  for (const t of tracks) {
    out.push(`### ${t.label} — ${t.goal}`);
    for (const w of t.inWork)
      out.push(
        `- in work #${w.number} ${clip(w.title)} — ${claimLabel(w.claim)}`,
      );
    if (t.next === undefined) out.push("- next (unknown — see Warnings)");
    else if (t.next === null)
      out.push("- next (queue empty — ask the owner for the next order)");
    else {
      const unknown =
        t.next.blockers === null ? " — blockers unknown — see Warnings" : "";
      out.push(`- next #${t.next.number} ${clip(t.next.title)}${unknown}`);
      for (const b of t.next.blockers ?? [])
        out.push(
          `  - blocked by #${b.number} ${clip(b.title)} (${b.track ?? "no track"})`,
        );
    }
  }
  return out;
}

// ── I/O (only reached from the two tools' main()) ───────────────────────────

interface GhIssueJson {
  number: number;
  title: string;
  state: string;
  labels?: Array<{ name: string } | string>;
  pull_request?: unknown;
}

const trackLabels = (i: GhIssueJson): string[] =>
  (i.labels ?? [])
    .map((l) => (typeof l === "string" ? l : l.name))
    .filter((n) => n.startsWith("track:"));

const firstLine = (e: unknown) =>
  e instanceof Error ? e.message.split("\n")[0]! : String(e);

/**
 * Read the queue file and resolve it against live GitHub. Never throws: every
 * failed source becomes a Warnings row, a failed file read renders as unknown.
 * Claims reuse `detectClaim` (worktree + start-comment, #811) — a failed
 * comment fetch is a Warnings row, not a silent worktree-only check; work outside the
 * queue is an open track Issue with a worktree or the `agent-working` label.
 */
export async function loadTrackQueues(
  repoRoot: string,
  mainRoot: string,
  nowMs = Date.now(),
): Promise<{
  tracks: ResolvedTrack[] | null;
  fileDate: string | null;
  warnings: Warn[];
}> {
  const warnings: Warn[] = [];
  const raw = await readFile(
    resolve(repoRoot, TRACK_QUEUES_PATH),
    "utf-8",
  ).catch(() => null);
  const parsed = parseTrackQueues(raw);
  if (!parsed.ok) {
    warnings.push({ source: "track queues", message: parsed.error });
    return { tracks: null, fileDate: null, warnings };
  }
  const fileDate = await execa(
    "git",
    ["log", "-1", "--format=%cs", "--", TRACK_QUEUES_PATH],
    {
      cwd: repoRoot,
    },
  )
    .then((r) => r.stdout.trim() || null)
    .catch(() => null);

  const data: TrackQueueData = {
    issues: new Map(),
    claims: new Map(),
    blockers: new Map(),
    claimedOnTrack: new Map(),
  };
  const api = async <T>(path: string, paginate = false): Promise<T> => {
    const args = ["api", path];
    if (paginate) args.push("--paginate", "--slurp");
    const { stdout } = await execa("gh", args, { cwd: repoRoot });
    return JSON.parse(stdout) as T;
  };
  const numbers = [...new Set(parsed.tracks.flatMap((t) => t.items))];
  await Promise.all(
    numbers.map(async (n) => {
      let i: GhIssueJson;
      try {
        i = await api<GhIssueJson>(`repos/{owner}/{repo}/issues/${n}`);
      } catch (e) {
        if (/HTTP 404|HTTP 410/.test(firstLine(e))) data.issues.set(n, null);
        else
          warnings.push({ source: `track queue #${n}`, message: firstLine(e) });
        return;
      }
      if (i.pull_request) {
        data.issues.set(n, null);
        return;
      }
      const state = i.state === "open" ? "open" : "closed";
      data.issues.set(n, {
        number: n,
        title: i.title,
        state,
        tracks: trackLabels(i),
      });
      if (state !== "open") return;
      const [blockers, worktreeMtimeMs, comments] = await Promise.all([
        api<GhIssueJson[][]>(
          `repos/{owner}/{repo}/issues/${n}/dependencies/blocked_by`,
          true,
        ).catch((e) => {
          warnings.push({
            source: `track queue #${n} blocked_by`,
            message: firstLine(e),
          });
          return null;
        }),
        worktreeClaimMtime(mainRoot, n),
        fetchClaimComments(n, repoRoot),
      ]);
      if (comments === undefined)
        warnings.push({
          source: `track queue #${n} claim comments`,
          message: "unreadable — claim checked by worktree only",
        });
      const claim = detectClaim({
        nowMs,
        ...(worktreeMtimeMs === undefined ? {} : { worktreeMtimeMs }),
        ...(comments === undefined ? {} : { comments }),
      });
      if (claim) data.claims.set(n, claim);
      if (blockers === null) {
        data.blockers.set(n, null);
        return;
      }
      const open = blockers
        .flat()
        .filter((b) => b.state === "open")
        .map((b) => ({
          number: b.number,
          title: b.title,
          track: trackLabels(b)[0] ?? null,
        }));
      if (open.length > 0) data.blockers.set(n, open);
    }),
  );

  const worktrees = new Set(
    await readdir(resolve(mainRoot, ".claude", "worktrees")).catch(
      () => [] as string[],
    ),
  );
  await Promise.all(
    parsed.tracks.map(async (t) => {
      try {
        const { stdout } = await execa(
          "gh",
          [
            "issue",
            "list",
            "--state",
            "open",
            "--label",
            t.label,
            "--limit",
            "500",
            "--json",
            "number,title,labels",
          ],
          { cwd: repoRoot },
        );
        const rows = JSON.parse(stdout) as Array<{
          number: number;
          title: string;
          labels: Array<{ name: string }>;
        }>;
        data.claimedOnTrack.set(
          t.label,
          rows
            .filter(
              (r) =>
                worktrees.has(String(r.number)) ||
                r.labels.some((l) => l.name === "agent-working"),
            )
            .map((r) => ({ number: r.number, title: r.title })),
        );
      } catch (e) {
        warnings.push({
          source: `track queue ${t.label} claims`,
          message: firstLine(e),
        });
      }
    }),
  );

  const resolved = resolveTrackQueues(parsed.tracks, data);
  return {
    tracks: resolved.tracks,
    fileDate,
    warnings: [...warnings, ...resolved.warnings],
  };
}
