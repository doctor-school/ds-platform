/** Stage-B records are auditable owner relays, not identity authentication. */
import { isNonRuntimePath, type ChangeTier } from "./change-tier";

export interface StageBRecord {
  body: string;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
  /** Native scope assigned by the loader; never parsed from owner-controlled text. */
  batchContext?: { gate: number; child: StageBRecord };
}
type StageBDecision = ReturnType<typeof stageBDecisions>[number];
type Verdict =
  | { ok: true; reason: string; decision: StageBDecision }
  | { ok: false; reason: string };
const marker = /^[ \t]*Stage-?B:[ \t]*(.*?)[ \t]*$/gim; // no-hardcoded-path-ok: approval marker regex, not a filesystem path
const meaningful = (value: string) =>
  value.length > 0 && !/^(?:n\/a|none|tbd|pending|todo|<.*>)$/i.test(value);
const utc = (value: string) =>
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && // no-hardcoded-path-ok: ISO UTC timestamp regex, not a filesystem path
  Number.isFinite(Date.parse(value));
export const stageBField = (body: string, name: string) =>
  body
    .match(new RegExp(`^Stage-B-${name}:[ \\t]*([^\\r\\n]*)$`, "mi"))?.[1]
    ?.trim() ?? "";
const sourceOk = (value: string) =>
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+#(?:issuecomment-|discussion_r|pullrequestreview-)\d+$/.test(
    value,
  ) || /^owner-relay:[\w.-]+#[\w.-]+$/.test(value);

function decisionTime(record: StageBRecord, value: string): number {
  const recorded = Date.parse(stageBField(record.body, "recorded-at"));
  const native = [record.updatedAt, record.createdAt]
    .map((date) => Date.parse(date ?? ""))
    .filter(Number.isFinite);
  const affirmative =
    /^(?:GO(?:\s*[-\u2013\u2014]|$)|batched at #\d+\s*$|N\/A \(no visual surface\).*lead-certified)/i.test(
      value,
    ) &&
    !/\b(?:pending|hold|no|revoked|tbd|not)\b/i.test(
      value.replace(/no visual surface/i, ""),
    );
  if (affirmative) return recorded;
  const timestamps = [recorded, ...native].filter(Number.isFinite);
  return timestamps.length ? Math.max(...timestamps) : NaN;
}

export function stageBDecisions(records: StageBRecord[]) {
  return records
    .flatMap((record, order) =>
      [...record.body.matchAll(marker)].map((match, index) => ({
        ...record,
        value: match[1],
        order,
        index,
        // Approval age never refreshes merely because a body was edited. A
        // refusal/pending marker must honor its later native creation/edit time.
        time: decisionTime(record, match[1]),
      })),
    )
    .sort((a, b) => a.time - b.time || a.order - b.order || a.index - b.index);
}

/** Patch-id equivalence probe between a recorded head and the current head
 * (the merge gate's `checkRebaseEquivalence`, injected so this stays pure). */
export type HeadEquivalence = (
  recordedHead: string,
  head: string,
) => { accepted: boolean; reason: string; equal?: number; total?: number };

/** #2699: the files this PR's own diff changed between the recorded head and
 * the current head, net of main (a rebase onto other people's runtime files is
 * not this PR's delta). Injected so this module stays pure. */
export type HeadDelta = (
  recordedHead: string,
  head: string,
) => { ok: true; files: string[] } | { ok: false; reason: string };

/** #2699: the slot-free proof of a lead-certified N/A, read by the caller. */
export interface SlotFreeContext {
  /** Changed paths that keep the live slot report (auth, mailer, migrations…). */
  environmentSensitive: string[];
  /** The required CI e2e check on the current head SHA. */
  ciE2e: { ok: boolean; detail: string };
}

export interface StageBOptions {
  headDelta?: HeadDelta;
  slotFree?: SlotFreeContext;
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();
const QUOTE_MARKS = /^["'«“„]+|["'»”]+$/g;

/**
 * #2699: an owner quote is the owner's decision, never a line of a repo
 * instruction file. Returns the instruction file a quote occurs in verbatim
 * (whitespace-collapsed), or null. A short quote («Го», «Окей») merely also
 * occurring in a file is not a copied instruction line, so it is not refused.
 */
export function instructionQuoteSource(
  quote: string,
  docs: Record<string, string>,
): string | null {
  const needle = collapse(quote).replace(QUOTE_MARKS, "").trim();
  if (needle.length < 20) return null;
  for (const [path, text] of Object.entries(docs))
    if (collapse(text).includes(needle)) return path;
  return null;
}

export function validateStageB(
  records: StageBRecord[],
  head: string,
  paths: string[],
  gates: Record<number, string>,
  headEquivalent?: HeadEquivalence,
  copyOnlyCertified = false,
  tier: ChangeTier = "ask",
  options: StageBOptions = {},
): Verdict {
  const candidates = stageBDecisions(records);
  if (!candidates.length) return { ok: false, reason: "No Stage-B record" };
  // An undated decision cannot be shown to precede the GO: do not silently ignore it.
  if (candidates.some((c) => !Number.isFinite(c.time)))
    return {
      ok: false,
      reason: "Undated Stage-B decision; reconcile the record",
    };
  const latest = candidates.at(-1)!;
  const field = (name: string) => stageBField(latest.body, name);
  const go =
    /^GO(?:\s*[-\u2013\u2014]\s*[^;]+)?$/i.test(latest.value) &&
    !/\b(?:pending|hold|no|revoked|tbd|not)\b/i.test(latest.value);
  const batch = /^batched at #(\d+)\s*$/i.exec(latest.value);
  const lead =
    /^N\/A \(no visual surface\)\s*[-\u2013\u2014]\s*lead-certified(?:;|$)/i.test(
      latest.value,
    );
  if (!go && !batch && !lead)
    return {
      ok: false,
      reason:
        "Latest decision is not a Stage-B GO/batched/lead-certified approval (pending/refused/revoked)",
    };
  const recordedHead = field("head");
  let carried = "";
  // #2584: a ship-tier GO approves the wording with no live stand, but it
  // stays head-pinned so a later push cannot inherit a GO given on other text.
  const shipGo = go && tier === "ship";
  if (!/^[a-f0-9]{40}$/.test(head) || recordedHead !== head) {
    const stale =
      "Stage-B head is missing or stale; record current applicability or obtain a fresh verdict";
    // #2373: a pure rebase keeps a valid record, exactly as the Mode (a)
    // carry-over does (#1865). #2699: so does a delta made only of non-runtime
    // files (tests, changesets, evidence captures, docs). A slot-report lead
    // certification stays pinned by its own `report-sha` check below.
    if (
      (!headEquivalent && !options.headDelta) ||
      !/^[a-f0-9]{40}$/.test(head) ||
      !/^[a-f0-9]{40}$/.test(recordedHead)
    )
      return { ok: false, reason: stale };
    const probe = headEquivalent?.(recordedHead, head);
    const from = `${recordedHead.slice(0, 12)} to ${head.slice(0, 12)}`;
    if (probe?.accepted) {
      const rows =
        probe.total === undefined ? "" : `, ${probe.equal}/${probe.total} =`;
      carried = ` — carried from ${from} (patch-id-identical: git range-diff origin/main${rows})`;
    } else {
      const why = probe ? [probe.reason] : [];
      if (!options.headDelta)
        return { ok: false, reason: `${stale} (${why.join("; ")})` };
      const delta = options.headDelta(recordedHead, head);
      if (!delta.ok)
        return {
          ok: false,
          reason: `${stale} (${[...why, delta.reason].join("; ")})`,
        };
      const runtime = delta.files.filter((path) => !isNonRuntimePath(path));
      if (runtime.length)
        return {
          ok: false,
          reason: `${stale} (runtime file(s) changed since the recorded head: ${runtime.join(", ")})`,
        };
      carried = ` — carried from ${from} over a non-runtime delta (net of main): ${delta.files.join(", ") || "no file"}`;
    }
  }
  if (
    !utc(field("recorded-at")) ||
    Date.parse(field("recorded-at")) > Date.now() + 60_000
  )
    return {
      ok: false,
      reason: "Stage-B recorded-at must be a past ISO UTC timestamp",
    };
  if (!meaningful(field("owner-quote")) || !sourceOk(field("source")))
    return {
      ok: false,
      reason:
        "Stage-B requires the exact owner quote and its decision URL or explicit owner-relay session/message source",
    };
  // #2581: a copy-only PR (reviewer-certified `render-delta: copy-only`, the
  // caller's `ui-parity` verdict) is approved on the owner's chat wording
  // decision — no stand, so no live URL. Quote, source and head stay required.
  // #2584: ship needs no stand either; a show GO may cite a PR evidence
  // capture (`Stage-B-evidence: https://…`) in place of a live staging URL.
  const showEvidence =
    tier === "show" && /^https:\/\/\S+$/.test(field("evidence"));
  if (
    go &&
    !copyOnlyCertified &&
    !shipGo &&
    !showEvidence &&
    !/^https?:\/\/\S+$/.test(field("live-url"))
  )
    return {
      ok: false,
      reason:
        "Stage-B GO requires the reviewed live URL (a reviewer-certified `ui-parity: N/A (copy-only)` PR excepted)",
    };
  let slotFree = "";
  if (lead) {
    const run =
      latest.value.match(/;\s*run UTC:\s*([^;]+)/i)?.[1]?.trim() ?? "";
    const harness =
      latest.value.match(/;\s*harness:\s*([^;]+)/i)?.[1]?.trim() ?? "";
    const report =
      latest.value.match(/;\s*report:\s*(https:\/\/\S+)/i)?.[1] ?? "";
    const slotReport =
      field("live-verified") === "yes" &&
      utc(run) &&
      meaningful(harness) &&
      !!report &&
      field("report-sha") === head &&
      meaningful(field("report-stdout"));
    const authorized =
      field("authorization") === "autonomous-merge" &&
      field("visual-change") === "none";
    if (!authorized || (!slotReport && !options.slotFree))
      return {
        ok: false,
        reason:
          "Lead certification requires owner autonomous-merge authorization, no visual change, live harness/run UTC/report, complete stdout and tested head SHA",
      };
    // #2699: an invisible change is proven automatically — the required CI e2e
    // check on the current head plus before/after captures replace the slot
    // report, except where the live environment is the risk.
    const context = options.slotFree;
    if (!slotReport && context) {
      if (context.environmentSensitive.length)
        return {
          ok: false,
          reason: `Lead certification of an environment-sensitive PR (${context.environmentSensitive.join(", ")}) requires the live slot harness report: live-verified, harness/run UTC/report, complete stdout and tested head SHA`,
        };
      if (!/^https:\/\/\S+$/.test(field("evidence")))
        return {
          ok: false,
          reason:
            "Slot-free lead certification requires before/after captures of every touched screen (main vs head) as `Stage-B-evidence: https://…`",
        };
      if (!context.ciE2e.ok)
        return {
          ok: false,
          reason: `Slot-free lead certification requires the green required CI e2e check on the current head (${context.ciE2e.detail})`,
        };
      slotFree = ` — slot-free: ${context.ciE2e.detail}; captures ${field("evidence")}`;
    }
  }
  const batchId =
    latest.batchContext?.gate ?? (batch ? Number(batch[1]) : null);
  if (batchId !== null) {
    const gate = gates[batchId] ?? "";
    const covered = stageBField(gate, "surfaces")
      .split(",")
      .map((s) => s.trim());
    const declared = stageBField(
      latest.batchContext?.child.body ?? latest.body,
      "surfaces",
    )
      .split(",")
      .map((s) => s.trim());
    if (
      stageBField(gate, "batch-approved") !== "yes" ||
      !meaningful(stageBField(gate, "owner-quote")) ||
      !sourceOk(stageBField(gate, "source")) ||
      stageBField(gate, "new-section") !== "no" ||
      paths.some((path) => !covered.includes(path) || !declared.includes(path))
    )
      return {
        ok: false,
        reason:
          "Batched Stage-B needs the approved decomposition, bounded surface list and no new section at the gate Issue",
      };
  }
  return {
    ok: true,
    reason: `Current Stage-B record: ${latest.value}${carried}${slotFree}`,
    decision: latest,
  };
}
