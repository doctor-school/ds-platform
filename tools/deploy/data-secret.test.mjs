// Issue #4068: the data-box secret rotation's workstation and runner sides
// (tools/deploy/data-secret.mjs; spec §5 «Data-prod verbs.» → secret-apply).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  certFingerprint,
  encryptSecret,
  parseSecretLines,
  RECIPIENT_PATH,
  requireRecipient,
  rotationVerdict,
  SECRET_KEYS,
  SECRET_MAX_AGE_SEC,
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

it("4068: secretPlaintext carries the schema, a second-precision UTC stamp, the target SHA, a nonce and the values", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  assert.equal(
    secretPlaintext(
      { PGBACKREST_REPO1_S3_KEY: "ABCDEFGH1234" },
      {
        sha,
        now: new Date("2026-11-16T10:20:30.456Z"),
        nonce: "ab".repeat(16),
      },
    ),
    `{"schema":1,"createdAt":"2026-11-16T10:20:30Z","sha":"${sha}","nonce":"${"ab".repeat(16)}","values":{"PGBACKREST_REPO1_S3_KEY":"ABCDEFGH1234"}}`,
  );
  const a = JSON.parse(
    secretPlaintext({ PGBACKREST_REPO1_S3_KEY: "ABCDEFGH1234" }, { sha }),
  );
  const b = JSON.parse(
    secretPlaintext({ PGBACKREST_REPO1_S3_KEY: "ABCDEFGH1234" }, { sha }),
  );
  assert.match(a.nonce, /^[0-9a-f]{32}$/);
  assert.notEqual(a.nonce, b.nonce, "a fresh nonce per ciphertext");
  assert.throws(() => secretPlaintext({}, { sha: "abc" }), SecretError);
});

it("4068: a ciphertext is valid for 6 h", () => {
  assert.equal(SECRET_MAX_AGE_SEC, 6 * 3600);
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
        const plain = secretPlaintext(
          { PGBACKREST_REPO1_S3_KEY: "ABCDEFGH1234" },
          { sha: "0123456789abcdef0123456789abcdef01234567" },
        );
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
      for (const call of [
        () => encryptSecret("{}", join(tmpdir(), "no-such-recipient.pem")),
        () => requireRecipient(join(tmpdir(), "no-such-recipient.pem")),
      ]) {
        assert.throws(
          call,
          /is missing.*data-secret\.yml.*action=recipient.*step 1/s,
        );
      }
    });
  },
);

// Issue #4086: the certificate ds-data-prod answered to data-secret.yml action=recipient
// (run 43914489984, after release-2026.11.16-2). A rebuilt box generates a new pair:
// commit its certificate and its fingerprint here together.
const BOX_FINGERPRINT =
  "D4:56:5D:BE:30:52:CE:88:3D:8E:1E:C0:B5:1A:61:94:2D:1A:45:DF:82:17:A8:9E:F8:20:58:79:AB:9F:D7:4C";

describe("4086: the committed intake certificate", () => {
  it("is ds-data-prod's: it parses and its fingerprint is the one the box printed", () => {
    requireRecipient();
    const pem = readFileSync(RECIPIENT_PATH, "utf8");
    assert.ok(
      !pem.includes("\r"),
      "LF line endings, byte-exact to the run log",
    );
    assert.equal(
      new X509Certificate(pem).subject,
      "CN=ds-data-prod-secret-intake",
    );
    assert.equal(certFingerprint(pem), BOX_FINGERPRINT);
  });

  it(
    "pnpm prod:data-secret encrypts to it: one base64 line, its fingerprint on stderr",
    { skip: !opensslPresent && "needs openssl" },
    () => {
      const r = spawnSync(
        process.execPath,
        [join(import.meta.dirname, "data-secret.mjs"), SHA],
        {
          input:
            "PGBACKREST_REPO1_S3_KEY=ABCDEFGH1234\nPGBACKREST_REPO1_S3_KEY_SECRET=a/b+c=d_e.f-g\n",
          encoding: "utf8",
        },
      );
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /^[A-Za-z0-9+/]+={0,2}\n$/);
      assert.ok(r.stderr.includes(`encrypted to ${BOX_FINGERPRINT}`), r.stderr);
    },
  );
});

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
