import {
  type ApplicationsFailure,
  classifyFailure,
  keyReuseOutcome,
  type SubmissionState,
  startSubmission,
  submissionReducer,
  showRepeatBanner,
} from "./submission";

const keys = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-00000000000${++n}`;
};

describe("033 submission lifecycle", () => {
  it("EARS-8: one idempotency key per form instance; while in flight a second tap sends nothing", () => {
    const next = keys();
    const s0 = startSubmission(next);
    expect(s0).toEqual({
      phase: "editing",
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
    });

    const s1 = submissionReducer(s0, { type: "submit" }, next);
    expect(s1.phase).toBe("sending");
    expect(s1.idempotencyKey).toBe(s0.idempotencyKey);
    // A double tap: the reducer refuses the second submit — the caller sends
    // only when the phase moved to `sending`.
    expect(submissionReducer(s1, { type: "submit" }, next)).toBe(s1);
  });

  it("EARS-8: a network or 5xx failure keeps the key; the retry sends with the same key", () => {
    const next = keys();
    let s: SubmissionState = startSubmission(next);
    const key = s.idempotencyKey;
    s = submissionReducer(s, { type: "submit" }, next);
    s = submissionReducer(
      s,
      { type: "failed", failure: { kind: "unavailable" } },
      next,
    );
    expect(s).toEqual({ phase: "unavailable", idempotencyKey: key });
    s = submissionReducer(s, { type: "submit" }, next);
    expect(s).toEqual({ phase: "sending", idempotencyKey: key });
  });

  it("EARS-5/8: a field refusal returns to editing with the same unused key", () => {
    const next = keys();
    let s = submissionReducer(startSubmission(next), { type: "submit" }, next);
    const key = s.idempotencyKey;
    s = submissionReducer(
      s,
      {
        type: "failed",
        failure: { kind: "fields", problems: [{ code: "SPECIALTY_UNKNOWN" }] },
      },
      next,
    );
    expect(s).toEqual({ phase: "editing", idempotencyKey: key });
  });

  it("EARS-9: success shows the sent state; «Отправить ещё одну заявку» opens an empty form with a new key", () => {
    const next = keys();
    let s = submissionReducer(startSubmission(next), { type: "submit" }, next);
    const first = s.idempotencyKey;
    const result = {
      id: "11111111-1111-4111-8111-111111111111",
      submittedAt: "2026-11-25T10:00:00.000Z",
    };
    s = submissionReducer(s, { type: "succeeded", result }, next);
    expect(s).toEqual({ phase: "sent", idempotencyKey: first, result });
    expect(submissionReducer(s, { type: "submit" }, next)).toBe(s);

    s = submissionReducer(s, { type: "another" }, next);
    expect(s.phase).toBe("editing");
    expect(s.idempotencyKey).not.toBe(first);
  });

  it("EARS-8: the transport failure maps to the page outcome — network and 5xx are «unavailable», a 400 with fields «fields»", () => {
    const cases: [
      Parameters<typeof classifyFailure>[0],
      ApplicationsFailure,
    ][] = [
      [{ status: 0, problems: [] }, { kind: "unavailable" }],
      [{ status: 502, problems: [] }, { kind: "unavailable" }],
      [{ status: 503, problems: [] }, { kind: "unavailable" }],
      [
        {
          status: 400,
          problems: [{ code: "SPECIALTY_UNKNOWN", field: "specialtyCode" }],
        },
        {
          kind: "fields",
          problems: [{ code: "SPECIALTY_UNKNOWN", field: "specialtyCode" }],
        },
      ],
      [{ status: 401, problems: [] }, { kind: "signed-out" }],
      [
        { status: 403, problems: [], code: "BOT_PROTECTION_REJECTED" },
        { kind: "bot-protection" },
      ],
      [{ status: 422, problems: [] }, { kind: "refused" }],
      [
        { status: 422, problems: [{ code: "IDEMPOTENCY_KEY_REUSED" }] },
        { kind: "key-reused" },
      ],
    ];
    for (const [error, failure] of cases)
      expect(classifyFailure(error)).toEqual(failure);
  });
});

describe("033 lost reply, edited retry", () => {
  const open = {
    id: "11111111-1111-4111-8111-111111111111",
    submittedAt: "2026-11-25T10:00:00.000Z",
    topic: "Тема",
    state: "received" as const,
  };

  it("EARS-8: a 422 IDEMPOTENCY_KEY_REUSED keeps the submission in flight while the page re-reads the applicant's applications", () => {
    const next = keys();
    const s = submissionReducer(
      startSubmission(next),
      { type: "submit" },
      next,
    );
    expect(
      submissionReducer(
        s,
        { type: "failed", failure: { kind: "key-reused" } },
        next,
      ),
    ).toBe(s);
  });

  it("EARS-8: the re-read finds an open application — the stored submission shows as sent", () => {
    const next = keys();
    let s = submissionReducer(startSubmission(next), { type: "submit" }, next);
    const event = keyReuseOutcome({ ok: true, list: { items: [open] } });
    expect(event).toEqual({
      type: "succeeded",
      result: { id: open.id, submittedAt: open.submittedAt },
    });
    s = submissionReducer(s, event, next);
    expect(s.phase).toBe("sent");
  });

  it("EARS-8: the re-read fails — the server-failure state with the same key, so a retry re-reads and never creates a second application", () => {
    const next = keys();
    let s = submissionReducer(startSubmission(next), { type: "submit" }, next);
    const used = s.idempotencyKey;
    const event = keyReuseOutcome({ ok: false });
    expect(event).toEqual({ type: "failed", failure: { kind: "unavailable" } });
    s = submissionReducer(s, event, next);
    expect(s.phase).toBe("unavailable");
    expect(s.idempotencyKey).toBe(used);
    s = submissionReducer(s, { type: "submit" }, next);
    expect(s.phase).toBe("sending");
    expect(s.idempotencyKey).toBe(used);
  });

  it("EARS-8: the re-read succeeds with no open application — the server-failure state with a new key, so the next send can succeed", () => {
    const next = keys();
    let s = submissionReducer(startSubmission(next), { type: "submit" }, next);
    const used = s.idempotencyKey;
    const event = keyReuseOutcome({ ok: true, list: { items: [] } });
    expect(event).toEqual({ type: "rekey" });
    s = submissionReducer(s, event, next);
    expect(s.phase).toBe("unavailable");
    expect(s.idempotencyKey).not.toBe(used);
    s = submissionReducer(s, { type: "submit" }, next);
    expect(s.phase).toBe("sending");
    expect(s.idempotencyKey).not.toBe(used);
  });
});

describe("033 repeat banner", () => {
  it("EARS-10: the banner shows only when the read succeeded with at least one open application; a failed read hides it", () => {
    const item = {
      id: "11111111-1111-4111-8111-111111111111",
      submittedAt: "2026-11-25T10:00:00.000Z",
      topic: "Тема",
      state: "received" as const,
    };
    expect(showRepeatBanner({ ok: true, list: { items: [item] } })).toBe(true);
    expect(showRepeatBanner({ ok: true, list: { items: [] } })).toBe(false);
    expect(showRepeatBanner({ ok: false })).toBe(false);
  });
});
