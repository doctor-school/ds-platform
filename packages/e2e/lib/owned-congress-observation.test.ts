import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readOwnedCongressSnapshot,
  type CongressObservationContour,
} from "./owned-congress-observation.js";

const mocked = vi.hoisted(() => ({
  create: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
  end: vi.fn(),
  append: vi.fn(),
}));
vi.mock("@ds/db", () => ({ createDrizzle: mocked.create }));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  appendFileSync: mocked.append,
  mkdirSync: vi.fn(),
}));
const contour: CongressObservationContour = {
  academyBaseUrl: "http://localhost:3001",
  apiBaseUrl: "http://localhost:3000",
  databaseUrl: "postgresql://ds:private-fixture@localhost:5432/ds_dev_2250",
  expectedDatabase: "ds_dev_2250",
  expectedDatabaseHost: "localhost",
  expectedDatabasePort: 5432,
};
const fixture = {
  email:
    "congress-registration-2927-12345678-1234-4234-8234-123456789abc@example.test",
  displayName: "Иванова Мария",
};
const row = {
  userId: "12345678-1234-4234-8234-123456789abc",
  subject: "123456789012345678",
  emailVerified: false,
  displayNameMatches: true,
  profileFingerprint: "a".repeat(32),
  registrationCount: 1,
  createdByIntake: true,
  registrationFingerprint: "b".repeat(32),
  consents: [
    {
      id: "22345678-1234-4234-8234-123456789abc",
      purpose: "congress-personal-data",
      version: `2026-09-23.sha256-${"a".repeat(64)}`,
      capturedAt: "2026-10-15 01:02:03.123456+00",
      origin: null,
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("E2E_STAND_COMMAND_LOG", "");
  mocked.create.mockReturnValue({
    pool: {
      connect: async () => ({ query: mocked.query, release: mocked.release }),
      end: mocked.end,
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    },
  });
  mocked.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes("current_database()")
      ? [{ database: "ds_dev_2250", readOnly: true }]
      : sql.startsWith("SELECT")
        ? [row]
        : [],
  }));
});
describe("owned congress registration observation", () => {
  it.each([
    { ...fixture, email: "guest@example.org" },
    { ...fixture, email: fixture.email.replace("2927", "2928") },
    { ...fixture, email: `${fixture.email}' OR true--` },
  ])(
    "EARS-23: refuses foreign identifiers before connecting",
    async (foreign) => {
      await expect(readOwnedCongressSnapshot(contour, foreign)).rejects.toThrow(
        "Owned congress observation failed",
      );
      expect(mocked.create).not.toHaveBeenCalled();
    },
  );
  it.each([
    { expectedDatabase: "ds" },
    { expectedDatabase: "ds_main" },
    { expectedDatabaseHost: "prod.doctor.school" },
    { expectedDatabasePort: 5433 },
    { academyBaseUrl: "https://academy.doctor.school" },
    { databaseUrl: `${contour.databaseUrl}?options=unsafe` },
  ])(
    "EARS-23: refuses a mismatched or shared local target",
    async (override) => {
      await expect(
        readOwnedCongressSnapshot({ ...contour, ...override }, fixture),
      ).rejects.toThrow("Owned congress observation failed");
      expect(mocked.create).not.toHaveBeenCalled();
    },
  );
  it("EARS-23: proves actual database and read-only transaction before exact owned SELECT and closes the connection", async () => {
    expect(await readOwnedCongressSnapshot(contour, fixture)).toEqual(row);
    const queries = mocked.query.mock.calls.map(([sql]) => sql as string);
    expect(queries[0]).toBe("BEGIN READ ONLY");
    const selected = queries.find((sql) => sql.includes("FROM users u"));
    expect(selected).toContain("WHERE u.email = $1");
    expect(
      mocked.query.mock.calls.find(([sql]) => sql === selected)?.[1],
    ).toEqual([fixture.email, fixture.displayName]);
    expect(queries.at(-1)).toBe("ROLLBACK");
    expect(mocked.release).toHaveBeenCalledOnce();
    expect(mocked.end).toHaveBeenCalledOnce();
    const ledger = mocked.append.mock.calls.map(([, line]) => JSON.parse(line));
    expect(ledger.map((entry) => entry.status)).toEqual([
      "started",
      "completed",
    ]);
    expect(ledger[0].id).toBe(ledger[1].id);
    expect(JSON.stringify(ledger)).not.toMatch(
      /private-fixture|example.test|Иванова|SELECT/,
    );
  });
  it.each([
    { database: "ds", readOnly: true },
    { database: "ds_dev_2250", readOnly: false },
  ])(
    "EARS-23: wrong actual database or writable transaction prevents private SELECT",
    async (actual) => {
      mocked.query.mockImplementation(async (sql: string) => ({
        rows: sql.includes("current_database()") ? [actual] : [],
      }));
      await expect(readOwnedCongressSnapshot(contour, fixture)).rejects.toThrow(
        "Owned congress observation failed",
      );
      expect(
        mocked.query.mock.calls.some(([sql]) => sql.includes("FROM users u")),
      ).toBe(false);
      expect(mocked.release).toHaveBeenCalledOnce();
    },
  );
  it.each([
    { rows: [] },
    { rows: [row, row] },
    { rows: [{ ...row, registrationCount: 0 }] },
    {
      rows: [
        { ...row, consents: [{ ...row.consents[0], purpose: "unexpected" }] },
      ],
    },
    {
      rows: [
        { ...row, consents: [{ ...row.consents[0], version: "2026-01" }] },
      ],
    },
    {
      rows: [
        {
          ...row,
          consents: [
            {
              ...row.consents[0],
              purpose: "tos",
              version: row.consents[0]!.version,
            },
          ],
        },
      ],
    },
  ])(
    "EARS-23: fails closed on invalid cardinality and consent projection",
    async ({ rows }) => {
      mocked.query.mockImplementation(async (sql: string) => ({
        rows: sql.includes("current_database()")
          ? [{ database: "ds_dev_2250", readOnly: true }]
          : sql.startsWith("SELECT")
            ? rows
            : [],
      }));
      await expect(readOwnedCongressSnapshot(contour, fixture)).rejects.toThrow(
        "Owned congress observation failed",
      );
    },
  );
  it("EARS-23: reuses canonical stage transport with configured hostname and guarded read-only slot query", async () => {
    const capture = vi.fn(async (script: string) =>
      script.includes("ON_ERROR_STOP=1")
        ? JSON.stringify({
            database: "ds_pr_2927",
            readOnly: true,
            rows: [row],
          })
        : "STAGE_BASE_DOMAIN=stage.doctor.school\nPRIVATE_VALUE=never-log",
    );
    expect(
      await readOwnedCongressSnapshot(
        {
          ...contour,
          academyBaseUrl: "https://academy-pr-2927.stage.doctor.school",
          apiBaseUrl: "",
          databaseUrl: "",
          expectedDatabase: "",
          expectedDatabaseHost: "",
          expectedDatabasePort: NaN,
        },
        fixture,
        { capture },
      ),
    ).toEqual(row);
    expect(capture).toHaveBeenCalledTimes(2);
    const sql = capture.mock.calls[1]![0];
    expect(sql).toContain("BEGIN READ ONLY");
    expect(sql).toContain("transaction_read_only");
    expect(sql).toContain("current_database()");
    expect(sql).toContain("ds_pr_2927");
    expect(sql).toContain("ROLLBACK");
    expect(mocked.create).not.toHaveBeenCalled();
    expect(JSON.stringify(mocked.append.mock.calls)).not.toMatch(
      /never-log|example.test|SELECT/,
    );
  });
  it("EARS-23: refuses a foreign stage hostname before the data query", async () => {
    const capture = vi.fn(async () => "STAGE_BASE_DOMAIN=stage.doctor.school");
    await expect(
      readOwnedCongressSnapshot(
        { ...contour, academyBaseUrl: "https://academy-main.foreign.test" },
        fixture,
        { capture },
      ),
    ).rejects.toThrow("Owned congress observation failed");
    expect(capture).toHaveBeenCalledOnce();
  });
});
