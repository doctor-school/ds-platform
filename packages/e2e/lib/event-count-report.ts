import { assertOperationalReport } from "../api-probes/operational-report.js";

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
  registrationCount: number;
  presenceCount: number;
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
      resource.registrationCount === 1 && resource.presenceCount === 1,
      "known nonzero native producer counts",
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
