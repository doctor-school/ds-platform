import { assertOperationalReport } from "../api-probes/operational-report.js";
import { createHash } from "node:crypto";
import { eventCountBackgrounds } from "./event-count-report.js";

export const eventAuthoringCases = [
  {
    id: "007:49",
    title:
      "A created event starts in draft and stores one canonical instant for a МСК time",
  },
  {
    id: "007:86:rutube",
    title: "The stream is configured from an explicit provider enum [rutube]",
  },
  {
    id: "007:86:youtube",
    title: "The stream is configured from an explicit provider enum [youtube]",
  },
  {
    id: "007:105",
    title: "A wrong stream URL is correctable while the event is published",
  },
] as const;

export const eventAuthoringProjections = [
  "academy-detail",
  "doctor-detail",
  "academy-participation",
  "doctor-participation",
  "academy-bare",
  "academy-upcoming",
  "academy-past",
  "academy-month",
  "academy-month-counts",
  "academy-live",
  "doctor-feed",
  "doctor-past",
  "doctor-month",
  "doctor-month-counts",
  "doctor-live",
  "specialty-events",
  "event-directions",
  "event-projects",
  "event-speakers",
  "direction-events",
  "project-events",
  "project-page",
  "project-scale",
  "statistics",
] as const;

type Row = Record<string, unknown>;
export function redactAuthoringPublicEvidence(value: unknown) {
  const redactions: {
    path: string;
    rawUrlSha256: string;
    querySha256: string;
  }[] = [];
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  function visit(child: unknown, path: string): unknown {
    if (typeof child === "string" && /^https?:\/\//.test(child)) {
      const url = new URL(child);
      if (url.search || url.username || url.password) {
        redactions.push({
          path,
          rawUrlSha256: sha(child),
          querySha256: sha(url.search),
        });
        url.username = "";
        url.password = "";
        url.search = "";
        return url.href;
      }
    }
    if (Array.isArray(child))
      return child.map((entry, index) => visit(entry, `${path}.${index}`));
    if (child && typeof child === "object")
      return Object.fromEntries(
        Object.entries(child).map(([key, entry]) => [
          key,
          visit(entry, `${path}.${key}`),
        ]),
      );
    return child;
  }
  return { value: visit(value, "$"), redactions };
}
export function assertAuthoringRateIsolation(ops: unknown) {
  const witnesses = rows(ops).filter(
    (item) => item.command === "native rate namespace witness",
  );
  const observed = new Set<string>(),
    absent = new Set<string>();
  for (const item of witnesses) {
    if (item.observed === true) {
      requireEvidence(
        item.disjoint === true && digest(item.keySha256),
        "native rate isolation observation",
      );
      observed.add(String(item.keySha256));
    }
    if (item.action === "verified-absent") {
      requireEvidence(
        Array.isArray(item.keySha256s) && item.keySha256s.every(digest),
        "native rate isolation cleanup keys",
      );
      item.keySha256s.forEach((key: string) => absent.add(key));
    }
  }
  requireEvidence(
    observed.size > 0 &&
      observed.size === absent.size &&
      [...observed].every((key) => absent.has(key)),
    "complete native rate isolation and exact-key cleanup",
  );
  return { observedKeySha256s: [...observed], absentKeySha256s: [...absent] };
}
export function assertAuthoringTerminal(value: unknown) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (
      [
        "nextCursor",
        "hasMore",
        "hasNextPage",
        "remaining",
        "nextCount",
        "nextFrom",
      ].includes(key) &&
      child !== null &&
      child !== false &&
      child !== 0
    )
      throw new Error(`4061 nonterminal public projection: ${key}`);
    assertAuthoringTerminal(child);
  }
}
function requireEvidence(ok: unknown, name: string): asserts ok {
  if (!ok) throw new Error(`4061 evidence: ${name}`);
}
function row(value: unknown): Row {
  requireEvidence(
    value && typeof value === "object" && !Array.isArray(value),
    "object witness",
  );
  return value as Row;
}
function rows(value: unknown): Row[] {
  requireEvidence(Array.isArray(value), "array witness");
  return value.map(row);
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const digest = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const identity = (value: unknown) =>
  typeof value === "string" && value.length > 0;

function backgroundEvidence(clause: string, evidence: Row, resource: Row) {
  if (clause === "admin")
    requireEvidence(
      evidence.status === 200 &&
        Array.isArray(evidence.roles) &&
        evidence.roles.includes("platform_admin") &&
        typeof evidence.origin === "string" &&
        /^https?:\/\//.test(evidence.origin),
      "native configured Admin session",
    );
  if (clause === "pdf")
    requireEvidence(
      evidence.status === 200 &&
        typeof evidence.bytes === "number" &&
        evidence.bytes > 0 &&
        digest(evidence.sha256),
      "actual stored PDF bytes",
    );
  if (clause === "lifecycles")
    requireEvidence(
      same(evidence.enum, [
        "draft",
        "published",
        "live",
        "ended",
        "hidden",
        "in_archive",
      ]) &&
        same(evidence.platform, [
          "draft>published",
          "published>live",
          "live>ended",
          "ended>hidden",
        ]) &&
        same(evidence.legacy, ["hidden>in_archive", "in_archive>hidden"]),
      "native enum and disjoint graphs",
    );
  if (clause === "msk")
    requireEvidence(
      typeof evidence.msk === "string" &&
        new Date(`${evidence.msk}:00+03:00`).toISOString() === evidence.instant,
      "canonical Background MSK instant",
    );
  if (clause === "consumers")
    requireEvidence(
      evidence.publicStatus === 200 &&
        evidence.pageState === "live" &&
        evidence.listingState === "live" &&
        evidence.registrationStatus === 200 &&
        evidence.registered === true &&
        evidence.roomStatus === 200 &&
        evidence.roomEventId === resource.backgroundId &&
        evidence.roomPresence === null,
      "real public, registration and non-staff room consumers",
    );
}

function draftProof(proof: Row) {
  const drafts = rows(proof.drafts);
  requireEvidence(
    drafts.length === 2 &&
      new Set(drafts.map((item) => item.eventId)).size === 2 &&
      same(drafts.map((item) => item.audience).sort(), ["doctors", "experts"]),
    "both audience drafts without vacuous storefront proof",
  );
  for (const item of drafts)
    requireEvidence(
      identity(item.eventId) &&
        item.state === "draft" &&
        typeof item.msk === "string" &&
        new Date(`${item.msk}:00+03:00`).toISOString() === item.instant,
      "actual draft state and canonical instant",
    );
  const projections = rows(proof.projections);
  requireEvidence(
    same(
      projections.map((item) => item.key).sort(),
      [...eventAuthoringProjections].sort(),
    ),
    "complete unique mounted public projection inventory",
  );
  for (const item of projections)
    requireEvidence(
      item.negativeStatus ===
        (/(?:detail|participation)$|^event-/.test(String(item.key))
          ? 404
          : 200) &&
        item.draftAbsent === true &&
        item.positiveStatus === 200 &&
        item.positiveVerified === true &&
        item.terminal === true &&
        digest(item.negativeSha256) &&
        digest(item.positiveSha256),
      "real negative and positive projection controls, complete pagination",
    );
  requireEvidence(
    proof.monthCountBefore === 0 &&
      proof.monthCountAfter === 1 &&
      proof.projectScaleDelta === 1 &&
      proof.statistics === proof.statisticsOracle &&
      typeof proof.statistics === "number" &&
      proof.statistics > 0 &&
      typeof proof.today === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(proof.today),
    "scoped counters, native statistics oracle and owning horizon",
  );
}

function providerProof(proof: Row, resource: Row, provider: string) {
  requireEvidence(
    proof.provider === provider &&
      identity(proof.embedRef) &&
      proof.persisted === true &&
      proof.reopened === true &&
      proof.noSniffingUnitPassed === true,
    "persisted, reopened explicit provider and owning adversarial test",
  );
  const frames = rows(proof.frames);
  requireEvidence(
    frames.length === 2 &&
      same(frames.map((frame) => frame.host).sort(), ["academy", "doctor"]),
    "both real storefront room mounts",
  );
  const expected =
    provider === "rutube"
      ? "https://rutube.ru/play/embed/"
      : "https://www.youtube.com/embed/";
  for (const frame of frames)
    requireEvidence(
      frame.provider === provider &&
        frame.src ===
          `${expected}${proof.embedRef}${provider === "youtube" ? `?enablejsapi=1&origin=${encodeURIComponent(String(frame.browserOrigin))}` : ""}` &&
        frame.nativeProvider === provider &&
        frame.nativeEmbedRef === proof.embedRef &&
        frame.ssrStatus === 200 &&
        frame.ssrApiOrigin === resource.apiOrigin &&
        frame.ssrDatabase === resource.database &&
        frame.eventId === resource.eventId &&
        digest(frame.assetsSha256),
      "actual enum iframe and owned SSR/native/asset binding",
    );
}

function correctionProof(proof: Row) {
  requireEvidence(
    proof.beforeState === "published" &&
      proof.afterState === "published" &&
      typeof proof.beforeVersion === "number" &&
      proof.afterVersion === proof.beforeVersion + 1 &&
      identity(proof.wrongRef) &&
      identity(proof.correctedRef) &&
      proof.wrongRef !== proof.correctedRef &&
      proof.persistedRef === proof.correctedRef &&
      proof.reopenedRef === proof.correctedRef &&
      proof.streamRows === 1 &&
      proof.beforeRoomOpen === true,
    "browser correction persisted/reopened while published, one stream row",
  );
  const expected = [
    { type: "event.published", from: "draft", to: "published" },
  ];
  requireEvidence(
    same(proof.lifecycleBefore, expected) &&
      same(proof.lifecycleAfter, expected),
    "immutable native lifecycle history without reversal or room opening",
  );
}

export function assertEventAuthoringEvidence(value: {
  report: unknown;
  backgrounds: unknown;
  resources: unknown;
  head: string;
}) {
  assertOperationalReport(
    value.report,
    eventAuthoringCases.map((item) => item.title),
    "admin",
  );
  const execution: { title: string; start: number }[] = [];
  function visitReport(suite: Row) {
    for (const spec of rows(suite.specs ?? [])) {
      for (const test of rows(spec.tests)) {
        for (const result of rows(test.results)) {
          const start = Date.parse(String(result.startTime));
          requireEvidence(
            Number.isFinite(start),
            "actual execution start time",
          );
          execution.push({
            title: String(spec.title).replace(/ @host:admin$/, ""),
            start,
          });
          requireEvidence(
            result.error == null &&
              (result.errors === undefined ||
                (Array.isArray(result.errors) && result.errors.length === 0)),
            "no errors attached to a passed result",
          );
        }
      }
    }
    rows(suite.suites ?? []).forEach(visitReport);
  }
  rows(row(value.report).suites).forEach(visitReport);
  requireEvidence(
    new Set(execution.map((item) => item.start)).size === 4,
    "unique actual case execution timestamps",
  );
  const reportOrder = execution
    .sort((a, b) => a.start - b.start)
    .map((item) => item.title);
  requireEvidence(
    same(
      reportOrder,
      eventAuthoringCases.map((item) => item.title),
    ),
    "ordered executed cases",
  );
  requireEvidence(/^[a-f0-9]{40}$/.test(value.head), "committed head");
  const backgrounds = rows(value.backgrounds),
    resources = rows(value.resources);
  requireEvidence(
    backgrounds.length === 20,
    "exactly twenty ordered Backgrounds",
  );
  requireEvidence(resources.length === 4, "exactly four original-owned cases");
  requireEvidence(
    new Set(resources.flatMap((item) => [item.eventId, item.backgroundId]))
      .size === 8,
    "distinct owned case and Background events",
  );
  for (const [index, expected] of eventAuthoringCases.entries()) {
    const resource = resources[index]!;
    requireEvidence(
      resource.caseId === expected.id &&
        resource.title === expected.title &&
        resource.head === value.head &&
        /^ds_(dev|probe)_4061$/.test(String(resource.database)) &&
        identity(resource.adminSub) &&
        identity(resource.doctorSub) &&
        resource.adminSub !== resource.doctorSub &&
        same(resource.adminRoles, ["platform_admin"]) &&
        same(resource.doctorRoles, ["doctor_guest"]) &&
        typeof resource.apiOrigin === "string" &&
        /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(resource.apiOrigin) &&
        digest(resource.compiledApiSha256) &&
        digest(resource.shippingSourceSha256),
      "ordered case/head/DB/native identity",
    );
    for (const [order, clause] of eventCountBackgrounds.entries()) {
      const item = backgrounds[index * 5 + order]!;
      requireEvidence(
        item.title === resource.title &&
          item.head === value.head &&
          item.database === resource.database &&
          item.eventId === resource.backgroundId &&
          item.adminSub === resource.adminSub &&
          item.doctorSub === resource.doctorSub &&
          item.order === order &&
          item.clause === clause,
        "ordered Background identity",
      );
      backgroundEvidence(clause, row(item.evidence), resource);
    }
    const proof = row(resource.proof);
    if (index === 0) draftProof(proof);
    else if (index === 3) correctionProof(proof);
    else providerProof(proof, resource, index === 1 ? "rutube" : "youtube");
    const cleanup = row(resource.cleanup),
      events = rows(cleanup.events),
      subjects = rows(cleanup.subjects);
    requireEvidence(
      events.length >= 2 &&
        new Set(events.map((item) => item.eventId)).size === events.length &&
        events.some((item) => item.eventId === resource.eventId) &&
        events.some((item) => item.eventId === resource.backgroundId) &&
        events.every(
          (item) =>
            item.state === "hidden" &&
            item.pdfAbsent === true &&
            item.historyRetained === true,
        ) &&
        subjects.length === 2 &&
        same(
          subjects.map((item) => item.sub).sort(),
          [resource.adminSub, resource.doctorSub].sort(),
        ) &&
        subjects.every((item) => item.status === 404 || item.status === 410) &&
        cleanup.sessionsClosed === true,
      "complete supported owned cleanup with native history retained",
    );
  }
}
