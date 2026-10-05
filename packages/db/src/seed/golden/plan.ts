// #2063 — the pure write plan of the golden seed.
//
// Everything that can be decided without a database is decided here: the order
// the tables are written in, which column each upsert conflicts on, which
// columns a re-run refreshes, and whether the dataset is referentially sound.
// `seed.ts` then does nothing but execute this plan, which is what makes the
// interesting half of the seed unit-testable without a Postgres.
//
// Idempotency is a property of the plan, not of the executor: every step
// conflicts on a PINNED identity and updates in place, so a second run rewrites
// the same values into the same rows and changes nothing observable.

import { doctorSpecialties } from "../../schema/doctor-specialties.js";
import { eventRecordings } from "../../schema/event-recordings.js";
import { events, streamConfig } from "../../schema/events.js";
import { consentRecords } from "../../schema/consent-records.js";
import {
  congressSubmissionKindSettings,
  congressSubmissionSettings,
} from "../../schema/congress-submission-settings.js";
import { congressSubmissions } from "../../schema/congress-submissions.js";
import { registrationAttendance } from "../../schema/registration-attendance.js";
import { registrations } from "../../schema/registrations.js";
import {
  directionAdjacency,
  directions,
  directionSpecialties,
  eventDirections,
  eventExperts,
  eventProjects,
  experts,
  partners,
  projectExperts,
  projectPartners,
  projects,
} from "../../schema/taxonomy.js";
import { users } from "../../schema/users.js";
import { GOLDEN_GROUP, SEED_EVENT_KINDS } from "./ids.js";
import type {
  GoldenDataset,
  GoldenDirectionSpecialtyLink,
  GoldenDoctorSpecialtyLink,
} from "./dataset.js";

/** Raised when the plan cannot be built — a missing dependency, never a warning. */
export class GoldenPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldenPlanError";
  }
}

/**
 * One idempotent upsert.
 *
 * `conflictKeys` and `updateKeys` are Drizzle PROPERTY names (`eventId`), not
 * column names; `seed.ts` translates them through the table's column map so a
 * column rename in the schema can never leave a stale string here.
 */
export interface GoldenSeedStep {
  /** Physical table name — used in logs and in the step-count report. */
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous table set; the executor narrows per step
  table: any;
  rows: Record<string, unknown>[];
  conflictKeys: string[];
  updateKeys: string[];
  /**
   * Id group ({@link GOLDEN_GROUP}) whose VOLUME ordinal namespace this step
   * owns outright and replaces on every run.
   *
   * Declared by the steps whose rows are a pin-dependent PAIRING rather than a
   * pinned identity: a later pin reshuffles which logical pair each positional
   * ordinal carries, so a row-by-row upsert on `id` walks straight into the
   * table's pair unique key against an ordinal the same run has not rewritten
   * yet (`registrations_user_id_event_id_unique` #2271,
   * `event_directions_pair_key` #2351). The executor deletes
   * `[GOLDEN_VOLUME_ORDINAL_BASE, max ordinal]` of this group inside the seed
   * transaction, immediately before the upsert.
   *
   * Deliberately NOT a blanket policy. Named catalogue rows sit BELOW the
   * volume base and keep their identity through the upsert, product-created
   * rows carry no golden uuid at all, and a step may declare it only while
   * every table that references its rows is named in
   * {@link volumeNamespaceChildren} — an undeclared child FK would turn the
   * replacement into a cascade or a `restrict` failure.
   */
  replacesVolumeNamespace?: number;
  /**
   * Child tables whose rows reference the replaced range, cleared in this
   * order BEFORE the range itself (inside the same seed transaction).
   *
   * Retained children reference their parent `ON DELETE RESTRICT` (#1278), so
   * replacing a volume range they point at is an ordered child cleanup the plan
   * names, never a physical cascade. A child is listed here only when it hangs
   * off the replaced rows alone and carries no meaning without them — today the
   * per-day attendance marks of a registration (044 EARS-34, #2381), which a
   * registrar may set on a staging golden registration, and the congress
   * submissions it holds (046 EARS-5, #2433), which a tester may create on one;
   * both go with the registration the re-pin replaces. `parentKey` is the Drizzle property name
   * of the child's FK column.
   */
  volumeNamespaceChildren?: GoldenVolumeChild[];
}

/** One child table cleared before a volume namespace replacement. */
export interface GoldenVolumeChild {
  /** Physical table name — used in logs and in the plan assertion. */
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous table set; the executor narrows per step
  table: any;
  /** Drizzle property name of the child column referencing the step's `id`. */
  parentKey: string;
}

/**
 * Table write order. Parents first: every FK a step writes must already be
 * satisfiable by an earlier step, otherwise the whole seed transaction rolls
 * back on the first `restrict` reference.
 */
export const GOLDEN_SEED_ORDER = Object.freeze([
  "users",
  "experts",
  "projects",
  // #2213 — the taxonomy books, before anything that classifies through them.
  "directions",
  "partners",
  "events",
  "stream_config",
  "event_experts",
  "event_projects",
  "event_directions",
  "registrations",
  // 046 EARS-1 (#2432) — the event's congress intake settings, then its kinds.
  "congress_submission_settings",
  "congress_submission_kind_settings",
  "event_recordings",
  "consent_records",
  "doctor_specialties",
  "direction_specialties",
  "direction_adjacency",
  "project_experts",
  "project_partners",
]);

/**
 * Resolves the doctor↔specialty links against the seeded Минздрав book.
 *
 * The book's ids belong to the book seed (`seedSpecialtiesMinzdrav`), which
 * derives them from each row's `code` on INSERT and never rewrites them on
 * conflict — so a database seeded before that derivation existed still holds
 * randomly generated ids. The golden dataset therefore holds names and this
 * function resolves them against whatever the target database actually carries.
 * A name the book does not carry is a hard failure: silently dropping the link
 * would produce a template whose «doctor with a specialty» scenario has no
 * specialty, and the scenario would fail far from its cause.
 */
export function resolveDoctorSpecialtyRows(
  links: readonly GoldenDoctorSpecialtyLink[],
  specialtyIdByName: ReadonlyMap<string, string>,
): Record<string, unknown>[] {
  const missing = links
    .map((link) => link.specialtyName)
    .filter((name) => !specialtyIdByName.has(name));
  if (missing.length > 0) {
    throw new GoldenPlanError(
      `the Минздрав specialty book does not carry: ${[...new Set(missing)].join(", ")} — run the book seed before the golden seed`,
    );
  }
  return links.map((link) => ({
    id: link.id,
    doctorId: link.doctorId,
    specialtyId: specialtyIdByName.get(link.specialtyName) as string,
    role: "primary",
    status: "active",
    version: 1,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  }));
}

/**
 * Resolves the direction↔specialty links against the seeded Минздрав book.
 *
 * The twin of {@link resolveDoctorSpecialtyRows}, and for the same reason: the
 * book's ids belong to the book seed, so the golden dataset holds names. A name
 * the book does not carry is a hard failure — dropping the link silently would
 * produce a template in which a whole specialty resolves to no direction, and
 * the doctor feed would render empty far from the cause (017 EARS-8).
 */
export function resolveDirectionSpecialtyRows(
  links: readonly GoldenDirectionSpecialtyLink[],
  specialtyIdByName: ReadonlyMap<string, string>,
): Record<string, unknown>[] {
  const missing = links
    .map((link) => link.specialtyName)
    .filter((name) => !specialtyIdByName.has(name));
  if (missing.length > 0) {
    throw new GoldenPlanError(
      `the Минздрав specialty book does not carry: ${[...new Set(missing)].join(", ")} — run the book seed before the golden seed`,
    );
  }
  return links.map((link) => {
    const row: Record<string, unknown> = {
      id: link.id,
      directionId: link.directionId,
      specialtyMinzdravId: specialtyIdByName.get(link.specialtyName) as string,
      status: link.status,
      version: 1,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    };
    if (link.deletedAt) row.deletedAt = link.deletedAt;
    return row;
  });
}

/** Builds the ordered, idempotent write plan for a dataset. */
export function buildGoldenSeedPlan(
  dataset: GoldenDataset,
  specialtyIdByName: ReadonlyMap<string, string>,
): GoldenSeedStep[] {
  const steps: GoldenSeedStep[] = [
    step("users", users, dataset.users, ["id"]),
    step("experts", experts, dataset.experts, ["id"]),
    step("projects", projects, dataset.projects, ["id"]),
    step("directions", directions, dataset.directions, ["id"]),
    step("partners", partners, dataset.partners, ["id"]),
    step("events", events, dataset.events, ["id"]),
    // `stream_config` is keyed by its event, not by a surrogate id.
    step("stream_config", streamConfig, dataset.streamConfig, ["eventId"]),
    step("event_experts", eventExperts, dataset.eventExperts, ["id"]),
    step("event_projects", eventProjects, dataset.eventProjects, ["id"]),
    // The three tables below carry a pairing that walks with the pin rather
    // than a pinned identity: see `replacesVolumeNamespace`.
    step("event_directions", eventDirections, dataset.eventDirections, ["id"], {
      replacesVolumeNamespace: GOLDEN_GROUP.eventDirections,
    }),
    step("registrations", registrations, dataset.registrations, ["id"], {
      replacesVolumeNamespace: GOLDEN_GROUP.registrations,
      volumeNamespaceChildren: [
        {
          name: "registration_attendance",
          table: registrationAttendance,
          parentKey: "registrationId",
        },
        {
          name: "congress_submissions",
          table: congressSubmissions,
          parentKey: "registrationId",
        },
      ],
    }),
    // Keyed by the event (and the kind), like `stream_config`: one settings
    // row per congress, no surrogate id.
    step(
      "congress_submission_settings",
      congressSubmissionSettings,
      dataset.congressSubmissionSettings,
      ["eventId"],
    ),
    step(
      "congress_submission_kind_settings",
      congressSubmissionKindSettings,
      dataset.congressSubmissionKindSettings,
      ["eventId", "kind"],
    ),
    step("event_recordings", eventRecordings, dataset.eventRecordings, ["id"], {
      replacesVolumeNamespace: GOLDEN_GROUP.eventRecordings,
    }),
    step("consent_records", consentRecords, dataset.consentRecords, ["id"]),
    step(
      "doctor_specialties",
      doctorSpecialties,
      resolveDoctorSpecialtyRows(dataset.doctorSpecialties, specialtyIdByName),
      ["id"],
    ),
    step(
      "direction_specialties",
      directionSpecialties,
      resolveDirectionSpecialtyRows(
        dataset.directionSpecialties,
        specialtyIdByName,
      ),
      ["id"],
    ),
    step(
      "direction_adjacency",
      directionAdjacency,
      dataset.directionAdjacency,
      ["id"],
    ),
    step("project_experts", projectExperts, dataset.projectExperts, ["id"]),
    step("project_partners", projectPartners, dataset.projectPartners, ["id"]),
  ];

  const planned = steps.map((s) => s.name);
  const expected = [...GOLDEN_SEED_ORDER];
  if (planned.join(",") !== expected.join(",")) {
    throw new GoldenPlanError(
      `golden seed plan order drifted from GOLDEN_SEED_ORDER: ${planned.join(", ")}`,
    );
  }
  return steps;
}

/**
 * Columns a re-run must NOT rewrite.
 *
 * `first_published_at` is a publication instant: the `taxonomy_first_published_at_set_once`
 * trigger (migration 0015, attached to every publishable taxonomy table) raises a
 * `check_violation` when an UPDATE moves or clears it. A slot database is cloned from the
 * `ds_golden` template, so its rows already carry the instant the template build wrote —
 * a re-run that tried to refresh it would abort the whole seed transaction. The insert
 * still writes it; a re-run keeps the instant of that first write and refreshes every
 * other column.
 */
const SET_ONCE_KEYS = ["firstPublishedAt"] as const;

function step(
  name: string,
  table: unknown,
  rows: readonly Record<string, unknown>[],
  conflictKeys: string[],
  options: {
    replacesVolumeNamespace?: number;
    volumeNamespaceChildren?: GoldenVolumeChild[];
  } = {},
): GoldenSeedStep {
  const keys = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) keys.add(key);
  return {
    name,
    table,
    rows: rows as Record<string, unknown>[],
    conflictKeys,
    ...(options.replacesVolumeNamespace === undefined
      ? {}
      : { replacesVolumeNamespace: options.replacesVolumeNamespace }),
    ...(options.volumeNamespaceChildren === undefined
      ? {}
      : { volumeNamespaceChildren: options.volumeNamespaceChildren }),
    // A re-run refreshes every non-key column it wrote, minus the set-once
    // publication instants. Columns the dataset never sets are left alone
    // rather than reset to a default: the seed owns what it writes, not the
    // whole row.
    updateKeys: [...keys].filter(
      (key) =>
        !conflictKeys.includes(key) &&
        !(SET_ONCE_KEYS as readonly string[]).includes(key),
    ),
  };
}

/**
 * Referential problems inside the dataset, as human-readable lines.
 *
 * Cheaper and far more legible than discovering the same defect as a Postgres
 * FK violation two minutes into a template build, and it runs with no database
 * at all — which is the only reason CI can guard the golden dataset.
 */
export function goldenReferentialIssues(dataset: GoldenDataset): string[] {
  const issues: string[] = [];
  const userIds = idSet(dataset.users);
  const eventIds = idSet(dataset.events);
  const expertIds = idSet(dataset.experts);
  const projectIds = idSet(dataset.projects);

  const check = <T extends object>(
    label: string,
    rows: readonly T[],
    key: keyof T & string,
    known: ReadonlySet<string>,
  ) => {
    for (const row of rows) {
      const value = (row as Record<string, unknown>)[key];
      if (typeof value !== "string" || !known.has(value)) {
        issues.push(
          `${label}.${key} references an unknown row: ${String(value)}`,
        );
      }
    }
  };

  check("registrations", dataset.registrations, "userId", userIds);
  check("registrations", dataset.registrations, "eventId", eventIds);
  check("consent_records", dataset.consentRecords, "userId", userIds);
  check("event_recordings", dataset.eventRecordings, "eventId", eventIds);
  check("stream_config", dataset.streamConfig, "eventId", eventIds);
  check(
    "congress_submission_settings",
    dataset.congressSubmissionSettings,
    "eventId",
    eventIds,
  );
  check(
    "congress_submission_kind_settings",
    dataset.congressSubmissionKindSettings,
    "eventId",
    new Set(dataset.congressSubmissionSettings.map((row) => row.eventId)),
  );
  check("event_experts", dataset.eventExperts, "eventId", eventIds);
  check("event_experts", dataset.eventExperts, "expertId", expertIds);
  // 012 EARS-26 — the kinds are migration 0046's seed rows, not golden rows.
  check(
    "events",
    dataset.events,
    "kindId",
    new Set(Object.values(SEED_EVENT_KINDS).map((kind) => kind.id)),
  );
  check("event_projects", dataset.eventProjects, "eventId", eventIds);
  check("event_projects", dataset.eventProjects, "projectId", projectIds);
  check("doctor_specialties", dataset.doctorSpecialties, "doctorId", userIds);

  // #2213 — the taxonomy link tables.
  const directionIds = idSet(dataset.directions);
  const partnerIds = idSet(dataset.partners);
  check(
    "direction_specialties",
    dataset.directionSpecialties,
    "directionId",
    directionIds,
  );
  check(
    "direction_adjacency",
    dataset.directionAdjacency,
    "directionId",
    directionIds,
  );
  check(
    "direction_adjacency",
    dataset.directionAdjacency,
    "adjacentDirectionId",
    directionIds,
  );
  check("event_directions", dataset.eventDirections, "eventId", eventIds);
  check(
    "event_directions",
    dataset.eventDirections,
    "directionId",
    directionIds,
  );
  check("project_experts", dataset.projectExperts, "projectId", projectIds);
  check("project_experts", dataset.projectExperts, "expertId", expertIds);
  check("project_partners", dataset.projectPartners, "projectId", projectIds);
  check("project_partners", dataset.projectPartners, "partnerId", partnerIds);

  return issues;
}

function idSet<T extends object>(rows: readonly T[]): Set<string> {
  return new Set(
    rows
      .map((row) => (row as Record<string, unknown>).id)
      .filter((id): id is string => typeof id === "string"),
  );
}
