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
  BOXES,
  certFingerprint,
  GENERATE,
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

// --- Issue #4153: the same rotation for ds-api-prod's api.env and compose .env -------
describe("4153: the api box", () => {
  const contract = JSON.parse(
    readFileSync(
      new URL(
        "../../packages/schemas/src/runtime-env/runtime-env-contract.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  it("names every runtime-env contract variable, the runbooks' IdP + captcha names and the 048 Telegram trio — each with its file", () => {
    const api = BOXES.api.names;
    for (const { name } of contract.variables) {
      assert.equal(api[name]?.file, "api", `${name} is in the allowlist`);
    }
    for (const name of [
      "IDP_SERVICE_TOKEN",
      "IDP_CLIENT_ID",
      "IDP_CLIENT_SECRET",
      "IDP_PROJECT_ID",
      "BOT_PROTECTION_ENABLED",
      "SMARTCAPTCHA_SERVER_KEY",
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_WEBHOOK_SECRET",
      "TELEGRAM_WEBHOOK_URL",
    ]) {
      assert.equal(api[name]?.file, "api", name);
    }
    assert.equal(api.SMARTCAPTCHA_SITE_KEY?.file, "compose");
    assert.equal(BOXES.api.step, "api-secret");
    assert.match(BOXES.api.recipient, /infra[\\/]deploy[\\/]keys[\\/]api-secret-recipient\.pem$/);
    assert.deepEqual(Object.keys(BOXES.data.names), [...SECRET_KEYS]);
  });

  it("no value shape admits whitespace, a quote or a shell metacharacter (api.env is sourced by bash)", () => {
    for (const [name, { shape }] of Object.entries(BOXES.api.names)) {
      const re = new RegExp(`^(?:${shape})$`);
      for (const bad of [" ", '"', "'", "`", "$", ";", "&", "|", "\\", "<", ">", "(", "#", "\n"]) {
        for (const probe of [`a${bad}b`, `ysc1_aaaaaaaa${bad}`, `1:${"a".repeat(30)}${bad}`]) {
          assert.ok(!re.test(probe), `${name} refuses ${JSON.stringify(probe)}`);
        }
      }
    }
  });

  it("takes allowlisted lines, empty for the captcha OFF, and `<generate>` for a generatable name", () => {
    assert.deepEqual(
      parseSecretLines(
        [
          `TELEGRAM_BOT_TOKEN=123456789:${"A".repeat(35)}`,
          "TELEGRAM_WEBHOOK_URL=https://api.doctor.school/v1/integrations/telegram/webhook",
          "TELEGRAM_WEBHOOK_SECRET=<generate>",
          "BOT_PROTECTION_ENABLED=false",
          "SMARTCAPTCHA_SERVER_KEY=",
          "SMARTCAPTCHA_SITE_KEY=",
          `SIGN_IN_RECORD_KEY=${"A".repeat(43)}=`,
        ].join("\n"),
        "api",
      ),
      {
        TELEGRAM_BOT_TOKEN: `123456789:${"A".repeat(35)}`,
        TELEGRAM_WEBHOOK_URL:
          "https://api.doctor.school/v1/integrations/telegram/webhook",
        TELEGRAM_WEBHOOK_SECRET: GENERATE,
        BOT_PROTECTION_ENABLED: "false",
        SMARTCAPTCHA_SERVER_KEY: "",
        SMARTCAPTCHA_SITE_KEY: "",
        SIGN_IN_RECORD_KEY: `${"A".repeat(43)}=`,
      },
    );
  });

  it("refuses an off-list name, a bad shape, or `<generate>` for a name the box does not generate — naming the name, never the value", () => {
    const cases = [
      ["PGBACKREST_REPO1_S3_KEY=ABCDEFGH1234", /line 1: not NAME=value/],
      ["TELEGRAM_BOT_TOKEN=not-a-token-value", /line 1: the value of TELEGRAM_BOT_TOKEN is not/],
      ["BOT_PROTECTION_ENABLED=yes", /BOT_PROTECTION_ENABLED is not true or false/],
      ["AUDIT_IDENTIFIER_PEPPER=abc", /AUDIT_IDENTIFIER_PEPPER is not/],
      ["TELEGRAM_BOT_TOKEN=<generate>", /TELEGRAM_BOT_TOKEN is not generated by the box/],
      ["TELEGRAM_WEBHOOK_URL=https://evil.example/hook", /TELEGRAM_WEBHOOK_URL is not/],
    ];
    for (const [text, reason] of cases) {
      assert.throws(
        () => parseSecretLines(text, "api"),
        (err) =>
          err instanceof SecretError &&
          reason.test(err.message) &&
          !/not-a-token|evil\.example|=yes/.test(err.message),
        text,
      );
    }
  });

  it("puts `<generate>` names in the plaintext's generate list, never among the values", () => {
    const plain = JSON.parse(
      secretPlaintext(
        { TELEGRAM_WEBHOOK_SECRET: GENERATE, BOT_PROTECTION_ENABLED: "true" },
        { sha: SHA, nonce: "cd".repeat(16), now: new Date("2026-11-18T00:00:00Z") },
      ),
    );
    assert.deepEqual(plain, {
      schema: 1,
      createdAt: "2026-11-18T00:00:00Z",
      sha: SHA,
      nonce: "cd".repeat(16),
      values: { BOT_PROTECTION_ENABLED: "true" },
      generate: ["TELEGRAM_WEBHOOK_SECRET"],
    });
    assert.ok(
      !("generate" in JSON.parse(secretPlaintext({ PGBACKREST_REPO1_S3_KEY: "ABCDEFGH1234" }, { sha: SHA }))),
      "a data-box plaintext keeps its exact key set",
    );
  });

  it("reads the api-secret step's verdict", () => {
    const answer = (rc) =>
      JSON.stringify({ release: { sha: SHA, steps: [{ name: "api-secret", rc }] }, unitAlive: rc === null });
    assert.deepEqual(rotationVerdict(answer(0), SHA, "api"), {
      state: "succeeded",
      line: "status: api-secret succeeded (the recreated stack answers /v1/health at the live SHA and /v1/ready)",
    });
    assert.equal(rotationVerdict(answer(null), SHA, "api").state, "running");
    assert.match(rotationVerdict(answer(1), SHA, "api").line, /api-secret failed, exit 1 \(the previous api\.env and compose \.env are back\)/);
    assert.equal(rotationVerdict(answer(0), SHA).state, "failed", "the data box reads its own step only");
  });

  it("refuses without the api box's certificate, pointing at its recipient run", () => {
    assert.throws(
      () => requireRecipient(join(tmpdir(), "no-such-recipient.pem"), "api"),
      /is missing.*data-secret\.yml.*-f box=api.*action=recipient/s,
    );
  });

  it("the CLI takes --box api and refuses an off-list line before encrypting", () => {
    const cli = (args, input) =>
      spawnSync(process.execPath, [join(import.meta.dirname, "data-secret.mjs"), ...args], {
        input,
        encoding: "utf8",
      });
    const r = cli(["--box", "api", SHA], "PGBACKREST_REPO1_S3_KEY=ABCDEFGH1234\n");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /api-secret: (line 1: not NAME=value|.*is missing)/);
    assert.equal(r.stdout, "");
    assert.equal(cli(["--box", "nope", SHA], "").status, 2);
    const v = cli(["verdict", "--box", "api", SHA], JSON.stringify({ release: { sha: SHA, steps: [{ name: "api-secret", rc: 0 }] } }));
    assert.equal(v.stdout, "succeeded\n");
  });
});

// Issue #4153: the certificate ds-api-prod answered to data-secret.yml -f box=api
// action=recipient (run 44455451390, after release-2026.11.19-1). A rebuilt box
// generates a new pair: commit its certificate and its fingerprint here together.
const API_BOX_FINGERPRINT =
  "98:9A:5D:E1:D4:2F:53:98:83:99:3D:01:41:60:00:C3:80:98:8D:E7:38:50:64:77:4B:02:56:DB:DD:8B:61:C1";

describe("4153: the committed api intake certificate", () => {
  it("is ds-api-prod's: it parses and its fingerprint is the one the box printed", () => {
    requireRecipient(BOXES.api.recipient, "api");
    const pem = readFileSync(BOXES.api.recipient, "utf8");
    assert.ok(
      !pem.includes("\r"),
      "LF line endings, byte-exact to the run log",
    );
    assert.equal(
      new X509Certificate(pem).subject,
      "CN=ds-api-prod-secret-intake",
    );
    assert.equal(certFingerprint(pem), API_BOX_FINGERPRINT);
  });

  it(
    "pnpm prod:api-secret encrypts to it: one base64 line, its fingerprint on stderr",
    { skip: !opensslPresent && "needs openssl" },
    () => {
      const r = spawnSync(
        process.execPath,
        [join(import.meta.dirname, "data-secret.mjs"), "--box", "api", SHA],
        {
          input: "BOT_PROTECTION_ENABLED=true\nTELEGRAM_WEBHOOK_SECRET=<generate>\n",
          encoding: "utf8",
        },
      );
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /^[A-Za-z0-9+/]+={0,2}\n$/);
      assert.ok(
        r.stderr.includes(`encrypted to ${API_BOX_FINGERPRINT} (ds-api-prod)`),
        r.stderr,
      );
      assert.match(r.stderr, /-f box=api -f action=apply/);
    },
  );
});
