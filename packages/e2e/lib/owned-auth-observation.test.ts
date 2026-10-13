import { beforeEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readOwnedConsentSnapshot,
  readOwnedUserCount,
  readOwnedPhoneAccountCount,
  type OwnedAuthContour,
} from "./owned-auth-observation.js";

const mocked = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  end: vi.fn(),
  connect: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  on: vi.fn(),
  append: vi.fn(),
  mkdir: vi.fn(),
}));
vi.mock("@ds/db", () => ({ createDrizzle: mocked.create }));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  appendFileSync: mocked.append,
  mkdirSync: mocked.mkdir,
}));
const contour: OwnedAuthContour = {
  academyBaseUrl: "http://localhost:3001",
  apiBaseUrl: "http://localhost:3000",
  databaseUrl: "postgresql://ds:synthetic-password@localhost:5432/ds_dev_2250",
  expectedDatabase: "ds_dev_2250",
  expectedDatabaseHost: "localhost",
  expectedDatabasePort: 5432,
};
const commandLog = join(tmpdir(), "stand-ops-2856.jsonl");
const fixture = {
  email: "consent-2856-12345678-1234-4234-8234-123456789abc@example.test",
  subject: "123456789012345678",
  profileId: "abcdef12-1234-4234-8234-123456789abc",
};
const consentRow = {
  profile_id: fixture.profileId,
  email_matches: true,
  subject_matches: true,
  email_verified: true,
  phone_absent: true,
  phone_verified: false,
  display_name_absent: true,
  consent_id: "11223344-1234-4234-8234-123456789abc",
  purpose: "tos",
  version: "2026-01",
  captured_at: "2026-10-13 01:45:09.123456+00",
  origin: null,
};
function rows(value: unknown[]) {
  mocked.query.mockImplementation(async (query: string) => ({
    rows: query.includes("current_database")
      ? [{ database: "ds_dev_2250" }]
      : query.startsWith("SELECT")
        ? value
        : [],
  }));
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("E2E_STAND_COMMAND_LOG", "");
  mocked.connect.mockResolvedValue({
    query: mocked.query,
    release: mocked.release,
  });
  mocked.end.mockResolvedValue(undefined);
  mocked.create.mockReturnValue({
    pool: {
      connect: mocked.connect,
      end: mocked.end,
      removeAllListeners: mocked.remove,
      on: mocked.on,
    },
  });
  rows([consentRow]);
});

describe("canonical stage consent observation", () => {
  const stageContour = (slot = "main"): OwnedAuthContour => ({
    ...contour,
    academyBaseUrl: `https://academy-${slot}.stage.doctor.school`,
    apiBaseUrl: "",
    databaseUrl: "",
    expectedDatabase: "",
    expectedDatabaseHost: "",
    expectedDatabasePort: NaN,
  });
  const stageEffects = (
    slot = "main",
    envelope: unknown = {
      database: slot === "main" ? "ds_main" : `ds_${slot.replace("-", "_")}`,
      readOnly: true,
      rows: [consentRow],
    },
  ) => ({
    capture: vi.fn(async (script: string) =>
      script.includes("ON_ERROR_STOP=1")
        ? JSON.stringify(envelope)
        : "STAGE_BASE_DOMAIN=stage.doctor.school\nSYNTHETIC_SECRET=never-log-this",
    ),
  });
  it.each(["main", "pr-2872"])(
    "EARS-23: accepts canonical %s without local DB/API variables and returns the same typed owned projection",
    async (slot) => {
      const effects = stageEffects(slot);
      const snapshot = await readOwnedConsentSnapshot(
        stageContour(slot),
        fixture,
        effects,
      );
      expect(snapshot.consentId).toBe(consentRow.consent_id);
      expect(snapshot.capturedAt).toBe(consentRow.captured_at);
      expect(effects.capture).toHaveBeenCalledTimes(2);
      const sql = effects.capture.mock.calls[1]![0];
      expect(sql).toContain("BEGIN READ ONLY");
      expect(sql).toContain("statement_timeout");
      expect(sql).toContain("ON_ERROR_STOP=1");
      expect(sql).toContain("current_database()");
      expect(sql).toContain("transaction_read_only");
      expect(sql).toContain("ROLLBACK");
      expect(sql).toContain(`ds_${slot.replace("-", "_")}`);
      expect(/SELECT \*|INSERT|UPDATE|DELETE|DROP/i.test(sql)).toBe(false);
      expect(mocked.create).not.toHaveBeenCalled();
      const ledger = mocked.append.mock.calls.map((call) =>
        JSON.parse(call[1]),
      );
      expect(ledger.length).toBeGreaterThan(0);
      expect(JSON.stringify(ledger)).not.toMatch(
        /never-log-this|example\.test|123456789012345678|SELECT|synthetic-password/,
      );
    },
  );
  it("EARS-23: refuses a hostname mismatched with actual Stage topology before the private query", async () => {
    const effects = stageEffects();
    await expect(
      readOwnedConsentSnapshot(
        {
          ...stageContour(),
          academyBaseUrl: "https://academy-main.foreign.test",
        },
        fixture,
        effects,
      ),
    ).rejects.toThrow(/^Owned auth observation failed$/);
    expect(effects.capture).toHaveBeenCalledOnce();
  });
  it.each([
    { database: "ds", readOnly: true, rows: [consentRow] },
    { database: "ds_pr_999", readOnly: true, rows: [consentRow] },
    { database: "ds_main", readOnly: false, rows: [consentRow] },
    { database: "ds_main", readOnly: "on", rows: [consentRow] },
    { database: "ds_main", readOnly: true, rows: [consentRow, consentRow] },
    {
      database: "ds_main",
      readOnly: true,
      rows: [{ ...consentRow, version: "secret@example.test" }],
    },
    {
      database: "ds_main",
      readOnly: true,
      rows: [consentRow],
      secret: "never-log-this",
    },
    null,
  ])(
    "EARS-23: rejects wrong DB, non-read-only or malformed Stage projections without retaining them %#",
    async (envelope) => {
      const effects = stageEffects("main", envelope);
      await expect(
        readOwnedConsentSnapshot(stageContour(), fixture, effects),
      ).rejects.toThrow(/^Owned auth observation failed$/);
    },
  );
  it("EARS-23: missing Stage SSH access fails hard with redacted diagnostics", async () => {
    const effects = {
      capture: vi
        .fn()
        .mockRejectedValue(new Error("synthetic-password secret@example.test")),
    };
    await expect(
      readOwnedConsentSnapshot(stageContour(), fixture, effects),
    ).rejects.toThrow(/^Owned auth observation failed$/);
    expect(effects.capture).toHaveBeenCalledOnce();
  });
  it("EARS-23: an unsafe owned fixture is rejected before any Stage access", async () => {
    const effects = stageEffects();
    await expect(
      readOwnedConsentSnapshot(
        stageContour(),
        { ...fixture, email: "owner@example.org" },
        effects,
      ),
    ).rejects.toThrow("Invalid owned auth observation fixture");
    expect(effects.capture).not.toHaveBeenCalled();
  });
  it("EARS-23: Stage fixture binding cannot change while topology is awaited", async () => {
    const mutable = { ...fixture };
    const effects = stageEffects();
    effects.capture.mockImplementation(async (script: string) => {
      if (!script.includes("ON_ERROR_STOP=1")) {
        mutable.email = "owner@example.org";
        return "STAGE_BASE_DOMAIN=stage.doctor.school";
      }
      return JSON.stringify({
        database: "ds_main",
        readOnly: true,
        rows: [consentRow],
      });
    });
    await readOwnedConsentSnapshot(stageContour(), mutable, effects);
    expect(effects.capture.mock.calls[1]![0]).toContain(fixture.email);
    expect(effects.capture.mock.calls[1]![0]).not.toContain(mutable.email);
  });
  it("EARS-2: a global Stage users count is refused before any SQL or pool", async () => {
    await expect(
      readOwnedUserCount(stageContour(), { email: fixture.email }),
    ).rejects.toThrow("Invalid owned auth observation target");
    expect(mocked.create).not.toHaveBeenCalled();
  });
});

describe("owned submitted-phone account absence", () => {
  const phoneFixture = {
    email:
      "phone-control-2857-12345678-1234-4234-8234-123456789abc@example.test",
    phones: ["+199912345678", "+199987654321"] as [string, string],
  };
  it("EARS-2: local reads count only the two actual submitted phones without filtering the control email", async () => {
    rows([{ count: "0" }]);
    expect(await readOwnedPhoneAccountCount(contour, phoneFixture)).toBe(0);
    expect(
      mocked.query.mock.calls.find(([sql]) => sql.includes("WHERE phone"))?.[1],
    ).toEqual([phoneFixture.phones]);
    expect(
      mocked.query.mock.calls.some(([sql]) => sql.includes("WHERE email")),
    ).toBe(false);
  });
  it("EARS-2: shared Stage reads only the submitted owned phone identifiers with actual topology guards", async () => {
    const stage = {
      ...contour,
      academyBaseUrl: "https://academy-main.stage.doctor.school",
      apiBaseUrl: "",
      databaseUrl: "",
    };
    const effects = {
      capture: vi.fn(async (script: string) =>
        script.includes("ON_ERROR_STOP=1")
          ? JSON.stringify({
              database: "ds_main",
              readOnly: true,
              rows: [{ count: "0" }],
            })
          : "STAGE_BASE_DOMAIN=stage.doctor.school",
      ),
    };
    expect(await readOwnedPhoneAccountCount(stage, phoneFixture, effects)).toBe(
      0,
    );
    const script = effects.capture.mock.calls[1]![0];
    expect(script).toContain("WHERE phone IN");
    expect(script).toContain(phoneFixture.phones[0]);
    expect(script).toContain(phoneFixture.phones[1]);
    expect(script).not.toContain(phoneFixture.email);
  });
  it("EARS-2: submitted phone bindings cannot change during the Stage topology await", async () => {
    const mutable = { ...phoneFixture, phones: [...phoneFixture.phones] };
    const effects = {
      capture: vi.fn(async (script: string) => {
        if (!script.includes("ON_ERROR_STOP=1")) {
          mutable.phones[0] = "+79991234567";
          return "STAGE_BASE_DOMAIN=stage.doctor.school";
        }
        return JSON.stringify({
          database: "ds_main",
          readOnly: true,
          rows: [{ count: "0" }],
        });
      }),
    };
    await readOwnedPhoneAccountCount(
      {
        ...contour,
        academyBaseUrl: "https://academy-main.stage.doctor.school",
      },
      mutable,
      effects,
    );
    expect(effects.capture.mock.calls[1]![0]).toContain(phoneFixture.phones[0]);
    expect(effects.capture.mock.calls[1]![0]).not.toContain(mutable.phones[0]);
  });
  it.each([
    { ...phoneFixture, email: fixture.email },
    { ...phoneFixture, phones: [] },
    {
      ...phoneFixture,
      phones: [phoneFixture.phones[0], phoneFixture.phones[0]],
    },
    { ...phoneFixture, phones: ["+79991234567", phoneFixture.phones[1]] },
    { ...phoneFixture, phones: ["+1999' OR true--", phoneFixture.phones[1]] },
  ])(
    "EARS-2: unsafe or unbound phone fixtures fail before any local pool or Stage access %#",
    async (bad) => {
      rows([{ count: "0" }]);
      const effects = { capture: vi.fn() };
      for (const target of [
        contour,
        {
          ...contour,
          academyBaseUrl: "https://academy-main.stage.doctor.school",
        },
      ])
        await expect(
          readOwnedPhoneAccountCount(target, bad, effects),
        ).rejects.toThrow("Invalid owned phone observation fixture");
      expect(mocked.create).not.toHaveBeenCalled();
      expect(effects.capture).not.toHaveBeenCalled();
    },
  );
  it.each(
    [
      [],
      [{ count: "0" }, { count: "0" }],
      [{ count: "-1" }],
      [{ count: 0 }],
      [{ count: "0", secret: "synthetic-password" }],
    ].map((resultRows) => ({ resultRows })),
  )(
    "EARS-2: malformed Stage phone-count projections cannot credit account absence %#",
    async ({ resultRows }) => {
      const stage = {
        ...contour,
        academyBaseUrl: "https://academy-main.stage.doctor.school",
      };
      const effects = {
        capture: vi.fn(async (script: string) =>
          script.includes("ON_ERROR_STOP=1")
            ? JSON.stringify({
                database: "ds_main",
                readOnly: true,
                rows: resultRows,
              })
            : "STAGE_BASE_DOMAIN=stage.doctor.school",
        ),
      };
      await expect(
        readOwnedPhoneAccountCount(stage, phoneFixture, effects),
      ).rejects.toThrow(/^Owned auth observation failed$/);
    },
  );
});
describe("owned auth observation", () => {
  it("EARS-23: reads only the exact owned consent binding and retains timestamp precision", async () => {
    const snapshot = await readOwnedConsentSnapshot(contour, fixture);
    expect(snapshot).toEqual({
      profileId: fixture.profileId,
      emailMatches: true,
      subjectMatches: true,
      emailVerified: true,
      phoneAbsent: true,
      phoneVerified: false,
      displayNameAbsent: true,
      consentCount: 1,
      consentId: consentRow.consent_id,
      purpose: "tos",
      version: "2026-01",
      capturedAt: consentRow.captured_at,
      origin: null,
    });
    expect(
      mocked.query.mock.calls.some(([sql]) => sql === "BEGIN READ ONLY"),
    ).toBe(true);
    expect(
      mocked.query.mock.calls.find(([sql]) =>
        sql.includes("consent_records"),
      )?.[1],
    ).toEqual([fixture.email, fixture.subject, fixture.profileId]);
    expect(mocked.release).toHaveBeenCalledOnce();
    expect(mocked.end).toHaveBeenCalledOnce();
  });
  it.each([
    { expectedDatabase: "ds" },
    { expectedDatabase: "ds_prod" },
    { databaseUrl: "postgresql://ds:secret@localhost:5432/ds_dev_2857" },
    { databaseUrl: "postgresql://ds:secret@remote.invalid:5432/ds_dev_2250" },
    { academyBaseUrl: "https://academy.doctor.school" },
    { apiBaseUrl: "http://127.0.0.1:3000" },
    { apiBaseUrl: "http://localhost:3001" },
    { expectedDatabaseHost: "foreign.local" },
    { expectedDatabasePort: 5433 },
    {
      academyBaseUrl: "http://127.1:3001",
      apiBaseUrl: "http://127.1:3000",
      databaseUrl: "postgresql://ds:secret@127.0.0.1:5432/ds_dev_2250",
      expectedDatabaseHost: "127.0.0.1",
    },
  ])(
    "EARS-23: rejects unsafe or mismatched DB/contours before opening a pool %#",
    async (patch) => {
      await expect(
        readOwnedConsentSnapshot({ ...contour, ...patch }, fixture),
      ).rejects.toThrow("Invalid owned auth observation target");
      expect(mocked.create).not.toHaveBeenCalled();
    },
  );
  it.each([
    { email: "golden@example.test" },
    { email: fixture.email.toUpperCase() },
    {
      email:
        "consent-2856-12345678-1234-4234-8234-123456789abc@example.test' OR true--",
    },
    { profileId: "secret" },
    { subject: undefined },
  ])(
    "EARS-23: refuses an unowned or malformed fixture before any select %#",
    async (patch) => {
      await expect(
        readOwnedConsentSnapshot(contour, { ...fixture, ...patch }),
      ).rejects.toThrow("Invalid owned auth observation fixture");
      expect(mocked.create).not.toHaveBeenCalled();
    },
  );
  it("EARS-23: verifies the actual database before the data select", async () => {
    mocked.query.mockResolvedValue({ rows: [{ database: "ds" }] });
    await expect(readOwnedConsentSnapshot(contour, fixture)).rejects.toThrow(
      "Owned auth observation failed",
    );
    expect(
      mocked.query.mock.calls.some(([sql]) => sql.includes("consent_records")),
    ).toBe(false);
    expect(mocked.end).toHaveBeenCalledOnce();
  });
  it.each(
    [
      [],
      [consentRow, consentRow],
      [{ ...consentRow, version: "secret@example.org" }],
      [{ ...consentRow, captured_at: "not-a-timestamp" }],
      [{ ...consentRow, captured_at: "2026-02-30 01:45:09+00" }],
      [{ ...consentRow, captured_at: "0000-01-01 01:45:09+00" }],
      [{ ...consentRow, profile_id: "00000000-1234-4234-8234-123456789abc" }],
      [{ ...consentRow, email_matches: false }],
      [{ ...consentRow, email_verified: "true" }],
      [{ ...consentRow, origin: "paper" }],
      [{ ...consentRow, token: "synthetic-token" }],
    ].map((value) => ({ value })),
  )(
    "EARS-23: malformed, foreign or duplicate consent results fail closed %#",
    async ({ value }) => {
      rows(value);
      await expect(readOwnedConsentSnapshot(contour, fixture)).rejects.toThrow(
        "Owned auth observation failed",
      );
    },
  );
  it("EARS-2: counts all users in the isolated branch, without filtering by the owned control email", async () => {
    rows([{ count: "42" }]);
    expect(await readOwnedUserCount(contour, { email: fixture.email })).toBe(
      42,
    );
    expect(
      mocked.query.mock.calls.find(([sql]) => sql.includes("count(*)")),
    ).toEqual(["SELECT count(*)::text AS count FROM users"]);
  });
  it("EARS-23: accepts the trusted remote dev-stand recipe target while the Academy/API stay local", async () => {
    const actual = {
      ...contour,
      databaseUrl:
        "postgresql://ds:synthetic-password@truenas.local:5432/ds_dev_2250",
      expectedDatabaseHost: "truenas.local",
      expectedDatabasePort: 5432,
    };
    expect((await readOwnedConsentSnapshot(actual, fixture)).consentCount).toBe(
      1,
    );
    expect(mocked.create).toHaveBeenCalledWith(actual.databaseUrl, {
      max: 1,
      statement_timeout: 5000,
    });
  });
  it.each(
    [
      [],
      [{ count: "0" }, { count: "1" }],
      [{ count: "-1" }],
      [{ count: "1.5" }],
      [{ count: "9007199254740992" }],
      [{ count: "1", email: "secret@example.org" }],
    ].map((value) => ({ value })),
  )(
    "EARS-2: malformed total-user counts cannot credit absence %#",
    async ({ value }) => {
      rows(value);
      await expect(
        readOwnedUserCount(contour, { email: fixture.email }),
      ).rejects.toThrow("Owned auth observation failed");
    },
  );
  it.each(["connect", "query", "rollback", "close"])(
    "EARS-23: redacts %s failures and still closes the owned pool",
    async (failure) => {
      const secret = new Error(
        "synthetic-password secret@example.org synthetic-token",
      );
      if (failure === "connect") mocked.connect.mockRejectedValue(secret);
      if (failure === "query") mocked.query.mockRejectedValue(secret);
      if (failure === "rollback")
        mocked.query.mockImplementation(async (sql: string) => {
          if (sql === "ROLLBACK") throw secret;
          return {
            rows: sql.includes("current_database")
              ? [{ database: "ds_dev_2250" }]
              : [consentRow],
          };
        });
      if (failure === "close") mocked.end.mockRejectedValue(secret);
      await expect(readOwnedConsentSnapshot(contour, fixture)).rejects.toThrow(
        /^Owned auth observation failed$/,
      );
      expect(mocked.end).toHaveBeenCalledOnce();
    },
  );
  it("EARS-23: records only safe completion metadata with no invented native SQL exit", async () => {
    vi.stubEnv("E2E_STAND_COMMAND_LOG", commandLog);
    await readOwnedConsentSnapshot(contour, fixture);
    expect(mocked.append).toHaveBeenCalledOnce();
    const record = JSON.parse(mocked.append.mock.calls[0]![1]);
    expect(record).toEqual({
      at: expect.any(String),
      operation: "owned-consent-read",
      database: "ds_dev_2250",
      readOnly: true,
      nativeExit: null,
      ok: true,
    });
    expect(Object.keys(record).sort()).toEqual([
      "at",
      "database",
      "nativeExit",
      "ok",
      "operation",
      "readOnly",
    ]);
  });
  it("EARS-23: a failed ledger write fails closed without leaking its error", async () => {
    vi.stubEnv("E2E_STAND_COMMAND_LOG", commandLog);
    mocked.append.mockImplementation(() => {
      throw new Error("synthetic-password");
    });
    await expect(readOwnedConsentSnapshot(contour, fixture)).rejects.toThrow(
      /^Owned auth observation failed$/,
    );
    expect(mocked.end).toHaveBeenCalledOnce();
  });
});
