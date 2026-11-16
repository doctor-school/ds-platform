import { describe, expect, it } from "vitest";
import {
  assertEventAuthoringEvidence,
  eventAuthoringCases,
  eventAuthoringProjections,
} from "./event-authoring-report.js";
import { eventCountBackgrounds } from "./event-count-report.js";

const sha = "b".repeat(64),
  head = "a".repeat(40);
function proof() {
  const resources = eventAuthoringCases.map((item, index) => {
    const eventId = `case-${index}`,
      backgroundId = `background-${index}`,
      adminSub = `admin-${index}`,
      doctorSub = `doctor-${index}`;
    const provider = index === 1 ? "rutube" : "youtube",
      embedRef = "known-reference";
    const lifecycle = [
      { type: "event.published", from: "draft", to: "published" },
    ];
    const evidence =
      index === 0
        ? {
            drafts: ["doctors", "experts"].map((audience) => ({
              audience,
              eventId: audience,
              state: "draft",
              msk: "2026-12-21T19:00",
              instant: "2026-12-21T16:00:00.000Z",
            })),
            projections: eventAuthoringProjections.map((key) => ({
              key,
              negativeStatus: /(?:detail|participation)$|^event-/.test(key)
                ? 404
                : 200,
              draftAbsent: true,
              positiveStatus: 200,
              positiveVerified: true,
              terminal: true,
              negativeSha256: sha,
              positiveSha256: sha,
            })),
            monthCountBefore: 0,
            monthCountAfter: 1,
            projectScaleDelta: 1,
            statistics: 1,
            statisticsOracle: 1,
            today: "2026-11-16",
          }
        : index === 3
          ? {
              beforeState: "published",
              afterState: "published",
              beforeVersion: 3,
              afterVersion: 4,
              wrongRef: "wrong",
              correctedRef: "corrected",
              persistedRef: "corrected",
              reopenedRef: "corrected",
              streamRows: 1,
              beforeRoomOpen: true,
              lifecycleBefore: lifecycle,
              lifecycleAfter: lifecycle,
            }
          : {
              provider,
              embedRef,
              persisted: true,
              reopened: true,
              noSniffingUnitPassed: true,
              frames: ["academy", "doctor"].map((host) => ({
                host,
                provider,
                eventId,
                src: `${provider === "rutube" ? "https://rutube.ru/play/embed/" : "https://www.youtube.com/embed/"}${embedRef}${provider === "youtube" ? "?enablejsapi=1&origin=http%3A%2F%2Flocalhost%3A4001" : ""}`,
                browserOrigin: "http://localhost:4001",
                nativeProvider: provider,
                nativeEmbedRef: embedRef,
                ssrStatus: 200,
                ssrApiOrigin: "http://127.0.0.1:4000",
                ssrDatabase: "ds_dev_4061",
                assetsSha256: sha,
              })),
            };
    return {
      caseId: item.id,
      title: item.title,
      head,
      database: "ds_dev_4061",
      eventId,
      backgroundId,
      adminSub,
      doctorSub,
      adminRoles: ["platform_admin"],
      doctorRoles: ["doctor_guest"],
      apiOrigin: "http://127.0.0.1:4000",
      compiledApiSha256: sha,
      shippingSourceSha256: sha,
      proof: evidence,
      cleanup: {
        events: [eventId, backgroundId].map((eventId) => ({
          eventId,
          state: "hidden",
          pdfAbsent: true,
          historyRetained: true,
        })),
        subjects: [adminSub, doctorSub].map((sub) => ({ sub, status: 404 })),
        sessionsClosed: true,
      },
    };
  });
  const backgrounds = resources.flatMap((resource) =>
    eventCountBackgrounds.map((clause, order) => ({
      title: resource.title,
      head,
      database: resource.database,
      eventId: resource.backgroundId,
      adminSub: resource.adminSub,
      doctorSub: resource.doctorSub,
      clause,
      order,
      evidence: [
        {
          status: 200,
          roles: ["platform_admin"],
          origin: "http://localhost:4006",
        },
        { status: 200, bytes: 52, sha256: sha },
        {
          enum: ["draft", "published", "live", "ended", "hidden", "in_archive"],
          platform: [
            "draft>published",
            "published>live",
            "live>ended",
            "ended>hidden",
          ],
          legacy: ["hidden>in_archive", "in_archive>hidden"],
        },
        { msk: "2026-12-21T19:00", instant: "2026-12-21T16:00:00.000Z" },
        {
          publicStatus: 200,
          pageState: "live",
          listingState: "live",
          registrationStatus: 200,
          registered: true,
          roomStatus: 200,
          roomEventId: resource.backgroundId,
          roomPresence: null,
        },
      ][order],
    })),
  );
  const report = {
    errors: [],
    suites: [
      {
        specs: eventAuthoringCases.map(({ title }, index) => ({
          title,
          tests: [
            {
              projectId: "admin",
              projectName: "admin",
              status: "expected",
              results: [
                {
                  status: "passed",
                  retry: 0,
                  startTime: new Date(
                    1794798000000 + index * 1000,
                  ).toISOString(),
                },
              ],
            },
          ],
        })),
      },
    ],
  };
  return { head, report, backgrounds, resources };
}

describe("4061 original-owned evidence", () => {
  it("accepts the actual YouTube browser API iframe parameter", () => {
    const p = proof();
    expect(() => assertEventAuthoringEvidence(p)).not.toThrow();
  });
  it("rejects a non-404 draft detail even with a negative boolean and successful controls", () => {
    const p = proof();
    p.resources[0]!.proof.projections![0]!.negativeStatus = 200;
    expect(() => assertEventAuthoringEvidence(p)).toThrow();
  });
  it("rejects reordered report execution despite four passing counters", () => {
    const p = proof();
    p.report.suites[0]!.specs.forEach((spec, index) => {
      spec.tests[0]!.results[0]!.startTime = new Date(
        1794798000000 + (3 - index) * 1000,
      ).toISOString();
    });
    expect(() => assertEventAuthoringEvidence(p)).toThrow();
  });
  it("accepts actual chronological execution through the nested provider outline", () => {
    const p = proof(),
      suite = p.report.suites[0]!,
      specs = [...suite.specs];
    suite.specs = [specs[0]!, specs[3]!];
    Object.assign(suite, { suites: [{ specs: specs.slice(1, 3) }] });
    expect(() => assertEventAuthoringEvidence(p)).not.toThrow();
  });
  it("rejects errors attached to an otherwise passed result", () => {
    const p = proof();
    Object.assign(p.report.suites[0]!.specs[0]!.tests[0]!.results[0]!, {
      error: { message: "real failure" },
    });
    expect(() => assertEventAuthoringEvidence(p)).toThrow();
  });
  it("accepts exactly the complete four original-owned cases and twenty ordered witnesses", () =>
    expect(() => assertEventAuthoringEvidence(proof())).not.toThrow());
  it("rejects four passing counters when all twenty Background witnesses are missing", () => {
    const p = proof();
    p.backgrounds = [];
    expect(() => assertEventAuthoringEvidence(p)).toThrow(/twenty/);
  });
  it("rejects missing, duplicate, extra or reordered Backgrounds", () => {
    for (const edit of [
      (p: ReturnType<typeof proof>) => p.backgrounds.pop(),
      (p: ReturnType<typeof proof>) => {
        p.backgrounds[1] = p.backgrounds[0]!;
      },
      (p: ReturnType<typeof proof>) => p.backgrounds.push(p.backgrounds[0]!),
      (p: ReturnType<typeof proof>) => p.backgrounds.reverse(),
    ]) {
      const p = proof();
      edit(p);
      expect(() => assertEventAuthoringEvidence(p)).toThrow();
    }
  });
  it("rejects wrong, missing, extra, duplicate and reordered case identity", () => {
    for (const edit of [
      (p: ReturnType<typeof proof>) => p.resources.pop(),
      (p: ReturnType<typeof proof>) => p.resources.push(p.resources[0]!),
      (p: ReturnType<typeof proof>) => {
        p.resources[1] = p.resources[0]!;
      },
      (p: ReturnType<typeof proof>) => p.resources.reverse(),
      (p: ReturnType<typeof proof>) => {
        Object.assign(p.resources[0]!, { caseId: "007:98" });
      },
    ]) {
      const p = proof();
      edit(p);
      expect(() => assertEventAuthoringEvidence(p)).toThrow();
    }
  });
  it("rejects non-passing, retried, flaky or skipped actual results and global errors", () => {
    for (const status of ["failed", "skipped", "timedOut", "interrupted"]) {
      const p = proof();
      p.report.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = status;
      expect(() => assertEventAuthoringEvidence(p)).toThrow();
    }
    const p = proof();
    p.report.suites[0]!.specs[0]!.tests[0]!.results[0]!.retry = 1;
    expect(() => assertEventAuthoringEvidence(p)).toThrow();
    const q = proof();
    q.report.suites[0]!.specs[0]!.tests[0]!.status = "flaky";
    expect(() => assertEventAuthoringEvidence(q)).toThrow();
    expect(() =>
      assertEventAuthoringEvidence({
        ...proof(),
        report: { ...proof().report, errors: [{ message: "actual failure" }] },
      }),
    ).toThrow();
  });
  it("rejects a narrowed, unproved or nonterminal public projection and mismatched scoped counters", () => {
    const base = proof().resources[0]!.proof;
    for (const change of [
      { projections: base.projections?.slice(1) },
      {
        projections: base.projections?.map((x, i) =>
          i === 0 ? { ...x, draftAbsent: false } : x,
        ),
      },
      {
        projections: base.projections?.map((x, i) =>
          i === 0 ? { ...x, positiveVerified: false } : x,
        ),
      },
      {
        projections: base.projections?.map((x, i) =>
          i === 0 ? { ...x, terminal: false } : x,
        ),
      },
      { monthCountAfter: 0 },
      { statisticsOracle: 2 },
    ]) {
      const p = proof();
      Object.assign(p.resources[0]!.proof, change);
      expect(() => assertEventAuthoringEvidence(p)).toThrow();
    }
  });
  it("rejects an absent second mount, a sniffed provider or SSR escaping the owned API/DB", () => {
    for (const change of [
      { host: "doctor" },
      { provider: "youtube" },
      { src: "https://wrong.example/player" },
      { ssrStatus: 401 },
      { ssrApiOrigin: "http://127.0.0.1:3000" },
      { ssrDatabase: "ds_dev" },
    ]) {
      const p = proof();
      Object.assign(p.resources[1]!.proof.frames![0]!, change);
      expect(() => assertEventAuthoringEvidence(p)).toThrow();
    }
    const p = proof();
    p.resources[1]!.proof.noSniffingUnitPassed = false;
    expect(() => assertEventAuthoringEvidence(p)).toThrow();
  });
  it("rejects a correction that reverses state, appends a stream row, loses its reopen or opens the room early", () => {
    for (const change of [
      { afterState: "draft" },
      { streamRows: 2 },
      { reopenedRef: "wrong" },
      { afterVersion: 3 },
      { beforeRoomOpen: false },
      { lifecycleAfter: [] },
    ]) {
      const p = proof();
      Object.assign(p.resources[3]!.proof, change);
      expect(() => assertEventAuthoringEvidence(p)).toThrow();
    }
  });
  it("rejects wrong head/DB/actor/background state and incomplete native cleanup", () => {
    for (const change of [
      { head: "c".repeat(40) },
      { database: "ds_dev_4035" },
      { adminSub: "" },
      { compiledApiSha256: "missing" },
      { doctorRoles: ["platform_admin"] },
    ]) {
      const p = proof();
      Object.assign(p.resources[0]!, change);
      expect(() => assertEventAuthoringEvidence(p)).toThrow();
    }
    const p = proof();
    p.resources[0]!.cleanup.events[0]!.pdfAbsent = false;
    expect(() => assertEventAuthoringEvidence(p)).toThrow();
    const q = proof();
    Object.assign(q.backgrounds[4]!.evidence!, { roomStatus: 401 });
    expect(() => assertEventAuthoringEvidence(q)).toThrow();
  });
});
