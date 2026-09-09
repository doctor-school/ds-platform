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
import { registrations } from "../../schema/registrations.js";
import {
  eventExperts,
  eventProjects,
  experts,
  projects,
} from "../../schema/taxonomy.js";
import { users } from "../../schema/users.js";
import type { GoldenDataset, GoldenDoctorSpecialtyLink } from "./dataset.js";

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
  "events",
  "stream_config",
  "event_experts",
  "event_projects",
  "registrations",
  "event_recordings",
  "consent_records",
  "doctor_specialties",
]);

/**
 * Resolves the doctor↔specialty links against the seeded Минздрав book.
 *
 * The book's ids are generated per database (`seedSpecialtiesMinzdrav`), so the
 * golden dataset holds names and this function turns them into ids at seed time.
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

/** Builds the ordered, idempotent write plan for a dataset. */
export function buildGoldenSeedPlan(
  dataset: GoldenDataset,
  specialtyIdByName: ReadonlyMap<string, string>,
): GoldenSeedStep[] {
  const steps: GoldenSeedStep[] = [
    step("users", users, dataset.users, ["id"]),
    step("experts", experts, dataset.experts, ["id"]),
    step("projects", projects, dataset.projects, ["id"]),
    step("events", events, dataset.events, ["id"]),
    // `stream_config` is keyed by its event, not by a surrogate id.
    step("stream_config", streamConfig, dataset.streamConfig, ["eventId"]),
    step("event_experts", eventExperts, dataset.eventExperts, ["id"]),
    step("event_projects", eventProjects, dataset.eventProjects, ["id"]),
    step("registrations", registrations, dataset.registrations, ["id"]),
    step("event_recordings", eventRecordings, dataset.eventRecordings, ["id"]),
    step("consent_records", consentRecords, dataset.consentRecords, ["id"]),
    step(
      "doctor_specialties",
      doctorSpecialties,
      resolveDoctorSpecialtyRows(dataset.doctorSpecialties, specialtyIdByName),
      ["id"],
    ),
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

function step(
  name: string,
  table: unknown,
  rows: readonly Record<string, unknown>[],
  conflictKeys: string[],
): GoldenSeedStep {
  const keys = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) keys.add(key);
  return {
    name,
    table,
    rows: rows as Record<string, unknown>[],
    conflictKeys,
    // A re-run refreshes every non-key column it wrote. Columns the dataset
    // never sets are left alone rather than reset to a default: the seed owns
    // what it writes, not the whole row.
    updateKeys: [...keys].filter((key) => !conflictKeys.includes(key)),
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
  check("event_experts", dataset.eventExperts, "eventId", eventIds);
  check("event_experts", dataset.eventExperts, "expertId", expertIds);
  check("event_projects", dataset.eventProjects, "eventId", eventIds);
  check("event_projects", dataset.eventProjects, "projectId", projectIds);
  check("doctor_specialties", dataset.doctorSpecialties, "doctorId", userIds);

  return issues;
}

function idSet<T extends object>(rows: readonly T[]): Set<string> {
  return new Set(
    rows
      .map((row) => (row as Record<string, unknown>).id)
      .filter((id): id is string => typeof id === "string"),
  );
}
