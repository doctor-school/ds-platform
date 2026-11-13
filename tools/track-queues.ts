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
  /**
   * Sub-issues of open queue items, in sub-issue order (#4053); absent or
   * empty = a leaf, `null` = unreadable. Their claims and blockers live in
   * `claims` / `blockers` keyed by the child's number.
   */
  children: Map<number, QueueIssue[] | null>;
  /**
   * Parent of a closed queue item; `null` = none, absent = not read.
   * `openChildren` = the parent's open sub-issues (`null` = unreadable).
   */
  parents: Map<
    number,
    {
      number: number;
      title: string;
      state: "open" | "closed";
      openChildren: number[] | null;
    } | null
  >;
}

export interface ResolvedTrack {
  label: string;
  goal: string;
  inWork: Array<{ number: number; title: string; claim: ClaimSignal }>;
  /** `null` = queue empty; `undefined` = an earlier item is unreadable. */
  next:
    | {
        number: number;
        title: string;
        blockers: Blocker[] | null;
        /** Set when the queue item is a parent expanded to this child. */
        parent?: { number: number; title: string };
      }
    | null
    | undefined;
}

export function resolveTrackQueues(
  tracks: TrackQueue[],
  data: TrackQueueData,
): { tracks: ResolvedTrack[]; warnings: Warn[] } {
  const warnings: Warn[] = [];
  // A child of a queued parent is queue work (#4053), not work outside it.
  const queued = new Set(
    tracks.flatMap((t) =>
      t.items.flatMap((n) => [
        n,
        ...(data.children.get(n) ?? []).map((c) => c.number),
      ]),
    ),
  );
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
      if (i.state !== "open") {
        // Only an outcome Issue is a queue item (#4053): a closed step whose
        // open parent is not queued means the outcome fell out of the queue.
        const p = data.parents.get(n);
        // Silent while every open sibling is itself queued: nothing fell out.
        if (
          p &&
          p.state === "open" &&
          !queued.has(p.number) &&
          (p.openChildren ?? []).some((c) => !queued.has(c))
        )
          warnings.push({
            source,
            message: `#${n} is a step of #${p.number} ${clip(p.title)} — queue #${p.number} instead`,
          });
        continue;
      }
      const blockersOf = (k: number) =>
        data.blockers.has(k) ? data.blockers.get(k)! : [];
      const kids = data.children.get(n);
      if (kids === null) {
        // Unreadable sub-issues: the item may be a parent — never a leaf.
        unknownSeen = true;
        continue;
      }
      if (kids === undefined || kids.length === 0) {
        open++;
        const claim = data.claims.get(n);
        if (claim) r.inWork.push({ number: n, title: i.title, claim });
        else if (r.next === null)
          r.next = unknownSeen
            ? undefined
            : { number: n, title: i.title, blockers: blockersOf(n) };
        continue;
      }
      // A parent's own claim (e.g. a spec session) never hides its children.
      const openKids = kids.filter((c) => c.state === "open");
      if (openKids.length === 0) {
        warnings.push({
          source,
          message: `#${n} is open with no open sub-issues — open the next slice or close it (ask the owner)`,
        });
        continue;
      }
      open++;
      const free = openKids.filter((c) => {
        const cc = data.claims.get(c.number);
        if (cc) r.inWork.push({ number: c.number, title: c.title, claim: cc });
        return !cc;
      });
      const pick =
        free.find((c) => blockersOf(c.number)?.length === 0) ?? free[0];
      if (pick && r.next === null)
        r.next = unknownSeen
          ? undefined
          : {
              number: pick.number,
              title: pick.title,
              blockers: blockersOf(pick.number),
              parent: { number: n, title: i.title },
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
      const step = t.next.parent
        ? ` — step of #${t.next.parent.number} ${clip(t.next.parent.title)}`
        : "";
      out.push(
        `- next #${t.next.number} ${clip(t.next.title)}${step}${unknown}`,
      );
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

/** execa puts `gh: Not Found (HTTP 404)` in stderr, below the first line. */
const httpStatus = (e: unknown, re: RegExp) =>
  re.test(e instanceof Error ? e.message : String(e));

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
    children: new Map(),
    parents: new Map(),
  };
  const api = async <T>(path: string, paginate = false): Promise<T> => {
    const args = ["api", path];
    if (paginate) args.push("--paginate", "--slurp");
    const { stdout } = await execa("gh", args, { cwd: repoRoot });
    return JSON.parse(stdout) as T;
  };
  /** Claim + open native blockers of one open Issue (queue item or child). */
  const loadWork = async (n: number) => {
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
  };
  const toQueueIssue = (i: GhIssueJson): QueueIssue => ({
    number: i.number,
    title: i.title,
    state: i.state === "open" ? "open" : "closed",
    tracks: trackLabels(i),
  });
  const numbers = [...new Set(parsed.tracks.flatMap((t) => t.items))];
  await Promise.all(
    numbers.map(async (n) => {
      let i: GhIssueJson;
      try {
        i = await api<GhIssueJson>(`repos/{owner}/{repo}/issues/${n}`);
      } catch (e) {
        if (httpStatus(e, /HTTP 404|HTTP 410/)) data.issues.set(n, null);
        else
          warnings.push({ source: `track queue #${n}`, message: firstLine(e) });
        return;
      }
      if (i.pull_request) {
        data.issues.set(n, null);
        return;
      }
      const item = { ...toQueueIssue(i), number: n };
      data.issues.set(n, item);
      if (item.state !== "open") {
        // A closed step under an open, unqueued parent is a Warnings row (#4053).
        try {
          const p = await api<GhIssueJson>(
            `repos/{owner}/{repo}/issues/${n}/parent`,
          );
          const state = p.state === "open" ? "open" : "closed";
          const openChildren =
            state !== "open"
              ? []
              : await api<GhIssueJson[][]>(
                  `repos/{owner}/{repo}/issues/${p.number}/sub_issues`,
                  true,
                )
                  .then((pages) =>
                    pages
                      .flat()
                      .filter((c) => c.state === "open")
                      .map((c) => c.number),
                  )
                  .catch((e) => {
                    warnings.push({
                      source: `track queue #${n} parent #${p.number} sub-issues`,
                      message: firstLine(e),
                    });
                    return null;
                  });
          data.parents.set(n, {
            number: p.number,
            title: p.title,
            state,
            openChildren,
          });
        } catch (e) {
          if (httpStatus(e, /HTTP 404/)) data.parents.set(n, null);
          else
            warnings.push({
              source: `track queue #${n} parent`,
              message: firstLine(e),
            });
        }
        return;
      }
      const [, kids] = await Promise.all([
        loadWork(n),
        api<GhIssueJson[][]>(
          `repos/{owner}/{repo}/issues/${n}/sub_issues`,
          true,
        )
          .then((pages) => pages.flat().map(toQueueIssue))
          .catch((e) => {
            warnings.push({
              source: `track queue #${n} sub-issues`,
              message: firstLine(e),
            });
            return null;
          }),
      ]);
      data.children.set(n, kids);
      await Promise.all(
        (kids ?? [])
          .filter((c) => c.state === "open")
          .map((c) => loadWork(c.number)),
      );
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
