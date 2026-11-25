/**
 * The hold on slot `main` (#4259): one run owns the slot at a time — either the
 * automatic `stage.yml` converge plus its suite, or an operator `e2e:stage main` run.
 *
 * The automatic run is already serialised by Actions itself: every `stage.yml` run of a
 * `main` push sits in the `stage-main` concurrency group, so its converge job and its
 * suite job hold the slot together for as long as that run is not `completed`. That run
 * is the holder of the automatic side; nothing on the box duplicates it.
 *
 * The operator side has no Actions run, so an operator run records its hold on the box
 * (`SLOT_HOLD_PATH`, root-owned, written through `sudo` over the operator's ssh). It
 * names the holder and the moment it was taken, and carries `until` — the stale bound
 * after which a crashed holder no longer owns the slot.
 *
 *   - `e2e:stage main` from a workstation refuses (exit 2) while another operator's
 *     hold is live, takes its own hold, then refuses while a `stage.yml` run of `main`
 *     is not `completed` (and drops its hold); it drops the hold when it ends.
 *   - The converge (`slot.mjs up|sync|reset main`, the release driver's unit included)
 *     refuses while an operator hold is live, naming it.
 *
 * The hold is taken BEFORE the Actions read, so the race closes: a run that becomes
 * active after the read finds the hold when its converge starts.
 *
 * Everything here is pure (the decision, the record, the shell text), so
 * `slot-hold.test.mjs` pins it on a machine with no box.
 */

/** The hold record on the stage box; `/var/lib/ds-platform` already holds the e2e reports. */
export const SLOT_HOLD_DIR = "/var/lib/ds-platform/slot-holds";
export const SLOT_HOLD_PATH = `${SLOT_HOLD_DIR}/main.json`;

/**
 * The stale bound of an operator hold: a full workstation run of the suite, its axe
 * and live-tier legs measured at under an hour (#4096: 45 min for the suite alone);
 * twice that is margin. A holder that crashed without dropping its hold stops
 * blocking converges once this has passed.
 */
export const OPERATOR_HOLD_MS = 2 * 60 * 60 * 1000;

/**
 * The stale bound of a not-`completed` `stage.yml` run: its converge job's
 * `timeout-minutes: 55` plus its suite job's `timeout-minutes: 90`, plus 15 minutes
 * for runner queueing and the status jobs. GitHub ends a job at its limit, so a run
 * still reported live past this is GitHub's own wedge, not a converge.
 */
export const ACTIONS_RUN_HOLD_MS = (55 + 90 + 15) * 60 * 1000;

/** The `gh run list` fields `actionsRunHolder` reads. */
export const STAGE_RUN_FIELDS = "databaseId,status,event,createdAt,displayTitle,url";

const HOLDER_RE = /^[\w .:@()/#+-]{1,160}$/;

/** The holder name of an operator run: who, from where, which process. */
export function operatorHolder({ user, host, pid }) {
  const clean = (s) => String(s ?? "").replace(/[^\w.-]/g, "") || "unknown";
  return `operator ${clean(user)}@${clean(host)} e2e:stage main (pid ${Number(pid) || 0})`;
}

/** The record an operator run writes: holder, since, until (ISO-8601 UTC). */
export function holdRecord({ holder, now, boundMs = OPERATOR_HOLD_MS }) {
  if (!HOLDER_RE.test(holder)) throw new Error(`bad slot holder: ${JSON.stringify(holder)}`);
  return {
    slot: "main",
    holder,
    since: new Date(now).toISOString(),
    until: new Date(now + boundMs).toISOString(),
  };
}

/**
 * The record read back from the box: `null` when there is none (empty text),
 * `{ unreadable: true }` when the file holds anything that is not a record.
 */
export function parseHold(text) {
  if (text === undefined || text === null || String(text).trim() === "") return null;
  try {
    const doc = JSON.parse(text);
    const since = Date.parse(doc?.since);
    const until = Date.parse(doc?.until);
    if (
      doc?.slot !== "main" ||
      typeof doc.holder !== "string" ||
      !HOLDER_RE.test(doc.holder) ||
      Number.isNaN(since) ||
      Number.isNaN(until)
    ) {
      return { unreadable: true };
    }
    return { holder: doc.holder, since: doc.since, until: doc.until };
  } catch {
    return { unreadable: true };
  }
}

/**
 * The decision for a run that wants slot `main`, given the hold on record.
 *
 *   proceed — no hold, or the hold is `self`'s own;
 *   refuse  — another holder's hold is live; `reason` names it and since when;
 *   reclaim — the hold is past its `until` (a crashed holder) or unreadable; the
 *             caller takes the slot and `reason` says whose hold it overrode.
 */
export function slotHoldDecision({ hold, now, self }) {
  if (hold === null || hold === undefined) return { action: "proceed" };
  if (hold.unreadable) {
    return { action: "reclaim", reason: `the hold record ${SLOT_HOLD_PATH} is unreadable` };
  }
  if (self !== undefined && hold.holder === self) return { action: "proceed" };
  if (now >= Date.parse(hold.until)) {
    return {
      action: "reclaim",
      reason: `the hold of ${hold.holder} since ${hold.since} went stale at ${hold.until}`,
    };
  }
  return {
    action: "refuse",
    holder: hold.holder,
    since: hold.since,
    reason: `slot main is held by ${hold.holder} since ${hold.since} (stale after ${hold.until})`,
  };
}

const LIVE_RUN_STATUSES = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

/**
 * The automatic side as a hold: the oldest `stage.yml` run of a `main` push that is
 * not `completed` (a PR-slot `workflow_dispatch` run holds `pr-<N>`, not `main`).
 * Returns the hold-shaped record `slotHoldDecision` reads, or `null`. A run older than
 * `ACTIONS_RUN_HOLD_MS` is past every job limit: its record is already stale.
 */
export function actionsRunHold(runs) {
  const live = (runs ?? [])
    .filter((r) => r && r.event === "workflow_run" && LIVE_RUN_STATUSES.has(r.status))
    .filter((r) => !Number.isNaN(Date.parse(r.createdAt)))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  if (live.length === 0) return null;
  const run = live[0];
  const created = Date.parse(run.createdAt);
  return {
    holder: `Actions run ${run.databaseId} (${run.displayTitle}, ${run.status}) ${run.url}`,
    since: new Date(created).toISOString(),
    until: new Date(created + ACTIONS_RUN_HOLD_MS).toISOString(),
  };
}

/** The refusal line of a run that does not get the slot, with the way out. */
export function holdRefusal(decision, who) {
  return (
    `${who} refuses: ${decision.reason}. One run owns slot main at a time (#4259); ` +
    "wait for the holder to finish, or — if it crashed — for its stale bound."
  );
}

// --- the box (shell text only; the callers run it over their own transport) -------

/** Prints the record, or nothing when there is none. */
export function readHoldScript() {
  return `if sudo test -f ${SLOT_HOLD_PATH}; then sudo cat ${SLOT_HOLD_PATH}; fi`;
}

const b64 = (record) => Buffer.from(`${JSON.stringify(record)}\n`, "utf8").toString("base64");

/** Writes the record atomically (temp + rename), root-owned 0644 so the driver reads it. */
export function writeHoldScript(record) {
  return [
    "set -euo pipefail",
    `sudo install -d -m 0755 -o root -g root ${SLOT_HOLD_DIR}`,
    `tmp=$(sudo mktemp ${SLOT_HOLD_DIR}/.main.XXXXXX)`,
    `printf '%s' '${b64(record)}' | base64 -d | sudo tee -- "$tmp" >/dev/null`,
    `sudo chmod 0644 -- "$tmp"`,
    `sudo mv -f -- "$tmp" ${SLOT_HOLD_PATH}`,
  ].join("\n");
}

/** Drops the record only while it is still `record` — never another holder's hold. */
export function clearHoldScript(record) {
  return (
    `if [ "$(sudo cat ${SLOT_HOLD_PATH} 2>/dev/null | base64 -w0)" = '${b64(record)}' ]; ` +
    `then sudo rm -f -- ${SLOT_HOLD_PATH}; fi`
  );
}

/**
 * The converge side (`slot.mjs up|sync|reset main`): the record read from the box,
 * decided with no `self` (a converge never holds the record itself — its hold is its
 * `stage.yml` run). `{ refusal }` names the live operator holder; `{ note }` names a
 * stale one the converge overrides; `{}` when the slot is free.
 */
export function convergeHoldCheck({ text, now, command }) {
  const decision = slotHoldDecision({ hold: parseHold(text), now });
  if (decision.action === "refuse") return { refusal: holdRefusal(decision, `slot ${command} main`) };
  if (decision.action === "reclaim") return { note: `# ${decision.reason}; the converge proceeds` };
  return {};
}
