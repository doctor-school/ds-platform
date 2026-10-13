import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readOwnedConsentSnapshot,
  readOwnedUserCount,
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
}));
vi.mock("@ds/db", () => ({ createDrizzle: mocked.create }));
vi.mock("node:fs", () => ({ appendFileSync: mocked.append }));
const contour: OwnedAuthContour = {
  academyBaseUrl: "http://localhost:3001",
  apiBaseUrl: "http://localhost:3000",
  databaseUrl: "postgresql://ds:synthetic-password@localhost:5432/ds_dev_2250",
  expectedDatabase: "ds_dev_2250",
};
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
    vi.stubEnv(
      "E2E_STAND_COMMAND_LOG",
      "C:/Users/sidor/AppData/Local/Temp/stand-ops-2856.jsonl",
    );
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
    vi.stubEnv(
      "E2E_STAND_COMMAND_LOG",
      "C:/Users/sidor/AppData/Local/Temp/stand-ops-2856.jsonl",
    );
    mocked.append.mockImplementation(() => {
      throw new Error("synthetic-password");
    });
    await expect(readOwnedConsentSnapshot(contour, fixture)).rejects.toThrow(
      /^Owned auth observation failed$/,
    );
    expect(mocked.end).toHaveBeenCalledOnce();
  });
});
