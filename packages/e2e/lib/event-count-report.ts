import { assertOperationalReport } from "../api-probes/operational-report.js";
import { createHash } from "node:crypto";

const moduleErrorCodes = [
  "UNCLASSIFIED_MODULE_LOAD_FAILURE",
  "MODULE_NOT_FOUND",
  "ERR_MODULE_NOT_FOUND",
  "ERR_REQUIRE_ESM",
  "ERR_REQUIRE_ASYNC_MODULE",
  "ERR_REQUIRE_CYCLE_MODULE",
  "ERR_UNKNOWN_FILE_EXTENSION",
  "ERR_PACKAGE_PATH_NOT_EXPORTED",
  "ERR_PACKAGE_IMPORT_NOT_DEFINED",
  "ERR_INVALID_PACKAGE_CONFIG",
  "ERR_UNSUPPORTED_DIR_IMPORT",
  "ERR_IMPORT_ATTRIBUTE_MISSING",
  "ERR_INVALID_ARG_VALUE",
  "ERR_INVALID_URL",
  "ERR_INVALID_FILE_URL_PATH",
  "ERR_INTERNAL_ASSERTION",
  "ERR_DLOPEN_FAILED",
];
const moduleErrorNames = [
  "Error",
  "TypeError",
  "ReferenceError",
  "SyntaxError",
  "RangeError",
  "AggregateError",
  "UNKNOWN_ERROR_TYPE",
];
export function countModuleFailure(error: unknown) {
  const codes: string[] = [],
    names: string[] = [],
    seen = new Set<unknown>();
  for (
    let current = error;
    current &&
    typeof current === "object" &&
    !seen.has(current) &&
    codes.length < 4;
  ) {
    seen.add(current);
    const row = current as Record<string, unknown>;
    codes.push(
      typeof row.code === "string" && moduleErrorCodes.includes(row.code)
        ? row.code
        : "UNCLASSIFIED_MODULE_LOAD_FAILURE",
    );
    names.push(
      typeof row.name === "string" && moduleErrorNames.includes(row.name)
        ? row.name
        : "UNKNOWN_ERROR_TYPE",
    );
    current = row.cause;
  }
  return { codes, names };
}

const browserRoutes = [
  "auth-state",
  "auth-session",
  "event-kinds",
  "events",
  "projects",
  "editor",
];
export function countBrowserRoute(
  raw: string,
  adminOrigin: string,
  apiOrigin: string,
) {
  const url = new URL(raw);
  const origin =
    url.origin === adminOrigin
      ? "admin"
      : url.origin === apiOrigin
        ? "owned-api"
        : undefined;
  if (!origin) return;
  const route =
    url.pathname === "/v1/admin/auth/state"
      ? "auth-state"
      : url.pathname === "/v1/admin/auth/session"
        ? "auth-session"
        : /^\/v1\/admin\/event-kinds(?:\/|$)/.test(url.pathname)
          ? "event-kinds"
          : /^\/v1\/admin\/events(?:\/|$)/.test(url.pathname)
            ? "events"
            : /^\/v1\/admin\/projects(?:\/|$)/.test(url.pathname)
              ? "projects"
              : /^\/events(?:\/|$)/.test(url.pathname)
                ? "editor"
                : undefined;
  if (route) return { origin, route };
}

export function eventCountFailureDiagnostic(raw?: string, rawOps?: string) {
  const diagnostic = {
    accepted: false,
    reportAvailable: false,
    phase: "before-native-boot",
    counts: {
      passed: 0,
      failed: 0,
      skipped: 0,
      timedOut: 0,
      interrupted: 0,
      retries: 0,
      globalErrors: 0,
    },
    errors: [] as string[],
    browserFailures: [] as {
      category: string;
      selectors: string[];
      locations: { file: string; line: number; column: number }[];
    }[],
    browserResponses: [] as { origin: string; route: string; status: number }[],
    nativeModuleFailures: [] as {
      module: string;
      loader: string;
      codes: string[];
      names: string[];
      nodeVersion: string;
      platform: string;
    }[],
    rawReportSha256:
      raw === undefined ? null : createHash("sha256").update(raw).digest("hex"),
    rawOperationsSha256:
      rawOps === undefined
        ? null
        : createHash("sha256").update(rawOps).digest("hex"),
  };
  const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const array = (value: unknown): unknown[] =>
    Array.isArray(value) ? value : [];
  const phases = new Map([
    [
      "git HEAD and clean shipping source binding before native boot",
      "native-boot",
    ],
    [
      "standard native AdminSessionService fixture startLogin/upgradePending; no factor acceptance",
      "operator-session",
    ],
    [
      "actual storefront session-seed fixture through native OIDC transaction/redeem",
      "doctor-session",
    ],
    ["actual Admin create form; count defaults untouched", "admin-editor"],
    ["public page and listing owning reads", "consumer-reads"],
    ...["admin", "pdf", "lifecycles", "msk", "consumers"].map(
      (clause): [string, string] => [
        `count Background: ${clause}`,
        `background-${clause}`,
      ],
    ),
    ...[
      "navigate",
      "form-visible",
      "defaults",
      "title",
      "school",
      "starts-at",
      "duration",
      "pdf",
      "classification",
      "submit",
      "saved-url",
    ].map((stage): [string, string] => [
      `count editor: ${stage === "classification" ? "select classification" : stage}`,
      `editor-${stage}`,
    ]),
  ]);
  for (const line of rawOps?.split(/\r?\n/) ?? []) {
    try {
      const row = object(JSON.parse(line));
      const phase = phases.get(String(row.command));
      if (phase) diagnostic.phase = phase;
      const moduleLoader = new Map([
        ["lifecycle @ds/schemas require failed", "require"],
        ["lifecycle @ds/schemas resolve failed", "resolve"],
        ["lifecycle @ds/schemas native import failed", "native-import"],
      ]).get(String(row.command));
      if (
        moduleLoader &&
        Array.isArray(row.codes) &&
        row.codes.length > 0 &&
        row.codes.length <= 4 &&
        row.codes.every(
          (code) => typeof code === "string" && moduleErrorCodes.includes(code),
        ) &&
        Array.isArray(row.names) &&
        row.names.length === row.codes.length &&
        row.names.every(
          (name) => typeof name === "string" && moduleErrorNames.includes(name),
        ) &&
        typeof row.nodeVersion === "string" &&
        /^v\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(row.nodeVersion) &&
        ["linux", "win32", "darwin"].includes(String(row.platform))
      ) {
        diagnostic.nativeModuleFailures.push({
          module: "@ds/schemas",
          loader: moduleLoader,
          codes: row.codes,
          names: row.names,
          nodeVersion: row.nodeVersion,
          platform: String(row.platform),
        });
      }
      if (
        (row.command === "own Admin browser response" ||
          row.command === "own Admin browser request failure") &&
        ["admin", "owned-api"].includes(String(row.origin)) &&
        browserRoutes.includes(String(row.route)) &&
        typeof row.status === "number" &&
        Number.isInteger(row.status) &&
        (row.command === "own Admin browser request failure"
          ? row.status === 0
          : row.status >= 100 && row.status <= 599)
      ) {
        diagnostic.browserResponses.push({
          origin: String(row.origin),
          route: String(row.route),
          status: row.status,
        });
      }
    } catch {
      /* Raw diagnostics remain private. */
    }
  }
  const classify = (error: unknown) => {
    const row = object(error),
      message = typeof row.message === "string" ? row.message : "";
    const category = /zitadel OIDC application config[^\n]*is not set/.test(
      message,
    )
      ? "OIDC_APPLICATION_CONFIG_MISSING"
      : /ERR_CONNECTION_REFUSED/.test(message)
        ? "BROWSER_CONNECTION_REFUSED"
        : /element\(s\) not found/.test(message)
          ? "BROWSER_TARGET_MISSING"
          : /not attached to the DOM|detached from the DOM/.test(message)
            ? "BROWSER_TARGET_DETACHED"
            : /strict mode violation/.test(message)
              ? "BROWSER_TARGET_AMBIGUOUS"
              : /page\.(?:goto|waitForURL).*Timeout/.test(message)
                ? "BROWSER_NAVIGATION_TIMEOUT"
                : /locator\.[a-zA-Z]+.*Timeout/.test(message)
                  ? "BROWSER_LOCATOR_TIMEOUT"
                  : /expect\(.*\)\.(?:toBeVisible|toBeChecked|toHave|toBe|toEqual)/.test(
                        message,
                      )
                    ? "BROWSER_ASSERTION_FAILED"
                    : /ERR_|Failed to fetch|fetch failed/.test(message)
                      ? "BROWSER_NETWORK_FAILURE"
                      : "UNCLASSIFIED_FAILURE";
    diagnostic.errors.push(category);
    const selectors = [
      "event-form",
      "hide-sign-up-count",
      "show-presence-count",
      "program-pdf",
      "event-kind",
      "event-audience",
      "submit-event",
      "edit-ok",
    ].filter(
      (selector) =>
        message.includes(`getByTestId('${selector}')`) ||
        message.includes(`getByTestId("${selector}")`),
    );
    const locations: { file: string; line: number; column: number }[] = [];
    const stack =
      typeof row.stack === "string" ? row.stack.replaceAll("\\", "/") : "";
    for (const match of stack.matchAll(
      /(?:^|[/(\s])((?:packages\/e2e\/)(?:lib\/event-count-fixture|admin\/event-classification|admin\/events|steps\/event-count-visibility\.steps)\.ts):(\d{1,5}):(\d{1,4})(?=[)\s]|$)/g,
    )) {
      const line = Number(match[2]),
        column = Number(match[3]);
      if (line > 0 && line <= 10000 && column > 0 && column <= 1000)
        locations.push({ file: match[1]!, line, column });
    }
    diagnostic.browserFailures.push({ category, selectors, locations });
  };
  if (raw === undefined) diagnostic.errors.push("REPORT_UNAVAILABLE");
  else {
    try {
      const report = object(JSON.parse(raw));
      diagnostic.reportAvailable = true;
      const errors = array(report.errors);
      diagnostic.counts.globalErrors = errors.length;
      errors.forEach(classify);
      const visit = (suite: unknown) => {
        const row = object(suite);
        for (const spec of array(row.specs))
          for (const test of array(object(spec).tests))
            for (const result of array(object(test).results)) {
              const item = object(result);
              for (const status of [
                "passed",
                "failed",
                "skipped",
                "timedOut",
                "interrupted",
              ] as const)
                if (item.status === status) diagnostic.counts[status]++;
              if (
                typeof item.retry === "number" &&
                Number.isSafeInteger(item.retry) &&
                item.retry > 0
              )
                diagnostic.counts.retries += item.retry;
              if (item.error) classify(item.error);
              array(item.errors).forEach(classify);
            }
        array(row.suites).forEach(visit);
      };
      array(report.suites).forEach(visit);
    } catch {
      diagnostic.errors.push("REPORT_UNREADABLE");
    }
  }
  diagnostic.errors = [...new Set(diagnostic.errors)];
  diagnostic.browserFailures = [
    ...new Map(
      diagnostic.browserFailures.map((failure) => [
        JSON.stringify(failure),
        failure,
      ]),
    ).values(),
  ].slice(-30);
  diagnostic.browserResponses = diagnostic.browserResponses.slice(-60);
  return diagnostic;
}

export const eventCountOriginals = [
  "A new event hides its registrant count by default",
  "An operator shows the registrant count of an event",
  "An operator shows the live participant count of an event to viewers",
] as const;
export const eventCountBackgrounds = [
  "admin",
  "pdf",
  "lifecycles",
  "msk",
  "consumers",
] as const;

export function decodeCountEvidence(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return bytes.subarray(2).toString("utf16le");
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return Buffer.from(bytes.subarray(2)).swap16().toString("utf16le");
  return bytes.toString("utf8").replace(/^\uFEFF/, "");
}
export function assertCountStorageProvider(
  provider: Record<string, unknown>,
  native: Record<string, unknown>,
) {
  requireEvidence(
    provider.endpoint === native.storageEndpoint &&
      provider.bucket === native.storageBucket,
    "storage provider/native API binding",
  );
  if (provider.provider === "dev-stand MinIO")
    requireEvidence(
      typeof provider.imageId === "string" &&
        /^sha256:[a-f0-9]{64}$/.test(provider.imageId),
      "actual dev-stand MinIO image identity",
    );
  else
    requireEvidence(
      provider.provider === "official-source MinIO" &&
        provider.source === "7aac2a2c5b7c882e68c1ce017d8256be2feea27f" &&
        provider.goArchiveSha256 ===
          "6842c516ca66c89d648a7f1dbe28e28c47b61b59f8f06633eb2ceb1188e9251d" &&
        typeof provider.binarySha256 === "string" &&
        /^[a-f0-9]{64}$/.test(provider.binarySha256) &&
        provider.listenerReleased === true,
      "official MinIO source/toolchain/binary identity and owned listener cleanup",
    );
}
export function assertNoCountCredentials(
  files: Record<string, string | Buffer>,
  secrets: readonly string[],
) {
  for (const [name, bytes] of Object.entries(files)) {
    const text = typeof bytes === "string" ? bytes : decodeCountEvidence(bytes);
    if (secrets.some((secret) => secret.length >= 6 && text.includes(secret)))
      throw new Error(
        `Configured or dynamically issued credential in safe export: ${name}`,
      );
    if (
      /"(?:accessToken|refreshToken|csrfToken|password|authorization|cookie)"\s*:/i.test(
        text,
      )
    )
      throw new Error(`Credential field in safe export: ${name}`);
  }
}

export interface CountResource {
  title: string;
  head: string;
  database: string;
  eventId: string;
  backgroundId: string;
  adminSub: string;
  doctorSub: string;
  adminRoles: string[];
  doctorRoles: string[];
  expectedCount: number | null;
  observedCount: number | null;
  persisted: boolean;
  reopened: boolean;
  defaultHidden: boolean;
  defaultPresence: boolean;
  backgroundRegistrationCount: number;
  backgroundPresenceCount: number;
  caseRegistrationCount: number;
  casePresenceCount: number;
  cleanup: {
    eventState: string;
    backgroundState: string;
    objectsDeleted: number;
    registrationsRetained: boolean;
    beatsRetained: boolean;
  };
}
export interface CountBackground {
  title: string;
  clause: string;
  order: number;
  head: string;
  database: string;
  eventId: string;
  adminSub: string;
  doctorSub: string;
  evidence: Record<string, unknown>;
}
function requireEvidence(ok: unknown, name: string): asserts ok {
  if (!ok) throw new Error(`4035 evidence: ${name}`);
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export function assertEventCountEvidence(value: {
  report: unknown;
  backgrounds: unknown;
  resources: unknown;
  head: string;
}) {
  assertOperationalReport(value.report, eventCountOriginals, "admin");
  requireEvidence(/^[0-9a-f]{40}$/.test(value.head), "invalid committed head");
  requireEvidence(
    Array.isArray(value.resources) && value.resources.length === 3,
    "exactly three resources",
  );
  requireEvidence(
    Array.isArray(value.backgrounds) && value.backgrounds.length === 15,
    "exactly fifteen Background receipts",
  );
  const resources = value.resources as CountResource[];
  const backgrounds = value.backgrounds as CountBackground[];
  requireEvidence(
    new Set(resources.flatMap((r) => [r.eventId, r.backgroundId])).size === 6,
    "own distinct case and Background events",
  );
  for (const [index, title] of eventCountOriginals.entries()) {
    const resource = resources[index]!;
    requireEvidence(
      resource.title === title &&
        resource.head === value.head &&
        /^ds_(dev|probe)_4035$/.test(resource.database),
      "resource identity/head/database",
    );
    requireEvidence(
      resource.eventId &&
        resource.backgroundId &&
        resource.adminSub &&
        resource.doctorSub &&
        resource.adminSub !== resource.doctorSub,
      "own event and distinct identities",
    );
    requireEvidence(
      resource.adminRoles.includes("platform_admin") &&
        same(resource.doctorRoles, ["doctor_guest"]),
      "real operator and non-staff doctor",
    );
    requireEvidence(
      resource.defaultHidden === true && resource.defaultPresence === false,
      "untouched defaults",
    );
    requireEvidence(
      resource.persisted === (index !== 1) &&
        resource.reopened === (index !== 1),
      "persisted and reopened option",
    );
    requireEvidence(
      resource.backgroundRegistrationCount === 1 &&
        resource.backgroundPresenceCount === 1,
      "known nonzero native producer counts",
    );
    requireEvidence(
      resource.caseRegistrationCount === (index === 0 ? 0 : 1) &&
        resource.casePresenceCount === (index === 2 ? 1 : 0),
      "case producer counts distinct from Background witnesses",
    );
    requireEvidence(
      resource.expectedCount === (index === 0 ? null : 1) &&
        resource.observedCount === resource.expectedCount,
      "exact count",
    );
    requireEvidence(
      resource.cleanup?.eventState === "hidden" &&
        resource.cleanup.backgroundState === "hidden" &&
        resource.cleanup.objectsDeleted === 2 &&
        resource.cleanup.registrationsRetained === true &&
        resource.cleanup.beatsRetained === true,
      "complete supported cleanup and retained history",
    );
    for (const [order, clause] of eventCountBackgrounds.entries()) {
      const row = backgrounds[index * 5 + order]!;
      requireEvidence(
        row.title === title &&
          row.order === order &&
          row.clause === clause &&
          row.head === value.head &&
          row.database === resource.database &&
          row.eventId === resource.backgroundId &&
          row.adminSub === resource.adminSub &&
          row.doctorSub === resource.doctorSub,
        "ordered Background identity",
      );
      const e = row.evidence;
      requireEvidence(e && typeof e === "object", "owning Background evidence");
      if (clause === "admin")
        requireEvidence(
          e.status === 200 &&
            Array.isArray(e.roles) &&
            e.roles.includes("platform_admin") &&
            typeof e.origin === "string" &&
            /^https?:\/\//.test(e.origin),
          "configured origin and authenticated Admin",
        );
      if (clause === "pdf")
        requireEvidence(
          e.status === 200 &&
            typeof e.bytes === "number" &&
            e.bytes > 0 &&
            typeof e.sha256 === "string" &&
            /^[a-f0-9]{64}$/.test(e.sha256),
          "real stored PDF bytes",
        );
      if (clause === "lifecycles") {
        requireEvidence(
          same(e.enum, [
            "draft",
            "published",
            "live",
            "ended",
            "hidden",
            "in_archive",
          ]),
          "closed six-value enum without alias",
        );
        requireEvidence(
          same(e.platform, [
            "draft>published",
            "published>live",
            "live>ended",
            "ended>hidden",
          ]) && same(e.legacy, ["hidden>in_archive", "in_archive>hidden"]),
          "origin-selected disjoint lifecycles",
        );
      }
      if (clause === "msk")
        requireEvidence(
          typeof e.msk === "string" &&
            typeof e.instant === "string" &&
            new Date(`${e.msk}:00+03:00`).toISOString() === e.instant,
          "actual MSK input to stored canonical instant",
        );
      if (clause === "consumers")
        requireEvidence(
          e.publicStatus === 200 &&
            e.pageState === "live" &&
            e.listingState === "live" &&
            e.registrationStatus === 200 &&
            e.registered === true &&
            e.roomStatus === 200 &&
            e.roomEventId === resource.backgroundId &&
            e.roomPresence === null,
          "actual public/list/registration and non-staff room read",
        );
    }
  }
}
