import { describe, expect, it } from "vitest";
import {
  assertEventCountEvidence,
  eventCountOriginals,
  eventCountBackgrounds,
  assertNoCountCredentials,
} from "./event-count-report.js";

function proof() {
  const head = "a".repeat(40);
  const resources = eventCountOriginals.map((title, index) => ({
    title,
    head,
    database: "ds_dev_4035",
    eventId: `case-${index}`,
    backgroundId: `background-${index}`,
    adminSub: `admin-${index}`,
    doctorSub: `doctor-${index}`,
    adminRoles: ["platform_admin"],
    doctorRoles: ["doctor_guest"],
    expectedCount: index === 0 ? null : 1,
    observedCount: index === 0 ? null : 1,
    persisted: index !== 1,
    reopened: index !== 1,
    defaultHidden: true,
    defaultPresence: false,
    registrationCount: 1,
    presenceCount: 1,
    cleanup: {
      eventState: "hidden",
      backgroundState: "hidden",
      objectsDeleted: 2,
      registrationsRetained: true,
      beatsRetained: true,
    },
  }));
  const backgrounds = resources.flatMap((resource) =>
    eventCountBackgrounds.map((clause, order) => ({
      title: resource.title,
      clause,
      order,
      head,
      database: resource.database,
      eventId: resource.backgroundId,
      adminSub: resource.adminSub,
      doctorSub: resource.doctorSub,
      evidence: [
        {
          status: 200,
          roles: ["platform_admin"],
          origin: "http://localhost:3200",
        },
        { status: 200, bytes: 52, sha256: "b".repeat(64) },
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
        { msk: "2026-11-13T12:00", instant: "2026-11-13T09:00:00.000Z" },
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
        specs: eventCountOriginals.map((title) => ({
          title,
          tests: [
            {
              status: "expected",
              projectName: "admin",
              projectId: "admin",
              results: [{ status: "passed", retry: 0 }],
            },
          ],
        })),
      },
    ],
  };
  return { report, backgrounds, resources, head };
}

describe("4035 exact original evidence", () => {
  it("refuses configured and dynamically issued credentials in either export encoding", () => {
    const secret = "fixture-issued-private-cookie-4035";
    expect(() =>
      assertNoCountCredentials(
        { "ops.jsonl": Buffer.from(JSON.stringify({ session: secret })) },
        [secret],
      ),
    ).toThrow();
    expect(() =>
      assertNoCountCredentials(
        {
          "ops.jsonl": Buffer.concat([
            Buffer.from([255, 254]),
            Buffer.from(JSON.stringify({ session: secret }), "utf16le"),
          ]),
        },
        [secret],
      ),
    ).toThrow();
    expect(() =>
      assertNoCountCredentials({ "safe.json": Buffer.from('{"count":1}') }, [
        secret,
      ]),
    ).not.toThrow();
  });
  it("accepts all three originals, fifteen ordered owning witnesses and retained history", () => {
    const value = proof();
    expect(() => assertEventCountEvidence(value)).not.toThrow();
  });
  for (const mutation of [
    "missing",
    "extra",
    "duplicate",
    "foreign",
    "order",
    "identity",
    "count",
    "cleanup",
    "head",
    "database",
    "pdf",
    "time",
    "lifecycle",
    "room",
  ] as const) {
    it(`rejects ${mutation} evidence even when Playwright passed`, () => {
      const value = proof();
      switch (mutation) {
        case "missing":
          value.backgrounds.pop();
          break;
        case "extra":
          value.resources.push(structuredClone(value.resources[0]!));
          break;
        case "duplicate":
          value.backgrounds[1] = structuredClone(value.backgrounds[0]!);
          break;
        case "foreign":
          value.backgrounds[0]!.eventId = "foreign-event";
          break;
        case "order":
          [value.backgrounds[0], value.backgrounds[1]] = [
            value.backgrounds[1]!,
            value.backgrounds[0]!,
          ];
          break;
        case "identity":
          value.resources[2]!.doctorRoles = ["platform_admin", "doctor_guest"];
          break;
        case "count":
          value.resources[1]!.observedCount = 0;
          break;
        case "cleanup":
          value.resources[0]!.cleanup.beatsRetained = false;
          break;
        case "head":
          value.resources[1]!.head = "c".repeat(40);
          break;
        case "database":
          value.resources[0]!.database = "ds_dev";
          break;
        case "pdf":
          (value.backgrounds[1]!.evidence as { bytes: number }).bytes = 0;
          break;
        case "time":
          (value.backgrounds[3]!.evidence as { instant: string }).instant =
            "2026-11-13T12:00:00.000Z";
          break;
        case "lifecycle":
          (value.backgrounds[2]!.evidence as { enum: string[] }).enum.push(
            "archived",
          );
          break;
        case "room":
          (
            value.backgrounds[4]!.evidence as { roomEventId: string }
          ).roomEventId = "foreign-event";
          break;
      }
      expect(() => assertEventCountEvidence(value)).toThrow();
    });
  }
  for (const status of [
    "skipped",
    "failed",
    "timedOut",
    "interrupted",
  ] as const) {
    it(`rejects a ${status} original`, () => {
      const value = proof();
      value.report.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = status;
      expect(() => assertEventCountEvidence(value)).toThrow();
    });
  }
  it("rejects retries and duplicate report tests", () => {
    const value = proof();
    value.report.suites[0]!.specs[0]!.tests[0]!.results[0]!.retry = 1;
    expect(() => assertEventCountEvidence(value)).toThrow();
    value.report.suites[0]!.specs[0]!.tests.push(
      structuredClone(value.report.suites[0]!.specs[0]!.tests[0]!),
    );
    expect(() => assertEventCountEvidence(value)).toThrow();
  });
});
