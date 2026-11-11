import type { OriginReceipt, LegacyBarReceipt } from "./recording-lifecycle.js";
import { rerunTitle, type BackfillReceipt } from "./recording-backfill.js";
export function originFixture(origin: "platform" | "legacy"): OriginReceipt {
  const states =
    origin === "platform"
      ? ["draft", "published", "live", "ended", "hidden"]
      : ["hidden", "in_archive"];
  const transitions =
    origin === "platform"
      ? [["published"], ["live"], ["ended"], ["hidden"], []]
      : [["in_archive"], ["hidden"]];
  const commands =
    origin === "platform"
      ? ["archive-legacy", "hide-legacy", "transition:in_archive"]
      : [
          "publish",
          "open",
          "close",
          "hide",
          "transition:draft",
          "transition:published",
          "transition:live",
          "transition:ended",
        ];
  const answer = (id: string, action: string, status: number) => ({
    status,
    body:
      status === 400
        ? {
            message: "invalid event payload",
            issues: [
              { path: ["origin"], expected: "never", code: "invalid_type" },
            ],
          }
        : {
            errorCode: "INVALID_TRANSITION",
            ...(action.startsWith("transition:")
              ? { to: action.split(":")[1] }
              : {}),
          },
    request: {
      method: action ? "POST" : "PATCH",
      path: `/v1/admin/events/${id}${action ? `/${action.split(":")[0]}` : ""}`,
      ifMatch: 'W/"1"',
      idempotencyKey: "12345678-1234-4123-8123-123456789abc",
      transport: "api",
    },
  });
  const before = { id: "editable", origin, state: states[0], version: 1 };
  return {
    origin,
    machine: states.join(", "),
    states: states.map((state, i) => {
      const row = { id: state, origin, state, version: 1 };
      return {
        before: row,
        after: row,
        validTransitions: transitions[i]!,
        refusals: commands.map((command) => ({
          command,
          answer: answer(state, command, 409),
        })),
      };
    }),
    update: {
      before,
      after: before,
      suppliedOrigin: origin === "platform" ? "legacy" : "platform",
      answer: answer("editable", "", 400),
      control: {
        ...answer("editable", "", 200),
        body: { origin, title: "Control" },
      },
      controlAfter: { ...before, title: "Control", version: 2 },
    },
  };
}

export function barFixture(): LegacyBarReceipt {
  return {
    states: ["hidden", "in_archive"].map((state, i) => ({
      id: state,
      origin: "legacy",
      state,
      recording: { status: "published", deleted_at: null },
      validTransitions: [i ? "hidden" : "in_archive"],
      labels: [i ? "Скрыть" : "Архивировать"],
      controls: [i ? "action-hide-legacy" : "action-archive-legacy"],
      transport: "browser",
    })),
  };
}
export function rerunFixture(): BackfillReceipt {
  const actor = "operator",
    event = { id: "owned", origin: "platform", state: "ended" };
  const row = {
    id: "recording",
    event_id: "owned",
    kind: "edited",
    status: "published",
    deleted_at: null,
  };
  const audit = ["insert", "update"].map((action) => ({
    id: action,
    event_type: `data.event_recordings.${action}`,
    subject_id: actor,
    metadata: {
      source: "system:recordings-backfill",
      table: "event_recordings",
      pk: { id: row.id },
    },
  }));
  const stdout = (outcome: string) =>
    [
      { event: event.id, kind: "edited", outcome, recordingId: row.id },
      {
        dryRun: false,
        summary: Object.fromEntries(
          [
            "attached+published",
            "published",
            "skipped",
            "would-attach",
            "refused",
          ].map((s) => [s, s === outcome ? 1 : 0]),
        ),
      },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n");
  const r: BackfillReceipt = {
    title: rerunTitle,
    actor,
    database: "ds_dev_3951",
    manifest: [
      { event: event.id, edited: { provider: "rutube", embed_ref: "ref" } },
    ],
    command: {
      entrypoint: "apps/api/scripts/recordings-backfill.ts",
      args: ["--manifest", "exact.json", "--actor", actor],
      exitCode: 0,
      stderr: "",
      stdout: stdout("skipped"),
    },
    dryRun: false,
    statusMap: {},
    before: { events: [event], recordings: [row], audit },
    after: { events: [event], recordings: [row], audit },
  };
  r.after = structuredClone(r.before);
  r.firstRun = {
    ...structuredClone(r),
    command: {
      ...structuredClone(r.command),
      stdout: stdout("attached+published"),
    },
    before: { events: [event], recordings: [], audit: [] },
  };
  return r;
}
