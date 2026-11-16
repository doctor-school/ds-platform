// Issue #4068: the data-box secret rotation's workstation and runner sides
// (tools/deploy/data-secret.mjs; spec §5 «Data-prod verbs.» → secret-apply).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  certFingerprint,
  encryptSecret,
  parseSecretLines,
  rotationVerdict,
  SECRET_KEYS,
  SecretError,
  secretPlaintext,
} from "./data-secret.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const opensslPresent = spawnSync("openssl", ["version"]).status === 0;

describe("4068: parseSecretLines", () => {
  it("takes NAME=value lines of the allowlist, skipping blanks and comments", () => {
    assert.deepEqual(
      parseSecretLines(
        "# new key\r\nPGBACKREST_REPO1_S3_KEY=ABCDEFGH1234\n\nPGBACKREST_REPO1_S3_KEY_SECRET=a/b+c=d_e.f-g\n",
      ),
      {
        PGBACKREST_REPO1_S3_KEY: "ABCDEFGH1234",
        PGBACKREST_REPO1_S3_KEY_SECRET: "a/b+c=d_e.f-g",
      },
    );
  });

  it("refuses an off-list name, a repeat, a bad value or no line — naming the name, never the value", () => {
    const cases = [
      ["PGBACKREST_REPO1_CIPHER_PASS=abcdefgh123", /line 1: not NAME=value/],
      [
        "PGBACKREST_REPO1_S3_KEY=ABCDEFGH1234\nPGBACKREST_REPO1_S3_KEY=ABCDEFGH1235",
        /line 2: PGBACKREST_REPO1_S3_KEY is given twice/,
      ],
      [
        "PGBACKREST_REPO1_S3_KEY=short",
        /line 1: the value of PGBACKREST_REPO1_S3_KEY is not/,
      ],
      ["PGBACKREST_REPO1_S3_KEY=has space inside", /is not 8-256/],
      ["\n# only a comment\n", /no NAME=value line/],
    ];
    for (const [text, reason] of cases) {
      assert.throws(
        () => parseSecretLines(text),
        (err) =>
          err instanceof SecretError &&
          reason.test(err.message) &&
          !/ABCDEFGH|short|space inside/.test(err.message),
      );
    }
  });

  it("the allowlist is the pgBackRest S3 key pair", () => {
    assert.deepEqual(
      [...SECRET_KEYS],
      ["PGBACKREST_REPO1_S3_KEY", "PGBACKREST_REPO1_S3_KEY_SECRET"],
    );
  });
});

it("4068: secretPlaintext carries the schema, a second-precision UTC stamp and the values", () => {
  assert.equal(
    secretPlaintext(
      { PGBACKREST_REPO1_S3_KEY: "ABCDEFGH1234" },
      new Date("2026-11-16T10:20:30.456Z"),
    ),
    '{"schema":1,"createdAt":"2026-11-16T10:20:30Z","values":{"PGBACKREST_REPO1_S3_KEY":"ABCDEFGH1234"}}',
  );
});

describe(
  "4068: encryptSecret",
  { skip: !opensslPresent && "needs openssl" },
  () => {
    it("encrypts to the certificate (only its key decrypts it) and fingerprints it as openssl does", () => {
      const dir = mkdtempSync(join(tmpdir(), "ds-data-secret-"));
      try {
        const key = join(dir, "k.pem");
        const cert = join(dir, "c.pem");
        const made = spawnSync(
          "openssl",
          [
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            key,
            "-out",
            cert,
            "-subj",
            "/CN=t",
            "-days",
            "1",
          ],
          { encoding: "utf8" },
        );
        assert.equal(made.status, 0, made.stderr);
        const plain = secretPlaintext({
          PGBACKREST_REPO1_S3_KEY: "ABCDEFGH1234",
        });
        const b64 = encryptSecret(plain, cert);
        assert.match(b64, /^[A-Za-z0-9+/]+={0,2}$/);
        assert.ok(
          !Buffer.from(b64, "base64")
            .toString("latin1")
            .includes("ABCDEFGH1234"),
        );
        const dec = spawnSync(
          "openssl",
          [
            "cms",
            "-decrypt",
            "-binary",
            "-inform",
            "DER",
            "-inkey",
            key,
            "-recip",
            cert,
          ],
          { input: Buffer.from(b64, "base64") },
        );
        assert.equal(dec.status, 0, String(dec.stderr));
        assert.equal(String(dec.stdout), plain);
        const fp = spawnSync(
          "openssl",
          ["x509", "-in", cert, "-noout", "-fingerprint", "-sha256"],
          { encoding: "utf8" },
        );
        assert.equal(
          certFingerprint(readFileSync(cert, "utf8")),
          fp.stdout.trim().split("=")[1],
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("refuses without the committed certificate, pointing at the bootstrap step", () => {
      assert.throws(
        () => encryptSecret("{}", join(tmpdir(), "no-such-recipient.pem")),
        /bootstrap it first/,
      );
    });
  },
);

describe("4068: rotationVerdict", () => {
  const status = (steps, { sha = SHA, unitAlive = null } = {}) =>
    JSON.stringify({
      release: { sha, state: "running", steps },
      unitAlive,
      driver: { active: "absent" },
    });

  it("reads the data-secret step's exit code: running, succeeded, failed", () => {
    assert.equal(
      rotationVerdict(
        status([{ name: "data-secret", rc: null }], { unitAlive: true }),
        SHA,
      ).state,
      "running",
    );
    assert.deepEqual(
      rotationVerdict(status([{ name: "data-secret", rc: 0 }]), SHA),
      {
        state: "succeeded",
        line: "status: data-secret succeeded (pgbackrest check passed)",
      },
    );
    assert.equal(
      rotationVerdict(status([{ name: "data-secret", rc: 1 }]), SHA).state,
      "failed",
    );
  });

  it("fails on a dead unit with no verdict, another SHA's record, no step or no JSON", () => {
    assert.equal(
      rotationVerdict(
        status([{ name: "data-secret", rc: null }], { unitAlive: false }),
        SHA,
      ).state,
      "failed",
    );
    assert.equal(
      rotationVerdict(
        status([{ name: "data-secret", rc: 0 }], { sha: "f".repeat(40) }),
        SHA,
      ).state,
      "failed",
    );
    assert.equal(
      rotationVerdict(status([{ name: "up", rc: 0 }]), SHA).state,
      "failed",
    );
    assert.equal(
      rotationVerdict('{"release":null,"unitAlive":null}', SHA).state,
      "failed",
    );
    assert.equal(rotationVerdict("ds-release: refused", SHA).state, "failed");
  });

  it("prints only the step, its state and exit code — never a status field's text", () => {
    const { line } = rotationVerdict(
      JSON.stringify({
        release: {
          sha: SHA,
          error: "SECRET-ish text",
          steps: [{ name: "data-secret", rc: 1 }],
        },
      }),
      SHA,
    );
    assert.doesNotMatch(line, /SECRET-ish/);
  });
});
