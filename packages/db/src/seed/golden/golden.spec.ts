// #2063 — the pure core of the golden dataset, proven without a Postgres.
//
// What these lock is the property the whole staging regression contour rests on:
// the dataset is DETERMINISTIC (same pin ⇒ same bytes), REFERENTIALLY SOUND, and
// the seed REFUSES to run when the golden IdP accounts are not provisioned. The
// DB round-trip (idempotency, drift) is proven on a stand by re-running
// `seed:golden` and diffing `pg_dump --data-only`; it cannot be faked here.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import { materialBodySchema, PointsTraceEntrySchema } from "@ds/schemas";
import { PDFDocument } from "pdf-lib";
import { getTableColumns, getTableName, is, type SQL } from "drizzle-orm";
import { PgDialect, PgTable } from "drizzle-orm/pg-core";
import { beforeAll, describe, expect, it } from "vitest";

import { RAZDEL_I_NAMES } from "../specialties-minzdrav.data.js";
import * as schema from "../../schema/index.js";
import { SEED_ORGANISATION_ROLES } from "../../schema/taxonomy.js";
import {
  buildGoldenDataset,
  GOLDEN_CONSENT_PURPOSES,
  GOLDEN_CONSENT_VERSION,
  goldenSpecialtyIssues,
} from "./dataset.js";
import {
  golden,
  GOLDEN_ACCOUNT_KEYS,
  GOLDEN_GROUP,
  goldenUuid,
  SEED_EVENT_KINDS,
  SEED_PROJECT_OUTPUT_KINDS,
} from "./ids.js";
import {
  GOLDEN_IDP_ACCOUNTS,
  GoldenIdpError,
  missingSubjectEnvVars,
  resolveGoldenSubjects,
  type GoldenSubjectMap,
} from "./idp.js";
import {
  GOLDEN_NOW_ENV_VAR,
  GoldenNowError,
  goldenDateOnly,
  resolveGoldenNow,
  shiftFromNow,
} from "./now.js";
import { GOLDEN_FEED_IMAGES, goldenFeedImageOfKey } from "./feed-volume.js";
import {
  GOLDEN_SOON_SCHOOL,
  GOLDEN_SOON_SCHOOL_INTERESTS,
} from "./learning-soon-volume.js";
import {
  applyGoldenStep,
  buildGoldenMediaPlan,
  buildGoldenSeedPlan,
  buildGoldenVolume,
  composeDescription,
  createInMemoryGoldenMediaStore,
  eventProgrammeKey,
  expertPhotoKey,
  GOLDEN_EMPTY_DIRECTION,
  GOLDEN_EMPTY_SPECIALTY,
  GOLDEN_EMPTY_SCOPE_DIRECTION,
  GOLDEN_EMPTY_SCOPE_SPECIALTY,
  GOLDEN_MAX_BIND_PARAMS,
  GOLDEN_SEED_ORDER,
  goldenDirectionId,
  goldenProgrammeSpecs,
  goldenReferentialIssues,
  GoldenPlanError,
  hasProgramme,
  isDatedProgrammeLine,
  GOLDEN_VOLUME_ORDINAL_BASE,
  isGoldenVolumeUuid,
  ordinalFromExpertPhotoKey,
  programmeLines,
  programmeTotalMinutes,
  renderProgrammePdf,
  resolveDirectionSpecialtyRows,
  resolveDoctorSpecialtyRows,
  resolveLearningRuleLayerRows,
  GOLDEN_LEARNING_PATH_COURSES,
  GOLDEN_LEARNERS,
  GOLDEN_LEARNING_PATH_PASS_MARK,
  GOLDEN_RULE_CHANGE_COURSE,
  GOLDEN_RULE_CHANGE_EARLIER_PASS_MARK,
  goldenLearnerId,
  goldenResultPlans,
  GOLDEN_LEARNING_PATH_SCHOOL,
  GOLDEN_VOLUME_CONGRESSES,
  GOLDEN_COURSE_MEMO_KEY,
  goldenCourseMemoPdf,
  GOLDEN_POINTS_RULE_IDS,
  goldenLedgerEventId,
  resolveGoldenPointsRows,
  type GoldenPointsContext,
  type GoldenPointsLedger,
  specialtiesWithoutParagraphBank,
  VOLUME_EXPERTS,
  VOLUME_PROGRAMME,
  VOLUME_PROJECTS,
  writeGoldenMedia,
  type GoldenMediaObject,
} from "./index.js";

const SUBJECT_ENV = Object.fromEntries(
  GOLDEN_IDP_ACCOUNTS.map((account, index) => [
    account.subjectEnvVar,
    `golden-subject-${index}`,
  ]),
);

const subjects = resolveGoldenSubjects(SUBJECT_ENV) as GoldenSubjectMap;

const specialtyIdByName = new Map(
  RAZDEL_I_NAMES.map((name, index) => [name, goldenUuid(0x00ff, index + 1)]),
);

// Migration 0065 inserts the presets with generated ids; the plan resolves the
// golden course's layer against the rows. The «Путь (Duolingo)» values here are
// the migration's literal.
const PATH_PRESET_VALUES = {
  order: "strict",
  unlock: { kind: "after-previous" },
  "testOut.allowed": true,
  "repeat.allowed": true,
  lockedVisibility: "locked",
  "test.exitRequired": true,
};
const learningPresetByName = new Map([
  [
    "Путь (Duolingo)",
    { id: goldenUuid(0x00fe, 1), values: PATH_PRESET_VALUES },
  ],
]);

// Every dataset assertion below is deterministic, so the suite pins the instant
// explicitly rather than inheriting the run-time default.
const PINNED_NOW = "2026-01-15T12:00:00.000Z";

const now = resolveGoldenNow({ [GOLDEN_NOW_ENV_VAR]: PINNED_NOW });

// #4172 — a freshly migrated database as `loadGoldenPointsContext` reads it:
// the issuance account 0059 opened, the person accounts the seed opened with
// their golden ids, the 0060 rule versions and nothing recorded yet.
const ISSUANCE_ACCOUNT_ID = goldenUuid(0x00fd, 1);
function freshPointsContext(
  ledger: GoldenPointsLedger,
  recorded: { eventIds?: Iterable<string>; dedupeKeys?: Iterable<string> } = {},
): GoldenPointsContext {
  return {
    accountIdByRef: new Map([
      ["s:issuance", ISSUANCE_ACCOUNT_ID],
      ...ledger.accounts.map((a): [string, string] => [
        `p:${a.subjectId}`,
        a.id!,
      ]),
    ]),
    ruleVersionById: new Map(GOLDEN_POINTS_RULE_IDS.map((id) => [id, 2])),
    recordedEventIds: new Set(recorded.eventIds ?? []),
    recordedDedupeKeys: new Set(recorded.dedupeKeys ?? []),
  };
}
const pointsContext = freshPointsContext(
  buildGoldenDataset(now, subjects).pointsLedger,
);

describe("#2063 golden «now» pin", () => {
  it("#2212: falls back to the seed run time when nothing pins it", () => {
    const runTime = new Date("2026-09-15T09:41:07.123Z");
    expect(resolveGoldenNow({}, () => runTime).toISOString()).toBe(
      runTime.toISOString(),
    );
  });

  it("#2212: lets an explicit pin win over the run-time clock", () => {
    const pin = "2026-01-15T12:00:00.000Z";
    const clock = () => new Date("2026-09-15T09:41:07.123Z");
    expect(
      resolveGoldenNow({ [GOLDEN_NOW_ENV_VAR]: pin }, clock).toISOString(),
    ).toBe(pin);
  });

  it("honours an explicit override", () => {
    const pin = "2027-03-04T08:30:00.000Z";
    expect(resolveGoldenNow({ [GOLDEN_NOW_ENV_VAR]: pin }).toISOString()).toBe(
      pin,
    );
  });

  it("refuses a pin that is not a UTC instant with millisecond precision", () => {
    // Each of these parses under `Date.parse` and would silently move the whole
    // dataset to an instant the operator did not write.
    for (const bad of [
      "2026-01-15",
      "2026-01-15T15:00:00+03:00",
      "2026-01-15T12:00:00Z",
      "not-a-date",
    ]) {
      expect(() => resolveGoldenNow({ [GOLDEN_NOW_ENV_VAR]: bad })).toThrow(
        GoldenNowError,
      );
    }
  });

  it("refuses a well-shaped but impossible instant", () => {
    expect(() =>
      resolveGoldenNow({ [GOLDEN_NOW_ENV_VAR]: "2026-02-31T12:00:00.000Z" }),
    ).toThrow(GoldenNowError);
  });

  it("shifts relative to the pin and renders date-only columns in UTC", () => {
    const base = new Date("2026-01-15T12:00:00.000Z");
    expect(shiftFromNow(base, { days: -1, hours: -12 }).toISOString()).toBe(
      "2026-01-14T00:00:00.000Z",
    );
    expect(goldenDateOnly(shiftFromNow(base, { days: 20 }))).toBe("2026-02-04");
  });
});

describe("#2063 golden identities", () => {
  it("mints RFC-4122-shaped ids carrying the golden marker", () => {
    expect(goldenUuid(1, 2)).toBe("20630063-0001-4d5b-8b63-000000000002");
    expect(goldenUuid(1, 2)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("refuses an out-of-range group or ordinal rather than truncating", () => {
    expect(() => goldenUuid(0x1_0000, 1)).toThrow(RangeError);
    expect(() => goldenUuid(1, -1)).toThrow(RangeError);
  });

  it("keeps every catalogue identity distinct", () => {
    const ids = collectIds(golden);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("declares an IdP account for every catalogue account key", () => {
    expect(GOLDEN_IDP_ACCOUNTS.map((a) => a.key).sort()).toEqual(
      [...GOLDEN_ACCOUNT_KEYS].sort(),
    );
  });
});

describe("#2063 golden IdP preconditions", () => {
  it("names every missing subject variable instead of failing on the first", () => {
    expect(missingSubjectEnvVars({})).toEqual(
      GOLDEN_IDP_ACCOUNTS.map((a) => a.subjectEnvVar),
    );
  });

  it("refuses to run when a golden account is not provisioned", () => {
    const partial = { ...SUBJECT_ENV };
    delete partial[GOLDEN_IDP_ACCOUNTS[0]!.subjectEnvVar];
    expect(() => resolveGoldenSubjects(partial)).toThrow(GoldenIdpError);
  });

  it("treats a blank subject as absent", () => {
    expect(() =>
      resolveGoldenSubjects({
        ...SUBJECT_ENV,
        [GOLDEN_IDP_ACCOUNTS[0]!.subjectEnvVar]: "   ",
      }),
    ).toThrow(GoldenIdpError);
  });

  it("refuses two accounts sharing one subject", () => {
    expect(() =>
      resolveGoldenSubjects({
        ...SUBJECT_ENV,
        [GOLDEN_IDP_ACCOUNTS[1]!.subjectEnvVar]: SUBJECT_ENV[
          GOLDEN_IDP_ACCOUNTS[0]!.subjectEnvVar
        ] as string,
      }),
    ).toThrow(GoldenIdpError);
  });

  it("never carries a credential value, only the variable that holds it", () => {
    for (const account of GOLDEN_IDP_ACCOUNTS) {
      expect(account.passwordEnvVar).toMatch(/^DS_GOLDEN_PASSWORD_[A-Z_]+$/);
      // Digits allowed for the #2805 worker pool (`…_VERIFIED_W1`).
      expect(account.subjectEnvVar).toMatch(/^DS_GOLDEN_SUB_[A-Z0-9_]+$/);
    }
  });
});

describe("#2063 golden dataset", () => {
  const dataset = buildGoldenDataset(now, subjects);

  it("is byte-identical across two builds at the same pin", () => {
    const again = buildGoldenDataset(
      resolveGoldenNow({ [GOLDEN_NOW_ENV_VAR]: PINNED_NOW }),
      subjects,
    );
    // `feed_sources.telegram_chat_id` is a bigint, which JSON cannot carry bare.
    const bytes = (v: unknown) =>
      JSON.stringify(v, (_, x: unknown) =>
        typeof x === "bigint" ? `${x}n` : x,
      );
    expect(bytes(again)).toBe(bytes(dataset));
  });

  it("moves every timestamp when the pin moves — nothing is hardcoded", () => {
    // Matched BY ID, not positionally. The volume half (#2213) makes the row
    // COUNT of the date-derived families depend on the pin — how much of the
    // season lies in the past decides how many recordings exist — so a
    // positional walk compared unrelated rows and asserted on the length of a
    // collection the plan never promised to keep constant. What the pin must
    // move is every instant of a row that exists at BOTH pins, which is the
    // property this test was written to hold.
    const shifted = buildGoldenDataset(
      resolveGoldenNow({ [GOLDEN_NOW_ENV_VAR]: "2027-01-15T12:00:00.000Z" }),
      subjects,
    );

    let compared = 0;
    for (const [family, before] of rowFamilies(dataset)) {
      const after = new Map(
        rowsByKey(shifted[family as keyof typeof shifted] as GoldenRow[]),
      );
      for (const [key, beforeRow] of rowsByKey(before)) {
        const afterRow = after.get(key);
        if (!afterRow) continue; // a row this pin does not reach — see above
        for (const [column, value] of Object.entries(beforeRow)) {
          if (!(value instanceof Date)) continue;
          const moved = afterRow[column];
          // A column the twin does not carry at all — the row reached a state
          // whose shape omits it (a published recording drops nothing, a draft
          // one carries no publication instant). Nothing to compare, and the
          // state rules are asserted by the #2213 timeline tests.
          if (!(moved instanceof Date)) continue;
          expect(
            (moved as Date).getTime(),
            `${family}.${column} of ${key}`,
          ).not.toBe(value.getTime());
          compared += 1;
        }
      }
    }
    // A pin-invariance test that compared nothing would pass silently.
    expect(compared).toBeGreaterThan(1_000);
  });

  it("carries a doctor in every state the specs distinguish", () => {
    const byId = new Map(dataset.users.map((u) => [u.id as string, u]));
    expect(byId.get(golden.doctors.unverified.id)?.emailVerified).toBe(false);
    expect(
      byId.get(golden.doctors.verifiedCardiologist.id)?.emailVerified,
    ).toBe(true);
    const deleted = byId.get(golden.doctors.deleted.id);
    expect(deleted?.recordStatus).toBe("retired");
    expect(deleted?.deletedAt).toBeInstanceOf(Date);
    expect(byId.get(golden.admins.platform.id)?.role).toBe("platform_admin");
    // MFA is an IdP property, not a column — it must not be faked on the mirror.
    expect(
      GOLDEN_IDP_ACCOUNTS.find((a) => a.key === "doctorMfa")?.mfaEnrolled,
    ).toBe(true);
  });

  it("satisfies the `retired iff deleted` check on every user row", () => {
    for (const user of dataset.users) {
      expect(user.recordStatus === "retired").toBe(user.deletedAt != null);
    }
  });

  it("carries an event in every lifecycle state", () => {
    // A set, not the row list: since #2213 the dataset carries dozens of events
    // per state, so what this locks is coverage of the enum, not a census.
    expect([...new Set(dataset.events.map((e) => e.state))].sort()).toEqual(
      ["draft", "ended", "hidden", "in_archive", "live", "published"].sort(),
    );
  });

  it("places the live event on air relative to the pin", () => {
    const live = dataset.events.find((e) => e.id === golden.events.live.id);
    expect(live?.state).toBe("live");
    expect(live?.liveAt).toBeInstanceOf(Date);
    expect((live?.startsAt as Date).getTime()).toBeLessThan(now.getTime());
  });

  it("gives the past event a published recording with its first-publish stamp", () => {
    const published = dataset.eventRecordings.find(
      (r) => r.status === "published",
    );
    expect(published?.eventId).toBe(golden.events.pastWithRecording.id);
    expect(published?.firstPublishedAt).toBeInstanceOf(Date);
  });

  it("#1943: the seeded events carry an expert", () => {
    expect(
      dataset.eventExperts.some(
        (link) => link.eventId === golden.events.upcoming.id,
      ),
    ).toBe(true);
  });

  it("records the pinned legal acceptances for every consenting doctor", () => {
    expect(
      [...new Set(dataset.consentRecords.map((c) => c.purpose))].sort(),
    ).toEqual([...GOLDEN_CONSENT_PURPOSES].sort());
    for (const record of dataset.consentRecords) {
      expect(record.version).toBe(GOLDEN_CONSENT_VERSION);
    }
  });

  it("never writes an audit column implicitly", () => {
    for (const row of [
      ...dataset.users,
      ...dataset.events,
      ...dataset.experts,
    ]) {
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.updatedAt).toBeInstanceOf(Date);
    }
  });

  it("is referentially sound", () => {
    expect(goldenReferentialIssues(dataset)).toEqual([]);
  });

  it("reports a dangling reference instead of leaving it to a FK violation", () => {
    const broken = {
      ...dataset,
      registrations: [
        { ...dataset.registrations[0]!, userId: goldenUuid(0x0fff, 1) },
      ],
      // The rows hanging off the dropped registrations go with them (#4172).
      congressSubmissions: [],
      registrationAttendance: [],
    };
    expect(goldenReferentialIssues(broken)).toHaveLength(1);
  });

  it("012 EARS-26: an event naming a kind migration 0046 did not seed is a dangling reference", () => {
    const broken = {
      ...dataset,
      events: [{ ...dataset.events[0]!, kindId: goldenUuid(0x0fff, 2) }],
      registrations: [],
      consentRecords: [],
      eventRecordings: [],
      streamConfig: [],
      congressSubmissionSettings: [],
      congressSubmissionKindSettings: [],
      eventExperts: [],
      eventProjects: [],
      eventDirections: [],
    };
    expect(
      goldenReferentialIssues(broken).filter((issue) =>
        issue.startsWith("events.kindId"),
      ),
    ).toHaveLength(1);
  });

  it("012 EARS-29: the golden events populate BOTH storefronts, each event with a kind allowing its format", () => {
    const audiences = new Set(dataset.events.map((event) => event.audience));
    expect([...audiences].sort()).toEqual(["doctors", "experts"]);
    const allowed: Record<string, readonly string[]> = {
      [SEED_EVENT_KINDS.vebinar.id]: ["online"],
      [SEED_EVENT_KINDS.efir.id]: ["online"],
      [SEED_EVENT_KINDS.kongress.id]: ["offline", "hybrid"],
      [SEED_EVENT_KINDS.vstrechaKluba.id]: ["online", "offline", "hybrid"],
      [SEED_EVENT_KINDS.masterKlass.id]: ["offline", "hybrid"],
    };
    for (const event of dataset.events) {
      expect(allowed[event.kindId], event.slug).toContain(
        event.participationFormat ?? "online",
      );
    }
    for (const project of dataset.projects) {
      expect(["doctors", "experts"]).toContain(project.defaultAudience);
    }
  });

  it("012 EARS-29 / #2628: the named эфиры are Academy (experts) events, so the Academy listing and archive can carry the cards 004/014 address; the doctor live room stays a doctors event", () => {
    // The Academy reads only `audience = experts` (004 content set); a named
    // эфир filed as `doctors` is never sent to the listing the Academy-host
    // scenarios page through. `live` is the doctor storefront's named room
    // (019 EARS-6 «Идёт сейчас» reads only `doctors` live events).
    const named = new Set(
      Object.values(golden.events)
        .filter((event) => event.id !== golden.events.doctorCongress.id)
        .map((event) => event.id as string),
    );
    const rows = dataset.events.filter((event) =>
      named.has(event.id as string),
    );
    expect(rows).toHaveLength(named.size);
    for (const event of rows) {
      const doctorsRoom = event.id === golden.events.live.id;
      expect(event.audience, event.slug).toBe(
        doctorsRoom ? "doctors" : "experts",
      );
      // The volume half's own classification of an online event per audience.
      expect(event.kindId, event.slug).toBe(
        doctorsRoom ? SEED_EVENT_KINDS.vebinar.id : SEED_EVENT_KINDS.efir.id,
      );
    }
  });

  it("012 EARS-29 / #2628: every audience has a live event with a named registrant", () => {
    const namedDoctors = new Set(
      Object.values(golden.doctors).map((doctor) => doctor.id as string),
    );
    const registered = new Set(
      dataset.registrations
        .filter(
          (row) =>
            namedDoctors.has(row.userId as string) &&
            row.recordStatus === "active",
        )
        .map((row) => row.eventId as string),
    );
    const audiences = new Set(
      dataset.events
        .filter(
          (event) =>
            event.state === "live" && registered.has(event.id as string),
        )
        .map((event) => event.audience),
    );
    expect([...audiences].sort()).toEqual(["doctors", "experts"]);
  });

  it("only references specialties the closed Минздрав book carries", () => {
    expect(goldenSpecialtyIssues(dataset.doctorSpecialties)).toEqual([]);
    expect(
      goldenSpecialtyIssues([
        {
          ...dataset.doctorSpecialties[0]!,
          specialtyName: "Хирургия драконов",
        },
      ]),
    ).toHaveLength(1);
  });

  it("#2618: no event lists the same specialty twice — the card would render the chip twice", () => {
    const repeated = dataset.events
      .filter((e) => {
        const names = (e.specialties ?? []).map((n) => n.trim().toLowerCase());
        return new Set(names).size !== names.length;
      })
      .map((e) => [e.slug, e.specialties]);
    expect(repeated).toEqual([]);
  });
});

describe("#2063 golden seed plan", () => {
  const dataset = buildGoldenDataset(now, subjects);

  it("#4127: seeds the optional stage committee subject only for the doctor congress", () => {
    const subject = "stage-committee-subject";
    const committee = buildGoldenDataset(now, subjects, subject);
    const user = committee.users.find((row) => row.zitadelSub === subject);
    expect(user).toMatchObject({
      email: "golden.committee.agent@example.test",
      role: "congress-program-committee",
    });
    expect(dataset.users.some((row) => row.email === user?.email)).toBe(false);
    const steps = buildGoldenSeedPlan(
      committee,
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    );
    const grantIndex = steps.findIndex(
      (step) => step.name === "event_role_grants",
    );
    expect(grantIndex).toBeGreaterThan(
      steps.findIndex((step) => step.name === "events"),
    );
    expect(steps[grantIndex]).toMatchObject({
      rows: [
        {
          userId: user?.id,
          eventId: golden.events.doctorCongress.id,
          role: "congress-program-committee",
        },
      ],
      conflictKeys: ["userId", "role", "eventId"],
    });
    expect(
      buildGoldenSeedPlan(
        dataset,
        specialtyIdByName,
        learningPresetByName,
        pointsContext,
      ).find((step) => step.name === "event_role_grants")?.rows ?? [],
    ).toEqual([]);
    expect(() => buildGoldenDataset(now, subjects, subjects.admin)).toThrow(
      /already used/,
    );
    expect(goldenReferentialIssues(committee)).toEqual([]);
  });

  it("writes parents before children", () => {
    const plan = buildGoldenSeedPlan(
      dataset,
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    );
    expect(plan.map((s) => s.name)).toEqual([...GOLDEN_SEED_ORDER]);
  });

  it("conflicts on the pinned identity of every step", () => {
    for (const step of buildGoldenSeedPlan(
      dataset,
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    )) {
      expect(step.conflictKeys.length).toBeGreaterThan(0);
      for (const key of step.conflictKeys) {
        expect(step.updateKeys).not.toContain(key);
        // Set on every row — a `position` of 0 is a value, not a missing key.
        for (const row of step.rows) expect(row[key] ?? null).not.toBeNull();
      }
    }
  });

  it("#2381: the registrations volume replacement clears its attendance marks first", () => {
    // `registration_attendance` references `registrations` ON DELETE RESTRICT
    // (#1278), so the replaced range's marks are an ordered child cleanup the
    // plan declares — never a cascade and never a restrict failure mid-seed.
    const plan = buildGoldenSeedPlan(
      dataset,
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    );
    const registrationsStep = plan.find((s) => s.name === "registrations");
    expect(
      registrationsStep?.volumeNamespaceChildren?.map((child) => [
        child.name,
        child.parentKey,
      ]),
    ).toEqual([
      ["registration_attendance", "registrationId"],
      // 046 EARS-6 (#2433) — a submission is held by its registration.
      ["congress_submissions", "registrationId"],
    ]);
    for (const step of plan) {
      if (step.name === "registrations") continue;
      expect(step.volumeNamespaceChildren).toBeUndefined();
    }
  });

  it("keys stream_config on its event, not on a surrogate id", () => {
    const step = buildGoldenSeedPlan(
      dataset,
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    ).find((s) => s.name === "stream_config");
    expect(step?.conflictKeys).toEqual(["eventId"]);
  });

  it("046 EARS-1 (#2432): keys the congress intake settings on the event, and each kind on (event, kind)", () => {
    const plan = buildGoldenSeedPlan(
      dataset,
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    );
    expect(
      plan.find((s) => s.name === "congress_submission_settings")?.conflictKeys,
    ).toEqual(["eventId"]);
    expect(
      plan.find((s) => s.name === "congress_submission_kind_settings")
        ?.conflictKeys,
    ).toEqual(["eventId", "kind"]);
  });

  it("046 EARS-1 (#2432): the upcoming эфир is a configured congress — open oral and poster, abstracts announced, all on Moscow day boundaries", () => {
    const eventId = golden.events.upcoming.id;
    expect(
      dataset.congressSubmissionSettings.filter((s) => s.eventId === eventId),
    ).toEqual([
      expect.objectContaining({
        eventId,
        registrationUrl: expect.stringMatching(/^https:\/\//),
        firstAuthorCounts: false,
      }),
    ]);
    const kinds = dataset.congressSubmissionKindSettings.filter(
      (s) => s.eventId === eventId,
    );
    expect(kinds.map((k) => [k.eventId, k.kind])).toEqual([
      [eventId, "oral"],
      [eventId, "poster"],
      [eventId, "abstract"],
    ]);
    const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const onMskMidnight = (d: unknown) =>
      ((d as Date).getTime() + MSK_OFFSET_MS) % DAY_MS === 0;
    for (const kind of kinds) {
      expect(onMskMidnight(kind.opensAt)).toBe(true);
      expect(onMskMidnight(kind.closesAt)).toBe(true);
      expect((kind.closesAt as Date).getTime()).toBeGreaterThan(
        (kind.opensAt as Date).getTime(),
      );
    }
    const byKind = new Map(kinds.map((k) => [k.kind, k]));
    const isOpen = (k: (typeof kinds)[number]) =>
      now.getTime() >= (k.opensAt as Date).getTime() &&
      now.getTime() < (k.closesAt as Date).getTime();
    expect(isOpen(byKind.get("oral")!)).toBe(true);
    expect(isOpen(byKind.get("poster")!)).toBe(true);
    expect(isOpen(byKind.get("abstract")!)).toBe(false);
    // The product defaults (EARS-2) where the golden sets nothing else.
    expect(byKind.get("poster")?.maxAgeYears).toBe(40);
    expect(byKind.get("abstract")?.submitLimit).toBe(3);
    expect(byKind.get("oral")?.submitLimit).toBeNull();
    expect(goldenReferentialIssues(dataset)).toEqual([]);
  });

  it("046 EARS-6: each verified worker can open the kind picker for the doctor congress", () => {
    for (const doctor of golden.workerPool.verifiedCardiologist) {
      const rows = dataset.registrations.filter(
        (row) =>
          row.userId === doctor.id &&
          row.eventId === golden.events.doctorCongress.id &&
          row.recordStatus === "active",
      );
      expect(rows, doctor.email).toHaveLength(1);
    }
  });

  it("resolves doctor specialties through the seeded book", () => {
    const rows = resolveDoctorSpecialtyRows(
      dataset.doctorSpecialties,
      specialtyIdByName,
    );
    expect(rows).toHaveLength(dataset.doctorSpecialties.length);
    for (const row of rows) {
      expect(row.specialtyId).toBe(
        specialtyIdByName.get(
          dataset.doctorSpecialties.find((l) => l.id === row.id)!.specialtyName,
        ),
      );
      expect(row.role).toBe("primary");
    }
  });

  it("fails loudly when the book has not been seeded yet", () => {
    expect(() =>
      resolveDoctorSpecialtyRows(dataset.doctorSpecialties, new Map()),
    ).toThrow(GoldenPlanError);
  });
});

describe("#2212 a re-run rewrites the dates", () => {
  // The seed now moves with the wall clock, so the property that makes that
  // safe is the upsert: a second run over the SAME ids must refresh every
  // time-derived column rather than leave yesterday's schedule in place.
  const laterNow = resolveGoldenNow({
    [GOLDEN_NOW_ENV_VAR]: "2026-03-20T12:00:00.000Z",
  });

  const eventsStep = (at: Date) =>
    buildGoldenSeedPlan(
      buildGoldenDataset(at, subjects),
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    ).find((s) => s.name === "events")!;

  const stepNamed = (name: string, at: Date) =>
    buildGoldenSeedPlan(
      buildGoldenDataset(at, subjects),
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    ).find((s) => s.name === name)!;

  it("#2212: the events upsert refreshes every date-bearing column", () => {
    const step = eventsStep(now);
    expect(step.conflictKeys).toEqual(["id"]);
    for (const key of ["startsAt", "createdAt", "updatedAt"]) {
      expect(step.updateKeys).toContain(key);
    }
  });

  it("#2212: two runs keep the ids and differ only in date-bearing columns", () => {
    const first = eventsStep(now).rows;
    const second = eventsStep(laterNow).rows;

    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id));

    // The stronger form of «differ only in date-bearing columns»: at volume a
    // pin move also moves an эфир ACROSS the run instant, so `state`, `origin`
    // and the programme reference legitimately change with it. What must never
    // change is (a) the authored content of the row, and (b) the guarantee that
    // every column the second run rewrites is a column the upsert refreshes —
    // a column that moves but is absent from `updateKeys` is exactly the drift
    // this test exists to catch, and enumerating Date-ness no longer says that.
    const updateKeys = new Set([
      ...eventsStep(now).updateKeys,
      ...eventsStep(laterNow).updateKeys,
    ]);
    const authored = [
      "id",
      "slug",
      "title",
      "description",
      "durationMin",
      "school",
      "specialties",
      "seatsLeft",
      "participationFormat",
      "version",
      "recordStatus",
    ];

    const moved = new Set<string>();
    for (const [index, before] of first.entries()) {
      const after = second[index]!;
      // Not a key-for-key match: at volume a pin move can carry an эфир into a
      // state whose row omits an optional column (`recordingExpectedBy` once a
      // recording is published). The union is what the upsert has to cover.
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const key of authored) {
        expect(JSON.stringify(after[key]), `${key} of row ${index}`).toBe(
          JSON.stringify(before[key]),
        );
      }
      for (const key of keys) {
        if (JSON.stringify(after[key]) === JSON.stringify(before[key]))
          continue;
        expect(
          updateKeys,
          `${key} moves but the upsert never rewrites it`,
        ).toContain(key);
        moved.add(key);
      }
    }
    // Every date-bearing column of the events step is among the movers.
    for (const key of [
      "startsAt",
      "createdAt",
      "updatedAt",
      "liveAt",
      "recordingExpectedBy",
    ]) {
      expect(moved, key).toContain(key);
    }
  });

  // `taxonomy_first_published_at_set_once` (migration 0015) refuses to move a
  // publication instant once written. A slot database is cloned from the
  // `ds_golden` template, so those rows arrive already published — the re-run
  // upsert must not try to rewrite the instant, or the whole seed transaction
  // rolls back.
  it.each(["experts", "projects", "event_recordings"])(
    "#2212: the %s upsert writes first_published_at on insert but never updates it",
    (name) => {
      const step = stepNamed(name, now);
      expect(
        step.rows.some((row) => row.firstPublishedAt instanceof Date),
      ).toBe(true);
      expect(step.updateKeys).not.toContain("firstPublishedAt");
      expect(step.conflictKeys).toEqual(["id"]);
      // Every other date-bearing column still refreshes.
      expect(step.updateKeys).toContain("updatedAt");
    },
  );

  it("#2212: the exclusion is a no-op for steps that never publish", () => {
    const step = eventsStep(now);
    expect(step.rows.some((row) => "firstPublishedAt" in row)).toBe(false);
    expect(step.updateKeys).not.toContain("firstPublishedAt");
  });

  it("#2212: a publication instant moves in the rows but not in the upsert", () => {
    const first = stepNamed("experts", now);
    const second = stepNamed("experts", laterNow);

    const movedInRows = first.rows.filter((row, index) => {
      const after = second.rows[index]!;
      return (
        row.firstPublishedAt instanceof Date &&
        (after.firstPublishedAt as Date).getTime() !==
          row.firstPublishedAt.getTime()
      );
    });
    expect(movedInRows.length).toBeGreaterThan(0);
    expect(second.updateKeys).not.toContain("firstPublishedAt");
  });
});

describe("#2063 golden step execution", () => {
  const dataset = buildGoldenDataset(now, subjects);

  it("upserts on the conflict target and refreshes from `excluded`", async () => {
    const plan = buildGoldenSeedPlan(
      dataset,
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    );
    const step = plan.find((s) => s.name === "users")!;
    const calls: {
      rows: unknown;
      config: { target: unknown[]; set: Record<string, unknown> };
    }[] = [];
    const tx = {
      insert: () => ({
        values: (rows: unknown) => ({
          onConflictDoUpdate: (config: {
            target: unknown[];
            set: Record<string, unknown>;
          }) => {
            calls.push({ rows, config });
            return Promise.resolve();
          },
        }),
      }),
    };

    const written = await applyGoldenStep(tx, step);
    expect(written).toBe(step.rows.length);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.config.target).toHaveLength(1);
    // Every non-key column the dataset writes is refreshed, so a re-run cannot
    // leave a stale value behind.
    expect(Object.keys(calls[0]!.config.set).sort()).toEqual(
      [...step.updateKeys].sort(),
    );
  });

  it("re-runs a key-only step (an organisation's role link) as a no-op on its conflict target", async () => {
    // `organisation_role_assignments` rows carry nothing but their composite
    // key, so there is no column to refresh: an empty `ON CONFLICT DO UPDATE
    // SET` is not valid SQL, and the re-run must leave the held link alone.
    const plan = buildGoldenSeedPlan(
      dataset,
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    );
    const step = plan.find((s) => s.name === "organisation_role_assignments")!;
    expect(step.rows.length).toBeGreaterThan(0);
    expect(step.updateKeys).toEqual([]);
    const nothing: { target: unknown[] }[] = [];
    const tx = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => {
            throw new Error("No values to set");
          },
          onConflictDoNothing: (config: { target: unknown[] }) => {
            nothing.push(config);
            return Promise.resolve();
          },
        }),
      }),
    };

    await expect(applyGoldenStep(tx, step)).resolves.toBe(step.rows.length);
    expect(nothing).toHaveLength(1);
    expect(nothing[0]!.target).toHaveLength(2);
  });

  it("splits a step past the Postgres bind-parameter limit into statements under it, every row written once", async () => {
    // #4012 — the 200-doctor projection is tens of thousands of rows: one
    // INSERT of them all exceeds the 65 535 bind parameters of the protocol.
    const plan = buildGoldenSeedPlan(
      dataset,
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    );
    const step = plan.find((s) => s.name === "learning_node_status")!;
    const columns = Object.keys(getTableColumns(step.table)).length;
    expect(step.rows.length * columns).toBeGreaterThan(GOLDEN_MAX_BIND_PARAMS);
    const chunks: unknown[][] = [];
    const tx = {
      insert: () => ({
        values: (rows: unknown[]) => ({
          onConflictDoNothing: () => {
            chunks.push(rows);
            return Promise.resolve();
          },
        }),
      }),
    };

    await expect(applyGoldenStep(tx, step)).resolves.toBe(step.rows.length);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks)
      expect(chunk.length * columns).toBeLessThanOrEqual(
        GOLDEN_MAX_BIND_PARAMS,
      );
    expect(chunks.flat()).toEqual(step.rows);
  });

  it("024 EARS-30 (#4012): a refresh in place fills a NULL publication instant and never moves a written one", async () => {
    // A database seeded before the seed stamped `first_published_at` holds the
    // golden courses with NULL; the set-once column is left out of the refresh
    // but filled where still empty (the set-once triggers allow NULL → value).
    const plan = buildGoldenSeedPlan(
      dataset,
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    );
    const step = plan.find((s) => s.name === "learning_courses")!;
    expect(step.updateKeys).not.toContain("firstPublishedAt");
    expect(step.fillKeys).toEqual(["firstPublishedAt"]);
    const sets: Record<string, unknown>[] = [];
    const tx = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: (config: { set: Record<string, unknown> }) => {
            sets.push(config.set);
            return Promise.resolve();
          },
        }),
      }),
    };
    await applyGoldenStep(tx, step);
    const dialect = new PgDialect();
    const fill = dialect.sqlToQuery(sets[0]!.firstPublishedAt as SQL).sql;
    expect(fill).toBe(
      'coalesce("learning_courses"."first_published_at", excluded."first_published_at")',
    );
    // A step that never publishes fills nothing.
    expect(plan.find((s) => s.name === "users")!.fillKeys).toEqual([]);
  });

  it("refuses a plan key that is not a column of the table", async () => {
    const plan = buildGoldenSeedPlan(
      dataset,
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    );
    const step = { ...plan[0]!, updateKeys: ["notAColumn"] };
    await expect(applyGoldenStep({ insert: () => ({}) }, step)).rejects.toThrow(
      GoldenPlanError,
    );
  });
});

// #2213 — the volume half. What the named catalogue proves is that every state
// EXISTS; what these lock is that the staging contour is walked against a
// dataset with the SHAPE of production — dozens of rows, several pages, a
// schedule that fills a week view and a month view, an archive that paginates.
// A one-row-per-state fixture hides exactly the defects a walk is looking for.
describe("#2213 golden dataset at volume", () => {
  const dataset = buildGoldenDataset(now, subjects);

  const isVolume = (row: { id?: unknown }) =>
    typeof row.id === "string" && isGoldenVolumeUuid(row.id);

  const volumeEvents = dataset.events.filter(isVolume);
  const volumeUsers = dataset.users.filter(isVolume);

  const byState = (state: string) =>
    dataset.events.filter((e) => e.state === state);

  const recordedEventIds = new Set(
    dataset.eventRecordings.map((r) => r.eventId as string),
  );

  /** UTC midnight of the Monday that owns `date` — the ISO week bucket. */
  const weekStart = (date: Date): number => {
    const day = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    );
    return day - ((date.getUTCDay() + 6) % 7) * 86_400_000;
  };

  const monthKey = (date: Date): string =>
    `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

  /** A pin's month shifted by whole months — never by days, which skips a 31st. */
  const shiftedMonthKey = (base: Date, months: number): string =>
    monthKey(
      new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1)),
    );

  /**
   * The pins the calendar floors are replayed at.
   *
   * The floors are a property of the PLAN, not of one lucky pin: the suite's
   * own `PINNED_NOW` is mid-month, which is exactly the run date at which a
   * missing current-month row cannot be seen. These add both month ends, a leap
   * day, a year boundary, a month starting on a Monday, and a run ninety
   * minutes before a month rolls over.
   */
  const COVERAGE_PINS = [
    PINNED_NOW,
    "2025-01-29T12:00:00.000Z",
    "2026-02-28T12:00:00.000Z",
    "2026-12-31T12:00:00.000Z",
    // Thirty minutes before the year rolls over — in МСК it is already the 1st
    // of January, so a UTC-day walk and an МСК-day walk disagree here.
    "2026-12-31T23:30:00.000Z",
    "2027-03-01T12:00:00.000Z",
    "2028-02-29T09:00:00.000Z",
    "2026-04-30T22:30:00.000Z",
  ] as const;

  const atPin = (pin: string) => {
    const pinned = resolveGoldenNow({ [GOLDEN_NOW_ENV_VAR]: pin });
    const built = buildGoldenDataset(pinned, subjects);
    const upcoming = built.events.filter(
      (e) =>
        e.state === "published" &&
        (e.startsAt as Date).getTime() > pinned.getTime(),
    );
    return { pinned, built, upcoming };
  };

  /** The МСК calendar day an instant falls on — the day the operator sees. */
  const mskDayKey = (date: Date): string =>
    new Date(date.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);

  /** 0 = Sunday … 6 = Saturday, in МСК. */
  const mskDayOfWeek = (key: string): number =>
    new Date(`${key}T00:00:00.000Z`).getUTCDay();

  /** Every МСК day of the season, from −180 to +120 days around a pin. */
  const seasonDays = (pinned: Date): string[] => {
    const msk = new Date(pinned.getTime() + 3 * 3_600_000);
    const midnight = Date.UTC(
      msk.getUTCFullYear(),
      msk.getUTCMonth(),
      msk.getUTCDate(),
    );
    const days: string[] = [];
    for (let k = -180; k <= 120; k += 1) {
      days.push(new Date(midnight + k * 86_400_000).toISOString().slice(0, 10));
    }
    return days;
  };

  const eventsByMskDay = (
    events: { startsAt?: unknown; state?: unknown }[],
  ) => {
    const byDay = new Map<string, { state?: unknown }[]>();
    for (const event of events) {
      const key = mskDayKey(event.startsAt as Date);
      const bucket = byDay.get(key) ?? [];
      bucket.push(event);
      byDay.set(key, bucket);
    }
    return byDay;
  };

  /**
   * The first МСК day from tomorrow back to today that stays inside the pin's
   * own МСК month: tomorrow, or today when today is the month's last day.
   */
  const denseAcademyDay = (pinned: Date): string => {
    const today = mskDayKey(pinned);
    const tomorrow = mskDayKey(new Date(pinned.getTime() + 86_400_000));
    return tomorrow.slice(0, 7) === today.slice(0, 7) ? tomorrow : today;
  };

  it("#3229: carries one dense Academy day in the pin's own МСК month, so the month view's «+N ещё» overflow (004 scope item 10) is reachable at any pin", () => {
    // A desktop month cell renders at most three pills and a 4+-event day
    // appends «+N ещё». The grid carries two or three эфиры a weekday split
    // between both audiences, so no Academy (experts) day ever reached four
    // and the overflow was unreachable on a slot (#3229). Production runs
    // expert marathons — one such day next to the run day is the shape.
    for (const pin of COVERAGE_PINS) {
      const { pinned, built } = atPin(pin);
      const day = denseAcademyDay(pinned);
      expect(day.slice(0, 7), pin).toBe(mskDayKey(pinned).slice(0, 7));
      // 004 scope item 10: the four sit in the pin's own month, scheduled —
      // published and still ahead of the run instant.
      const academy = built.events.filter(
        (e) =>
          e.audience === "experts" &&
          e.state === "published" &&
          (e.startsAt as Date).getTime() > pinned.getTime() &&
          mskDayKey(e.startsAt as Date) === day,
      );
      expect(academy.length, `${pin} / ${day}`).toBeGreaterThanOrEqual(4);
      // A marathon tomorrow runs inside the grid's own МСК hours.
      if (day !== mskDayKey(pinned)) {
        for (const event of academy) {
          const hour = (event.startsAt as Date).getUTCHours() + 3;
          const label = `${pin} / ${event.slug as string}`;
          expect(hour, label).toBeGreaterThanOrEqual(10);
          expect(hour, label).toBeLessThanOrEqual(19);
        }
      }
    }
  });

  it("#2213: carries an эфир on every day of the season, not just most", () => {
    // The owner's Stage-B verdict on PR #2216 in one assertion: doctor.school
    // runs эфиры EVERY day, so a calendar walked day by day must never render
    // an empty weekday. Two a weekday is the floor because one эфир a day makes
    // the day view a single card — which is the thin schedule that was rejected.
    for (const pin of COVERAGE_PINS) {
      const { pinned, built } = atPin(pin);
      const byDay = eventsByMskDay(built.events);
      // The floor is read off EVERY event the operator can see; the ceiling
      // only off the grid, because the named catalogue rows sit at their own
      // fixed offsets from the pin and legitimately double up on a day.
      const gridByDay = eventsByMskDay(
        built.events.filter((e) => isGoldenVolumeUuid(e.id as string)),
      );
      const sundaysWithAnEfir: number[] = [];

      for (const [index, day] of seasonDays(pinned).entries()) {
        const count = (byDay.get(day) ?? []).length;
        const dow = mskDayOfWeek(day);
        if (dow === 0) {
          // Sunday carries the monthly «школа» only — asserted below as a
          // cadence, not per day: a Sunday with nothing on it is the product's
          // own weekly rhythm, not a hole in the dataset.
          if (count > 0) sundaysWithAnEfir.push(index);
        } else if (dow === 6) {
          expect(count, `${pin} / Saturday ${day}`).toBeGreaterThanOrEqual(1);
        } else {
          expect(count, `${pin} / ${day}`).toBeGreaterThanOrEqual(2);
          // The ceiling holds everywhere but today and the dense Academy day:
          // the run day also carries the two live rooms and the «сегодня»
          // эфир, the dense day its expert marathon — all appended to the
          // grid rather than scheduled in it.
          if (day !== mskDayKey(pinned) && day !== denseAcademyDay(pinned)) {
            expect(
              (gridByDay.get(day) ?? []).length,
              `${pin} / ${day}`,
            ).toBeLessThanOrEqual(3);
          }
        }
      }

      // «Monthly», stated as the property a calendar shows: never two whole
      // months in a row without a Sunday школа.
      expect(sundaysWithAnEfir.length, pin).toBeGreaterThanOrEqual(9);
      for (let i = 1; i < sundaysWithAnEfir.length; i += 1) {
        expect(
          sundaysWithAnEfir[i]! - sundaysWithAnEfir[i - 1]!,
          `${pin} / gap between Sunday школы`,
        ).toBeLessThanOrEqual(28);
      }
    }
  });

  it("#2213: leaves no future day of the season without a published эфир", () => {
    // The past is read as an archive, where an empty day is invisible. The
    // FUTURE is read as a schedule the doctor plans around, and `published` is
    // the only state that reaches them — a day whose only row is draft or
    // hidden renders as an empty day on the public calendar.
    for (const pin of COVERAGE_PINS) {
      const { pinned, built } = atPin(pin);
      const byDay = eventsByMskDay(built.events);
      for (const day of seasonDays(pinned)) {
        if (day <= mskDayKey(pinned)) continue;
        if (mskDayOfWeek(day) === 0) continue;
        const published = (byDay.get(day) ?? []).filter(
          (e) => e.state === "published",
        );
        expect(published.length, `${pin} / ${day}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("#2213: holds the same season whatever day the seed runs on", () => {
    // The grid is anchored on the pin's MONDAY, so the plan has the same cells
    // in the same order at every run date; only which of them have already
    // happened depends on the pin. A count that wobbled with the run date would
    // mean an ordinal addresses a different эфир on different days — and the
    // #2067 scenarios address rows by ordinal.
    const totals = new Set<number>();
    for (const pin of COVERAGE_PINS) totals.add(atPin(pin).built.events.length);
    expect([...totals]).toHaveLength(1);
    // A range, not a golden number: the shape is the decision, the count is its
    // output, and tightening the cadence must not have to edit an assertion.
    const total = [...totals][0]!;
    expect(total).toBeGreaterThanOrEqual(560);
    expect(total).toBeLessThanOrEqual(700);
  });

  it("#2213: derives every lifecycle state from the timeline, not from a list", () => {
    for (const pin of COVERAGE_PINS) {
      const { pinned, built } = atPin(pin);
      for (const event of built.events.filter((e) =>
        isGoldenVolumeUuid(e.id as string),
      )) {
        const startsAt = (event.startsAt as Date).getTime();
        const label = `${pin} / ${event.id as string} (${event.state as string})`;
        if (event.state === "ended" || event.state === "in_archive") {
          expect(startsAt, label).toBeLessThan(pinned.getTime());
        } else if (event.state === "live") {
          expect(startsAt, label).toBeLessThanOrEqual(pinned.getTime());
          expect(
            startsAt + (event.durationMin as number) * 60_000,
            label,
          ).toBeGreaterThan(pinned.getTime());
        } else {
          expect(startsAt, label).toBeGreaterThan(pinned.getTime());
        }
      }
    }
  });

  it("#2213: keeps the authored catalogue byte-identical at every run date", () => {
    // The named rows are the compile target of the #2067 scenarios and of the
    // owner's walk. The pin moves their dates; it must never move a word of
    // what they say, or a scenario asserting on copy breaks on the calendar.
    const authored = (built: ReturnType<typeof buildGoldenDataset>) =>
      JSON.stringify({
        events: built.events
          .filter((e) => !isGoldenVolumeUuid(e.id as string))
          .map((e) => [e.id, e.slug, e.title, e.description, e.durationMin]),
        experts: built.experts
          .filter((e) => !isGoldenVolumeUuid(e.id as string))
          .map((e) => [
            e.id,
            e.familyName,
            e.givenName,
            e.patronymic,
            e.bio,
            e.credentials,
            e.affiliation,
          ]),
        projects: built.projects
          .filter((p) => !isGoldenVolumeUuid(p.id as string))
          .map((p) => [p.id, p.title, p.description]),
        users: built.users
          .filter((u) => !isGoldenVolumeUuid(u.id as string))
          .map((u) => [u.id, u.email, u.displayName, u.role]),
      });

    const baseline = authored(dataset);
    for (const pin of COVERAGE_PINS) {
      expect(authored(atPin(pin).built), pin).toBe(baseline);
    }
  });

  it("#2213: carries every entity family at volume, not one positive case", () => {
    expect(dataset.events.length).toBeGreaterThanOrEqual(48);
    expect(dataset.experts.length).toBeGreaterThanOrEqual(34);
    expect(dataset.projects.length).toBeGreaterThanOrEqual(12);
    expect(
      dataset.users.filter((u) => u.role === "doctor_guest").length,
    ).toBeGreaterThanOrEqual(12);
    expect(dataset.registrations.length).toBeGreaterThanOrEqual(30);
    expect(dataset.eventRecordings.length).toBeGreaterThanOrEqual(20);
    expect(dataset.doctorSpecialties.length).toBeGreaterThanOrEqual(12);
    expect(dataset.consentRecords.length).toBeGreaterThanOrEqual(36);
  });

  it("#2213: every lifecycle state arrives with a walkable multiplicity", () => {
    expect(byState("published").length).toBeGreaterThanOrEqual(14);
    expect(byState("ended").length).toBeGreaterThanOrEqual(20);
    expect(byState("in_archive").length).toBeGreaterThanOrEqual(8);
    expect(byState("live").length).toBeGreaterThanOrEqual(2);
    expect(byState("draft").length).toBeGreaterThanOrEqual(3);
    expect(byState("hidden").length).toBeGreaterThanOrEqual(3);

    const ended = byState("ended");
    expect(
      ended.filter((e) => recordedEventIds.has(e.id as string)).length,
    ).toBeGreaterThanOrEqual(14);
    expect(
      ended.filter((e) => !recordedEventIds.has(e.id as string)).length,
    ).toBeGreaterThanOrEqual(6);
  });

  it("#2213: fills more than one page of the archive and of the admin list", () => {
    // Public archive listing and the admin event table both page at 20
    // (`public-listing.schema.ts`, `apps/admin/app/events/page.tsx`), so a
    // pagination defect only shows above that floor.
    const archiveVisible = dataset.events.filter(
      (e) => e.state === "ended" || e.state === "in_archive",
    );
    expect(archiveVisible.length).toBeGreaterThan(20);
    const adminVisible = dataset.events.filter(
      (e) => e.recordStatus !== "retired",
    );
    expect(adminVisible.length).toBeGreaterThan(20);
  });

  it("#2213: puts a future event in each of the next 16 ISO weeks", () => {
    for (const pin of COVERAGE_PINS) {
      const { pinned, upcoming } = atPin(pin);
      const weeks = [
        ...new Set(upcoming.map((e) => weekStart(e.startsAt as Date))),
      ].sort((a, b) => a - b);
      expect(weeks.length, pin).toBeGreaterThanOrEqual(16);
      // The first bucket is this week or the next one — no gap in front.
      expect(weeks[0]!, pin).toBeLessThanOrEqual(
        weekStart(pinned) + 7 * 86_400_000,
      );
      // …and no gap inside: a week view must never render empty mid-range.
      for (let i = 1; i < weeks.length; i += 1) {
        expect(weeks[i]! - weeks[i - 1]!, pin).toBe(7 * 86_400_000);
      }
    }
  });

  it("#2213: fills each of the next 4 calendar months and the previous 6", () => {
    for (const pin of COVERAGE_PINS) {
      const { pinned, built, upcoming } = atPin(pin);
      const futureMonths = new Set(
        upcoming.map((e) => monthKey(e.startsAt as Date)),
      );
      // m = 0 is the month the operator opens the schedule IN. The weekly grid
      // starts three days out, so on the last days of a month it lands entirely
      // in the next one — the «сегодня» row is what makes this month non-empty
      // at every run date, not just at a mid-month pin.
      for (let m = 0; m < 4; m += 1) {
        expect(futureMonths, pin).toContain(shiftedMonthKey(pinned, m));
      }

      // The past side is read as one archive, so ended and in_archive count together.
      const pastMonths = new Set(
        built.events
          .filter((e) => e.state === "ended" || e.state === "in_archive")
          .map((e) => monthKey(e.startsAt as Date)),
      );
      for (let m = 1; m <= 6; m += 1) {
        expect(pastMonths, pin).toContain(shiftedMonthKey(pinned, -m));
      }
    }
  });

  it("#2213: always carries an эфир later today, whatever the run date", () => {
    for (const pin of COVERAGE_PINS) {
      const { pinned, upcoming } = atPin(pin);
      // «Сегодня» is a schedule state of its own — the badge, the countdown and
      // the «начнётся сегодня» copy are only reachable through it.
      const today = upcoming.filter(
        (e) =>
          (e.startsAt as Date).getTime() - pinned.getTime() <= 24 * 3_600_000,
      );
      expect(today.length, pin).toBeGreaterThanOrEqual(1);
      expect(
        today.map((e) => monthKey(e.startsAt as Date)),
        pin,
      ).toContain(monthKey(pinned));
    }
  });

  it("#2213: gives every volume event 2–4 experts and 1–2 projects", () => {
    // Scoped to the volume rows on purpose: the named draft/hidden/archived
    // rows legitimately carry no link, and #1943 already pins the named ones.
    const expertsPer = new Map<string, number>();
    const projectsPer = new Map<string, number>();
    for (const link of dataset.eventExperts) {
      const id = link.eventId as string;
      if (isGoldenVolumeUuid(id))
        expertsPer.set(id, (expertsPer.get(id) ?? 0) + 1);
    }
    for (const link of dataset.eventProjects) {
      const id = link.eventId as string;
      if (isGoldenVolumeUuid(id))
        projectsPer.set(id, (projectsPer.get(id) ?? 0) + 1);
    }
    expect(volumeEvents.length).toBeGreaterThan(0);
    for (const event of volumeEvents) {
      const id = event.id as string;
      // Two is the floor: a single-speaker эфир is part of what the owner
      // rejected on PR #2216, and the programme PDF needs a panel to schedule.
      expect(expertsPer.get(id) ?? 0).toBeGreaterThanOrEqual(2);
      expect(expertsPer.get(id) ?? 0).toBeLessThanOrEqual(4);
      expect(projectsPer.get(id) ?? 0).toBeGreaterThanOrEqual(1);
      expect(projectsPer.get(id) ?? 0).toBeLessThanOrEqual(2);
    }
  });

  it("#2213: gives most panels a Модератор, not a wall of Спикеры", () => {
    // The role is rendered on the эфир page and in the programme PDF, so a
    // roster that only ever says «Спикер» leaves the moderated-panel layout
    // unreachable on the walk. Most, not all: a two-speaker эфир without a
    // moderator is a real shape the product also has to render.
    const roles = new Map<string, Set<string>>();
    for (const link of dataset.eventExperts) {
      const id = link.eventId as string;
      if (!isGoldenVolumeUuid(id)) continue;
      const set = roles.get(id) ?? new Set<string>();
      set.add(link.role as string);
      roles.set(id, set);
    }
    const moderated = [...roles.values()].filter((set) =>
      set.has("Модератор"),
    ).length;
    expect(moderated / volumeEvents.length).toBeGreaterThanOrEqual(0.6);
    expect(
      [...roles.values()].filter((set) => set.has("Эксперт")).length,
    ).toBeGreaterThanOrEqual(10);
  });

  it("#2213: gives each volume doctor a personal history, not one row", () => {
    // «Мои эфиры» and the /account projection page on the count: a doctor with
    // two registrations never paginates and never shows a mixed past/future
    // history, which is the journey the owner walks.
    const perDoctor = new Map<string, { eventId: string; row: unknown }[]>();
    for (const row of dataset.registrations) {
      const holder = row.userId as string;
      const list = perDoctor.get(holder) ?? [];
      list.push({ eventId: row.eventId as string, row });
      perDoctor.set(holder, list);
    }

    // #4012 — the long paths' learners are the learning population, not the
    // эфир one: registrations for them would inflate every roster count.
    const learners = new Set(
      Array.from({ length: GOLDEN_LEARNERS }, (_, i) => goldenLearnerId(i)),
    );
    const volumeDoctors = volumeUsers.filter(
      (u) =>
        u.role === "doctor_guest" &&
        u.emailVerified &&
        !learners.has(u.id as string),
    );
    expect(volumeDoctors.length).toBeGreaterThanOrEqual(8);
    for (const doctor of volumeDoctors) {
      const rows = perDoctor.get(doctor.id as string) ?? [];
      expect(rows.length, doctor.id as string).toBeGreaterThanOrEqual(15);
      expect(rows.length, doctor.id as string).toBeLessThanOrEqual(40);
      // A doctor cannot register for the same эфир twice — the unique index
      // would reject the seed, and the slot would come up half-populated.
      expect(new Set(rows.map((r) => r.eventId)).size).toBe(rows.length);
    }
  });

  it("#2213: never registers a doctor before their account existed", () => {
    // The volume registrations derive their window from the HOLDER's own
    // `createdAt`, including the two IdP-backed named doctors, whose creation
    // instant lives in `dataset.ts`. A registration older than its account is
    // a row the product can never produce — and the first thing that breaks if
    // those two windows drift apart.
    const userById = new Map(dataset.users.map((u) => [u.id as string, u]));
    expect(dataset.registrations.length).toBeGreaterThan(0);
    for (const row of dataset.registrations) {
      const user = userById.get(row.userId as string)!;
      const registeredAt = (row.registeredAt as Date).getTime();
      expect(registeredAt, row.userId as string).toBeGreaterThan(
        (user.createdAt as Date).getTime(),
      );
      if (user.deletedAt instanceof Date) {
        expect(registeredAt, row.userId as string).toBeLessThan(
          user.deletedAt.getTime(),
        );
      }
    }
  });

  it("#2213: cancels about a tenth of the roster, at every run date", () => {
    // Cancellation is a rendered state on both sides — the doctor's own list
    // and the admin roster — and a seat count that never moved is a seat count
    // nobody can check. A share, not a count: the roster grows with the season.
    for (const pin of COVERAGE_PINS) {
      const { built } = atPin(pin);
      const cancelled = built.registrations.filter(
        (r) => r.recordStatus === "retired",
      );
      const share = cancelled.length / built.registrations.length;
      expect(share, pin).toBeGreaterThan(0.05);
      expect(share, pin).toBeLessThan(0.15);
      for (const row of cancelled) expect(row.deletedAt).toBeInstanceOf(Date);
    }
  });

  it("#2213: works every expert and every project, not just the first", () => {
    const perExpert = new Map<string, number>();
    for (const link of dataset.eventExperts) {
      const id = link.expertId as string;
      perExpert.set(id, (perExpert.get(id) ?? 0) + 1);
    }
    for (const expert of dataset.experts.filter(isVolume)) {
      expect(perExpert.get(expert.id as string) ?? 0).toBeGreaterThanOrEqual(3);
    }
    const perProject = new Map<string, number>();
    for (const link of dataset.eventProjects) {
      const id = link.projectId as string;
      perProject.set(id, (perProject.get(id) ?? 0) + 1);
    }
    for (const project of dataset.projects.filter(isVolume)) {
      expect(perProject.get(project.id as string) ?? 0).toBeGreaterThanOrEqual(
        4,
      );
    }
  });

  it("#2213: carries at least two doctors in each state the DB distinguishes", () => {
    const doctors = dataset.users.filter((u) => u.role === "doctor_guest");
    expect(
      doctors.filter((u) => u.emailVerified && u.recordStatus === "active")
        .length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      doctors.filter((u) => !u.emailVerified && u.recordStatus === "active")
        .length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      doctors.filter((u) => u.recordStatus === "retired").length,
    ).toBeGreaterThanOrEqual(2);
    for (const user of volumeUsers) {
      expect(user.recordStatus === "retired").toBe(user.deletedAt != null);
    }
  });

  it("#2213: spreads the roster over past and future, cancellations included", () => {
    expect(
      dataset.registrations.filter((r) => r.recordStatus === "retired").length,
    ).toBeGreaterThanOrEqual(2);
    const startsAtById = new Map(
      dataset.events.map((e) => [e.id as string, e.startsAt as Date]),
    );
    const past = dataset.registrations.filter(
      (r) => startsAtById.get(r.eventId as string)!.getTime() < now.getTime(),
    );
    expect(past.length).toBeGreaterThanOrEqual(5);
    expect(dataset.registrations.length - past.length).toBeGreaterThanOrEqual(
      5,
    );
  });

  it("#2213: carries recordings in every kind and every status", () => {
    for (const status of ["draft", "published", "retired"]) {
      expect(
        dataset.eventRecordings.filter((r) => r.status === status).length,
      ).toBeGreaterThanOrEqual(2);
    }
    for (const kind of ["edited", "raw"]) {
      expect(
        dataset.eventRecordings.filter((r) => r.kind === kind).length,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  // On the second pin the volume grid would omit the original row.
  it.each([PINNED_NOW, "2026-11-02T12:00:00.000Z"])(
    "014 EARS-8: the stage doctor recording fixture has two published cuts at %s",
    (timestamp) => {
      const pin = new Date(timestamp);
      const fixture = buildGoldenDataset(pin, subjects);
      const event = fixture.events.find(
        (row) => row.slug === "golden-volume-event-151",
      );
      expect(event).toMatchObject({
        audience: "doctors",
        state: "ended",
        participationFormat: "online",
      });
      expect(event?.startsAt.getTime()).toBeLessThan(pin.getTime());
      const cuts = fixture.eventRecordings
        .filter(
          (row) => row.eventId === event?.id && row.status === "published",
        )
        .sort((a, b) => a.kind.localeCompare(b.kind));
      expect(cuts).toMatchObject([
        {
          kind: "edited",
          provider: "rutube",
          embedRef: "1766d2bce7049428166252d02a41f8da",
          durationSec: 20,
          firstPublishedAt: expect.any(Date),
        },
        {
          kind: "raw",
          provider: "rutube",
          embedRef: "a682bead10b37ce96beef4f3a6d59b08",
          durationSec: 6692,
          firstPublishedAt: expect.any(Date),
        },
      ]);
    },
  );

  it("#2213: gives every archived эфир the published recording it needs", () => {
    // `hidden -> in_archive` is offered only when a published recording exists
    // (014 EARS-25), so an archived row without one is a shape the product
    // cannot produce — and in «Прошедшие» it renders as a card that promises a
    // recording forever.
    const publishedFor = new Set(
      dataset.eventRecordings
        .filter((r) => r.status === "published")
        .map((r) => r.eventId as string),
    );
    const archived = dataset.events.filter(
      (e) => e.state === "in_archive" && isGoldenVolumeUuid(e.id as string),
    );
    expect(archived.length).toBeGreaterThanOrEqual(8);
    for (const event of archived) {
      expect(publishedFor).toContain(event.id as string);
    }
  });

  it("#2213: dates «запись готовится» only where the plaque is rendered", () => {
    // `recordings.projection.ts` projects the date ONLY when the event has no
    // published recording; written anywhere else it is invisible, and the dated
    // plaque (014-design §2) becomes a state no walk can reach.
    const publishedFor = new Set(
      dataset.eventRecordings
        .filter((r) => r.status === "published")
        .map((r) => r.eventId as string),
    );
    const bare = dataset.events.filter(
      (e) =>
        isGoldenVolumeUuid(e.id as string) &&
        e.state === "ended" &&
        !publishedFor.has(e.id as string),
    );
    expect(bare.length).toBeGreaterThanOrEqual(6);
    for (const event of bare) expect(event.recordingExpectedBy).toBeTruthy();
    for (const event of dataset.events.filter(
      (e) =>
        isGoldenVolumeUuid(e.id as string) && publishedFor.has(e.id as string),
    )) {
      expect(event.recordingExpectedBy).toBeUndefined();
    }

    // Both sides of the promise: a date still ahead of «now», and one already
    // missed — the overdue copy is its own rendered state.
    const dates = bare.map((e) =>
      Date.parse(`${e.recordingExpectedBy}T00:00:00Z`),
    );
    expect(
      dates.filter((d) => d > now.getTime()).length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      dates.filter((d) => d < now.getTime()).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("#2213: registers doctors only where registration is possible", () => {
    const byId = new Map(dataset.events.map((e) => [e.id as string, e]));
    for (const row of dataset.registrations.filter(isVolume)) {
      const event = byId.get(row.eventId as string)!;
      // `doctor-register.service.ts` refuses a draft or hidden эфир, and a
      // `legacy` archive row predates the registration flow entirely.
      expect(["published", "live", "ended"]).toContain(event.state);
      const registeredAt = (row.registeredAt as Date).getTime();
      expect(registeredAt).toBeLessThan((event.startsAt as Date).getTime());
      expect(registeredAt).toBeLessThan(now.getTime());
      if (row.deletedAt instanceof Date) {
        expect(row.deletedAt.getTime()).toBeGreaterThan(registeredAt);
        expect(row.deletedAt.getTime()).toBeLessThan(now.getTime());
      }
    }
  });

  it("#2213: keeps `legacy` origin and the stream room mutually exclusive", () => {
    const byId = new Map(dataset.events.map((e) => [e.id as string, e]));
    for (const event of dataset.events) {
      if (event.origin === "legacy") expect(event.state).toBe("in_archive");
    }
    for (const config of dataset.streamConfig) {
      expect(byId.get(config.eventId as string)?.origin).toBe("platform");
    }
  });

  it("#2213: is byte-identical across two builds of the volume half", () => {
    const first = buildGoldenVolume(
      resolveGoldenNow({ [GOLDEN_NOW_ENV_VAR]: PINNED_NOW }),
    );
    const again = buildGoldenVolume(
      resolveGoldenNow({ [GOLDEN_NOW_ENV_VAR]: PINNED_NOW }),
    );
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
    expect(first.events.length).toBeGreaterThanOrEqual(48);
  });

  it("#2213: is referentially sound over the volume rows too", () => {
    expect(goldenReferentialIssues(dataset)).toEqual([]);
    const userIds = new Set(dataset.users.map((u) => u.id as string));
    const eventIds = new Set(dataset.events.map((e) => e.id as string));
    const expertIds = new Set(dataset.experts.map((e) => e.id as string));
    const projectIds = new Set(dataset.projects.map((p) => p.id as string));

    for (const row of dataset.registrations.filter(isVolume)) {
      expect(userIds).toContain(row.userId as string);
      expect(eventIds).toContain(row.eventId as string);
    }
    for (const row of dataset.eventExperts.filter(isVolume)) {
      expect(eventIds).toContain(row.eventId as string);
      expect(expertIds).toContain(row.expertId as string);
    }
    for (const row of dataset.eventProjects.filter(isVolume)) {
      expect(eventIds).toContain(row.eventId as string);
      expect(projectIds).toContain(row.projectId as string);
    }
    for (const row of dataset.eventRecordings.filter(isVolume)) {
      expect(eventIds).toContain(row.eventId as string);
    }
    // stream_config is keyed on its event, not on a surrogate id, so there is
    // no ordinal to scope by — every row is checked.
    for (const row of dataset.streamConfig) {
      expect(eventIds).toContain(row.eventId as string);
    }
    for (const row of dataset.consentRecords.filter(isVolume)) {
      expect(userIds).toContain(row.userId as string);
    }
    for (const row of dataset.doctorSpecialties.filter(isVolume)) {
      expect(userIds).toContain(row.doctorId);
    }
    expect(goldenSpecialtyIssues(dataset.doctorSpecialties)).toEqual([]);
  });

  it("#2213: never renumbers a named row into the volume range", () => {
    // The named catalogue is the compile target of the #2067 scenarios; volume
    // ids live strictly above it, so a scenario `Given` can never collide.
    expect(isGoldenVolumeUuid(golden.events.upcoming.id)).toBe(false);
    expect(isGoldenVolumeUuid(golden.doctors.verifiedCardiologist.id)).toBe(
      false,
    );
    // The marker is the golden prefix, not the ordinal tail: a production uuid
    // whose last twelve hex digits exceed the base is still not a volume row.
    expect(isGoldenVolumeUuid("f81d4fae-7dec-11d0-a765-00a0c91e6bf6")).toBe(
      false,
    );
    const ids = collectIds(dataset);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("#2213: keeps every publication instant out of the update set at volume", () => {
    // `taxonomy_first_published_at_set_once` (migration 0015) rolls the whole
    // seed transaction back on a re-run if a publication instant is updated —
    // and the volume half multiplies the rows that carry one.
    for (const name of ["experts", "projects", "event_recordings"]) {
      const step = buildGoldenSeedPlan(
        dataset,
        specialtyIdByName,
        learningPresetByName,
        pointsContext,
      ).find((s) => s.name === name)!;
      const published = step.rows.filter(
        (row) => row.firstPublishedAt instanceof Date,
      );
      expect(published.length).toBeGreaterThanOrEqual(2);
      expect(step.updateKeys).not.toContain("firstPublishedAt");
      expect(step.updateKeys).toContain("updatedAt");
    }
  });
});

// #2213 part D — the taxonomy families and the TARGETING they exist for.
//
// PR #2216 filled the calendar and the owner still found the stand «кусочно»:
// «Направления», «Связи специальностей», «Смежность» and «Партнёры» were empty
// admin lists, and — because the doctor feed is resolved through
// `direction_specialties` → `directions` → `event_directions` — a doctor who had
// chosen a specialty saw NOTHING. An empty taxonomy is not a missing nicety, it
// is a feed that returns `totalCount: 0` for every specialty in the book.
describe("#2213 golden taxonomy and targeting", () => {
  const dataset = buildGoldenDataset(now, subjects);

  const publishedDirections = dataset.directions.filter(
    (d) => d.status === "published",
  );
  const directionById = new Map(
    dataset.directions.map((d) => [d.id as string, d]),
  );

  /** Exactly the join the API walks: `targeting.repository.ts` `findOwnDirections`. */
  const ownDirectionIds = (specialtyId: string): string[] =>
    dataset.directionSpecialties
      .filter(
        (link) =>
          link.specialtyName !== undefined &&
          specialtyIdByName.get(link.specialtyName) === specialtyId &&
          link.status === "active",
      )
      .map((link) => link.directionId)
      .filter((id) => directionById.get(id)?.status === "published");

  it("#2213: carries every admin family at volume, not a subset of them", () => {
    // One row per family proves the page renders; the owner walks LISTS. Every
    // floor below is the admin table's own page size or the count the walk has
    // to be able to sort, filter and paginate.
    expect(dataset.directions.length).toBeGreaterThanOrEqual(38);
    expect(dataset.partners.length).toBeGreaterThanOrEqual(14);
    expect(dataset.directionSpecialties.length).toBeGreaterThanOrEqual(118);
    expect(dataset.directionAdjacency.length).toBeGreaterThanOrEqual(40);
    expect(dataset.eventDirections.length).toBeGreaterThan(400);
    expect(dataset.projectExperts.length).toBeGreaterThanOrEqual(28);
    expect(dataset.projectPartners.length).toBeGreaterThanOrEqual(14);
  });

  it("#2213: carries every lifecycle status of every new family", () => {
    const statuses = (rows: readonly { status?: unknown }[]) =>
      new Set(rows.map((row) => row.status as string));

    expect(statuses(dataset.directions)).toEqual(
      new Set(["draft", "published", "retired"]),
    );
    expect(statuses(dataset.partners)).toEqual(
      new Set(["draft", "published", "retired"]),
    );
    for (const [family, rows] of [
      ["direction_specialties", dataset.directionSpecialties],
      ["direction_adjacency", dataset.directionAdjacency],
      ["event_directions", dataset.eventDirections],
      ["project_experts", dataset.projectExperts],
      ["project_organisations", dataset.projectPartners],
    ] as const) {
      expect(statuses(rows), family).toEqual(new Set(["active", "retired"]));
    }
  });

  it("032 EARS-11: every golden organisation holds the «Инвестор» role, as the absorbing migration gives every former partner", () => {
    const held = new Map(
      dataset.organisationRoleAssignments.map((a) => [
        a.organisationId,
        a.roleId,
      ]),
    );
    expect(dataset.organisationRoleAssignments).toHaveLength(
      dataset.partners.length,
    );
    for (const org of dataset.partners) {
      expect(held.get(org.id as string)).toBe(
        SEED_ORGANISATION_ROLES.investor.id,
      );
    }
  });

  it("#2213: satisfies the retired-iff-deleted check on every new row", () => {
    const families = [
      ["directions", dataset.directions],
      ["organisations", dataset.partners],
      ["direction_specialties", dataset.directionSpecialties],
      ["direction_adjacency", dataset.directionAdjacency],
      ["event_directions", dataset.eventDirections],
      ["project_experts", dataset.projectExperts],
      ["project_organisations", dataset.projectPartners],
    ] as const;
    for (const [family, rows] of families) {
      for (const row of rows) {
        const retired = row.status === "retired";
        expect(
          row.deletedAt instanceof Date,
          `${family} ${String(row.id)}`,
        ).toBe(retired);
      }
    }
    // `directions_published_has_first_published_at` / the partners twin.
    for (const row of [...dataset.directions, ...dataset.partners]) {
      if (row.status === "published") {
        expect(row.firstPublishedAt instanceof Date).toBe(true);
      }
    }
  });

  it("#2213: gives every partner a title, a logo key and an HTTPS site or none", () => {
    // `partners_website_url_https` is a DATABASE check: a relative path or a
    // plaintext origin aborts the whole seed transaction.
    for (const partner of dataset.partners) {
      expect(partner.title, String(partner.slug)).toBeTruthy();
      expect(String(partner.logoRef)).toMatch(/^golden\/partners\/\d+\.svg$/);
      if (partner.websiteUrl != null) {
        expect(String(partner.websiteUrl)).toMatch(
          /^https:\/\/[^\s/?#]+[^\s]*$/,
        );
      }
    }
    // Both sides of the nullable column — «партнёр без сайта» is a rendered state.
    expect(dataset.partners.some((p) => p.websiteUrl == null)).toBe(true);
    expect(dataset.partners.some((p) => p.websiteUrl != null)).toBe(true);
  });

  it("#2213: links every specialty of the Минздрав book to a published direction", () => {
    // The invariant the owner's walk is: ANY specialty a doctor can choose
    // resolves to at least one published direction. `Другое` is deliberately
    // excluded — `TargetingService.resolve` answers `mode: 'general'` for it and
    // never reads a direction at all.
    const uncovered = RAZDEL_I_NAMES.filter(
      (name) =>
        ownDirectionIds(specialtyIdByName.get(name) as string).length === 0,
    );
    expect(uncovered).toEqual([]);
  });

  it("#2213: leads every specialty of the book to an upcoming published эфир", () => {
    // The whole chain the doctor feed walks, asserted end to end and replayed
    // at the month boundaries: a specialty that resolves to a direction nothing
    // upcoming is classified under renders the same empty feed as no direction
    // at all.
    for (const pin of [
      "2026-01-15T12:00:00.000Z",
      "2026-12-31T23:30:00.000Z",
    ]) {
      const pinned = resolveGoldenNow({ [GOLDEN_NOW_ENV_VAR]: pin });
      const built = buildGoldenDataset(pinned, subjects);
      const publishedById = new Map(
        built.directions
          .filter((d) => d.status === "published")
          .map((d) => [d.id as string, d]),
      );
      const upcoming = new Set(
        built.events
          .filter(
            (e) =>
              e.state === "published" &&
              (e.startsAt as Date).getTime() > pinned.getTime(),
          )
          .map((e) => e.id as string),
      );
      const liveDirections = new Set(
        built.eventDirections
          .filter(
            (link) =>
              link.status === "active" && upcoming.has(link.eventId as string),
          )
          .map((link) => link.directionId as string),
      );
      const starved = RAZDEL_I_NAMES.filter((name) => {
        const specialtyId = specialtyIdByName.get(name) as string;
        const own = built.directionSpecialties.filter(
          (link) =>
            specialtyIdByName.get(link.specialtyName) === specialtyId &&
            link.status === "active" &&
            publishedById.has(link.directionId),
        );
        return !own.some((link) => liveDirections.has(link.directionId));
      });
      // #2836 / #2871: exactly TWO named specialties are starved on purpose —
      // one whose adjacent areas carry эфиры (019 LD-9 keeps «Моя и смежные»),
      // one whose adjacent areas carry none (LD-9 falls back to «Все»).
      expect([...starved].sort(), pin).toEqual(
        [GOLDEN_EMPTY_SPECIALTY, GOLDEN_EMPTY_SCOPE_SPECIALTY].sort(),
      );
    }
  });

  it("#2213: shows every specialty a published эфир in every 14-day feed window", () => {
    // A density bar for the golden season: every specialty's directions carry
    // a published эфир inside any 14 days. The doctor feed itself pages by
    // event count (019 LD-2, #2884), so this is not its horizon; «every
    // direction has SOME upcoming эфир» is still too weak — a direction whose
    // next эфир is five weeks out makes a specialty-narrowed feed read as empty
    // for weeks of the stand's calendar. So the invariant is
    // replayed over every window a doctor could open between the pin and the
    // end of the season, on the specialty's OWN directions only: adjacency is a
    // widening the product may or may not apply, never what keeps a feed alive.
    const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
    const MS_DAY = 24 * 60 * 60 * 1000;
    const HORIZON_DAYS = 14;
    const SEASON_AHEAD_DAYS = 18 * 7;
    for (const pin of [
      "2026-01-15T12:00:00.000Z",
      "2026-12-31T23:30:00.000Z",
    ]) {
      const pinned = resolveGoldenNow({ [GOLDEN_NOW_ENV_VAR]: pin });
      const built = buildGoldenDataset(pinned, subjects);
      const publishedById = new Set(
        built.directions
          .filter((d) => d.status === "published")
          .map((d) => d.id as string),
      );
      const startById = new Map(
        built.events
          .filter(
            (e) =>
              e.state === "published" &&
              (e.startsAt as Date).getTime() > pinned.getTime(),
          )
          .map((e) => [e.id as string, (e.startsAt as Date).getTime()]),
      );
      const startsByDirection = new Map<string, number[]>();
      for (const link of built.eventDirections) {
        const start = startById.get(link.eventId as string);
        if (link.status !== "active" || start === undefined) continue;
        const list = startsByDirection.get(link.directionId as string) ?? [];
        list.push(start);
        startsByDirection.set(link.directionId as string, list);
      }
      const mskToday =
        Math.floor((pinned.getTime() + MSK_OFFSET_MS) / MS_DAY) * MS_DAY -
        MSK_OFFSET_MS;
      const starved: string[] = [];
      for (const name of RAZDEL_I_NAMES) {
        const specialtyId = specialtyIdByName.get(name) as string;
        const starts = built.directionSpecialties
          .filter(
            (link) =>
              specialtyIdByName.get(link.specialtyName) === specialtyId &&
              link.status === "active" &&
              publishedById.has(link.directionId),
          )
          .flatMap((link) => startsByDirection.get(link.directionId) ?? []);
        for (let day = 0; day + HORIZON_DAYS <= SEASON_AHEAD_DAYS; day += 1) {
          const from = mskToday + day * MS_DAY;
          const to = from + HORIZON_DAYS * MS_DAY;
          if (!starts.some((start) => start >= from && start < to)) {
            starved.push(`${name} @ +${day}d`);
            break;
          }
        }
      }
      // #2836 / #2871: the two deliberately empty specialties, empty from the
      // first day.
      expect([...starved].sort(), pin).toEqual(
        [
          `${GOLDEN_EMPTY_SPECIALTY} @ +0d`,
          `${GOLDEN_EMPTY_SCOPE_SPECIALTY} @ +0d`,
        ].sort(),
      );
    }
  });

  it("#2836: carries one pickable specialty with no эфиры and a managed adjacency", () => {
    // 019 EARS-9 / LD-9: «в вашей специальности пока ничего нет» is a render of
    // its own, and a scenario can only drive it on a specialty that is empty
    // for real — every direction it resolves to classifies NO эфир at all —
    // while its adjacent directions lead to upcoming ones.
    expect(RAZDEL_I_NAMES).toContain(GOLDEN_EMPTY_SPECIALTY);
    const emptyId = goldenDirectionId(GOLDEN_EMPTY_DIRECTION.slug);
    const own = ownDirectionIds(
      specialtyIdByName.get(GOLDEN_EMPTY_SPECIALTY) as string,
    );
    expect(own).toEqual([emptyId]);
    expect(directionById.get(emptyId)?.status).toBe("published");
    expect(
      dataset.eventDirections.filter((link) => link.directionId === emptyId),
    ).toEqual([]);

    const upcoming = new Set(
      dataset.events
        .filter(
          (e) =>
            e.state === "published" &&
            (e.startsAt as Date).getTime() > now.getTime(),
        )
        .map((e) => e.id as string),
    );
    const adjacent = dataset.directionAdjacency.filter(
      (edge) => edge.directionId === emptyId && edge.status === "active",
    );
    expect(adjacent.length).toBeGreaterThanOrEqual(2);
    for (const edge of adjacent) {
      const to = edge.adjacentDirectionId as string;
      expect(directionById.get(to)?.status, to).toBe("published");
      expect(
        dataset.eventDirections.some(
          (link) =>
            link.directionId === to &&
            link.status === "active" &&
            upcoming.has(link.eventId as string),
        ),
        to,
      ).toBe(true);
    }

    // Append, never renumber: the new direction, its link and its edges come
    // after every row seeded before them (only #2871's rows follow), so no
    // earlier row keeps a different id or pairing.
    expect(dataset.directions.at(-2)?.id).toBe(emptyId);
    const link = dataset.directionSpecialties.at(-2);
    expect([link?.directionId, link?.specialtyName]).toEqual([
      emptyId,
      GOLDEN_EMPTY_SPECIALTY,
    ]);
    const tail = dataset.directionAdjacency.slice(-adjacent.length - 1, -1);
    expect(tail.map((edge) => edge.directionId)).toEqual(
      adjacent.map(() => emptyId),
    );
  });

  it("#2871: carries one pickable specialty whose default «Моя и смежные» has no upcoming эфир", () => {
    // 019 LD-9 / EARS-9: the feed falls back to «Все специальности» only when
    // the default «Моя и смежные» read — own AND adjacent directions — is
    // empty. A scenario drives that on a specialty whose own direction and
    // every managed adjacent one classify no upcoming эфир at all.
    expect(RAZDEL_I_NAMES).toContain(GOLDEN_EMPTY_SCOPE_SPECIALTY);
    const scopeId = goldenDirectionId(GOLDEN_EMPTY_SCOPE_DIRECTION.slug);
    const own = ownDirectionIds(
      specialtyIdByName.get(GOLDEN_EMPTY_SCOPE_SPECIALTY) as string,
    );
    expect(own).toEqual([scopeId]);
    expect(directionById.get(scopeId)?.status).toBe("published");

    const upcoming = new Set(
      dataset.events
        .filter(
          (e) =>
            e.state === "published" &&
            (e.startsAt as Date).getTime() > now.getTime(),
        )
        .map((e) => e.id as string),
    );
    const adjacent = dataset.directionAdjacency
      .filter(
        (edge) => edge.directionId === scopeId && edge.status === "active",
      )
      .map((edge) => edge.adjacentDirectionId as string);
    // A real managed adjacency, so the empty scope is «own and adjacent», not
    // merely «no adjacency».
    expect(adjacent.length).toBeGreaterThanOrEqual(1);
    for (const id of [scopeId, ...adjacent]) {
      expect(directionById.get(id)?.status, id).toBe("published");
      expect(
        dataset.eventDirections.some(
          (link) =>
            link.directionId === id &&
            link.status === "active" &&
            upcoming.has(link.eventId as string),
        ),
        id,
      ).toBe(false);
    }

    // Appended LAST in every family, after #2836's rows.
    expect(dataset.directions.at(-1)?.id).toBe(scopeId);
    const lastLink = dataset.directionSpecialties.at(-1);
    expect([lastLink?.directionId, lastLink?.specialtyName]).toEqual([
      scopeId,
      GOLDEN_EMPTY_SCOPE_SPECIALTY,
    ]);
    expect(dataset.directionAdjacency.at(-1)?.directionId).toBe(scopeId);
  });

  it("#2213: keeps the adjacency graph directed, loop-free and singly authored", () => {
    const pairs = new Set<string>();
    for (const edge of dataset.directionAdjacency) {
      expect(edge.directionId).not.toBe(edge.adjacentDirectionId);
      const pair = `${String(edge.directionId)}|${String(edge.adjacentDirectionId)}`;
      expect(pairs.has(pair), pair).toBe(false);
      pairs.add(pair);
      expect(edge.weight as number).toBeGreaterThanOrEqual(1);
      expect(edge.weight as number).toBeLessThanOrEqual(100);
    }
    // All three members of the closed vocabulary — an operator opening «вид
    // связи» on the stand has to see each one already used.
    expect(new Set(dataset.directionAdjacency.map((e) => e.kind))).toEqual(
      new Set(["related", "subdiscipline", "interdisciplinary"]),
    );
    // The edge is DIRECTED, so a mutual relation is two authored rows: at least
    // one pair exists in both orientations, and at least one does not.
    const mutual = [...pairs].filter((pair) => {
      const [from, to] = pair.split("|");
      return pairs.has(`${to}|${from}`);
    });
    expect(mutual.length).toBeGreaterThan(0);
    expect(mutual.length).toBeLessThan(pairs.size);
    // Every published direction is reachable in the «смежные» block.
    const touched = new Set(
      dataset.directionAdjacency.flatMap((e) => [
        e.directionId as string,
        e.adjacentDirectionId as string,
      ]),
    );
    for (const direction of publishedDirections) {
      expect(touched.has(direction.id as string), String(direction.slug)).toBe(
        true,
      );
    }
  });

  it("#2213: classifies every эфир the doctor can reach, curated ones included", () => {
    const classified = new Map<string, number>();
    for (const link of dataset.eventDirections) {
      if (link.status !== "active") continue;
      const id = link.eventId as string;
      classified.set(id, (classified.get(id) ?? 0) + 1);
    }
    const reachable = dataset.events.filter(
      (e) => e.state !== "draft" && e.recordStatus !== "retired",
    );
    for (const event of reachable) {
      const count = classified.get(event.id as string) ?? 0;
      expect(count, String(event.slug)).toBeGreaterThanOrEqual(1);
      expect(count, String(event.slug)).toBeLessThanOrEqual(3);
    }
    // The curated six are hand-picked, not left to the round-robin.
    for (const key of [
      "upcoming",
      "live",
      "pastWithRecording",
      "archived",
    ] as const) {
      expect(classified.get(golden.events[key].id) ?? 0).toBeGreaterThanOrEqual(
        1,
      );
    }
  });

  it("#2213: gives every project one active curator and at most one primary partner", () => {
    // Both bounds are PARTIAL UNIQUE INDEXES: a second active curator or a
    // second active primary partner aborts the seed transaction outright.
    const projectIds = dataset.projects
      .filter((p) => p.status !== "retired")
      .map((p) => p.id as string);
    const expertById = new Map(dataset.experts.map((e) => [e.id as string, e]));

    for (const projectId of projectIds) {
      const links = dataset.projectExperts.filter(
        (l) => l.projectId === projectId,
      );
      const curators = links.filter(
        (l) => l.status === "active" && l.role === "curator",
      );
      expect(curators.length, projectId).toBe(1);
      // 012-design §3.2: the curator of a published project is a published,
      // non-retired expert.
      const curator = expertById.get(curators[0]!.expertId as string);
      expect(curator?.status, projectId).toBe("published");
      expect(links.length, projectId).toBeGreaterThanOrEqual(2);
      expect(links.length, projectId).toBeLessThanOrEqual(5);

      const partners = dataset.projectPartners.filter(
        (l) => l.projectId === projectId,
      );
      expect(partners.length, projectId).toBeGreaterThanOrEqual(1);
      expect(partners.length, projectId).toBeLessThanOrEqual(3);
      expect(
        partners.filter((l) => l.status === "active" && l.isPrimary === true)
          .length,
        projectId,
      ).toBe(1);
    }
    // Each pair is unique across active AND retained rows (`*_pair_key`).
    for (const rows of [dataset.projectExperts, dataset.projectPartners]) {
      const keys = rows.map((row) =>
        [
          row.projectId,
          (row as { expertId?: unknown }).expertId,
          (row as { organisationId?: unknown }).organisationId,
        ]
          .filter((part) => part != null)
          .join("|"),
      );
      expect(new Set(keys).size).toBe(keys.length);
    }
    // A partner that only ever appears on one project is not a partner list.
    const perPartner = new Map<string, number>();
    for (const link of dataset.projectPartners) {
      const id = link.organisationId as string;
      perPartner.set(id, (perPartner.get(id) ?? 0) + 1);
    }
    expect(
      [...perPartner.values()].filter((n) => n > 1).length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("#2213: is referentially sound over the taxonomy link tables too", () => {
    expect(goldenReferentialIssues(dataset)).toEqual([]);
    const directionIds = new Set(dataset.directions.map((d) => d.id as string));
    const partnerIds = new Set(dataset.partners.map((p) => p.id as string));
    const eventIds = new Set(dataset.events.map((e) => e.id as string));
    const expertIds = new Set(dataset.experts.map((e) => e.id as string));
    const projectIds = new Set(dataset.projects.map((p) => p.id as string));

    for (const row of dataset.directionSpecialties) {
      expect(directionIds).toContain(row.directionId);
    }
    for (const row of dataset.directionAdjacency) {
      expect(directionIds).toContain(row.directionId as string);
      expect(directionIds).toContain(row.adjacentDirectionId as string);
    }
    for (const row of dataset.eventDirections) {
      expect(eventIds).toContain(row.eventId as string);
      expect(directionIds).toContain(row.directionId as string);
    }
    for (const row of dataset.projectExperts) {
      expect(projectIds).toContain(row.projectId as string);
      expect(expertIds).toContain(row.expertId as string);
    }
    for (const row of dataset.projectPartners) {
      expect(projectIds).toContain(row.projectId as string);
      expect(partnerIds).toContain(row.organisationId as string);
    }
    // Slugs are unique across EVERY retained row (`*_slug_key` is not partial).
    for (const rows of [dataset.directions, dataset.partners]) {
      const slugs = rows.map((row) => row.slug as string);
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const slug of slugs)
        expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("#2213: writes the taxonomy parents before the links that reference them", () => {
    const plan = buildGoldenSeedPlan(
      dataset,
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    );
    const order = plan.map((step) => step.name);
    const at = (name: string) => {
      const index = order.indexOf(name);
      expect(index, name).toBeGreaterThanOrEqual(0);
      return index;
    };
    expect(at("directions")).toBeLessThan(at("direction_specialties"));
    expect(at("directions")).toBeLessThan(at("direction_adjacency"));
    expect(at("directions")).toBeLessThan(at("event_directions"));
    expect(at("events")).toBeLessThan(at("event_directions"));
    expect(at("organisations")).toBeLessThan(at("project_organisations"));
    expect(at("organisations")).toBeLessThan(
      at("organisation_role_assignments"),
    );
    expect(at("projects")).toBeLessThan(at("project_organisations"));
    expect(at("experts")).toBeLessThan(at("project_experts"));
    expect(order).toEqual([...GOLDEN_SEED_ORDER]);
    for (const name of ["directions", "organisations"]) {
      const step = plan.find((s) => s.name === name)!;
      expect(step.updateKeys).not.toContain("firstPublishedAt");
      expect(step.updateKeys).toContain("updatedAt");
    }
  });

  it("030 EARS-17: every published golden project carries results, except the one dedicated no-result project", () => {
    // The `public_project` predicate (030-design) hides a published project with
    // no result from every public read. A golden stand whose published projects
    // carry none would show an Academy with no project anywhere, so every
    // published project gets an ordered result set — except ONE, kept so the
    // admin mark «Не на сайте: нет результатов» has a row to show.
    const results = dataset.projectResults;
    const withResults = new Set(results.map((r) => r.projectId as string));
    const publishedWithout = dataset.projects
      .filter((p) => p.status === "published" && !p.deletedAt)
      .filter((p) => !withResults.has(p.id as string))
      .map((p) => p.slug);
    expect(publishedWithout).toEqual([golden.projects.publishedNoResults.slug]);
    expect(golden.projects.publishedNoResults.slug).toBe(
      "golden-project-published-no-results",
    );

    const projectIds = new Set(dataset.projects.map((p) => p.id as string));
    const seedKinds = new Set(
      Object.values(SEED_PROJECT_OUTPUT_KINDS).map((kind) => kind.id),
    );
    const positions = new Map<string, number[]>();
    for (const row of results) {
      expect(projectIds).toContain(row.projectId);
      expect(seedKinds).toContain(row.outputKindId);
      expect((row.title as string).length).toBeGreaterThan(0);
      // A stand's doctor-storefront origin differs per stand, and the result
      // editor refuses a link off it: a golden link would make every re-save
      // of a golden project fail. The seed states no link.
      expect(row.storefrontUrl ?? null).toBeNull();
      const list = positions.get(row.projectId as string) ?? [];
      list.push(row.position as number);
      positions.set(row.projectId as string, list);
    }
    for (const [projectId, list] of positions) {
      expect(list, projectId).toEqual(list.map((_, i) => i));
    }
    const ids = results.map((r) => r.id as string);
    expect(new Set(ids).size).toBe(ids.length);
    expect(goldenReferentialIssues(dataset)).toEqual([]);
  });

  it("030 EARS-17: writes project results after their project, keyed on the per-project position", () => {
    const plan = buildGoldenSeedPlan(
      dataset,
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    );
    const order = plan.map((step) => step.name);
    expect(order.indexOf("project_results")).toBeGreaterThan(
      order.indexOf("projects"),
    );
    const step = plan.find((s) => s.name === "project_results")!;
    // The editor replaces the set with fresh ids, so a re-run must meet the
    // row on (project, position), not on a golden id the stand no longer holds.
    expect(step.conflictKeys).toEqual(["projectId", "position"]);
    expect(step.rows).toHaveLength(dataset.projectResults.length);
  });

  it("#2213: resolves direction specialties through the seeded book", () => {
    const rows = resolveDirectionSpecialtyRows(
      dataset.directionSpecialties,
      specialtyIdByName,
    );
    expect(rows.length).toBe(dataset.directionSpecialties.length);
    for (const row of rows) {
      expect(typeof row.specialtyMinzdravId).toBe("string");
      expect(row).not.toHaveProperty("specialtyName");
    }
  });

  it("#2213: fails loudly when the book does not carry a linked specialty", () => {
    expect(() =>
      resolveDirectionSpecialtyRows(
        [
          {
            id: goldenUuid(0x00fe, 1),
            directionId: goldenUuid(0x00fe, 2),
            specialtyName: "Спортивная гомеопатия",
            status: "active",
            createdAt: now,
            updatedAt: now,
          },
        ],
        specialtyIdByName,
      ),
    ).toThrow(GoldenPlanError);
  });
});

// #2213 — the CONTENT of the volume half, and the objects its rows promise.
//
// PR #2216 passed every structural assertion above and the owner still rejected
// the stand: one-sentence descriptions, empty programmes, single speakers with
// no faces. Shape is not content, so these are the assertions that hold the
// content — and, because the rows reference object-storage keys, the bytes too.
describe("#2213 golden volume content and media", () => {
  const dataset = buildGoldenDataset(now, subjects);
  const volumeEvents = dataset.events.filter((e) =>
    isGoldenVolumeUuid(e.id as string),
  );
  const volumeExperts = dataset.experts.filter((e) =>
    isGoldenVolumeUuid(e.id as string),
  );

  let plan: GoldenMediaObject[] = [];
  beforeAll(async () => {
    plan = await buildGoldenMediaPlan(dataset);
  }, 120_000);

  const sha = (bytes: Uint8Array): string =>
    createHash("sha256").update(bytes).digest("hex");

  it("#2213: gives every expert a face, a biography and a place of work", () => {
    expect(volumeExperts.length).toBeGreaterThanOrEqual(32);
    for (const expert of volumeExperts) {
      expect(expert.photoRef).toBeTruthy();
      expect(
        ordinalFromExpertPhotoKey(expert.photoRef as string),
      ).not.toBeNull();
      expect((expert.bio ?? "").length).toBeGreaterThanOrEqual(120);
      expect(expert.credentials).toBeTruthy();
      expect(expert.affiliation).toBeTruthy();
      expect(expert.professionalRole).toBeTruthy();
    }
    // The two named experts are golden rows like any other: an expert page
    // walked from the published catalogue must show a face as well.
    const named = dataset.experts.filter(
      (e) => !isGoldenVolumeUuid(e.id as string),
    );
    expect(named.length).toBeGreaterThanOrEqual(2);
    for (const expert of named) {
      expect(expert.photoRef).toBeTruthy();
      expect(expert.bio).toBeTruthy();
    }
    expect(named[0]?.photoRef).toBe(expertPhotoKey(1));
  });

  it("#2213: backs every portrait key with a committed file", () => {
    const keys = dataset.experts
      .map((e) => e.photoRef)
      .filter((key): key is string => Boolean(key));
    expect(keys.length).toBeGreaterThanOrEqual(34);
    for (const key of keys) {
      const ordinal = ordinalFromExpertPhotoKey(key);
      expect(ordinal).not.toBeNull();
      const file = new URL(
        `./media/portraits/${ordinal}.webp`,
        import.meta.url,
      );
      expect(existsSync(file), `missing portrait for ${key}`).toBe(true);
    }
  });

  it("#2213: plans one unique object per key it promises", () => {
    const keys = plan.map((object) => object.key);
    expect(new Set(keys).size).toBe(keys.length);

    const promised = new Set<string>([
      ...dataset.experts
        .map((e) => e.photoRef)
        .filter((key): key is string => Boolean(key)),
      ...dataset.events
        .map((e) => e.programPdfRef)
        .filter((key): key is string => Boolean(key)),
      ...dataset.partners
        .map((p) => p.logoRef)
        .filter((key): key is string => Boolean(key)),
      ...dataset.learningSteps
        .map((s) => s.mediaRef)
        .filter((key): key is string => Boolean(key)),
      ...dataset.materials
        .map((m) => m.coverRef)
        .filter((key): key is string => Boolean(key)),
      ...dataset.feedEntries
        .map((e) => e.imageRef)
        .filter((key): key is string => Boolean(key)),
    ]);
    expect(new Set(keys)).toEqual(promised);
    for (const object of plan) {
      expect(object.bytes.byteLength).toBeGreaterThan(512);
      expect(
        object.contentType === "image/webp" ||
          object.contentType === "application/pdf" ||
          object.contentType === "image/svg+xml",
      ).toBe(true);
    }
  });

  it("#2213: describes an эфир in paragraphs, not in one line", () => {
    const seen: string[] = [];
    for (const event of volumeEvents) {
      const paragraphs = (event.description as string).split("\n\n");
      expect(paragraphs.length).toBeGreaterThanOrEqual(3);
      expect(paragraphs.length).toBeLessThanOrEqual(5);
      for (const paragraph of paragraphs) {
        expect(paragraph.split(/\s+/).length).toBeGreaterThanOrEqual(30);
      }
      seen.push(event.description as string);
    }
    // Adjacent cards are what a schedule shows side by side; identical prose
    // there is what makes a stand read as a fixture.
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).not.toBe(seen[i - 1]);
    }
    const titles = volumeEvents.map((e) => e.title as string);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("#2213: carries a prose bank wide enough for the whole catalogue", () => {
    expect(VOLUME_PROGRAMME.length).toBeGreaterThanOrEqual(120);
    expect(
      new Set(VOLUME_PROGRAMME.map(([, s]) => s)).size,
    ).toBeGreaterThanOrEqual(10);
    expect(new Set(VOLUME_PROGRAMME.map(([t]) => t)).size).toBe(
      VOLUME_PROGRAMME.length,
    );
    // Every specialty a title names must have prose behind it, or
    // `composeDescription` throws for the first event that reaches it.
    expect(specialtiesWithoutParagraphBank()).toEqual([]);
    expect(VOLUME_EXPERTS.length).toBeGreaterThanOrEqual(32);
    expect(VOLUME_PROJECTS.length).toBeGreaterThanOrEqual(12);
    for (const project of VOLUME_PROJECTS) {
      expect(project.description.split("\n\n").length).toBe(2);
    }
    for (const [, specialty] of VOLUME_PROGRAMME) {
      const text = composeDescription(0, specialty);
      expect(text.split("\n\n").length).toBeGreaterThanOrEqual(3);
    }
  });

  it("#2213: advertises the length its own programme adds up to", () => {
    for (const event of volumeEvents) {
      const index = Number.parseInt((event.id as string).slice(-12), 16) - 1000;
      expect(event.durationMin).toBe(programmeTotalMinutes(index));
      expect(event.durationMin as number).toBeGreaterThanOrEqual(115);
    }
  });

  it("#2213: publishes a programme everywhere the page renders one", () => {
    let withProgramme = 0;
    let upcomingWithout = 0;
    for (const event of volumeEvents) {
      const index = Number.parseInt((event.id as string).slice(-12), 16) - 1000;
      const expected = hasProgramme(event.state as string, index);
      expect(Boolean(event.programPdfRef), `${String(event.slug)}`).toBe(
        expected,
      );
      if (expected) {
        expect(event.programPdfRef).toBe(eventProgrammeKey(1000 + index));
        withProgramme += 1;
      } else if (event.state === "published") {
        upcomingWithout += 1;
      }
      // A draft or hidden эфир publishes nothing at all.
      if (event.state === "draft" || event.state === "hidden") {
        expect(event.programPdfRef).toBeUndefined();
      }
    }
    expect(withProgramme).toBeGreaterThanOrEqual(30);
    // «Программа готовится» is a rendered state of its own
    // (`event-page-view.ts` → `eventProgrammeContent`) and a stand where it never
    // appears cannot show the owner what that block looks like.
    expect(upcomingWithout).toBeGreaterThanOrEqual(2);
  });

  it("#2213: names the эфир and its own speakers in the programme", () => {
    const specs = goldenProgrammeSpecs(dataset);
    expect(specs.length).toBeGreaterThanOrEqual(30);
    const expertById = new Map(
      dataset.experts.map((row) => [row.id as string, row]),
    );
    for (const spec of specs) {
      const text = programmeLines(spec).join("\n");
      expect(text).toContain(spec.title);
      expect(spec.speakers.length).toBeGreaterThanOrEqual(2);
      for (const speaker of spec.speakers) {
        expect(text).toContain(speaker.name);
      }
      expect(text).toContain("Вопросы и ответы");
      const sessionLines = programmeLines(spec).filter((line) =>
        /^\d{2}:\d{2} — \d{2}:\d{2}/.test(line.trim()),
      );
      expect(sessionLines.length).toBeGreaterThanOrEqual(6);
    }
    // Every speaker the programme names is an expert of THAT event.
    const first = specs[0]!;
    const names = new Set(
      dataset.eventExperts
        .filter(
          (link) =>
            (link.eventId as string) ===
            (volumeEvents.find((e) => e.programPdfRef)?.id as string),
        )
        .map((link) => {
          const expert = expertById.get(link.expertId as string)!;
          return [expert.familyName, expert.givenName, expert.patronymic]
            .filter(Boolean)
            .join(" ");
        }),
    );
    for (const speaker of first.speakers)
      expect(names.has(speaker.name)).toBe(true);
  });

  it("#2213: renders a programme PDF that parses and carries its title", async () => {
    const spec = goldenProgrammeSpecs(dataset)[0]!;
    const bytes = await renderProgrammePdf(spec);
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getTitle()).toContain(spec.title);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("#2213: renders byte-identical programmes at the same pin", async () => {
    const specs = goldenProgrammeSpecs(dataset).slice(0, 3);
    for (const spec of specs) {
      const [a, b] = await Promise.all([
        renderProgrammePdf(spec),
        renderProgrammePdf(spec),
      ]);
      expect(sha(a)).toBe(sha(b));
    }
  }, 60_000);

  it("#2213: re-dates the programme at a new pin without re-authoring it", () => {
    const later = resolveGoldenNow({
      [GOLDEN_NOW_ENV_VAR]: "2026-03-04T08:30:00.000Z",
    });
    const a = goldenProgrammeSpecs(dataset)[0]!;
    const b = goldenProgrammeSpecs(buildGoldenDataset(later, subjects))[0]!;
    expect(b.title).toBe(a.title);
    const linesA = programmeLines(a);
    const linesB = programmeLines(b);
    expect(linesB.length).toBe(linesA.length);
    let moved = 0;
    for (const [i, line] of linesA.entries()) {
      if (line === linesB[i]) continue;
      moved += 1;
      expect(isDatedProgrammeLine(line)).toBe(true);
    }
    expect(moved).toBeGreaterThan(0);
  });

  it("#2213: writes every object once and re-writes only the generated half", async () => {
    const store = createInMemoryGoldenMediaStore();
    const first = await writeGoldenMedia(store, plan);
    expect(first.written).toBe(plan.length);
    expect(first.skipped).toBe(0);
    expect(store.objects.size).toBe(plan.length);
    // The template bucket is cloned per slot and re-seeded on every `slot up`.
    // The committed portraits never change, so re-uploading them would make the
    // seed's cost grow with the dataset for no gain; the generated programmes
    // are pin-dependent under a pin-invariant key, so they must be re-PUT.
    const generated = plan.filter((o) => o.refresh === "always").length;
    expect(generated).toBeGreaterThan(0);
    const again = await writeGoldenMedia(store, plan);
    expect(again.written).toBe(generated);
    expect(again.skipped).toBe(plan.length - generated);
    expect(store.objects.size).toBe(plan.length);
  }, 30_000);

  it("#2213: re-renders programme PDFs on every seed and writes portraits once", async () => {
    // Two pins, two plans, ONE bucket — the life of the persistent `main` slot.
    // A programme key is ordinal-derived and therefore pin-invariant, while its
    // bytes carry the эфир's date: a writer that skipped on `exists` would leave
    // every downloaded programme dated at the pin the bucket was first filled
    // at, permanently disagreeing with the эфир row beside it.
    const later = resolveGoldenNow({
      [GOLDEN_NOW_ENV_VAR]: "2026-03-04T08:30:00.000Z",
    });
    const planAt = async (pin: Date): Promise<GoldenMediaObject[]> => {
      const full = buildGoldenDataset(pin, subjects);
      return await buildGoldenMediaPlan({
        ...full,
        events: full.events.slice(0, 40),
      });
    };
    const before = await planAt(now);
    const after = await planAt(later);

    const store = createInMemoryGoldenMediaStore();
    await writeGoldenMedia(store, before);

    const pdfs = after.filter((o) => o.refresh === "always");
    const portraits = after.filter((o) => o.refresh === "if-absent");
    expect(pdfs.length).toBeGreaterThan(0);
    expect(portraits.length).toBeGreaterThanOrEqual(32);

    const second = await writeGoldenMedia(store, after);
    expect(second.written).toBe(pdfs.length);
    expect(second.skipped).toBe(portraits.length);

    const beforeByKey = new Map(before.map((o) => [o.key, o.bytes]));
    const moved = pdfs.find((o) => beforeByKey.has(o.key));
    expect(moved, "the two pins share no programme key").toBeDefined();
    const stored = store.objects.get(moved!.key);
    expect(sha(stored!.bytes)).toBe(sha(moved!.bytes));
    expect(sha(moved!.bytes)).not.toBe(sha(beforeByKey.get(moved!.key)!));
  }, 120_000);

  it("#2213: plans the same bytes for the same pin", async () => {
    // The determinism proof, not a second full render. A whole second plan at
    // production volume is ~650 PDF renders for the same answer; this builds
    // the plan again over a TRIMMED slice of the same dataset and compares it,
    // key for key and hash for hash, against the full plan in `beforeAll`. Two
    // independent builds of the same rows still have to agree on every byte —
    // and the pair of dataset builds behind them is the part that could drift.
    const trimmed = {
      ...buildGoldenDataset(now, subjects),
      events: dataset.events.slice(0, 20),
    };
    const again = await buildGoldenMediaPlan(trimmed);
    expect(again.length).toBeGreaterThanOrEqual(20);

    const fullByKey = new Map(plan.map((o) => [o.key, sha(o.bytes)]));
    for (const object of again) {
      expect(fullByKey.get(object.key), object.key).toBe(sha(object.bytes));
    }
  }, 30_000);
});

function collectIds(
  node: unknown,
  out: string[] = [],
  // #2805 — `golden.workerPool.verifiedCardiologist[0]` IS
  // `golden.doctors.verifiedCardiologist` (the same frozen object): one identity
  // reached by two paths is an alias, not a collision, so each object counts once.
  seen: WeakSet<object> = new WeakSet(),
): string[] {
  if (node && typeof node === "object") {
    if (seen.has(node)) return out;
    seen.add(node);
    for (const [key, value] of Object.entries(node)) {
      if (key === "id" && typeof value === "string") out.push(value);
      else collectIds(value, out, seen);
    }
  }
  return out;
}

type GoldenRow = Record<string, unknown>;

/** The row families of a built dataset, in a stable order. */
function rowFamilies(dataset: object): [string, GoldenRow[]][] {
  return Object.entries(dataset)
    .filter((entry): entry is [string, GoldenRow[]] => Array.isArray(entry[1]))
    .sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Index rows by the identity the seed upserts on, so two builds are compared
 * row-for-row rather than position-for-position. Link tables carry no surrogate
 * id — their identity is the pair of foreign keys they join.
 */
function rowsByKey(rows: GoldenRow[]): [string, GoldenRow][] {
  return rows.map((row) => {
    const key =
      typeof row.id === "string"
        ? row.id
        : [
            row.eventId,
            row.userId,
            row.doctorId,
            row.expertId,
            row.projectId,
            row.purpose,
            row.specialtyName,
          ]
            .filter((part) => part != null)
            .join("|");
    return [key, row] as [string, GoldenRow];
  });
}

describe("#3705 golden material", () => {
  // 048 EARS-11 — the Academy reading page `/materials/[slug]` renders a
  // published material, and the stage route walk (`packages/e2e/route-params.ts`)
  // needs one such row on every slot to address it.
  const dataset = buildGoldenDataset(now, subjects);
  const material = golden.materials.published;

  it("catalogues one published material under its own id group", () => {
    expect(material.id).toBe(goldenUuid(GOLDEN_GROUP.materials, 1));
    expect(material.slug).toBe("golden-material-published");
  });

  it("048 EARS-1, EARS-2: seeds a published news item whose body passes the material body contract", () => {
    // The named catalogue's one material; the feed volume (#4172) adds more.
    const named = dataset.materials.filter(
      (m) => !isGoldenVolumeUuid(m.id as string),
    );
    expect(named).toHaveLength(1);
    const row = named[0]!;
    expect(row.id).toBe(material.id);
    expect(row.slug).toBe(material.slug);
    expect(row.kind).toBe("news");
    expect(row.status).toBe("published");
    expect(row.firstPublishedAt).toBeInstanceOf(Date);
    // A news item has no expert and no partner (EARS-1, EARS-19).
    expect(row.expertId ?? null).toBeNull();
    expect(row.partnerOrganisationId ?? null).toBeNull();
    expect((row.title as string).length).toBeGreaterThan(0);
    expect(materialBodySchema.safeParse(row.body).success).toBe(true);
  });

  it("048 EARS-4: carries the feed card a publish writes for that material", () => {
    // A published material always has its card (the own-materials feed source
    // writes it inside the publish transaction), so the fixture carries both.
    const row = dataset.materials[0]!;
    const namedCards = dataset.feedEntries.filter(
      (c) => !isGoldenVolumeUuid(c.id as string),
    );
    expect(namedCards).toHaveLength(1);
    const card = namedCards[0]!;
    expect(card).toMatchObject({
      sourcePlatform: "academy",
      sourceRef: material.id,
      materialId: material.id,
      kind: "news",
      title: row.title,
      imageRef: null,
      imageUrl: null,
      sourceName: "Академия",
      authorExpertId: null,
      partnerOrganisationId: null,
      href: `/materials/${material.slug}`,
    });
    expect((card.publishedAt as Date).getTime()).toBe(
      (row.firstPublishedAt as Date).getTime(),
    );
    expect(goldenReferentialIssues(dataset)).toEqual([]);
  });

  it("flags a feed card whose material the dataset does not carry", () => {
    const broken = {
      ...dataset,
      feedEntries: [
        {
          ...dataset.feedEntries[0]!,
          materialId: goldenUuid(GOLDEN_GROUP.materials, 999),
        },
      ],
      feedEntryMessages: [],
      feedEntryVkObjects: [],
    };
    expect(goldenReferentialIssues(broken)).toEqual([
      `feed_entries.materialId references an unknown row: ${goldenUuid(GOLDEN_GROUP.materials, 999)}`,
    ]);
  });

  it("writes the material after its references and the card after the material", () => {
    const plan = buildGoldenSeedPlan(
      dataset,
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    );
    const order = plan.map((s) => s.name);
    expect(order.indexOf("materials")).toBeGreaterThan(
      order.indexOf("experts"),
    );
    expect(order.indexOf("materials")).toBeGreaterThan(
      order.indexOf("organisations"),
    );
    expect(order.indexOf("feed_entries")).toBeGreaterThan(
      order.indexOf("materials"),
    );
  });

  it("048 EARS-6: a re-run keeps the publication instant of the material and of its card", () => {
    // `materials_first_published_at_set_once` refuses to move the instant, and
    // the card date IS that instant: refreshing one without the other would
    // make the card and its material disagree on a re-seeded slot.
    const plan = buildGoldenSeedPlan(
      dataset,
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    );
    const materials = plan.find((s) => s.name === "materials")!;
    expect(materials.conflictKeys).toEqual(["id"]);
    expect(materials.updateKeys).not.toContain("firstPublishedAt");
    expect(materials.updateKeys).toContain("status");
    expect(materials.updateKeys).toContain("updatedAt");

    const cards = plan.find((s) => s.name === "feed_entries")!;
    // The product re-creates a card on unpublish → publish with a fresh id, so
    // a re-run meets it on its unique source key, not on the golden id.
    expect(cards.conflictKeys).toEqual(["sourcePlatform", "sourceRef"]);
    expect(cards.updateKeys).not.toContain("publishedAt");
    expect(cards.updateKeys).toContain("title");
    expect(cards.updateKeys).toContain("updatedAt");
  });
});

describe("#4059 golden learning course", () => {
  // 024 — the doctor course routes render a published course only, and the
  // `live/doctor/learning` slot leg opens one; a slot is a clone of `ds_golden`.
  const dataset = buildGoldenDataset(now, subjects);
  const L = golden.learning;

  it("catalogues the course under its own id groups with a stable slug", () => {
    expect(L.course.id).toBe(goldenUuid(GOLDEN_GROUP.learningCourses, 1));
    expect(L.course.slug).toBe("golden-course-path");
    expect(L.steps.firstVideo.id).toBe(
      goldenUuid(GOLDEN_GROUP.learningSteps, 1),
    );
  });

  it("seeds one published course: two modules, lesson 1 video → download → exit test, lesson 2 video → exit test", () => {
    const ofCourse = new Set(
      dataset.learningModules
        .filter((m) => m.courseId === L.course.id)
        .map((m) => m.id),
    );
    expect(
      dataset.learningCourses.filter((c) => c.schoolId === L.school.id),
    ).toEqual([
      expect.objectContaining({
        id: L.course.id,
        slug: L.course.slug,
        state: "published",
        schoolId: L.school.id,
      }),
    ]);
    expect(
      dataset.learningModules
        .filter((m) => ofCourse.has(m.id))
        .map((m) => [m.id, m.position]),
    ).toEqual([
      [L.modules.first.id, 1],
      [L.modules.second.id, 2],
    ]);
    expect(
      dataset.learningLessons
        .filter((l) => ofCourse.has(l.moduleId))
        .map((l) => [l.moduleId, l.state]),
    ).toEqual([
      [L.modules.first.id, "published"],
      [L.modules.second.id, "published"],
    ]);
    const typesOf = (lessonId: string) =>
      dataset.learningSteps
        .filter((s) => s.lessonId === lessonId)
        .sort((a, b) => a.position - b.position)
        .map((s) => s.type);
    expect(typesOf(L.lessons.first.id)).toEqual(["video", "download", "test"]);
    expect(typesOf(L.lessons.second.id)).toEqual(["video", "test"]);
    expect(
      [L.lessons.first.id, L.lessons.second.id].flatMap((id) =>
        dataset.learningSteps
          .filter((s) => s.lessonId === id && s.type === "video")
          .map((s) => s.provider),
      ),
    ).toEqual(["youtube", "youtube"]);
    // A test step's row keeps only its kind; the questions are rows (`writeTest`).
    // The named course's rows; the long paths (#4172) carry their own.
    const namedTests = dataset.learningTests.filter(
      (t) => !isGoldenVolumeUuid(t.stepId),
    );
    expect(namedTests.map((t) => t.kind)).toEqual(["exit", "exit"]);
    expect(
      dataset.learningQuestions.filter(
        (q) => !isGoldenVolumeUuid(q.id as string),
      ),
    ).toHaveLength(4);
    expect(
      dataset.learningOptions.filter(
        (o) => !isGoldenVolumeUuid(o.id as string),
      ),
    ).toHaveLength(8);
    for (const q of dataset.learningQuestions) {
      const options = dataset.learningOptions.filter(
        (o) => o.questionId === q.id,
      );
      expect(options.filter((o) => o.correct).map((o) => o.text)).toEqual([
        "Верно",
      ]);
    }
  });

  it("is referentially sound, and names a dangling question", () => {
    expect(goldenReferentialIssues(dataset)).toEqual([]);
    const broken = {
      ...dataset,
      learningQuestions: [
        {
          ...dataset.learningQuestions[0]!,
          testId: goldenUuid(GOLDEN_GROUP.learningSteps, 999),
        },
      ],
    };
    expect(goldenReferentialIssues(broken)).toContain(
      `learning_questions.testId references an unknown row: ${goldenUuid(GOLDEN_GROUP.learningSteps, 999)}`,
    );
  });

  it("applies «Путь (Duolingo)» on the course from the preset row, as `applyPreset` writes the layer", () => {
    const step = buildGoldenSeedPlan(
      dataset,
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    ).find((s) => s.name === "learning_rule_layers")!;
    expect(step.conflictKeys).toEqual(["scopeKind", "scopeId"]);
    expect(step.rows.filter((r) => r.scopeId === L.course.id)).toEqual([
      expect.objectContaining({
        id: L.courseRules.id,
        scopeKind: "course",
        scopeId: L.course.id,
        values: PATH_PRESET_VALUES,
        appliedPresetId: goldenUuid(0x00fe, 1),
      }),
    ]);
  });

  it("refuses to plan without the preset row, naming it", () => {
    expect(() =>
      resolveLearningRuleLayerRows(dataset.learningRuleLayers, new Map()),
    ).toThrow(/learning_presets does not carry: Путь \(Duolingo\)/);
  });

  it("writes parents before children", () => {
    const order = [...GOLDEN_SEED_ORDER];
    const at = (name: string) => order.indexOf(name);
    expect(at("learning_schools")).toBeGreaterThan(at("directions"));
    expect(at("learning_courses")).toBe(at("learning_schools") + 1);
    expect(at("learning_options")).toBeGreaterThan(at("learning_questions"));
    expect(at("learning_rule_layers")).toBeGreaterThan(at("learning_courses"));
  });

  it("owns the download's object: the media plan carries the memo PDF the step row sizes", async () => {
    const download = dataset.learningSteps.find(
      (s) => s.id === L.steps.firstDownload.id,
    )!;
    expect(download.mediaRef).toBe(GOLDEN_COURSE_MEMO_KEY);
    const plan = await buildGoldenMediaPlan(dataset);
    const memo = plan.find((o) => o.key === GOLDEN_COURSE_MEMO_KEY)!;
    expect(memo.contentType).toBe("application/pdf");
    expect(memo.bytes.byteLength).toBe(download.mediaSizeBytes);
    expect(memo.bytes).toEqual(goldenCourseMemoPdf());
    const pdf = await PDFDocument.load(memo.bytes);
    expect(pdf.getPageCount()).toBe(1);
  }, 120_000);
});

describe("023 EARS-5 (#4017) golden schools at volume", () => {
  // The school screen past six courses (rows, «Показать ещё 10», «Найти курс»)
  // and the canvas volume switch 3 / 22 / 62 — plus 200 — on a slot, which runs
  // only `seed:golden`.
  const dataset = buildGoldenDataset(now, subjects);
  const V = golden.learning.volumeSchools;
  const coursesOf = (schoolId: string) =>
    dataset.learningCourses
      .filter((c) => c.schoolId === schoolId)
      .sort((a, b) => a.position! - b.position!);
  const lessonsOf = (courseId: string) => {
    const modules = dataset.learningModules.filter(
      (m) => m.courseId === courseId,
    );
    return {
      modules,
      lessons: dataset.learningLessons
        .filter((l) => modules.some((m) => m.id === l.moduleId))
        .sort((a, b) => a.position - b.position),
    };
  };
  const stepsOf = (lessonId: string) =>
    dataset.learningSteps
      .filter((s) => s.lessonId === lessonId)
      .sort((a, b) => a.position - b.position);

  it("publishes four schools of 3, 22, 62 and 200 published courses under their catalogue ids and slugs", () => {
    expect(V.map((s) => [s.slug, s.courseCount])).toEqual([
      ["golden-school-endocrinology", 3],
      ["golden-school-orthobiology", 22],
      ["golden-school-neurology", 62],
      ["golden-school-therapy", 200],
    ]);
    for (const school of V) {
      const row = dataset.learningSchools.find((s) => s.id === school.id);
      expect(row, school.slug).toMatchObject({
        slug: school.slug,
        state: "published",
      });
      const courses = coursesOf(school.id);
      expect(courses).toHaveLength(school.courseCount);
      expect(courses.every((c) => c.state === "published")).toBe(true);
      expect(courses.map((c) => c.position)).toEqual(
        courses.map((_, i) => i + 1),
      );
      expect(new Set(courses.map((c) => c.title)).size).toBe(courses.length);
    }
    // The golden course and its school stay as they were.
    expect(coursesOf(golden.learning.school.id).map((c) => c.slug)).toEqual([
      golden.learning.course.slug,
    ]);
    const slugs = dataset.learningCourses.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("each course is one module of 1–6 published lessons, download then video, course 6 one download", () => {
    const counts = new Set<number>();
    for (const school of V) {
      coursesOf(school.id).forEach((course, c) => {
        const { modules, lessons } = lessonsOf(course.id!);
        expect(modules, course.slug).toHaveLength(1);
        expect(lessons.length).toBeGreaterThanOrEqual(1);
        expect(lessons.length).toBeLessThanOrEqual(6);
        counts.add(lessons.length);
        expect(lessons.every((l) => l.state === "published")).toBe(true);
        for (const lesson of lessons) {
          expect(
            stepsOf(lesson.id!).map((s) => s.type),
            course.slug,
          ).toEqual(c === 5 ? ["download"] : ["download", "video"]);
        }
      });
    }
    expect([...counts].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    // No new media: every download is the golden memo.
    const keys = new Set(
      dataset.learningSteps.filter((s) => s.mediaRef).map((s) => s.mediaRef),
    );
    expect([...keys]).toEqual([GOLDEN_COURSE_MEMO_KEY]);
  });

  it("varies hours, document kinds and partners; partners are published golden organisations", () => {
    const all = V.flatMap((s) => coursesOf(s.id));
    expect(new Set(all.map((c) => c.documentKind))).toEqual(
      new Set(["certificate", "certificate-nmo"]),
    );
    expect(new Set(all.map((c) => c.academicHours)).size).toBeGreaterThan(3);
    const partnered = all.filter((c) => c.partnerOrganisationId);
    expect(partnered.length).toBeGreaterThan(10);
    const published = new Set(
      dataset.partners.filter((p) => p.status === "published").map((p) => p.id),
    );
    for (const c of partnered) {
      expect(published.has(c.partnerOrganisationId!), c.slug).toBe(true);
    }
  });

  it("no volume course title matches the school-volume live spec's no-match query «гастро»", () => {
    for (const school of V) {
      for (const c of coursesOf(school.id)) {
        expect(c.title.toLowerCase()).not.toContain("гастро");
      }
    }
  });

  it("every volume course carries an own rule layer completing a lesson on its steps, no exit test, no preset", () => {
    const rows = resolveLearningRuleLayerRows(
      dataset.learningRuleLayers,
      learningPresetByName,
    );
    for (const school of V) {
      for (const c of coursesOf(school.id)) {
        expect(
          rows.filter((r) => r.scopeId === c.id),
          c.slug,
        ).toEqual([
          expect.objectContaining({
            scopeKind: "course",
            appliedPresetId: null,
            values: {
              "test.exitRequired": false,
              "completion.lesson": { condition: "all-steps-done" },
              "completion.module": { condition: "lessons-done" },
            },
          }),
        ]);
      }
    }
  });

  it("gives the verified doctor and its worker-pool copies started and done courses on every school over six", () => {
    const doctors = golden.workerPool.verifiedCardiologist.map((d) => d.id);
    const stepToCourse = new Map<string, string>();
    for (const l of dataset.learningLessons) {
      const m = dataset.learningModules.find((x) => x.id === l.moduleId)!;
      for (const s of stepsOf(l.id!)) stepToCourse.set(s.id!, m.courseId);
    }
    // #4012 — the long paths' results are held in their own describe below.
    const schoolCourses = new Set(
      V.flatMap((school) => coursesOf(school.id).map((c) => c.id)),
    );
    const schoolFacts = dataset.learningFacts.filter((f) =>
      schoolCourses.has(stepToCourse.get(f.stepId!)),
    );
    expect(new Set(schoolFacts.map((f) => f.personId))).toEqual(
      new Set(doctors),
    );
    for (const school of V) {
      const courses = coursesOf(school.id);
      const touched = new Set(
        dataset.learningFacts
          .filter((f) =>
            courses.some((c) => c.id === stepToCourse.get(f.stepId!)),
          )
          .map((f) => stepToCourse.get(f.stepId!)),
      );
      expect(touched, school.slug).toEqual(
        school.courseCount > 6
          ? new Set([courses[2]!.id, courses[3]!.id, courses[4]!.id])
          : new Set(),
      );
    }
    for (const f of schoolFacts) {
      expect(["opened", "position"]).toContain(f.kind);
      expect(f.source).toBe("web");
      expect((f.occurredAt as Date).getTime()).toBeLessThan(now.getTime());
    }
    const keys = dataset.learningFacts.map((f) => `${f.personId}|${f.eventId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("inserts the facts once: append-only, keyed on the doctor's event id, nothing updated on a re-run", () => {
    const step = buildGoldenSeedPlan(
      dataset,
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    ).find((s) => s.name === "learning_facts")!;
    expect(step.conflictKeys).toEqual(["personId", "eventId"]);
    expect(step.updateKeys).toEqual([]);
    expect(step.rows.length).toBe(dataset.learningFacts.length);
    const order = [...GOLDEN_SEED_ORDER];
    expect(order.indexOf("learning_facts")).toBeGreaterThan(
      order.indexOf("learning_steps"),
    );
  });

  it("plans the shared memo object once", async () => {
    const plan = await buildGoldenMediaPlan(dataset);
    expect(plan.filter((o) => o.key === GOLDEN_COURSE_MEMO_KEY)).toHaveLength(
      1,
    );
  }, 120_000);

  it("names a fact whose step the dataset does not carry", () => {
    const broken = {
      ...dataset,
      learningFacts: [
        {
          ...dataset.learningFacts[0]!,
          stepId: goldenUuid(GOLDEN_GROUP.learningSteps, 999),
        },
      ],
    };
    expect(goldenReferentialIssues(broken)).toContain(
      `learning_facts.stepId references an unknown row: ${goldenUuid(GOLDEN_GROUP.learningSteps, 999)}`,
    );
  });
});

describe("#4192 golden feed at volume, as a channel looks", () => {
  const dataset = buildGoldenDataset(now, subjects);
  // What the rail reads: a card neither hidden, switched off (EARS-22) nor
  // removed in VK (EARS-45), of a platform the card contract serves — VK
  // joins the rail with its card variants (#4006).
  const visible = dataset.feedEntries.filter(
    (e) =>
      e.hiddenAt == null &&
      e.sourceOff !== true &&
      e.removedAt == null &&
      e.sourcePlatform !== "vk",
  );
  const posts = visible.filter((e) => e.kind === "post");

  it("#4192: gives the rail an extreme volume of ~200 visible cards", () => {
    expect(visible.length).toBeGreaterThanOrEqual(190);
    expect(visible.length).toBeLessThanOrEqual(220);
    // Several working channels feed it, not one.
    const sources = new Set(posts.map((e) => e.feedSourceId));
    expect(sources.size).toBeGreaterThanOrEqual(4);
  });

  it("#4192: no two visible cards share a text", () => {
    const titles = visible.map((e) => e.title as string);
    expect(titles.every((t) => t.trim().length > 0)).toBe(true);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("#4192: every Telegram source writes its own texts", () => {
    const bySource = new Map<string, Set<string>>();
    for (const e of dataset.feedEntries) {
      if (e.sourcePlatform !== "telegram") continue;
      const set = bySource.get(e.feedSourceId as string) ?? new Set<string>();
      set.add(e.title as string);
      bySource.set(e.feedSourceId as string, set);
    }
    const all = [...bySource.values()];
    for (const [i, a] of all.entries()) {
      for (const b of all.slice(i + 1)) {
        expect([...a].filter((t) => b.has(t))).toEqual([]);
      }
    }
  });

  it("#4192: a realistic share of posts carries a settled photo or video preview", () => {
    const photo = posts.filter((e) => e.imageRef && e.durationSeconds == null);
    const video = posts.filter((e) => e.imageRef && e.durationSeconds != null);
    const text = posts.filter((e) => !e.imageRef);
    expect(photo.length / posts.length).toBeGreaterThanOrEqual(0.4);
    expect(video.length / posts.length).toBeGreaterThanOrEqual(0.1);
    expect(text.length / posts.length).toBeGreaterThanOrEqual(0.2);
    for (const e of video) expect(e.durationSeconds).toBeGreaterThan(0);
    for (const e of dataset.feedEntries) {
      if (e.sourcePlatform !== "telegram") continue;
      if (e.imageRef) {
        // As `TelegramPreviewService` settles a copy: key, state, file ids.
        expect(e.imageRef).toMatch(
          new RegExp(`^feed-previews/${e.id}/[0-9a-f]{64}\\.webp$`),
        );
        expect(goldenFeedImageOfKey(e.imageRef)).not.toBeNull();
        expect(e.previewState).toBe("done");
        expect(e.previewFileId).toBeTruthy();
        expect(e.previewFileUniqueId).toBeTruthy();
        expect(e.imageUrl).toBeNull();
      } else {
        expect(e.previewState ?? null).toBeNull();
        expect(e.previewFileId ?? null).toBeNull();
      }
    }
  });

  it("#4192: some own materials carry a cover, and their card shows it", () => {
    const covered = dataset.materials.filter((m) => m.coverRef);
    expect(covered.length).toBeGreaterThanOrEqual(4);
    const uncovered = dataset.materials.filter(
      (m) => m.status === "published" && !m.coverRef,
    );
    expect(uncovered.length).toBeGreaterThan(0);
    for (const m of covered) {
      expect(m.coverRef).toMatch(
        new RegExp(`^materials/covers/${m.id}-[0-9a-f]{32}\\.webp$`),
      );
      expect(goldenFeedImageOfKey(m.coverRef as string)).not.toBeNull();
      const card = dataset.feedEntries.find((e) => e.materialId === m.id);
      if (m.status === "published") expect(card?.imageRef).toBe(m.coverRef);
    }
  });

  it("#4192: backs every feed image key with the committed bytes its hash names", async () => {
    const plan = await buildGoldenMediaPlan(dataset);
    const byKey = new Map(plan.map((o) => [o.key, o]));
    const keys = [
      ...dataset.materials.map((m) => m.coverRef),
      ...dataset.feedEntries.map((e) => e.imageRef),
    ].filter((key): key is string => Boolean(key));
    for (const key of keys) {
      const object = byKey.get(key);
      expect(object?.contentType).toBe("image/webp");
      expect(object?.refresh).toBe("if-absent");
      const image = goldenFeedImageOfKey(key)!;
      expect(createHash("sha256").update(object!.bytes).digest("hex")).toBe(
        GOLDEN_FEED_IMAGES[image],
      );
    }
  }, 120_000);

  it("#4192: keeps the #4172 card ids on their message ids, so a re-seed updates in place", () => {
    // `feed_entry_messages` reference a card id with no ON UPDATE: a persistent
    // slot's #4172 card must be met under the id it was written with.
    const news = goldenUuid(GOLDEN_GROUP.feedSources, 1000);
    const newest = dataset.feedEntries.find(
      (e) => e.sourceRef === `${news}:484`,
    );
    expect(newest?.id).toBe(goldenUuid(GOLDEN_GROUP.feedEntries, 2000));
    const album = dataset.feedEntries.find(
      (e) => e.sourceRef === `${news}:414`,
    );
    expect(album?.id).toBe(goldenUuid(GOLDEN_GROUP.feedEntries, 2010));
    expect(album?.mediaGroupId).toBeTruthy();
    const ids = dataset.feedEntries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("#4172 golden volume covers the schema", () => {
  // A slot runs only `seed:golden`, and production data never reaches staging, so
  // a table the volume half does not fill renders on a slot as one row or none —
  // the defect the retro of 2026-11-19 found three times. This walks the Drizzle
  // schema itself (never a hand list), so a PR that adds a table without volume
  // rows fails here.
  //
  // The marker of a volume row is the smallest honest one the plan already
  // carries: its `id` answers `isGoldenVolumeUuid`, or the uuid its upsert
  // conflicts on does — a table keyed by its parent instead of a surrogate id
  // (`stream_config` → event, `learning_tests` → step, `registration_attendance`
  // → registration) or by a slot of a volume parent (`project_results` → its
  // volume project, `feed_entries` → its volume material or source).
  //
  // An exemption is a table that carries no list or page data a slot could show
  // at volume. Each reason is one line; a table that gains a read surface loses
  // its exemption in the PR that ships it.
  const EXEMPT: Readonly<Record<string, string>> = {
    // Technical and audit records, not domain data.
    idempotency_keys:
      "request-dedup record (012 §6), a feature-010 technical exclusion; no screen reads it",
    media_cleanup_jobs:
      "storage-cleanup obligation leased by a worker, a feature-010 technical exclusion; no screen reads it",
    audit_ledger:
      "written by the audit trigger for every seeded row (README «audit_ledger — build bookkeeping»), never by the seed",
    sign_in_host_records:
      "one encrypted IdP session per browser cookie (003 EARS-64); a seeded row opens no session",
    presence_beats:
      "server-stamped room heartbeats; a seeded beat is stale a minute after the seed and the live count reads only fresh ones",
    // Reference books owned by migrations or the book seed: production holds
    // exactly these rows, so golden adds none.
    event_kinds: "reference book inserted by its migration (SEED_EVENT_KINDS)",
    organisation_roles:
      "reference book inserted by migration 0054 (SEED_ORGANISATION_ROLES)",
    project_output_kinds:
      "reference book inserted by migration 0055 (SEED_PROJECT_OUTPUT_KINDS)",
    specialties_minzdrav:
      "the closed Минздрав book, written by seedSpecialtiesMinzdrav before the golden seed",
    learning_presets:
      "reference book inserted by migration 0065; the plan resolves layers against it",
    points_rule_versions:
      "the 025 rule book, inserted by its migration and edited only through the rule admin",
    // Runtime in-flight state.
    telegram_update_cursor:
      "the poller's own offset per real bot id (048 EARS-24); a seeded offset would make a live bot skip or replay real updates",
    feed_vk_call_months:
      "the VK API client's own monthly call count (048 EARS-44); a seeded count would misstate the real account's budget",
    event_role_grants:
      "an authorization binding read only by the access check; no list screen ships (#2378) — the stage committee grant is the named one",
    // 025 holds: a price on a golden event changes its registration on every
    // slot (Pul and phone required), so they wait for a dedicated priced event.
    points_prices:
      "a price on a golden event changes its registration journey on every slot — #4188 adds a dedicated priced event",
    points_reserves:
      "a hold needs a priced item and a stable registration — #4188 (the priced golden event with a doctor's Pul on hold)",
    points_obligations:
      "an obligation hangs off an advance-covered hold — #4188",
    // 023 EARS-23 records with no reader in any app or package yet.
    learning_lesson_ratings:
      "023 EARS-23 rating; nothing reads it yet — seed with its first read",
    learning_feedback:
      "023 EARS-23 feedback; nothing reads it yet — seed with its first read",
  };

  const tables: PgTable[] = (Object.values(schema) as unknown[]).filter(
    (x): x is PgTable => is(x, PgTable),
  );
  const plan = buildGoldenSeedPlan(
    buildGoldenDataset(now, subjects),
    specialtyIdByName,
    learningPresetByName,
    pointsContext,
  );
  const UUID_IN_TEXT =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
  const volumeRowCount = (table: PgTable): number =>
    plan
      .filter((s) => s.table === table)
      .flatMap((s) =>
        s.rows.filter(
          (row) =>
            (typeof row.id === "string" && isGoldenVolumeUuid(row.id)) ||
            // A text key (a 025 event id) names its volume entity inside it.
            s.conflictKeys.some(
              (key) =>
                typeof row[key] === "string" &&
                ((row[key] as string).match(UUID_IN_TEXT) ?? []).some(
                  isGoldenVolumeUuid,
                ),
            ),
        ),
      ).length;

  it("finds the schema tables to check", () => {
    expect(tables.length).toBeGreaterThan(50);
  });

  it("gives every schema table volume-half rows, or an exemption with a reason", () => {
    const uncovered = tables
      .map((t) => getTableName(t))
      .filter((name) => !(name in EXEMPT))
      .filter(
        (name) =>
          volumeRowCount(tables.find((t) => getTableName(t) === name)!) === 0,
      );
    expect(
      uncovered,
      `tables without volume-half rows (golden README «The volume half»): ${uncovered.join(", ")}`,
    ).toEqual([]);
  });

  it("holds no stale exemption", () => {
    const names = new Set(tables.map((t) => getTableName(t)));
    expect(Object.keys(EXEMPT).filter((name) => !names.has(name))).toEqual([]);
    for (const [name, reason] of Object.entries(EXEMPT)) {
      expect(reason.trim(), name).not.toBe("");
    }
  });
});

describe("#4172 golden long learning paths", () => {
  // The canvas path «с десятками шагов и дюжиной модулей» on a slot: a fresh
  // doctor opens a published course of 12 and one of 30 modules.
  const dataset = buildGoldenDataset(now, subjects);
  const school = dataset.learningSchools.find(
    (s) => s.id === GOLDEN_LEARNING_PATH_SCHOOL.id,
  );

  it("publishes the long-path school in its volume half", () => {
    expect(school).toMatchObject({ state: "published" });
    expect(isGoldenVolumeUuid(GOLDEN_LEARNING_PATH_SCHOOL.id)).toBe(true);
  });

  it("gives every school its own direction and lead expert pair (learning_schools_direction_expert_key)", () => {
    const pairs = dataset.learningSchools.map(
      (s) => `${s.directionId}/${s.leadExpertId}`,
    );
    expect(pairs.length).toBe(new Set(pairs).size);
  });

  it("carries a 12-module and a 30-module published course of several lessons per module and dozens of mixed steps", () => {
    const counts = GOLDEN_LEARNING_PATH_COURSES.map((ref) => {
      const course = dataset.learningCourses.find((c) => c.id === ref.id)!;
      expect(course).toMatchObject({
        state: "published",
        schoolId: GOLDEN_LEARNING_PATH_SCHOOL.id,
      });
      const modules = dataset.learningModules.filter(
        (m) => m.courseId === ref.id,
      );
      const lessons = dataset.learningLessons.filter((l) =>
        modules.some((m) => m.id === l.moduleId),
      );
      for (const m of modules) {
        expect(
          lessons.filter((l) => l.moduleId === m.id).length,
        ).toBeGreaterThanOrEqual(2);
      }
      expect(lessons.every((l) => l.state === "published")).toBe(true);
      const steps = dataset.learningSteps.filter((s) =>
        lessons.some((l) => l.id === s.lessonId),
      );
      expect(new Set(steps.map((s) => s.type))).toEqual(
        new Set(["video", "download", "test"]),
      );
      // Every lesson closes with an exit test whose questions are rows.
      for (const l of lessons) {
        const last = steps
          .filter((s) => s.lessonId === l.id)
          .sort((a, b) => b.position - a.position)[0]!;
        expect(last.type).toBe("test");
        expect(dataset.learningTests.some((t) => t.stepId === last.id)).toBe(
          true,
        );
        expect(
          dataset.learningQuestions.filter((q) => q.testId === last.id),
        ).toHaveLength(2);
      }
      // The course carries a rule layer, so its lessons are publishable.
      expect(dataset.learningRuleLayers.some((r) => r.scopeId === ref.id)).toBe(
        true,
      );
      return [modules.length, steps.length];
    });
    expect(counts.map(([m]) => m)).toEqual([12, 30]);
    for (const [, steps] of counts) expect(steps).toBeGreaterThan(24);
  });

  it("gives a fresh doctor no fact on the long paths — only the #4012 result holders, on their passed lessons", () => {
    const pathSteps = new Set(
      dataset.learningSteps
        .filter((s) => isGoldenVolumeUuid(s.id as string))
        .map((s) => s.id),
    );
    const ids = new Set(
      dataset.learningLessons
        .filter((l) =>
          dataset.learningModules.some(
            (m) =>
              m.id === l.moduleId &&
              GOLDEN_LEARNING_PATH_COURSES.some((c) => c.id === m.courseId),
          ),
        )
        .map((l) => l.id),
    );
    const longSteps = dataset.learningSteps.filter((s) => ids.has(s.lessonId));
    expect(longSteps.length).toBeGreaterThan(0);
    const longStepIds = new Set(longSteps.map((s) => s.id));
    const allowed = new Set<string>();
    for (const plan of goldenResultPlans()) {
      const course = GOLDEN_LEARNING_PATH_COURSES[plan.course]!;
      const lessons = dataset.learningModules
        .filter((m) => m.courseId === course.id)
        .sort((a, b) => a.position - b.position)
        .flatMap((m) =>
          dataset.learningLessons
            .filter((l) => l.moduleId === m.id)
            .sort((a, b) => a.position - b.position),
        )
        .slice(0, plan.scores.length);
      for (const l of lessons)
        for (const st of dataset.learningSteps.filter(
          (x) => x.lessonId === l.id,
        ))
          allowed.add(`${plan.personId}|${st.id}`);
    }
    const onLong = dataset.learningFacts.filter(
      (f) => f.stepId != null && longStepIds.has(f.stepId),
    );
    expect(onLong.length).toBeGreaterThan(0);
    expect(
      onLong.filter((f) => !allowed.has(`${f.personId}|${f.stepId}`)),
    ).toEqual([]);
    expect(pathSteps.size).toBeGreaterThan(0);
  });
});

describe("024 EARS-24, EARS-29–31 (#4012) golden long-path results", () => {
  // A rules editor raising the pass mark on a slot needs doctors with submitted
  // results to re-judge: realistic (the worker pool, 10 lessons of the
  // 12-module path) and extreme (200 doctors on the 30-module path). The
  // evaluator agreement of the projection is held in
  // `packages/learning/src/golden-learning-results.test.ts`.
  const dataset = buildGoldenDataset(now, subjects);
  const plans = goldenResultPlans();
  const pool = golden.workerPool.verifiedCardiologist.map((d) => d.id);
  const attemptFacts = dataset.learningFacts.filter(
    (f) => f.kind === "attempt-submitted",
  );

  it("pins the volume: 6 doctors × 10 lessons on the 12-module path, 200 doctors × 2–5 lessons on the 30-module path", () => {
    const course0 = plans.filter((p) => p.course === 0);
    expect(course0.map((p) => p.personId)).toEqual(pool);
    expect(course0.every((p) => p.scores.length === 10)).toBe(true);
    expect(
      course0.every((p) => p.scores.includes(50) && p.scores.includes(100)),
    ).toBe(true);
    const course1 = plans.filter((p) => p.course === 1);
    expect(new Set(course1.map((p) => p.personId)).size).toBe(200);
    expect(
      course1.every((p) => p.scores.length >= 2 && p.scores.length <= 5),
    ).toBe(true);
    // Every 30-module doctor holds a 50 % result: a raise re-judges all 200.
    expect(course1.every((p) => p.scores.includes(50))).toBe(true);
    const lessons = plans.reduce((n, p) => n + p.scores.length, 0);
    expect(dataset.learningAttempts).toHaveLength(lessons);
    expect(attemptFacts).toHaveLength(lessons);
  });

  it("writes each attempt as `submitAttempt` does: submitted, a system fact keyed on the attempt, graded on the drawn questions", () => {
    const attempts = new Map(dataset.learningAttempts.map((a) => [a.id, a]));
    const options = new Map(dataset.learningOptions.map((o) => [o.id, o]));
    for (const f of attemptFacts) {
      const data = f.data as {
        attemptId: string;
        score: number;
        answers: { questionId: string; optionId: string }[];
      };
      const attempt = attempts.get(data.attemptId)!;
      expect(attempt.personId).toBe(f.personId);
      expect(attempt.testId).toBe(f.stepId);
      expect(attempt.submittedAt).toEqual(f.occurredAt);
      expect(f.eventId).toBe(`learning:attempt:${data.attemptId}`);
      expect(f.source).toBe("system");
      const correct = data.answers.filter(
        (a) => options.get(a.optionId)?.correct,
      ).length;
      const drawn = (attempt.questionIds as string[]).length;
      expect(Math.round((correct / drawn) * 100)).toBe(data.score);
      expect(data.score).toBeGreaterThanOrEqual(GOLDEN_LEARNING_PATH_PASS_MARK);
      expect((f.occurredAt as Date).getTime()).toBeLessThan(now.getTime());
      expect(isGoldenVolumeUuid(attempt.id as string)).toBe(true);
    }
  });

  it("the learners are verified, active, non-login mirror rows with consents and a specialty", () => {
    const ids = new Set(
      Array.from({ length: GOLDEN_LEARNERS }, (_, i) => goldenLearnerId(i)),
    );
    const users = dataset.users.filter((u) => ids.has(u.id as string));
    expect(users).toHaveLength(GOLDEN_LEARNERS);
    const logins = new Set(GOLDEN_IDP_ACCOUNTS.map((a) => a.username));
    for (const u of users) {
      expect(u).toMatchObject({
        role: "doctor_guest",
        emailVerified: true,
        recordStatus: "active",
      });
      expect(logins.has(u.email as string)).toBe(false);
      expect(isGoldenVolumeUuid(u.id as string)).toBe(true);
    }
    for (const id of ids) {
      expect(
        dataset.consentRecords.filter((c) => c.userId === id),
      ).toHaveLength(GOLDEN_CONSENT_PURPOSES.length);
      expect(
        dataset.doctorSpecialties.filter((d) => d.doctorId === id),
      ).toHaveLength(1);
    }
  });

  it("seeds the projection for every result holder, caused by its own facts, append-only", () => {
    const facts = new Map(dataset.learningFacts.map((f) => [f.id, f]));
    for (const row of dataset.learningNodeStatus) {
      expect(row.causeKind).toBe("fact");
      expect(facts.get(row.causeId!)?.personId).toBe(row.personId);
    }
    expect(
      new Set(dataset.learningNodeStatus.map((r) => r.personId)).size,
    ).toBe(200);
    const plan = buildGoldenSeedPlan(
      dataset,
      specialtyIdByName,
      learningPresetByName,
      pointsContext,
    );
    for (const name of [
      "learning_attempts",
      "learning_node_status",
      "learning_rule_changes",
    ]) {
      expect(plan.find((s) => s.name === name)!.updateKeys, name).toEqual([]);
    }
    const order = [...GOLDEN_SEED_ORDER];
    expect(order.indexOf("learning_node_status")).toBeGreaterThan(
      order.indexOf("learning_facts"),
    );
  });

  it("gives the long paths a 50 % pass mark on their own layer", () => {
    for (const course of GOLDEN_LEARNING_PATH_COURSES) {
      const layer = dataset.learningRuleLayers.find(
        (l) => l.scopeId === course.id,
      ) as { values: Record<string, unknown> };
      expect(layer.values["test.threshold"]).toBe(
        GOLDEN_LEARNING_PATH_PASS_MARK,
      );
    }
  });

  it("024 EARS-31: records the past 40 → 50 % «keep» raise on the 30-module path as the save writes it, recomputed and moving no status", () => {
    const course = GOLDEN_LEARNING_PATH_COURSES[GOLDEN_RULE_CHANGE_COURSE]!;
    expect(dataset.learningRuleChanges).toHaveLength(1);
    const change = dataset.learningRuleChanges[0]!;
    const layer = dataset.learningRuleLayers.find(
      (l) => l.scopeId === course.id,
    ) as { values: Record<string, unknown>; version?: number; updatedAt: Date };
    // `recordRuleChange`: the scope, the layer before and after, the actor.
    expect(change).toMatchObject({
      scopeKind: "course",
      scopeId: course.id,
      earnedProgress: "keep",
      actorSub: subjects.admin,
    });
    expect(isGoldenVolumeUuid(change.id as string)).toBe(true);
    expect(change.after).toEqual(layer.values);
    expect(change.before).toEqual({
      ...layer.values,
      "test.threshold": GOLDEN_RULE_CHANGE_EARLIER_PASS_MARK,
    });
    // `writeLayer` rewrote the layer in the same save.
    expect(layer.version).toBe(2);
    expect(layer.updatedAt).toEqual(change.at);
    // After every seeded result on the course, before «now», and finished.
    const results = dataset.learningAttempts.filter((a) =>
      dataset.learningSteps.some(
        (s) =>
          s.id === a.testId &&
          dataset.learningLessons.some(
            (l) =>
              l.id === s.lessonId &&
              dataset.learningModules.some(
                (m) => m.id === l.moduleId && m.courseId === course.id,
              ),
          ),
      ),
    );
    expect(results.length).toBeGreaterThan(0);
    const at = (change.at as Date).getTime();
    for (const a of results)
      expect((a.submittedAt as Date).getTime()).toBeLessThan(at);
    expect(at).toBeLessThan(now.getTime());
    expect((change.recomputedAt as Date).getTime()).toBeGreaterThan(at);
    // Every seeded score passes the earlier mark too, so «keep» kept nothing
    // and the recompute moved no status: no completion-kept fact, no status
    // naming the change. The other long path carries no change at all.
    for (const f of attemptFacts)
      expect((f.data as { score: number }).score).toBeGreaterThanOrEqual(
        GOLDEN_RULE_CHANGE_EARLIER_PASS_MARK,
      );
    expect(
      dataset.learningFacts.filter((f) => f.kind === "completion-kept"),
    ).toEqual([]);
    expect(
      dataset.learningNodeStatus.filter((r) => r.causeKind === "rule-change"),
    ).toEqual([]);
    const other = dataset.learningRuleLayers.find(
      (l) => l.scopeId === GOLDEN_LEARNING_PATH_COURSES[0]!.id,
    ) as { version?: number };
    expect(other.version ?? 1).toBe(1);
  });
});

describe("024 EARS-30 (#4012) golden courses carry their first publication", () => {
  // `first_published_at` is what tells a rules editor's change on a course
  // doctors could have reached from a course editor's free edit (EARS-30). The
  // seed runs after migration 0069's backfill, so it stamps the instant itself:
  // the real first publish, before any doctor's fact, attempt or status on the
  // course; a never-published draft stays NULL.
  const dataset = buildGoldenDataset(now, subjects);
  const moduleCourse = new Map(
    dataset.learningModules.map((m) => [m.id, m.courseId]),
  );
  const lessonCourse = new Map(
    dataset.learningLessons.map((l) => [l.id, moduleCourse.get(l.moduleId)]),
  );
  const stepCourse = new Map(
    dataset.learningSteps.map((s) => [s.id, lessonCourse.get(s.lessonId)]),
  );
  const earliest = new Map<string, number>();
  const note = (courseId: string | undefined, at: Date | null | undefined) => {
    if (!courseId || !(at instanceof Date)) return;
    const prev = earliest.get(courseId);
    if (prev === undefined || at.getTime() < prev)
      earliest.set(courseId, at.getTime());
  };
  for (const f of dataset.learningFacts)
    note(stepCourse.get(f.stepId as string), f.occurredAt);
  for (const a of dataset.learningAttempts)
    note(stepCourse.get(a.testId), a.startedAt ?? a.submittedAt);
  const courseIds = new Set(dataset.learningCourses.map((c) => c.id));
  for (const s of dataset.learningNodeStatus) {
    const courseId = courseIds.has(s.itemId)
      ? s.itemId
      : (moduleCourse.get(s.itemId) ??
        lessonCourse.get(s.itemId) ??
        stepCourse.get(s.itemId));
    note(courseId, s.since);
  }

  it("every published golden course, and every one doctors hold facts on, carries first_published_at before its earliest fact; drafts stay NULL", () => {
    expect(dataset.learningCourses.length).toBeGreaterThan(0);
    for (const c of dataset.learningCourses) {
      const once = c.state === "published" || earliest.has(c.id!);
      if (!once) {
        expect(c.firstPublishedAt ?? null, c.slug).toBeNull();
        continue;
      }
      expect(c.firstPublishedAt, c.slug).toBeInstanceOf(Date);
      const first = (c.firstPublishedAt as Date).getTime();
      expect(first, c.slug).toBeLessThan(now.getTime());
      const fact = earliest.get(c.id!);
      if (fact !== undefined) expect(first, c.slug).toBeLessThanOrEqual(fact);
    }
  });

  it("the seeded 40 → 50 % rule change post-dates the course's first publication", () => {
    expect(dataset.learningRuleChanges.length).toBeGreaterThan(0);
    for (const change of dataset.learningRuleChanges) {
      const course = dataset.learningCourses.find(
        (c) => c.id === change.scopeId,
      )!;
      expect((course.firstPublishedAt as Date).getTime()).toBeLessThan(
        (change.at as Date).getTime(),
      );
    }
  });
});

describe("#4172 golden volume congresses", () => {
  // 046 EARS-1: the doctor's congress section is the configured event with the
  // latest start (`CongressSubmissionsService.congressEventId`). The volume
  // congresses are grid эфиры anchored on the pin's Monday, so their distance
  // from «now» drifts with the pin's weekday: at every weekday and hour the named
  // `golden.events.doctorCongress` must stay the latest, and the volume upcoming
  // congress must still take submissions.
  const pins = Array.from(
    { length: 7 * 4 },
    (_, i) => new Date(Date.parse(PINNED_NOW) + i * 6 * 3_600_000),
  );

  it.each(pins.map((p) => [p.toISOString(), p] as const))(
    "keeps the named doctor congress the cabinet congress at the pin %s",
    (_label, pin) => {
      const dataset = buildGoldenDataset(pin, subjects);
      const configured = new Set(
        dataset.congressSubmissionSettings.map((s) => s.eventId),
      );
      const latest = dataset.events
        .filter((e) => configured.has(e.id!))
        .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
      expect(latest?.id).toBe(golden.events.doctorCongress.id);

      const upcoming = dataset.events.find(
        (e) => e.id === GOLDEN_VOLUME_CONGRESSES.upcoming.id,
      )!;
      for (const kind of ["oral", "poster", "abstract"] as const) {
        const intake = dataset.congressSubmissionKindSettings.find(
          (s) => s.eventId === upcoming.id && s.kind === kind,
        )!;
        expect(intake.closesAt!.getTime(), kind).toBeGreaterThan(pin.getTime());
        expect(intake.closesAt!.getTime(), kind).toBeLessThanOrEqual(
          upcoming.startsAt.getTime(),
        );
      }
    },
  );
});

describe("#4172 golden attention-points ledger", () => {
  const dataset = buildGoldenDataset(now, subjects);
  const ledger = dataset.pointsLedger;
  const stepRows = (
    plan: ReturnType<typeof buildGoldenSeedPlan>,
    name: string,
  ) => plan.find((s) => s.name === name)!.rows;
  const planAt = (at: Date, ctx: GoldenPointsContext) =>
    buildGoldenSeedPlan(
      buildGoldenDataset(at, subjects),
      specialtyIdByName,
      learningPresetByName,
      ctx,
    );
  const plan = planAt(now, pointsContext);
  const postings = stepRows(plan, "points_postings");

  /** `readPersonAccount`'s fold: Σ credits − Σ debits per (account, denomination). */
  function fold(
    rows: readonly Record<string, unknown>[],
    personId: string,
    denomination = "pul",
  ): number {
    const account = pointsContext.accountIdByRef.get(`p:${personId}`);
    if (!account) return 0;
    return rows
      .filter((p) => p.denomination === denomination)
      .reduce(
        (sum, p) =>
          sum +
          (p.creditAccountId === account ? Number(p.amount) : 0) -
          (p.debitAccountId === account ? Number(p.amount) : 0),
        0,
      );
  }

  it("the golden doctor reads a Pul balance above zero, folded as GET /v1/me/points folds it", () => {
    expect(
      fold(postings, golden.doctors.verifiedCardiologist.id),
    ).toBeGreaterThan(0);
  });

  it("spreads the balances: large on the worker pool, small on half the verified volume doctors, zero elsewhere", () => {
    const pool = golden.workerPool.verifiedCardiologist.map((d) => d.id);
    for (const id of pool) expect(fold(postings, id)).toBeGreaterThan(100);
    const volume = Array.from({ length: 8 }, (_, d) =>
      goldenUuid(GOLDEN_GROUP.users, GOLDEN_VOLUME_ORDINAL_BASE + d),
    );
    expect(volume.map((id) => fold(postings, id))).toEqual([
      20, 0, 20, 0, 20, 0, 20, 0,
    ]);
    expect(pointsContext.accountIdByRef.has(`p:${volume[1]}`)).toBe(false);
    expect(fold(postings, golden.doctors.unverified.id)).toBe(0);
  });

  it("writes every posting as the engine does: issuance → person, one accrual leg per denomination, under a cited rule", () => {
    const keys = new Map(
      stepRows(plan, "points_posting_keys").map((k) => [k.eventId, k]),
    );
    for (const p of postings) {
      expect(p.debitAccountId).toBe(ISSUANCE_ACCOUNT_ID);
      expect(p.leg).toBe(`accrual:${p.denomination}`);
      expect(Number(p.amount)).toBeGreaterThan(0);
      expect(keys.has(p.eventId as string)).toBe(true);
      expect(String(p.eventId).endsWith(`#${p.ruleId}`)).toBe(true);
      expect(GOLDEN_POINTS_RULE_IDS).toContain(p.ruleId);
      expect(+(p.occurredAt as Date)).toBeLessThanOrEqual(+now);
    }
    const postedEvents = new Set(postings.map((p) => p.eventId));
    for (const key of keys.keys()) expect(postedEvents.has(key)).toBe(true);
    const dedupe = [...keys.values()].map((k) => k.dedupeKey);
    expect(new Set(dedupe).size).toBe(dedupe.length);
  });

  it("journals every fact once with a trace the schema accepts, naming each applied rule's ledger event", () => {
    const facts = stepRows(plan, "points_facts");
    const keys = new Set(
      stepRows(plan, "points_posting_keys").map((k) => k.eventId),
    );
    expect(new Set(facts.map((f) => f.eventId)).size).toBe(facts.length);
    for (const f of facts) {
      const trace = f.trace as unknown[];
      for (const t of trace) PointsTraceEntrySchema.parse(t);
      const applied = (trace as { verdict: string; ledgerEventId?: string }[])
        .filter((t) => t.verdict === "applied")
        .map((t) => t.ledgerEventId);
      expect(applied.length).toBeGreaterThan(0);
      for (const id of applied) expect(keys.has(id!)).toBe(true);
    }
  });

  it("accrues a fact only after its holder exists", () => {
    const createdAt = new Map(dataset.users.map((u) => [u.id, u.createdAt]));
    for (const fact of ledger.facts) {
      expect(+fact.occurredAt).toBeGreaterThanOrEqual(
        +createdAt.get(fact.personId)!,
      );
    }
  });

  it("a re-seed at another pin adds nothing: the recorded ledger events are skipped, the balance stays", () => {
    const first = planAt(now, pointsContext);
    const recorded = freshPointsContext(ledger, {
      eventIds: stepRows(first, "points_posting_keys").map(
        (k) => k.eventId as string,
      ),
    });
    const later = planAt(new Date(+now + 9 * 86_400_000), recorded);
    for (const name of [
      "points_posting_keys",
      "points_facts",
      "points_postings",
    ])
      expect(stepRows(later, name), name).toEqual([]);
    const doctor = golden.doctors.verifiedCardiologist.id;
    expect(
      fold(
        [
          ...stepRows(first, "points_postings"),
          ...stepRows(later, "points_postings"),
        ],
        doctor,
      ),
    ).toBe(fold(stepRows(first, "points_postings"), doctor));
  });

  it("a fact whose dedupe key the ledger already holds is skipped whole (the engine's oncePer)", () => {
    const doctor = golden.doctors.verifiedCardiologist.id;
    const starter = ledger.facts.find(
      (f) =>
        f.personId === doctor && f.type === "person.starter-bonus-eligible",
    )!;
    const rows = resolveGoldenPointsRows(
      ledger,
      freshPointsContext(ledger, {
        dedupeKeys: [starter.applied[0]!.dedupeKey],
      }),
    );
    expect(rows.pointsPostingKeys.map((k) => k.eventId)).not.toContain(
      goldenLedgerEventId(starter, "accrual.starter-bonus"),
    );
    expect(rows.pointsFacts.map((f) => f.eventId)).not.toContain(
      starter.eventId,
    );
  });

  it("refuses a database without the issuance account or the rule book", () => {
    const ctx = freshPointsContext(ledger);
    expect(() =>
      resolveGoldenPointsRows(ledger, {
        ...ctx,
        accountIdByRef: new Map(
          [...ctx.accountIdByRef].filter(([k]) => k !== "s:issuance"),
        ),
      }),
    ).toThrow(/issuance/);
    expect(() =>
      resolveGoldenPointsRows(ledger, { ...ctx, ruleVersionById: new Map() }),
    ).toThrow(/rule book/);
  });
});

describe("#4019 golden «скоро» school", () => {
  // 023 EARS-6 / EARS-7 on a slot: a published school with no course shows
  // «Скоро» and the capture, and its admin read counts real interests.
  const dataset = buildGoldenDataset(now, subjects);
  const interests = dataset.learningSchoolInterests.filter(
    (i) => i.schoolId === GOLDEN_SOON_SCHOOL.id,
  );

  it("publishes the school with a note and no course", () => {
    expect(
      dataset.learningSchools.find((s) => s.id === GOLDEN_SOON_SCHOOL.id),
    ).toMatchObject({ state: "published", soonNote: expect.any(String) });
    expect(
      dataset.learningCourses.filter(
        (c) => c.schoolId === GOLDEN_SOON_SCHOOL.id,
      ),
    ).toEqual([]);
    expect(isGoldenVolumeUuid(GOLDEN_SOON_SCHOOL.id)).toBe(true);
  });

  it("holds the canvas volume of interests, some withdrawn, none notified", () => {
    expect(interests).toHaveLength(GOLDEN_SOON_SCHOOL_INTERESTS);
    expect(new Set(interests.map((i) => i.personId)).size).toBe(
      GOLDEN_SOON_SCHOOL_INTERESTS,
    );
    const withdrawn = interests.filter((i) => i.state === "withdrawn");
    expect(withdrawn.length).toBeGreaterThan(1);
    expect(withdrawn.every((i) => i.withdrawnAt instanceof Date)).toBe(true);
    expect(interests.every((i) => i.notifiedAt === null)).toBe(true);
  });

  it("leaves the login doctors without an interest, so a drive starts from the capture", () => {
    const pool = new Set(
      golden.workerPool.verifiedCardiologist.map((d) => d.id),
    );
    expect(interests.filter((i) => pool.has(i.personId))).toEqual([]);
  });
});
