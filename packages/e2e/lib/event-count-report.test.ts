import { describe, expect, it } from "vitest";
import {
  assertEventCountEvidence,
  eventCountOriginals,
  eventCountBackgrounds,
  assertNoCountCredentials,
  assertCountStorageProvider,
  eventCountFailureDiagnostic,
  countBrowserRoute,
} from "./event-count-report.js";

describe("count-original failure diagnostics", () => {
  it("locates the failed browser operation without publishing its message, stack or arbitrary selector", () => {
    const diagnostic = eventCountFailureDiagnostic(
      JSON.stringify({
        errors: [
          {
            message:
              "Error: expect(locator).toBeVisible() failed\nLocator: getByTestId('event-form')\nprivate-email@ds.test private-cookie-value",
            stack:
              "Error: private-cookie-value\n at initialize (C:\\private-user\\repo\\packages\\e2e\\lib\\event-count-fixture.ts:409:22)\n at foreign (/private/email.ts:33:4)",
          },
        ],
      }),
    );
    expect(diagnostic.errors).toEqual(["BROWSER_ASSERTION_FAILED"]);
    expect(diagnostic.browserFailures).toEqual([
      {
        category: "BROWSER_ASSERTION_FAILED",
        selectors: ["event-form"],
        locations: [
          {
            file: "packages/e2e/lib/event-count-fixture.ts",
            line: 409,
            column: 22,
          },
        ],
      },
    ]);
    expect(JSON.stringify(diagnostic)).not.toMatch(
      /private-|private-user|email\.ts|expect\(/,
    );
  });
  for (const [message, category] of [
    [
      "locator.fill: Timeout 20000ms exceeded; private-value",
      "BROWSER_LOCATOR_TIMEOUT",
    ],
    [
      "locator.click: Element is not attached to the DOM private-value",
      "BROWSER_TARGET_DETACHED",
    ],
    [
      "expect(locator).toBeVisible() failed\nError: element(s) not found private-value",
      "BROWSER_TARGET_MISSING",
    ],
    [
      "page.goto: net::ERR_CONNECTION_REFUSED at http://private-host/",
      "BROWSER_CONNECTION_REFUSED",
    ],
    [
      "page.waitForURL: Timeout 20000ms exceeded private-value",
      "BROWSER_NAVIGATION_TIMEOUT",
    ],
    [
      "Error: strict mode violation: locator resolved to 2 elements private-value",
      "BROWSER_TARGET_AMBIGUOUS",
    ],
  ]) {
    it(`classifies ${category} without arbitrary error text`, () => {
      const diagnostic = eventCountFailureDiagnostic(
        JSON.stringify({ errors: [{ message }] }),
      );
      expect(diagnostic.errors).toEqual([category]);
      expect(JSON.stringify(diagnostic)).not.toContain("private-");
    });
  }
  it("exports only fixed browser route classes and validated status observations", () => {
    const admin = "http://localhost:3200",
      api = "http://localhost:41999";
    expect(
      countBrowserRoute(
        admin + "/v1/admin/event-kinds?private-query",
        admin,
        api,
      ),
    ).toEqual({ origin: "admin", route: "event-kinds" });
    expect(
      countBrowserRoute(api + "/v1/admin/events/private-id", admin, api),
    ).toEqual({ origin: "owned-api", route: "events" });
    expect(
      countBrowserRoute("http://foreign/v1/admin/auth/session", admin, api),
    ).toBeUndefined();
    expect(
      countBrowserRoute(admin + "/private-email", admin, api),
    ).toBeUndefined();
    const diagnostic = eventCountFailureDiagnostic(
      undefined,
      [
        {
          command: "own Admin browser response",
          origin: "admin",
          route: "event-kinds",
          status: 401,
          private: "private-cookie",
        },
        {
          command: "own Admin browser response",
          origin: "private-origin",
          route: "private-route",
          status: 200,
        },
        {
          command: "own Admin browser response",
          origin: "admin",
          route: "events",
          status: "private-value",
        },
        {
          command: "own Admin browser request failure",
          origin: "owned-api",
          route: "events",
          status: 0,
        },
        {
          command: "own Admin browser response",
          origin: "admin",
          route: "events",
          status: 0,
        },
        {
          command: "count editor: select classification",
          private: "private-cookie",
        },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n"),
    );
    expect(diagnostic.phase).toBe("editor-classification");
    expect(diagnostic.browserResponses).toEqual([
      { origin: "admin", route: "event-kinds", status: 401 },
      { origin: "owned-api", route: "events", status: 0 },
    ]);
    expect(JSON.stringify(diagnostic)).not.toContain("private-");
  });
  it("reports missing evidence as failure without inventing successful receipts", () => {
    const diagnostic = eventCountFailureDiagnostic(undefined, undefined);
    expect(diagnostic.accepted).toBe(false);
    expect(diagnostic.reportAvailable).toBe(false);
    expect(diagnostic.phase).toBe("before-native-boot");
    expect(diagnostic.errors).toEqual(["REPORT_UNAVAILABLE"]);
  });
  it("classifies the native OIDC failure while discarding authenticated error contents", () => {
    const raw = JSON.stringify({
      errors: [],
      suites: [
        {
          specs: [
            {
              title: eventCountOriginals[0],
              tests: [
                {
                  results: [
                    {
                      status: "failed",
                      retry: 0,
                      error: {
                        message:
                          "zitadel OIDC application config (IDP_CLIENT_ID / redirect URI) is not set; cookie=private-cookie-value",
                        stack: "secret-password",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const diagnostic = eventCountFailureDiagnostic(
      raw,
      JSON.stringify({
        command:
          "standard native AdminSessionService fixture startLogin/upgradePending; no factor acceptance",
      }),
    );
    expect(diagnostic.errors).toEqual(["OIDC_APPLICATION_CONFIG_MISSING"]);
    expect(diagnostic.phase).toBe("operator-session");
    expect(diagnostic.counts.failed).toBe(1);
    expect(diagnostic.rawReportSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(diagnostic)).not.toMatch(
      /private-cookie-value|secret-password|redirect URI/,
    );
  });
  it("never publishes arbitrary titles, errors, operation text or malformed raw input", () => {
    const diagnostic = eventCountFailureDiagnostic(
      JSON.stringify({
        errors: [{ message: "Bearer private-access-token" }],
        suites: [
          {
            specs: [
              {
                title: "private-email@ds.test",
                tests: [
                  {
                    results: [
                      {
                        status: "timedOut",
                        retry: 1,
                        error: { message: "private-room-key" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
      JSON.stringify({
        command: "private-cookie-value",
        password: "secret-password",
      }),
    );
    expect(diagnostic.errors).toContain("UNCLASSIFIED_FAILURE");
    expect(diagnostic.counts.timedOut).toBe(1);
    expect(diagnostic.counts.retries).toBe(1);
    expect(JSON.stringify(diagnostic)).not.toMatch(
      /private-|secret-password|Bearer/,
    );
    expect(
      eventCountFailureDiagnostic("private-secret-invalid-json", "invalid")
        .errors,
    ).toEqual(["REPORT_UNREADABLE"]);
  });
});

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
    backgroundRegistrationCount: 1,
    backgroundPresenceCount: 1,
    caseRegistrationCount: index === 0 ? 0 : 1,
    casePresenceCount: index === 2 ? 1 : 0,
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
  it("requires actual MinIO provider identity bound to the native API endpoint and bucket", () => {
    const native = {
      storageEndpoint: "http://localhost:9000",
      storageBucket: "count4035",
    };
    const provider = {
      provider: "dev-stand MinIO",
      endpoint: native.storageEndpoint,
      bucket: native.storageBucket,
      imageId: `sha256:${"a".repeat(64)}`,
    };
    expect(() => assertCountStorageProvider(provider, native)).not.toThrow();
    expect(() =>
      assertCountStorageProvider({ ...provider, provider: "S3Mock" }, native),
    ).toThrow();
    expect(() =>
      assertCountStorageProvider(
        { ...provider, endpoint: "http://foreign:9000" },
        native,
      ),
    ).toThrow();
    expect(() =>
      assertCountStorageProvider({ ...provider, imageId: "" }, native),
    ).toThrow();
  });
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
    "case-count",
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
        case "case-count":
          value.resources[1]!.caseRegistrationCount = 0;
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
