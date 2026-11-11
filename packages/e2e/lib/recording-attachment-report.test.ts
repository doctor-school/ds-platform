import {
  legacyTitles,
  type PublicListBody,
  type LegacyReceipt,
  type BoundaryReceipt,
} from "./legacy-transition.js";
import { describe, expect, it } from "vitest";
import {
  assertRecordingAttachmentReport as assertRawReport,
  recordingAttachmentTitles,
} from "./recording-attachment-report.js";
const clauses = [
  "ended-only",
  "hidden-exclusion",
  "mutation-protocol",
  "retention",
  "derived-display",
  "approved-composition",
];
function report() {
  const titles = [
    ...recordingAttachmentTitles,
    "Publication is a separate act from attachment",
    "Example #1",
    "Example #2",
    "Example #3",
    "Example #4",
    "Every committed recording mutation is audited",
    "An archival broadcast with a published recording is archived",
    "An archival broadcast with nothing to play cannot be archived",
    "An archived broadcast is hidden again",
  ];
  const specs = titles.map((title, index) => ({
    title,
    tests: [
      {
        projectId: "recording-attachment",
        projectName: "recording-attachment",
        status: "expected",
        results: [
          {
            status: "passed",
            retry: 0,
            attachments: [
              {
                name: "recording-attachment",
                contentType: "application/json",
                body: Buffer.from(
                  JSON.stringify({
                    sourceHost: "academy",
                    legacy: index >= 10 ? legacyReceipt(title) : undefined,
                    caseKind:
                      index === 0 ? "raw" : index === 1 ? "edited" : undefined,
                    caseState:
                      index >= 5 && index <= 8
                        ? ["draft", "published", "live", "hidden"][index - 5]
                        : undefined,
                    backgrounds: clauses.map((clause) => ({
                      clause,
                      evidence: [{ id: crypto.randomUUID() }],
                    })),
                  }),
                ).toString("base64"),
              },
            ],
          },
        ],
      },
    ],
  }));
  return {
    errors: [] as unknown[],
    suites: [
      {
        title: "An operator attaches a recording of an explicit kind",
        specs: specs.slice(0, 2),
      },
      {
        title: "Recording lifecycle, playback and remaining archive contracts",
        specs: specs.slice(2, 5),
      },
      {
        title: "A recording is publishable only while the event is ended",
        specs: specs.slice(5, 9),
      },
      {
        title: "Recording lifecycle, playback and remaining archive contracts",
        specs: specs.slice(9),
      },
    ],
  };
}
function amend(
  value: ReturnType<typeof report>,
  override: Record<string, unknown>,
) {
  const attachment =
    value.suites[0]!.specs[0]!.tests[0]!.results[0]!.attachments[0]!;
  const receipt = JSON.parse(
    Buffer.from(attachment.body, "base64").toString("utf8"),
  );
  attachment.body = Buffer.from(
    JSON.stringify({ ...receipt, ...override }),
  ).toString("base64");
}
function assertRecordingAttachmentReport(
  value: ReturnType<typeof report>,
  scope: "full" | "new" = "full",
) {
  return assertRawReport(
    {
      ...value,
      suites: [
        {
          title:
            "A finished broadcast keeps its value as a recording, and the archive is browsable",
          suites: [
            {
              title:
                "Recording lifecycle, playback and remaining archive contracts",
              specs: value.suites
                .filter(
                  (s) =>
                    s.title ===
                    "Recording lifecycle, playback and remaining archive contracts",
                )
                .flatMap((s) => s.specs)
                .concat(
                  scope === "full"
                    ? boundaryReport().suites[0]!.suites[0]!.specs
                    : [],
                ),
              suites: [
                ...value.suites.filter(
                  (s) =>
                    s.title !==
                    "Recording lifecycle, playback and remaining archive contracts",
                ),
                ...(scope === "full"
                  ? boundaryReport().suites[0]!.suites[0]!.suites.filter(
                      (s) => s.title,
                    )
                  : []),
              ],
            },
          ],
        },
      ],
    },
    scope,
  );
}
describe("014 attachment receipts", () => {
  it("requires the new nine boundary cases when narrow scope is explicit", () => {
    expect(() => assertRawReport(boundaryReport(), "new")).not.toThrow();
    expect(() => assertRawReport(boundaryReport())).toThrow();
    expect(() => assertRecordingAttachmentReport(report(), "new")).toThrow();
  });
  it("rejects identical example titles moved into the other source outline", () => {
    const value = report();
    value.suites[0]!.specs[0] = value.suites[2]!.specs[0]!;
    expect(() => assertRecordingAttachmentReport(value)).toThrow(/identity/);
    const wrongRule = report();
    wrongRule.suites[1]!.title = "Another rule";
    expect(() => assertRecordingAttachmentReport(wrongRule)).toThrow(
      /identity/,
    );
  });
  it("accepts exactly twenty-two cases, four outlines and 132 Background groups", () => {
    expect(() => assertRecordingAttachmentReport(report())).not.toThrow();
  });
  it("rejects green labels without the executed Background receipt", () => {
    const value = report();
    value.suites[0]!.specs[0]!.tests[0]!.results[0]!.attachments = [];
    expect(() => assertRecordingAttachmentReport(value)).toThrow(/Background/);
  });
  it("rejects an omitted, repeated, out-of-order or empty Background group", () => {
    for (const backgrounds of [
      [],
      clauses.slice(1).map((clause) => ({ clause, evidence: [1] })),
      clauses.map(() => ({ clause: "ended-only", evidence: [1] })),
      [...clauses].reverse().map((clause) => ({ clause, evidence: [1] })),
      clauses.map((clause) => ({ clause, evidence: [] })),
    ]) {
      const value = report();
      amend(value, { backgrounds });
      expect(() => assertRecordingAttachmentReport(value)).toThrow(
        /Background/,
      );
    }
  });
  it("rejects the wrong source host, duplicated kind or different outline", () => {
    for (const override of [{ sourceHost: "admin" }, { caseKind: "edited" }]) {
      const value = report();
      amend(value, override);
      expect(() => assertRecordingAttachmentReport(value)).toThrow();
    }
    const value = report();
    value.suites[0]!.title = "Different outline";
    expect(() => assertRecordingAttachmentReport(value)).toThrow(/identity/);
  });
  it("rejects skips, retries, runner errors, a missing case and an extra case", () => {
    const skipped = report();
    skipped.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = "skipped";
    const retry = report();
    retry.suites[0]!.specs[0]!.tests[0]!.results[0]!.retry = 1;
    const error = report();
    error.errors.push({ message: "runner error" });
    const missing = report();
    missing.suites[2]!.specs.pop();
    const extra = report();
    extra.suites[0]!.specs.push(extra.suites[0]!.specs[0]!);
    for (const value of [skipped, retry, error, missing, extra])
      expect(() => assertRecordingAttachmentReport(value)).toThrow();
  });
});

// The guard must distinguish equal Example titles by their source outline.
it("rejects a non-ended outline example with another state identity", () => {
  const value = report();
  const attachment =
    value.suites[2]!.specs[0]!.tests[0]!.results[0]!.attachments[0]!;
  const receipt = JSON.parse(
    Buffer.from(attachment.body, "base64").toString("utf8"),
  );
  attachment.body = Buffer.from(
    JSON.stringify({ ...receipt, caseState: "ended" }),
  ).toString("base64");
  expect(() => assertRecordingAttachmentReport(value)).toThrow(/identity/);
});
it("rejects flaky, failed, duplicate results and the wrong project", () => {
  for (const change of [
    (
      t: ReturnType<
        typeof report
      >["suites"][number]["specs"][number]["tests"][number],
    ) => {
      t.status = "flaky";
    },
    (
      t: ReturnType<
        typeof report
      >["suites"][number]["specs"][number]["tests"][number],
    ) => {
      t.results[0]!.status = "failed";
    },
    (
      t: ReturnType<
        typeof report
      >["suites"][number]["specs"][number]["tests"][number],
    ) => {
      t.results.push(t.results[0]!);
    },
    (
      t: ReturnType<
        typeof report
      >["suites"][number]["specs"][number]["tests"][number],
    ) => {
      t.projectName = "chromium";
    },
  ]) {
    const value = report();
    change(value.suites[2]!.specs[0]!.tests[0]!);
    expect(() => assertRecordingAttachmentReport(value)).toThrow();
  }
});

function legacyReceipt(title: string): LegacyReceipt {
  const hide = title === legacyTitles[2],
    refusal = title === legacyTitles[1];
  const from = hide ? "in_archive" : "hidden",
    to = hide ? "hidden" : "in_archive";
  const before = {
    id: "owned",
    origin: "legacy",
    state: from,
    audience: "experts",
    version: 1,
  };
  const after = refusal ? { ...before } : { ...before, state: to, version: 2 };
  const list = (present: boolean): LegacyReceipt["publicBefore"] =>
    ["timeframe=upcoming", "timeframe=past", ""].map((query) => ({
      query,
      body:
        query === ""
          ? []
          : {
              data:
                present && query !== "timeframe=upcoming"
                  ? [{ id: "owned" }]
                  : [],
              counts: { past: present ? 1 : 0, upcoming: 0 },
              horizon: { today: "2026-11-10" },
            },
    }));
  return {
    identity: title,
    actor: "actor",
    fixture: {
      id: "owned",
      slug: "owned-slug",
      heldAtMsk: "2026-11-08T12:00",
      horizonToday: "2026-11-10",
      audience: "experts",
      recording: { status: refusal ? "draft" : "published", deletedAt: null },
    },
    before,
    after,
    auditBefore: [],
    auditAfter: refusal
      ? []
      : [
          {
            id: "named",
            event_type: `event.${hide ? "hidden" : "archived"}_legacy`,
            subject_id: "actor",
            metadata: { aggregateId: "owned", from, to },
          },
          {
            id: "generic",
            event_type: "data.events.update",
            subject_id: "actor",
            metadata: {
              table: "events",
              pk: { id: "owned" },
              source: "admin-ui",
              txid: "1",
              diff: {
                state: { old: from, new: to },
                version: { old: 1, new: 2 },
              },
            },
          },
        ],
    answer: {
      status: refusal ? 409 : 200,
      body: refusal ? { errorCode: "EVENT_NOT_FINISHED" } : { state: to },
      request: {
        method: "POST",
        path: `/v1/admin/events/owned/${hide ? "hide-legacy" : "archive-legacy"}`,
        ifMatch: 'W/"1"',
        idempotencyKey: "12345678-1234-4123-8123-123456789abc",
        transport: refusal ? "api" : "admin-click",
      },
    },
    absentAction: refusal,
    publicBefore: hide ? list(true) : undefined,
    publicAfter: hide ? list(false) : undefined,
    hiddenNotice: hide,
  };
}
function corruptLegacy(change: (receipt: LegacyReceipt) => void, index = 1) {
  const value = report();
  const attachment =
    value.suites[3]!.specs[index]!.tests[0]!.results[0]!.attachments[0]!;
  const receipt = JSON.parse(
    Buffer.from(attachment.body, "base64").toString("utf8"),
  );
  change(receipt.legacy);
  attachment.body = Buffer.from(JSON.stringify(receipt)).toString("base64");
  return value;
}
it("rejects a legacy receipt with the wrong actor, protocol, named audit or independent diff", () => {
  for (const change of [
    (r: LegacyReceipt) => {
      r.actor = "wrong";
    },
    (r: LegacyReceipt) => {
      r.answer.request.ifMatch = 'W/"99"';
    },
    (r: LegacyReceipt) => {
      r.answer.request.idempotencyKey = "invalid";
    },
    (r: LegacyReceipt) => {
      r.answer.request.transport = "api";
    },
    (r: LegacyReceipt) => {
      r.before.state = "draft";
    },
    (r: LegacyReceipt) => {
      r.fixture.recording.status = "draft";
    },
    (r: LegacyReceipt) => {
      r.auditAfter[0]!.event_type = "event.ended";
    },
    (r: LegacyReceipt) => {
      r.auditAfter[0]!.metadata = {
        aggregateId: "wrong",
        from: "hidden",
        to: "in_archive",
      };
    },
    (r: LegacyReceipt) => {
      r.auditAfter.push(r.auditAfter[0]!);
    },
    (r: LegacyReceipt) => {
      (r.auditAfter[1]!.metadata as Record<string, unknown>).diff = {};
    },
  ])
    expect(() =>
      assertRecordingAttachmentReport(corruptLegacy(change)),
    ).toThrow();
});
it("rejects refusal changes or audit writes and missing pre-hide membership/count proof", () => {
  for (const change of [
    (r: LegacyReceipt) => {
      r.after.state = "in_archive";
    },
    (r: LegacyReceipt) => {
      r.auditAfter.push({ id: "unexpected" });
    },
    (r: LegacyReceipt) => {
      r.absentAction = false;
    },
    (r: LegacyReceipt) => {
      r.answer.status = 200;
    },
  ])
    expect(() =>
      assertRecordingAttachmentReport(corruptLegacy(change, 2)),
    ).toThrow();
  for (const change of [
    (r: LegacyReceipt) => {
      (r.publicBefore![1]!.body as PublicListBody).data = [];
    },
    (r: LegacyReceipt) => {
      (r.publicAfter![1]!.body as PublicListBody).counts.past = 1;
    },
    (r: LegacyReceipt) => {
      r.hiddenNotice = false;
    },
    (r: LegacyReceipt) => {
      (r.publicAfter![1]!.body as PublicListBody).data = [{ id: "owned" }];
    },
  ])
    expect(() =>
      assertRecordingAttachmentReport(corruptLegacy(change, 3)),
    ).toThrow();
});
const boundaryDefinitions = [
  {
    outline: "",
    title: "The panel offers no Delete anywhere",
    origin: "platform",
    state: "ended",
    command: "DeleteRecording",
  },
  ...[
    ["hidden", "PublishEvent"],
    ["hidden", "OpenRoom"],
    ["in_archive", "CloseRoom"],
    ["in_archive", "HideEvent"],
    ["hidden", "ConfigureStream"],
  ].map(([state, command], index) => ({
    outline: "A broadcast command on a legacy event is refused",
    title: `Example #${index + 1}`,
    origin: "legacy",
    state,
    command,
  })),
  ...[
    ["published", "ArchiveLegacyBroadcast"],
    ["ended", "ArchiveLegacyBroadcast"],
    ["hidden", "HideLegacyBroadcast"],
  ].map(([state, command], index) => ({
    outline: "A legacy command on a platform event is refused",
    title: `Example #${index + 1}`,
    origin: "platform",
    state,
    command,
  })),
];
function boundaryReport() {
  const value = {
    errors: [],
    suites: [
      {
        title:
          "A finished broadcast keeps its value as a recording, and the archive is browsable",
        suites: [
          {
            title:
              "Recording lifecycle, playback and remaining archive contracts",
            specs: [] as ReturnType<typeof report>["suites"][number]["specs"],
            suites: boundaryDefinitions.map((definition) => ({
              title: definition.outline,
              specs: [
                {
                  title: definition.title,
                  tests: [
                    {
                      projectId: "recording-attachment",
                      projectName: "recording-attachment",
                      status: "expected",
                      results: [
                        {
                          status: "passed",
                          retry: 0,
                          attachments: [
                            {
                              name: "recording-attachment",
                              contentType: "application/json",
                              body: Buffer.from(
                                JSON.stringify({
                                  sourceHost: "academy",
                                  backgrounds: clauses.map((clause) => ({
                                    clause,
                                    evidence: [1],
                                  })),
                                  boundary: {
                                    ...definition,
                                    eventId: "owned",
                                    before: {
                                      id: "owned",
                                      origin: definition.origin,
                                      state: definition.state,
                                      version: 1,
                                      live_at: null,
                                    },
                                    after: {
                                      id: "owned",
                                      origin: definition.origin,
                                      state: definition.state,
                                      version: 1,
                                      live_at: null,
                                    },
                                    answer: {
                                      status:
                                        definition.command === "DeleteRecording"
                                          ? 404
                                          : 409,
                                      body: { errorCode: "INVALID_TRANSITION" },
                                      request: {
                                        method:
                                          definition.command ===
                                          "DeleteRecording"
                                            ? "DELETE"
                                            : definition.command ===
                                                "ConfigureStream"
                                              ? "PUT"
                                              : "POST",
                                        path: `/v1/admin/events/owned/${definition.command === "DeleteRecording" ? "recordings/recording" : ({ PublishEvent: "publish", OpenRoom: "open", CloseRoom: "close", HideEvent: "hide", ConfigureStream: "stream", ArchiveLegacyBroadcast: "archive-legacy", HideLegacyBroadcast: "hide-legacy" } as Record<string, string>)[definition.command!]}`,
                                        ifMatch: 'W/"1"',
                                        idempotencyKey:
                                          "12345678-1234-4123-8123-123456789abc",
                                        transport: "api",
                                      },
                                    },
                                    sideEffectsBefore: {
                                      stream: [],
                                      presence: [],
                                      liveAt: null,
                                    },
                                    sideEffectsAfter: {
                                      stream: [],
                                      presence: [],
                                      liveAt: null,
                                    },
                                    recordingBefore: {
                                      id: "recording",
                                      kind: "edited",
                                      status: "published",
                                      version: 1,
                                      deleted_at: null,
                                    },
                                    recordingAfter: {
                                      id: "recording",
                                      kind: "edited",
                                      status: "published",
                                      version: 1,
                                      deleted_at: null,
                                    },
                                    panelControls: [
                                      "Изменить",
                                      "Снять с публикации",
                                      "Убрать",
                                    ],
                                    dialogs: ["Изменить"],
                                  },
                                }),
                              ).toString("base64"),
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            })),
          },
        ],
      },
    ],
  };
  const rule = value.suites[0]!.suites[0]!;
  rule.specs.push(...rule.suites.shift()!.specs);
  return value;
}
it("accepts the exact nine boundary cases as the new portion", () => {
  expect(() => assertRawReport(boundaryReport(), "new")).not.toThrow();
});
it("rejects mismatched boundary examples, successful wrong-machine commands and new side effects", () => {
  for (const change of [
    (r: BoundaryReceipt) => {
      r.command = "OpenRoom";
    },
    (r: BoundaryReceipt) => {
      r.state = "in_archive";
    },
    (r: BoundaryReceipt) => {
      r.answer.status = 200;
    },
    (r: BoundaryReceipt) => {
      r.answer.body.errorCode = "EVENT_NOT_FINISHED";
    },
    (r: BoundaryReceipt) => {
      r.after.version = 2;
    },
    (r: BoundaryReceipt) => {
      r.answer.request.ifMatch = 'W/"9"';
    },
    (r: BoundaryReceipt) => {
      r.sideEffectsAfter!.stream = [{ id: "leaked" }];
    },
    (r: BoundaryReceipt) => {
      r.sideEffectsAfter!.presence = [{ id: "leaked" }];
    },
    (r: BoundaryReceipt) => {
      r.sideEffectsAfter!.liveAt = "2026-01-01";
    },
  ]) {
    const value = boundaryReport(),
      attachment =
        value.suites[0]!.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!
          .attachments[0]!;
    const receipt = JSON.parse(
      Buffer.from(attachment.body, "base64").toString("utf8"),
    );
    change(receipt.boundary);
    attachment.body = Buffer.from(JSON.stringify(receipt)).toString("base64");
    expect(() => assertRawReport(value, "new")).toThrow();
  }
});
it("rejects a draft no-Delete substitute, uninspected controls and destructive deletion", () => {
  for (const change of [
    (r: BoundaryReceipt) => {
      r.recordingBefore!.status = "draft";
      r.recordingAfter!.status = "draft";
    },
    (r: BoundaryReceipt) => {
      r.panelControls = [];
    },
    (r: BoundaryReceipt) => {
      r.dialogs = [];
    },
    (r: BoundaryReceipt) => {
      r.panelControls!.push("Удалить");
    },
    (r: BoundaryReceipt) => {
      r.recordingAfter = {};
    },
  ]) {
    const value = boundaryReport(),
      attachment =
        value.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!
          .attachments[0]!;
    const receipt = JSON.parse(
      Buffer.from(attachment.body, "base64").toString("utf8"),
    );
    change(receipt.boundary);
    attachment.body = Buffer.from(JSON.stringify(receipt)).toString("base64");
    expect(() => assertRawReport(value, "new")).toThrow();
  }
});
