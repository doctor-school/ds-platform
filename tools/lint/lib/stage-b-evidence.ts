/** Stage-B records are auditable owner relays, not identity authentication. */
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

export function validateStageB(
  records: StageBRecord[],
  head: string,
  paths: string[],
  gates: Record<number, string>,
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
  if (!/^[a-f0-9]{40}$/.test(head) || field("head") !== head)
    return {
      ok: false,
      reason:
        "Stage-B head is missing or stale; record current applicability or obtain a fresh verdict",
    };
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
  if (go && !/^https?:\/\/\S+$/.test(field("live-url")))
    return { ok: false, reason: "Stage-B GO requires the reviewed live URL" };
  if (lead) {
    const run =
      latest.value.match(/;\s*run UTC:\s*([^;]+)/i)?.[1]?.trim() ?? "";
    const harness =
      latest.value.match(/;\s*harness:\s*([^;]+)/i)?.[1]?.trim() ?? "";
    const report =
      latest.value.match(/;\s*report:\s*(https:\/\/\S+)/i)?.[1] ?? "";
    if (
      field("authorization") !== "autonomous-merge" ||
      field("visual-change") !== "none" ||
      field("live-verified") !== "yes" ||
      !utc(run) ||
      !meaningful(harness) ||
      !report ||
      field("report-sha") !== head ||
      !meaningful(field("report-stdout"))
    )
      return {
        ok: false,
        reason:
          "Lead certification requires owner autonomous-merge authorization, no visual change, live harness/run UTC/report, complete stdout and tested head SHA",
      };
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
    reason: `Current Stage-B record: ${latest.value}`,
    decision: latest,
  };
}
