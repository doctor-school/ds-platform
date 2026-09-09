// #2063 — the pure core of the golden dataset, proven without a Postgres.
//
// What these lock is the property the whole staging regression contour rests on:
// the dataset is DETERMINISTIC (same pin ⇒ same bytes), REFERENTIALLY SOUND, and
// the seed REFUSES to run when the golden IdP accounts are not provisioned. The
// DB round-trip (idempotency, drift) is proven on a stand by re-running
// `seed:golden` and diffing `pg_dump --data-only`; it cannot be faked here.

import { describe, expect, it } from "vitest";

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
  GOLDEN_NOW_DEFAULT,
  GOLDEN_NOW_ENV_VAR,
  GoldenNowError,
  goldenDateOnly,
  resolveGoldenNow,
  shiftFromNow,
} from "./now.js";
import {
  applyGoldenStep,
  buildGoldenSeedPlan,
  GOLDEN_SEED_ORDER,
  goldenReferentialIssues,
  GoldenPlanError,
  resolveDoctorSpecialtyRows,
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

const now = resolveGoldenNow({});

describe("#2063 golden «now» pin", () => {
  it("defaults to the pinned instant when nothing overrides it", () => {
    expect(resolveGoldenNow({}).toISOString()).toBe(GOLDEN_NOW_DEFAULT);
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
    const again = buildGoldenDataset(resolveGoldenNow({}), subjects);
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
    expect(dataset.events.map((e) => e.state).sort()).toEqual(
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
