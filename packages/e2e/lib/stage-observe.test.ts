import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ownedMirrorCount, stageMirrorQuery } from "./consent-refusal.js";
import {
  readOwnedConsentSnapshot,
  readOwnedPhoneAccountCount,
  type OwnedAuthContour,
} from "./owned-auth-observation.js";
import { readOwnedCongressSnapshot } from "./owned-congress-observation.js";
import { readPasswordPolicy } from "./password-policy.js";
import {
  STAGE_OBSERVATIONS,
  assertObservedMainOrigin,
  chooseStageObserve,
  createStageObserve,
  stageObserveTarget,
  type StageObserve,
} from "./stage-observe.js";
import { readWrongVerificationSnapshot } from "./wrong-verification-observation.js";

vi.mock("@ds/db", () => ({ createDrizzle: vi.fn() }));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  appendFile: vi.fn(),
  mkdir: vi.fn(),
}));

const OWNED = "12345678-1234-4234-8234-123456789abc";
const BASE = "https://academy-main.stage.doctor.school";
const TARGET = {
  E2E_STAGE_OBSERVE_SSH: "deploy@203.0.113.7",
  E2E_STAGE_OBSERVE_KEY: "/runner/stage-ssh/key",
  E2E_STAGE_OBSERVE_KNOWN_HOSTS: "/runner/stage-ssh/known_hosts",
};
const contour: OwnedAuthContour = {
  academyBaseUrl: BASE,
  apiBaseUrl: "",
  databaseUrl: "",
  expectedDatabase: "",
  expectedDatabaseHost: "",
  expectedDatabasePort: NaN,
};
const envelope = (rows: unknown[]) =>
  JSON.stringify({ database: "ds_main", readOnly: true, rows });

/** A fake box: the configured academy host plus one reply per observation. */
function box(replies: Partial<Record<string, string>>) {
  const capture = vi.fn();
  const observe = vi.fn<StageObserve>(async (name) => {
    if (name === "academy-host")
      return '{"academy":"academy-main.stage.doctor.school"}\n';
    const reply = replies[name];
    if (reply === undefined) throw new Error(`unexpected ${name}`);
    return reply;
  });
  return { capture, observe };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  for (const name of Object.keys(TARGET)) vi.stubEnv(name, "");
});

describe("3119: stage observe transport selection", () => {
  it("selects the operator's ssh while no E2E_STAGE_OBSERVE_* is set", () => {
    expect(stageObserveTarget({})).toBeUndefined();
    expect(chooseStageObserve(undefined, {})).toBeUndefined();
  });

  it("selects the CI observe transport when all three are set", () => {
    expect(stageObserveTarget(TARGET)).toEqual({
      destination: "deploy@203.0.113.7",
      keyFile: "/runner/stage-ssh/key",
      knownHostsFile: "/runner/stage-ssh/known_hosts",
    });
    expect(chooseStageObserve(undefined, TARGET)).toBeTypeOf("function");
  });

  it.each([
    { E2E_STAGE_OBSERVE_SSH: "deploy@203.0.113.7" },
    { ...TARGET, E2E_STAGE_OBSERVE_KEY: "relative/key" },
    { ...TARGET, E2E_STAGE_OBSERVE_SSH: "deploy@host; rm -rf /" },
  ])("refuses a partial or malformed transport %#", (env) => {
    expect(() => stageObserveTarget(env)).toThrow(/must be set together/);
  });

  it("an injected capture keeps the operator path, an injected observe wins", () => {
    const observe = vi.fn<StageObserve>();
    expect(chooseStageObserve({ capture: vi.fn() }, TARGET)).toBeUndefined();
    expect(chooseStageObserve({ capture: vi.fn(), observe }, {})).toBe(observe);
  });

  it("every client observation is on the forced command's allowlist", () => {
    const entrypoint = readFileSync(
      new URL(
        "../../../infra/deploy/bin/ds-deploy-entrypoint",
        import.meta.url,
      ),
      "utf8",
    );
    const arm = /case "\$\{words\[1\]\}" in\n([\s\S]*?)\) ;;/.exec(
      entrypoint,
    )![1]!;
    expect(
      arm
        .split(/[|\\\s]+/)
        .filter(Boolean)
        .sort(),
    ).toEqual([...STAGE_OBSERVATIONS].sort());
  });
});

describe("3119: createStageObserve", () => {
  const fakeSpawn = (code: number, stdout = "") => {
    const calls: { argv: string[]; stdin: string }[] = [];
    const spawn = vi.fn((_cmd: string, argv: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stdin: PassThrough;
      };
      child.stdout = new PassThrough();
      child.stdin = new PassThrough();
      const call = { argv, stdin: "" };
      calls.push(call);
      child.stdin.on("data", (d) => (call.stdin += d));
      child.stdin.on("finish", () => {
        child.stdout.end(stdout);
        setImmediate(() => child.emit("close", code));
      });
      return child;
    });
    return { spawn, calls };
  };

  it("sshes `observe <name>` with the CI key, pinned host keys and the params on stdin", async () => {
    const { spawn, calls } = fakeSpawn(0, "3\n");
    const observe = createStageObserve(
      stageObserveTarget(TARGET)!,
      spawn as never,
    );
    expect(await observe("mirror-count", { email: "a" })).toBe("3\n");
    expect(spawn).toHaveBeenCalledWith(
      "ssh",
      expect.any(Array),
      expect.objectContaining({ stdio: ["pipe", "pipe", "ignore"] }),
    );
    expect(calls[0]!.argv).toEqual([
      "-i",
      "/runner/stage-ssh/key",
      "-o",
      "UserKnownHostsFile=/runner/stage-ssh/known_hosts",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "deploy@203.0.113.7",
      "observe mirror-count",
    ]);
    expect(JSON.parse(calls[0]!.stdin)).toEqual({ email: "a" });
  });

  it("a refused observation fails with one fixed reason", async () => {
    const { spawn } = fakeSpawn(2, "");
    const observe = createStageObserve(
      stageObserveTarget(TARGET)!,
      spawn as never,
    );
    await expect(observe("wrong-verification", {})).rejects.toThrow(
      /^Stage observation failed$/,
    );
  });

  it("never sends a name outside the allowlist", async () => {
    const { spawn } = fakeSpawn(0);
    const observe = createStageObserve(
      stageObserveTarget(TARGET)!,
      spawn as never,
    );
    await expect(observe("drop-users" as never, {})).rejects.toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("observes the main slot only, at the configured academy host", async () => {
    const { observe } = box({});
    await expect(
      assertObservedMainOrigin(observe, BASE, "main"),
    ).resolves.toBeUndefined();
    await expect(
      assertObservedMainOrigin(
        observe,
        "https://academy-main.evil.test",
        "main",
      ),
    ).rejects.toThrow();
    await expect(
      assertObservedMainOrigin(observe, BASE, "pr-1"),
    ).rejects.toThrow();
  });
});

describe("3119: every box read of the stage suite goes through a named observation", () => {
  it("EARS-20: the owned mirror count", async () => {
    const io = box({ "mirror-count": "0\n" });
    const email = `register-2704-${OWNED}@example.test`;
    expect(
      await ownedMirrorCount(`${BASE}/`, email, stageMirrorQuery(io.observe)),
    ).toBe(0);
    expect(io.observe).toHaveBeenCalledWith("mirror-count", { email });
  });

  it("EARS-36: the password policy, read box-side without the IdP token", async () => {
    const io = box({
      "password-policy": JSON.stringify({ policy: { minLength: "8" } }),
    });
    expect(await readPasswordPolicy(BASE, { observe: io.observe })).toEqual({
      minLength: 8,
      hasUppercase: false,
      hasLowercase: false,
      hasNumber: false,
      hasSymbol: false,
    });
    expect(io.observe).toHaveBeenCalledWith("password-policy", {});
  });

  it("EARS-23: the owned consent snapshot", async () => {
    const consent = {
      profile_id: OWNED,
      email_matches: true,
      subject_matches: true,
      email_verified: true,
      phone_absent: true,
      phone_verified: false,
      display_name_absent: true,
      consent_id: "22345678-1234-4234-8234-123456789abc",
      purpose: "tos",
      version: "2026-01",
      captured_at: "2026-10-15 01:02:03.123456+00",
      origin: null,
    };
    const io = box({ "auth-consent": envelope([consent]) });
    const fixture = {
      email: `consent-2856-${OWNED}@example.test`,
      subject: "123456789012345678",
    };
    const snapshot = await readOwnedConsentSnapshot(contour, fixture, {
      observe: io.observe,
    });
    expect(snapshot.profileId).toBe(OWNED);
    expect(io.observe).toHaveBeenCalledWith("auth-consent", {
      ...fixture,
      profileId: null,
    });
    expect(io.capture).not.toHaveBeenCalled();
  });

  it("EARS-23: the owned phone account count", async () => {
    const io = box({ "phone-account-count": envelope([{ count: "0" }]) });
    const phones = ["+199900000001", "+199900000002"];
    expect(
      await readOwnedPhoneAccountCount(
        contour,
        { email: `phone-control-2857-${OWNED}@example.test`, phones },
        { observe: io.observe },
      ),
    ).toBe(0);
    expect(io.observe).toHaveBeenCalledWith("phone-account-count", { phones });
  });

  it("EARS-23/41: the owned congress snapshot", async () => {
    const row = {
      userId: OWNED,
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
          purpose: "tos",
          version: "2026-01",
          capturedAt: "2026-10-15 01:02:03.123456+00",
          origin: null,
        },
      ],
    };
    const io = box({ "congress-snapshot": envelope([row]) });
    const fixture = {
      email: `congress-registration-2927-${OWNED}@example.test`,
      displayName: "Иванова Мария",
    };
    expect(
      (
        await readOwnedCongressSnapshot(contour, fixture, {
          observe: io.observe,
        })
      ).userId,
    ).toBe(OWNED);
    expect(io.observe).toHaveBeenCalledWith("congress-snapshot", fixture);
  });

  it("EARS-41: the wrong-verification snapshot", async () => {
    const io = box({
      "wrong-verification": envelope([
        {
          users: 0,
          verified: false,
          consents: 0,
          user_digest: "a".repeat(32),
          consent_digest: "b".repeat(32),
        },
      ]),
    });
    const email = `wrong-2928-unknown-${OWNED}@example.test`;
    expect(
      (
        await readWrongVerificationSnapshot(contour, email, {
          observe: io.observe,
        })
      ).users,
    ).toBe(0);
    expect(io.observe).toHaveBeenCalledWith("wrong-verification", { email });
  });

  it("a box that answers another database fails the read", async () => {
    const io = box({
      "wrong-verification": JSON.stringify({
        database: "ds_pr_1",
        readOnly: true,
        rows: [],
      }),
    });
    await expect(
      readWrongVerificationSnapshot(
        contour,
        `wrong-2928-unknown-${OWNED}@example.test`,
        { observe: io.observe },
      ),
    ).rejects.toThrow(/observation failed/);
  });
});
