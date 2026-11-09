// Issue #3662: the automated key custody's box side — ds-recovery, the read verbs
// `recovery-bundle` / `recovery-check` of ds-read-entrypoint on ds-api-prod and the
// data verbs behind them on ds-data-prod (spec §5 «Prod read verbs.»; infra/deploy/
// RECOVERY.md §2 «Automated custody (CI)»).
//
// Both boxes run end to end in two fixture roots: the ssh stub hands the hop's verb
// (and its stdin) to the real data entrypoint against the data root; `age` and `curl`
// are stubs — age writes an age header and a digest of its input (never the input),
// curl keeps the bucket as a directory and logs its arguments.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(here, "../../infra/deploy/bin");
const RECOVERY = join(BIN, "ds-recovery");
const READ_ENTRYPOINT = join(BIN, "ds-read-entrypoint");
const DATA_ENTRYPOINT = join(BIN, "ds-deploy-entrypoint");

const toolsPresent =
  process.platform !== "win32" &&
  spawnSync(
    "bash",
    [
      "-c",
      "command -v python3 && command -v openssl && command -v tar && command -v sha256sum",
    ],
    {
      stdio: "ignore",
    },
  ).status === 0;
const SKIP =
  !toolsPresent && "needs Linux bash, python3, openssl, tar and sha256sum";

const R1 = `age1${"q".repeat(58)}`;
const R2 = `age1${"p".repeat(58)}`;
const CUSTODIANS = `# role: first custodian\n${R1}\n# role: second custodian\n${R2}\n`;
// Values a leak would show: none of them may reach any output or the bucket.
const SECRETS = {
  "api.env":
    "SIGN_IN_RECORD_KEY=sign-in-secret-value\nAUDIT_IDENTIFIER_PEPPER=pepper-secret-value\n",
  "zitadel.env": "ZITADEL_MASTERKEY=masterkey-secret-value\n",
  "data.env": [
    "PGBACKREST_REPO1_CIPHER_PASS=cipher-secret-value",
    "PGBACKREST_REPO1_S3_BUCKET=ds-backups",
    "PGBACKREST_REPO1_S3_ENDPOINT=s3.example.test",
    "PGBACKREST_REPO1_S3_REGION=ru-1",
    "PGBACKREST_REPO1_S3_KEY=access-key-value",
    "PGBACKREST_REPO1_S3_KEY_SECRET=s3-secret-value",
    "",
  ].join("\n"),
};
const SECRET_WORDS = ["secret-value", "access-key-value"];

describe("3662: the key custody, box side", { skip: SKIP }, () => {
  let dir, api, data, stubs;

  const stub = (path, body) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(path, 0o755);
  };
  const box = (root, role, files) => {
    mkdirSync(join(root, "etc/ds-platform"), { recursive: true });
    writeFileSync(join(root, "etc/ds-platform/box-role"), `${role}\n`);
    for (const [name, text] of Object.entries(files))
      writeFileSync(join(root, "etc/ds-platform", name), text);
    copyFileSync(RECOVERY, join(root, "usr/local/lib/ds-platform/ds-recovery"));
    chmodSync(join(root, "usr/local/lib/ds-platform/ds-recovery"), 0o755);
    stub(
      join(root, "usr/local/bin/ds-release"),
      `echo "${role} ds-release $*" >> "$STUB_DIR/ds-release.log"`,
    );
  };
  const custodians = (root, tree, text = CUSTODIANS) => {
    const p = join(root, tree, "infra/deploy/recovery/custodians.txt");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  const setCustodians = (text) => {
    custodians(api, "usr/local/lib/ds-platform/tree", text);
    custodians(data, "home/deploy/ds-platform", text);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ds-recovery-"));
    api = join(dir, "api");
    data = join(dir, "data");
    stubs = join(dir, "stubs");
    mkdirSync(join(api, "usr/local/lib/ds-platform"), { recursive: true });
    mkdirSync(join(data, "usr/local/lib/ds-platform"), { recursive: true });
    box(api, "prod", {
      "api.env": SECRETS["api.env"],
      "zitadel.env": SECRETS["zitadel.env"],
      "internal.env": "INTERNAL_API_TOKEN=internal-secret-value\n",
    });
    box(data, "data", { "data.env": SECRETS["data.env"] });
    setCustodians(CUSTODIANS);
    stub(join(stubs, "sudo"), 'exec "$@"');
    stub(join(stubs, "logger"), 'echo "$*" >> "$STUB_DIR/logger.log"');
    // age: an age file whose body is a digest of the plaintext, never the plaintext.
    stub(
      join(stubs, "age"),
      [
        "[[ ${1-} == --version ]] && { echo v1.1.1; exit 0; }",
        'echo "age $*" >> "$STUB_DIR/age.log"',
        "out=; rec=; while (($#)); do case $1 in -o) out=$2; shift 2 ;; -R) rec=$2; shift 2 ;; *) shift ;; esac; done",
        "[[ -n ${STUB_AGE_FAIL:-} ]] && exit 1",
        'cp -- "$rec" "$STUB_DIR/age-recipients.seen"',
        'tar -tf - > "$STUB_DIR/age-members.seen"',
        '{ echo age-encryption.org/v1; echo "-> X25519 stub"; sha256sum "$STUB_DIR/age-members.seen" | cut -c1-64; } > "$out"',
      ].join("\n"),
    );
    // curl: the bucket is $STUB_DIR/bucket/<bucket>/<key>; -w prints the status.
    stub(
      join(stubs, "curl"),
      [
        'echo "curl $*" >> "$STUB_DIR/curl.log"',
        "method=GET; out=; upload=; url=; cfg=",
        "while (($#)); do case $1 in",
        "  -T) method=PUT; upload=$2; shift 2 ;; -I) method=HEAD; shift ;; -o) out=$2; shift 2 ;;",
        "  -K) cfg=$2; shift 2 ;; -w|-H|--aws-sigv4|--connect-timeout|--max-time) shift 2 ;;",
        "  https://*) url=$1; shift ;; *) shift ;; esac; done",
        'cat -- "$cfg" >> "$STUB_DIR/curl-config.seen"',
        '[[ -n ${STUB_CURL_CODE:-} ]] && { printf %s "$STUB_CURL_CODE"; exit 0; }',
        'obj="$STUB_DIR/bucket/${url#https://*/}"',
        "case $method in",
        '  PUT) mkdir -p "$(dirname "$obj")"; cp -- "$upload" "$obj"; printf 200 ;;',
        '  GET) if [[ -f $obj ]]; then cp -- "$obj" "$out"; printf 200; else printf 404; fi ;;',
        '  HEAD) if [[ -f $obj ]]; then printf "HTTP/1.1 200 OK\\r\\nContent-Length: %s\\r\\n" "$(stat -c %s "$obj")" > "$out"; printf 200; else printf 404; fi ;;',
        "esac",
      ].join("\n"),
    );
    // The hop: the verb (and its stdin) goes to the real data entrypoint in the data root.
    stub(
      join(stubs, "ssh"),
      [
        'echo "$*" >> "$STUB_DIR/ssh.log"',
        "cmd=${*: -1}",
        'nostdin=0; for a in "$@"; do [[ $a == -n ]] && nostdin=1; done',
        `if ((nostdin)); then exec </dev/null; fi`,
        `DS_ENTRYPOINT_ROOT="${data}" SSH_ORIGINAL_COMMAND="$cmd" exec bash "${DATA_ENTRYPOINT}"`,
      ].join("\n"),
    );
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const env = (extra = {}) => ({
    ...process.env,
    PATH: `${stubs}${delimiter}${process.env.PATH}`,
    STUB_DIR: dir,
    ...extra,
  });
  const read = (command, extra = {}) => {
    const r = spawnSync("bash", [READ_ENTRYPOINT], {
      env: env({
        DS_ENTRYPOINT_ROOT: api,
        SSH_ORIGINAL_COMMAND: command,
        ...extra,
      }),
      input: "",
      encoding: "utf8",
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const recovery = (args, root = api, extra = {}) => {
    const r = spawnSync("bash", [RECOVERY, ...args], {
      env: env({ DS_RECOVERY_ROOT: root, ...extra }),
      input: "",
      encoding: "utf8",
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const log = (name) => {
    const p = join(dir, `${name}.log`);
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  };
  const bucket = () => {
    const root = join(dir, "bucket");
    const out = [];
    const walk = (d, rel) => {
      if (!existsSync(d)) return;
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name), `${rel}${e.name}/`);
        else out.push(`${rel}${e.name}`);
      }
    };
    walk(root, "");
    return out.sort();
  };
  const object = (key) => readFileSync(join(dir, "bucket", key), "utf8");
  const noLeak = (text, what) => {
    for (const w of SECRET_WORDS)
      assert.ok(!text.includes(w), `${what} carries no value (${w})`);
    assert.ok(
      !text.includes("age-encryption.org"),
      `${what} carries no ciphertext`,
    );
  };
  const STATUS_RE =
    /^(api-prod|data-prod) (MATCH|MISSING|STORED [0-9]{8}T[0-9]{6}Z members [0-9]{1,3}|STALE [0-9]{1,5}d|MISMATCH [A-Za-z0-9_.:-]{1,80})$/;

  it("recovery-bundle bundles each box, stores ciphertext + manifest under recovery-bundle/<box>/ only, prints status lines only", () => {
    const r = read("recovery-bundle");
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trimEnd().split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^api-prod STORED [0-9]{8}T[0-9]{6}Z members 3$/);
    assert.match(lines[1], /^data-prod STORED [0-9]{8}T[0-9]{6}Z members 1$/);
    for (const l of lines) assert.match(l, STATUS_RE);
    noLeak(r.stdout + r.stderr, "the verb's output");
    // The release check ran on both boxes first.
    assert.equal(
      log("ds-release"),
      "prod ds-release check prod\ndata ds-release check prod\n",
    );
    // The upload-path namespace: every object is recovery-bundle/<box>/…, nothing else.
    const keys = bucket();
    assert.equal(keys.length, 6, keys.join(", "));
    for (const k of keys) {
      assert.match(
        k,
        /^ds-backups\/recovery-bundle\/(api-prod|data-prod)\/([0-9]{8}T[0-9]{6}Z\.(tar\.age|manifest\.json)|latest\.json)$/,
      );
    }
    for (const line of log("curl").trimEnd().split("\n")) {
      assert.match(
        line,
        /https:\/\/s3\.example\.test\/ds-backups\/recovery-bundle\/(api-prod|data-prod)\//,
      );
      noLeak(line, "a curl command line");
    }
    // The credentials reach curl in its config file only.
    assert.match(
      readFileSync(join(dir, "curl-config.seen"), "utf8"),
      /^user = "access-key-value:s3-secret-value"$/m,
    );
    // What is stored: ciphertext, and a manifest with no value in it.
    const stamp = lines[0].split(" ")[2];
    const bundleKey = `ds-backups/recovery-bundle/api-prod/${stamp}.tar.age`;
    assert.match(object(bundleKey), /^age-encryption\.org\/v1\n/);
    for (const k of keys)
      for (const w of SECRET_WORDS)
        assert.ok(!object(k).includes(w), `${k} carries no plaintext value`);
    const manifest = JSON.parse(
      object(`ds-backups/recovery-bundle/api-prod/${stamp}.manifest.json`),
    );
    assert.deepEqual(manifest.members, [
      "api.env",
      "internal.env",
      "zitadel.env",
    ]);
    assert.equal(
      object(`ds-backups/recovery-bundle/api-prod/latest.json`),
      object(`ds-backups/recovery-bundle/api-prod/${stamp}.manifest.json`),
    );
    assert.equal(
      manifest.custodians.sha256,
      createHash("sha256").update(CUSTODIANS).digest("hex"),
    );
    assert.equal(manifest.bundle.bytes, Buffer.byteLength(object(bundleKey)));
    // age got the custodians file and the tar of exactly the members.
    assert.equal(
      readFileSync(join(dir, "age-recipients.seen"), "utf8"),
      CUSTODIANS,
    );
  });

  it("the manifest fingerprint is keyed (HMAC under the box's own key), never a plain hash of the value", () => {
    assert.equal(read("recovery-bundle").status, 0);
    const latest = JSON.parse(
      object("ds-backups/recovery-bundle/api-prod/latest.json"),
    );
    const fp = latest.fingerprints["api.env"].SIGN_IN_RECORD_KEY;
    assert.match(fp, /^[0-9a-f]{64}$/);
    const value = "sign-in-secret-value";
    for (const plain of [value, `SIGN_IN_RECORD_KEY=${value}`, `${value}\n`]) {
      assert.notEqual(
        fp,
        createHash("sha256").update(plain).digest("hex"),
        "not sha256 of the value",
      );
    }
    const keyFile = join(api, "var/lib/ds-platform/recovery/fingerprint.key");
    const key = Buffer.from(readFileSync(keyFile, "utf8").trim(), "hex");
    assert.equal(key.length, 32);
    const msg = Buffer.concat([
      Buffer.from("ds-recovery/v1\0api.env\0SIGN_IN_RECORD_KEY\0"),
      Buffer.from(value),
    ]);
    assert.equal(fp, createHmac("sha256", key).update(msg).digest("hex"));
    // The key stays on its box: in no object of the bucket.
    for (const k of bucket())
      assert.ok(
        !object(k).includes(key.toString("hex")),
        `${k} carries no fingerprint key`,
      );
  });

  for (const [what, text] of [
    ["no recipient (comments only)", "# role: one\n\n# nothing yet\n"],
    ["one recipient", `# role: one\n${R1}\n`],
    ["the same recipient twice", `${R1}\n${R1}\n`],
    ["a plugin recipient", `${R1}\nage1yubikey1${"q".repeat(58)}\n`],
    ["a malformed recipient", `${R1}\nage1short\n`],
  ]) {
    it(`fails closed with ${what}: exit 3, the ceremony named, nothing encrypted or stored`, () => {
      setCustodians(text);
      for (const verb of ["recovery-bundle", "recovery-check"]) {
        const r = read(verb);
        assert.equal(r.status, 3, `${verb}: ${r.stderr}`);
        assert.match(r.stderr, /#3662 custodian ceremony pending/);
      }
      assert.equal(log("age"), "", "age never ran");
      assert.deepEqual(bucket(), []);
    });
  }

  it("the member gate: a box without a required env file stores nothing for it", () => {
    rmSync(join(api, "etc/ds-platform/zitadel.env"));
    const r = read("recovery-bundle");
    assert.equal(r.status, 1);
    assert.match(
      r.stderr,
      /ds-read-entrypoint: api-prod: ds-recovery: member gate: no zitadel\.env/,
    );
    assert.ok(
      !bucket().some((k) => k.includes("/api-prod/")),
      "no api-prod object",
    );
    assert.match(
      r.stdout,
      /^data-prod STORED /m,
      "the other box still bundles",
    );
    writeFileSync(join(data, "etc/ds-platform/data.env"), "");
    const empty = recovery(
      [
        "bundle",
        "data-prod",
        join(
          data,
          "home/deploy/ds-platform/infra/deploy/recovery/custodians.txt",
        ),
        dir,
        "20261104T000000Z",
      ],
      data,
    );
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /member gate: data\.env is empty/);
  });

  it("recovery-check: MATCH on both boxes right after a bundle", () => {
    assert.equal(read("recovery-bundle").status, 0);
    const r = read("recovery-check");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "api-prod MATCH\ndata-prod MATCH\n");
  });

  it("recovery-check: MISSING before any bundle", () => {
    const r = read("recovery-check");
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "api-prod MISSING\ndata-prod MISSING\n");
  });

  it("recovery-check: MISMATCH <member:key> for a changed, added or removed key; no value printed", () => {
    assert.equal(read("recovery-bundle").status, 0);
    writeFileSync(
      join(api, "etc/ds-platform/api.env"),
      "SIGN_IN_RECORD_KEY=rotated-secret-value\nNEW_KEY=x\n",
    );
    writeFileSync(
      join(data, "etc/ds-platform/data.env"),
      SECRETS["data.env"].replace("cipher-secret-value", "other-secret-value"),
    );
    const r = read("recovery-check");
    assert.equal(r.status, 1);
    assert.equal(
      r.stdout,
      [
        "api-prod MISMATCH api.env:AUDIT_IDENTIFIER_PEPPER",
        "api-prod MISMATCH api.env:NEW_KEY",
        "api-prod MISMATCH api.env:SIGN_IN_RECORD_KEY",
        "data-prod MISMATCH data.env:PGBACKREST_REPO1_CIPHER_PASS",
        "",
      ].join("\n"),
    );
    noLeak(r.stdout + r.stderr, "the check's output");
  });

  it("recovery-check: STALE <age> past the max age, MISMATCH for custodians, members and the fingerprint key", () => {
    assert.equal(read("recovery-bundle").status, 0);
    const later = String(Math.floor(Date.now() / 1000) + 10 * 86400 + 3600);
    const stale = read("recovery-check", { DS_RECOVERY_NOW: later });
    assert.equal(stale.status, 1);
    assert.equal(stale.stdout, "api-prod STALE 10d\ndata-prod STALE 10d\n");
    setCustodians(`${R1}\n${R2}\n# role: third\nage1${"z".repeat(58)}\n`);
    rmSync(join(api, "etc/ds-platform/internal.env"));
    rmSync(join(data, "var/lib/ds-platform/recovery/fingerprint.key"));
    const r = read("recovery-check");
    assert.equal(r.status, 1);
    assert.equal(
      r.stdout,
      [
        "api-prod MISMATCH custodians",
        "api-prod MISMATCH member:internal.env",
        "data-prod MISMATCH custodians",
        "data-prod MISMATCH fingerprint-key",
        "",
      ].join("\n"),
    );
  });

  it("recovery-check: MISSING when the manifest's bundle object is gone", () => {
    assert.equal(read("recovery-bundle").status, 0);
    const stamp = JSON.parse(
      object("ds-backups/recovery-bundle/data-prod/latest.json"),
    ).stamp;
    rmSync(
      join(
        dir,
        "bucket/ds-backups/recovery-bundle/data-prod",
        `${stamp}.tar.age`,
      ),
    );
    const r = read("recovery-check");
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "api-prod MATCH\ndata-prod MISSING\n");
  });

  it("a bucket failure fails the verb with a fixed reason, no response text", () => {
    const r = read("recovery-bundle", { STUB_CURL_CODE: "403" });
    assert.equal(r.status, 1);
    assert.match(
      r.stderr,
      /data-prod: ds-recovery: the upload to the bucket failed \(HTTP 403\)/,
    );
    assert.equal(r.stdout, "");
  });

  it("refuses without age (exit 3) and without ds-recovery installed", () => {
    rmSync(join(stubs, "age"));
    // The stubs (found through the sudo stub) and the system dirs, without any age.
    const noAge = spawnSync(
      "bash",
      [
        "-c",
        'PATH="$(dirname "$(command -v sudo)"):/usr/bin:/bin" exec bash "$0"',
        READ_ENTRYPOINT,
      ],
      {
        env: {
          ...env(),
          DS_ENTRYPOINT_ROOT: api,
          SSH_ORIGINAL_COMMAND: "recovery-bundle",
        },
        encoding: "utf8",
      },
    );
    if (
      spawnSync("bash", ["-c", "PATH=/usr/bin:/bin command -v age"]).status !==
      0
    ) {
      assert.equal(noAge.status, 3, noAge.stderr);
      assert.match(noAge.stderr, /age is not installed/);
    }
    rmSync(join(api, "usr/local/lib/ds-platform/ds-recovery"));
    const r = read("recovery-check");
    assert.equal(r.status, 3);
    assert.match(r.stderr, /ds-recovery is not installed/);
  });

  it("the data box's recovery-put takes only api-prod, a lower-case stamp and bundle|manifest; the hop's other boxes are rejected", () => {
    for (const command of [
      "recovery-put data-prod 20261104t000000z bundle",
      "recovery-put api-prod 20261104T000000Z bundle",
      "recovery-put api-prod 20261104t000000z latest",
      "recovery-put api-prod 20261104t000000z",
      "recovery-latest data-prod",
      "recovery-bundle now",
    ]) {
      const r = spawnSync("bash", [DATA_ENTRYPOINT], {
        env: env({ DS_ENTRYPOINT_ROOT: data, SSH_ORIGINAL_COMMAND: command }),
        input: "",
        encoding: "utf8",
      });
      assert.equal(r.status, 2, `${command}: ${r.stderr}`);
    }
    assert.deepEqual(bucket(), []);
  });

  it("a manifest is stored only after its bundle object, of the manifest's size", () => {
    const work = join(dir, "work");
    mkdirSync(work);
    const c = join(
      api,
      "usr/local/lib/ds-platform/tree/infra/deploy/recovery/custodians.txt",
    );
    assert.equal(
      recovery(["bundle", "api-prod", c, work, "20261104T000000Z"]).status,
      0,
    );
    const r = recovery(
      [
        "upload",
        "api-prod",
        "20261104T000000Z",
        "manifest",
        join(work, "manifest.json"),
      ],
      data,
    );
    assert.equal(r.status, 1);
    assert.match(
      r.stderr,
      /the bundle of 20261104T000000Z is not in the bucket/,
    );
    assert.deepEqual(bucket(), []);
    const wrongBox = recovery(
      [
        "upload",
        "api-prod",
        "20261104T000000Z",
        "bundle",
        join(work, "bundle.tar.age"),
      ],
      api,
    );
    assert.equal(
      wrongBox.status,
      3,
      "the bucket is reached from ds-data-prod only",
    );
  });

  it("install-age reports a present age and never fails the release", () => {
    const r = recovery(["install-age"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "ds-recovery: age v1.1.1 present\n");
  });
});
