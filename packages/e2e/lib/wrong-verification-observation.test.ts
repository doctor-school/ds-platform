import { beforeEach, describe, expect, it, vi } from "vitest";
import { readWrongVerificationSnapshot } from "./wrong-verification-observation.js";
import type { OwnedAuthContour } from "./owned-auth-observation.js";

const mock = vi.hoisted(() => ({
  create: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  release: vi.fn(),
  append: vi.fn(),
}));
vi.mock("@ds/db", () => ({ createDrizzle: mock.create }));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  appendFileSync: mock.append,
  mkdirSync: vi.fn(),
}));
const target: OwnedAuthContour = {
  academyBaseUrl: "http://localhost:3101",
  apiBaseUrl: "http://localhost:3100",
  databaseUrl:
    "postgresql://fixture:synthetic-password@localhost:5432/ds_dev_2250",
  expectedDatabase: "ds_dev_2250",
  expectedDatabaseHost: "localhost",
  expectedDatabasePort: 5432,
};
const email =
  "wrong-verify-2928-unverified-12345678-1234-4234-8234-123456789abc@example.test";
const row = {
  users: 1,
  verified: false,
  consents: 1,
  user_digest: "a".repeat(32),
  consent_digest: "b".repeat(32),
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("E2E_STAND_COMMAND_LOG", "");
  mock.query.mockImplementation(async (sql: string) => ({
    rows: sql.startsWith("SELECT current_database")
      ? [{ database: "ds_dev_2250", read_only: true }]
      : sql.startsWith("SELECT\n")
        ? [row]
        : [],
  }));
  mock.create.mockReturnValue({
    pool: {
      connect: async () => ({ query: mock.query, release: mock.release }),
      end: mock.end,
      removeAllListeners: vi.fn(),
      on: vi.fn(),
    },
  });
});

describe("EARS-41 issue-owned read-only observations", () => {
  it.each([
    { ...target, expectedDatabase: "ds_main" },
    {
      ...target,
      databaseUrl:
        "postgresql://fixture:synthetic-password@localhost:5432/ds_dev_9999",
    },
    { ...target, academyBaseUrl: "https://academy.doctor.school" },
    { ...target, apiBaseUrl: target.academyBaseUrl },
    { ...target, expectedDatabaseHost: "api.doctor.school" },
  ])(
    "rejects a foreign or mismatched target before connecting",
    async (contour) => {
      await expect(
        readWrongVerificationSnapshot(contour, email),
      ).rejects.toThrow("Owned wrong-verification observation failed");
      expect(mock.create).not.toHaveBeenCalled();
    },
  );
  it.each([
    "somebody@example.test",
    email.replace("2928", "2856"),
    `${email}' OR true --`,
  ])("rejects unowned identities before connecting", async (identity) => {
    await expect(
      readWrongVerificationSnapshot(target, identity),
    ).rejects.toThrow("Owned wrong-verification observation failed");
    expect(mock.create).not.toHaveBeenCalled();
  });
  it("observes complete user and consent digests using parameterized read-only SQL and releases the connection", async () => {
    await expect(readWrongVerificationSnapshot(target, email)).resolves.toEqual(
      {
        users: 1,
        verified: false,
        consents: 1,
        userDigest: row.user_digest,
        consentDigest: row.consent_digest,
      },
    );
    expect(mock.query).toHaveBeenNthCalledWith(1, "BEGIN READ ONLY");
    expect(
      mock.query.mock.calls.find(([sql]) => sql.startsWith("SELECT\n"))?.[1],
    ).toEqual([email]);
    expect(mock.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(mock.release).toHaveBeenCalledOnce();
    expect(mock.end).toHaveBeenCalledOnce();
    expect(JSON.stringify(mock.append.mock.calls)).not.toContain(email);
    expect(JSON.stringify(mock.append.mock.calls)).not.toContain(
      "synthetic-password",
    );
  });
  it("fails closed before reading data if the connected database or transaction is wrong", async () => {
    mock.query.mockResolvedValue({
      rows: [{ database: "ds_dev_9999", read_only: false }],
    });
    await expect(readWrongVerificationSnapshot(target, email)).rejects.toThrow(
      "Owned wrong-verification observation failed",
    );
    expect(
      mock.query.mock.calls.some(([sql]) => sql.startsWith("SELECT\n")),
    ).toBe(false);
    expect(mock.query).toHaveBeenLastCalledWith("ROLLBACK");
  });
  it("discards credential-bearing database diagnostics and still releases resources", async () => {
    mock.query.mockRejectedValue(
      new Error(
        "postgresql://fixture:synthetic-password@localhost private rows",
      ),
    );
    await expect(readWrongVerificationSnapshot(target, email)).rejects.toThrow(
      /^Owned wrong-verification observation failed$/,
    );
    expect(mock.release).toHaveBeenCalledOnce();
    expect(mock.end).toHaveBeenCalledOnce();
    expect(JSON.stringify(mock.append.mock.calls)).not.toContain(
      "synthetic-password",
    );
  });
  it("checks the configured stage hostname and exact slot database, keeping remote reads read-only", async () => {
    const scripts: string[] = [];
    const stage = {
      ...target,
      academyBaseUrl: "https://academy-pr-2928.stage.doctor.school",
    };
    const observed = await readWrongVerificationSnapshot(stage, email, {
      capture: async (script) => {
        scripts.push(script);
        return scripts.length === 1
          ? "STAGE_BASE_DOMAIN=stage.doctor.school\n"
          : JSON.stringify({
              database: "ds_pr_2928",
              readOnly: true,
              rows: [row],
            });
      },
    });
    expect(observed.users).toBe(1);
    expect(scripts[1]).toContain("BEGIN READ ONLY");
    expect(scripts[1]).toContain("current_database()");
    expect(scripts[1]).toContain("ROLLBACK");
    expect(mock.create).not.toHaveBeenCalled();
  });
});
