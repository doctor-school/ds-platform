// #2063 — the pure core of the golden dataset, proven without a Postgres.
//
// What these lock is the property the whole staging regression contour rests on:
// the dataset is DETERMINISTIC (same pin ⇒ same bytes), REFERENTIALLY SOUND, and
// the seed REFUSES to run when the golden IdP accounts are not provisioned. The
// DB round-trip (idempotency, drift) is proven on a stand by re-running
// `seed:golden` and diffing `pg_dump --data-only`; it cannot be faked here.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";

import { RAZDEL_I_NAMES } from "../specialties-minzdrav.data.js";
import {
  buildGoldenDataset,
  GOLDEN_CONSENT_PURPOSES,
  GOLDEN_CONSENT_VERSION,
  goldenSpecialtyIssues,
} from "./dataset.js";
import { golden, GOLDEN_ACCOUNT_KEYS, goldenUuid } from "./ids.js";
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
import {
  applyGoldenStep,
  buildGoldenMediaPlan,
  buildGoldenSeedPlan,
  buildGoldenVolume,
  composeDescription,
  createInMemoryGoldenMediaStore,
  eventProgrammeKey,
  expertPhotoKey,
  GOLDEN_SEED_ORDER,
  goldenProgrammeSpecs,
  goldenReferentialIssues,
  GoldenPlanError,
  hasProgramme,
  isDatedProgrammeLine,
  isGoldenVolumeUuid,
  ordinalFromExpertPhotoKey,
  programmeLines,
  programmeTotalMinutes,
  renderProgrammePdf,
  resolveDoctorSpecialtyRows,
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

// Every dataset assertion below is deterministic, so the suite pins the instant
// explicitly rather than inheriting the run-time default.
const PINNED_NOW = "2026-01-15T12:00:00.000Z";

const now = resolveGoldenNow({ [GOLDEN_NOW_ENV_VAR]: PINNED_NOW });

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
      expect(account.subjectEnvVar).toMatch(/^DS_GOLDEN_SUB_[A-Z_]+$/);
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
    expect(JSON.stringify(again)).toBe(JSON.stringify(dataset));
  });

  it("moves every timestamp when the pin moves — nothing is hardcoded", () => {
    const shifted = buildGoldenDataset(
      resolveGoldenNow({ [GOLDEN_NOW_ENV_VAR]: "2027-01-15T12:00:00.000Z" }),
      subjects,
    );
    const before = collectTimestamps(dataset);
    const after = collectTimestamps(shifted);
    expect(after.length).toBe(before.length);
    expect(after.length).toBeGreaterThan(0);
    for (const [index, value] of after.entries()) {
      expect(value).not.toBe(before[index]);
    }
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
    };
    expect(goldenReferentialIssues(broken)).toHaveLength(1);
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
});

describe("#2063 golden seed plan", () => {
  const dataset = buildGoldenDataset(now, subjects);

  it("writes parents before children", () => {
    const plan = buildGoldenSeedPlan(dataset, specialtyIdByName);
    expect(plan.map((s) => s.name)).toEqual([...GOLDEN_SEED_ORDER]);
  });

  it("conflicts on the pinned identity of every step", () => {
    for (const step of buildGoldenSeedPlan(dataset, specialtyIdByName)) {
      expect(step.conflictKeys.length).toBeGreaterThan(0);
      for (const key of step.conflictKeys) {
        expect(step.updateKeys).not.toContain(key);
        for (const row of step.rows) expect(row[key]).toBeTruthy();
      }
    }
  });

  it("keys stream_config on its event, not on a surrogate id", () => {
    const step = buildGoldenSeedPlan(dataset, specialtyIdByName).find(
      (s) => s.name === "stream_config",
    );
    expect(step?.conflictKeys).toEqual(["eventId"]);
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
    buildGoldenSeedPlan(buildGoldenDataset(at, subjects), specialtyIdByName).find(
      (s) => s.name === "events",
    )!;

  const stepNamed = (name: string, at: Date) =>
    buildGoldenSeedPlan(buildGoldenDataset(at, subjects), specialtyIdByName).find(
      (s) => s.name === name,
    )!;

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

    const moved = new Set<string>();
    for (const [index, before] of first.entries()) {
      const after = second[index]!;
      expect(Object.keys(after)).toEqual(Object.keys(before));
      for (const key of Object.keys(before)) {
        if (JSON.stringify(after[key]) === JSON.stringify(before[key])) continue;
        expect(
          before[key] instanceof Date || key === "recordingExpectedBy",
        ).toBe(true);
        moved.add(key);
      }
    }
    expect([...moved].sort()).toEqual([
      "createdAt",
      "liveAt",
      "recordingExpectedBy",
      "startsAt",
      "updatedAt",
    ]);
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
    const plan = buildGoldenSeedPlan(dataset, specialtyIdByName);
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

  it("refuses a plan key that is not a column of the table", async () => {
    const plan = buildGoldenSeedPlan(dataset, specialtyIdByName);
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

  it("#2213: carries every entity family at volume, not one positive case", () => {
    expect(dataset.events.length).toBeGreaterThanOrEqual(48);
    expect(dataset.experts.length).toBeGreaterThanOrEqual(34);
    expect(dataset.projects.length).toBeGreaterThanOrEqual(12);
    expect(dataset.users.filter((u) => u.role === "doctor_guest").length)
      .toBeGreaterThanOrEqual(12);
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
    expect(ended.filter((e) => recordedEventIds.has(e.id as string)).length)
      .toBeGreaterThanOrEqual(14);
    expect(ended.filter((e) => !recordedEventIds.has(e.id as string)).length)
      .toBeGreaterThanOrEqual(6);
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
      const futureMonths = new Set(upcoming.map((e) => monthKey(e.startsAt as Date)));
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
      if (isGoldenVolumeUuid(id)) expertsPer.set(id, (expertsPer.get(id) ?? 0) + 1);
    }
    for (const link of dataset.eventProjects) {
      const id = link.eventId as string;
      if (isGoldenVolumeUuid(id)) projectsPer.set(id, (projectsPer.get(id) ?? 0) + 1);
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
      expect(perProject.get(project.id as string) ?? 0).toBeGreaterThanOrEqual(4);
    }
  });

  it("#2213: carries at least two doctors in each state the DB distinguishes", () => {
    const doctors = dataset.users.filter((u) => u.role === "doctor_guest");
    expect(doctors.filter((u) => u.emailVerified && u.recordStatus === "active").length)
      .toBeGreaterThanOrEqual(2);
    expect(doctors.filter((u) => !u.emailVerified && u.recordStatus === "active").length)
      .toBeGreaterThanOrEqual(2);
    expect(doctors.filter((u) => u.recordStatus === "retired").length)
      .toBeGreaterThanOrEqual(2);
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
    expect(dataset.registrations.length - past.length).toBeGreaterThanOrEqual(5);
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
      (e) => isGoldenVolumeUuid(e.id as string) && publishedFor.has(e.id as string),
    )) {
      expect(event.recordingExpectedBy).toBeUndefined();
    }

    // Both sides of the promise: a date still ahead of «now», and one already
    // missed — the overdue copy is its own rendered state.
    const dates = bare.map((e) => Date.parse(`${e.recordingExpectedBy}T00:00:00Z`));
    expect(dates.filter((d) => d > now.getTime()).length).toBeGreaterThanOrEqual(3);
    expect(dates.filter((d) => d < now.getTime()).length).toBeGreaterThanOrEqual(2);
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
    expect(isGoldenVolumeUuid(golden.doctors.verifiedCardiologist.id)).toBe(false);
    // The marker is the golden prefix, not the ordinal tail: a production uuid
    // whose last twelve hex digits exceed the base is still not a volume row.
    expect(isGoldenVolumeUuid("f81d4fae-7dec-11d0-a765-00a0c91e6bf6")).toBe(false);
    const ids = collectIds(dataset);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("#2213: keeps every publication instant out of the update set at volume", () => {
    // `taxonomy_first_published_at_set_once` (migration 0015) rolls the whole
    // seed transaction back on a re-run if a publication instant is updated —
    // and the volume half multiplies the rows that carry one.
    for (const name of ["experts", "projects", "event_recordings"]) {
      const step = buildGoldenSeedPlan(dataset, specialtyIdByName).find(
        (s) => s.name === name,
      )!;
      const published = step.rows.filter(
        (row) => row.firstPublishedAt instanceof Date,
      );
      expect(published.length).toBeGreaterThanOrEqual(2);
      expect(step.updateKeys).not.toContain("firstPublishedAt");
      expect(step.updateKeys).toContain("updatedAt");
    }
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
      expect(ordinalFromExpertPhotoKey(expert.photoRef as string)).not.toBeNull();
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
    ]);
    expect(new Set(keys)).toEqual(promised);
    for (const object of plan) {
      expect(object.bytes.byteLength).toBeGreaterThan(512);
      expect(
        object.contentType === "image/webp" ||
          object.contentType === "application/pdf",
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
    expect(new Set(VOLUME_PROGRAMME.map(([, s]) => s)).size)
      .toBeGreaterThanOrEqual(10);
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
      const index =
        Number.parseInt((event.id as string).slice(-12), 16) - 1000;
      expect(event.durationMin).toBe(programmeTotalMinutes(index));
      expect(event.durationMin as number).toBeGreaterThanOrEqual(115);
    }
  });

  it("#2213: publishes a programme everywhere the page renders one", () => {
    let withProgramme = 0;
    let upcomingWithout = 0;
    for (const event of volumeEvents) {
      const index =
        Number.parseInt((event.id as string).slice(-12), 16) - 1000;
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
    for (const speaker of first.speakers) expect(names.has(speaker.name)).toBe(true);
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

  it("#2213: writes every object once and nothing on a re-run", async () => {
    const store = createInMemoryGoldenMediaStore();
    expect(await writeGoldenMedia(store, plan)).toBe(plan.length);
    expect(store.objects.size).toBe(plan.length);
    // The template bucket is cloned per slot and re-seeded on every `slot up`;
    // a writer that re-uploaded everything would make the seed's cost grow with
    // the dataset for no gain.
    expect(await writeGoldenMedia(store, plan)).toBe(0);
    expect(store.objects.size).toBe(plan.length);
  }, 30_000);

  it("#2213: plans the same bytes for the same pin", async () => {
    const again = await buildGoldenMediaPlan(buildGoldenDataset(now, subjects));
    expect(again.map((o) => o.key)).toEqual(plan.map((o) => o.key));
    expect(again.map((o) => sha(o.bytes))).toEqual(
      plan.map((o) => sha(o.bytes)),
    );
  }, 120_000);
});

function collectIds(node: unknown, out: string[] = []): string[] {
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "id" && typeof value === "string") out.push(value);
      else collectIds(value, out);
    }
  }
  return out;
}

function collectTimestamps(node: unknown, out: string[] = []): string[] {
  if (node instanceof Date) out.push(node.toISOString());
  else if (Array.isArray(node))
    for (const item of node) collectTimestamps(item, out);
  else if (node && typeof node === "object")
    for (const value of Object.values(node)) collectTimestamps(value, out);
  return out;
}
