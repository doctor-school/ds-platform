// Tests of infra/deploy/bin/harden-ssh.sh, the one-off ssh converge of an existing
// box (Issue #2984; tech spec 2026-10-16-release-pipeline-off-workstation-en.md §4,
// §8 step (c)), and of its parity with the cloud-init files that give a NEW box the
// same end state. The bash suite runs the script for real against a fixture root
// (HARDEN_ROOT) with sshd / systemctl / visudo / useradd / chown stubbed on PATH.
// It needs bash, sed and grep (CI Linux; Git Bash on Windows); skipped where absent.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, it, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(here, "../../infra/deploy/bin/harden-ssh.sh");
const CLOUD_INIT = resolve(here, "../../infra/deploy/cloud-init");
const SCRIPT_TEXT = readFileSync(SCRIPT, "utf8");

const SKIP =
  spawnSync("bash", ["-c", "command -v sed && command -v grep && command -v mktemp"], {
    stdio: "ignore",
  }).status !== 0 && "needs bash, sed and grep";

/** The single-quoted DROPIN_CONTENT of harden-ssh.sh. */
function scriptDropin() {
  const m = SCRIPT_TEXT.match(/^DROPIN_CONTENT='([^']*)'$/m);
  assert.ok(m, "harden-ssh.sh defines DROPIN_CONTENT in single quotes");
  return m[1];
}

/** The literal block (`content: |`) of the write_files entry at `path`. */
function cloudInitFile(yaml, path) {
  const lines = yaml.split("\n");
  const at = lines.findIndex((l) => l.trim() === `- path: ${path}`);
  assert.ok(at >= 0, `cloud-init writes ${path}`);
  let i = at + 1;
  while (!/^\s+content: \|$/.test(lines[i])) {
    assert.ok(/^\s{4}\S/.test(lines[i]), `content: | belongs to the ${path} entry`);
    i += 1;
  }
  const body = [];
  for (i += 1; i < lines.length && /^ {6}/.test(lines[i]); i += 1) body.push(lines[i].slice(6));
  return `${body.join("\n")}\n`;
}

const ROLES = { "api-prod.yaml": "prod", "data-prod.yaml": "data", "stage-1.yaml": "stage" };

for (const [file, role] of Object.entries(ROLES)) {
  test(`2984: cloud-init ${file} gives a new box the end state harden-ssh.sh converges to`, () => {
    const yaml = readFileSync(join(CLOUD_INIT, file), "utf8");
    assert.equal(
      cloudInitFile(yaml, "/etc/ssh/sshd_config.d/10-ds-hardening.conf"),
      scriptDropin(),
      "the drop-in is byte-identical",
    );
    assert.equal(
      cloudInitFile(yaml, "/etc/sudoers.d/91-ds-breakglass"),
      SCRIPT_TEXT.match(/^sudoers_line='([^']*)'$/m)[1],
      "the breakglass sudoers file is byte-identical",
    );
    assert.equal(cloudInitFile(yaml, "/etc/ds-platform/box-role"), `${role}\n`);
    assert.match(yaml, /^ {2}- name: breakglass\n {4}groups: \[sudo\]\n {4}shell: \/bin\/bash\n/m);
    assert.match(yaml, /^ {6}- "\$\{breakglass_ssh_pubkey\}"$/m, "the key is rendered by terraform");
    assert.match(yaml, /^ {2}- truncate -s 0 \/root\/.ssh\/authorized_keys$/m);
    assert.match(yaml, /^ {2}- sshd -t && systemctl reload ssh$/m, "sshd -t before the reload");
  });
}

test("2984: the drop-in turns root and password login off and caps MaxStartups", () => {
  const conf = scriptDropin()
    .split("\n")
    .filter((l) => l && !l.startsWith("#"));
  assert.deepEqual(conf, [
    "PermitRootLogin no",
    "PasswordAuthentication no",
    "KbdInteractiveAuthentication no",
    "MaxStartups 10:30:60",
  ]);
});

const OPERATOR = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOPERATORKEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx deploy@ds-api-prod";
const BREAKGLASS = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBREAKGLASSxxxxxxxxxxxxxxxxxxxxxxxxxxxx owner-breakglass";
const CI_STAGE = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICISTAGEKEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxx gha-stage";
const CI_PROD = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICIPRODKEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx gha-prod";
const FORCED =
  'command="/usr/local/bin/ds-deploy-entrypoint",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding';

const SSHD_CONFIG = [
  "Include /etc/ssh/sshd_config.d/*.conf",
  "#PermitRootLogin prohibit-password",
  "PermitRootLogin yes",
  "PasswordAuthentication no",
  "",
].join("\n");

describe("2984: harden-ssh.sh on a fixture root", { skip: SKIP }, () => {
  let dir, root, stubs, keys;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ds-harden-"));
    root = join(dir, "root");
    stubs = join(dir, "stubs");
    keys = join(dir, "keys");
    for (const d of [stubs, keys, "etc/ssh/sshd_config.d", "etc/sudoers.d", "etc/ds-platform", "root/.ssh", "home/deploy/.ssh"]) {
      mkdirSync(d.startsWith(dir) ? d : join(root, d), { recursive: true });
    }
    writeFileSync(join(root, "etc/ssh/sshd_config"), SSHD_CONFIG);
    writeFileSync(join(root, "etc/ssh/sshd_config.d/50-cloud-init.conf"), "PasswordAuthentication no\n");
    writeFileSync(join(root, "root/.ssh/authorized_keys"), `${OPERATOR}\n`);
    // The operator line exactly as cloud-init wrote it, CRLF-free, no trailing newline
    // quirks: the converge must keep these bytes.
    writeFileSync(join(root, "home/deploy/.ssh/authorized_keys"), `${OPERATOR}\n`);
    writeFileSync(join(root, "etc/passwd"), "root:x:0:0::/root:/bin/bash\ndeploy:x:1000:1000::/home/deploy:/bin/bash\n");
    writeFileSync(join(keys, "breakglass.pub"), `${BREAKGLASS}\n`);
    writeFileSync(join(keys, "ci-stage.pub"), `${CI_STAGE}\n`);
    writeFileSync(join(keys, "ci-prod.pub"), `${CI_PROD}\n`);
    writeFileSync(join(dir, "enabled"), "fail2ban\n");

    const stub = (name, body) => {
      writeFileSync(join(stubs, name), `#!/usr/bin/env bash\necho "${name} $*" >> "$STUB_DIR/calls.log"\n${body}\n`);
      chmodSync(join(stubs, name), 0o755);
    };
    stub(
      "sshd",
      [
        'case $1 in',
        '  -t) exit "${STUB_SSHD_T_RC:-0}" ;;',
        "  -T) printf '%s\\n' 'permitrootlogin no' 'passwordauthentication no' 'kbdinteractiveauthentication no' 'maxstartups 10:30:60' ;;",
        "esac",
      ].join("\n"),
    );
    stub(
      "systemctl",
      [
        'case $1 in',
        '  is-enabled|is-active) grep -qx "$3" "$STUB_DIR/enabled" ;;',
        '  enable) echo "$3" >> "$STUB_DIR/enabled" ;;',
        "esac",
      ].join("\n"),
    );
    stub("visudo", 'grep -qx "breakglass ALL=(ALL) NOPASSWD:ALL" "$2" && exit "${STUB_VISUDO_RC:-0}"');
    stub(
      "useradd",
      [
        "prefix=",
        '[[ $1 == --prefix ]] && prefix=$2',
        'echo "breakglass:x:1001:1001::/home/breakglass:/bin/bash" >> "$prefix/etc/passwd"',
        'mkdir -p "$prefix/home/breakglass"',
      ].join("\n"),
    );
    stub("chown", "");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (args, env = {}) => {
    const r = spawnSync("bash", [SCRIPT, ...args], {
      env: { ...process.env, PATH: `${stubs}${delimiter}${process.env.PATH}`, STUB_DIR: dir, HARDEN_ROOT: root, ...env },
      encoding: "utf8",
    });
    return { status: r.status, out: r.stdout + r.stderr };
  };
  const stageArgs = (...extra) => [
    "--role",
    "stage",
    "--breakglass-pubkey",
    join(keys, "breakglass.pub"),
    "--ci-pubkey",
    join(keys, "ci-stage.pub"),
    ...extra,
  ];
  const read = (p) => readFileSync(join(root, p), "utf8");
  const calls = () => (existsSync(join(dir, "calls.log")) ? readFileSync(join(dir, "calls.log"), "utf8") : "");
  const snapshot = () => {
    const files = {};
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else files[relative(root, p)] = [readFileSync(p, "utf8"), statSync(p).mode];
      }
    };
    walk(root);
    return files;
  };

  it("converges a box to the hardened end state and reloads ssh once", () => {
    const r = run(stageArgs());
    assert.equal(r.status, 0, r.out);
    assert.equal(read("etc/ssh/sshd_config.d/10-ds-hardening.conf"), scriptDropin());
    const main = read("etc/ssh/sshd_config").split("\n");
    assert.ok(!main.some((l) => /^\s*PermitRootLogin\s+yes/.test(l)), "no active PermitRootLogin yes");
    assert.match(main[2], /^# PermitRootLogin yes {2}# ds-platform: set by sshd_config\.d\/10-ds-hardening\.conf$/);
    assert.equal(main[1], "#PermitRootLogin prohibit-password", "other lines untouched");
    assert.equal(read("root/.ssh/authorized_keys"), "");
    assert.match(read("etc/passwd"), /^breakglass:/m);
    assert.equal(read("etc/sudoers.d/91-ds-breakglass"), "breakglass ALL=(ALL) NOPASSWD:ALL\n");
    assert.equal(read("home/breakglass/.ssh/authorized_keys"), `${BREAKGLASS}\n`);
    assert.equal(read("home/deploy/.ssh/authorized_keys"), `${OPERATOR}\n${FORCED} ${CI_STAGE}\n`);
    assert.equal(read("etc/ds-platform/box-role"), "stage\n");
    const log = calls();
    assert.match(log, /^visudo -cf /m);
    assert.match(log, /^useradd --prefix .* -m -s \/bin\/bash -G sudo breakglass$/m);
    assert.match(log, /^systemctl enable --now unattended-upgrades$/m);
    assert.doesNotMatch(log, /enable --now fail2ban/, "an enabled unit is left alone");
    assert.ok(log.indexOf("sshd -t") < log.indexOf("systemctl reload ssh"), "sshd -t before the reload");
    assert.equal(log.match(/systemctl reload ssh/g).length, 1);
    assert.ok(!readdirSync(join(root, "etc/ssh")).some((f) => f.endsWith(".ds-harden.bak")), "no backup left");
  });

  it("is idempotent: a second run changes nothing and does not reload", () => {
    assert.equal(run(stageArgs()).status, 0);
    const before = snapshot();
    rmSync(join(dir, "calls.log"));
    const r = run(stageArgs());
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /nothing to change/);
    assert.deepEqual(snapshot(), before);
    assert.doesNotMatch(calls(), /reload|useradd|enable --now|visudo/);
  });

  it("adds a further CI key and keeps every existing line byte-identical", () => {
    writeFileSync(join(root, "home/deploy/.ssh/authorized_keys"), `${OPERATOR}\n# note\n`);
    assert.equal(run(stageArgs()).status, 0);
    assert.equal(run(stageArgs("--ci-pubkey", join(keys, "ci-prod.pub"))).status, 0);
    assert.equal(
      read("home/deploy/.ssh/authorized_keys"),
      `${OPERATOR}\n# note\n${FORCED} ${CI_STAGE}\n${FORCED} ${CI_PROD}\n`,
    );
  });

  it("puts a CI key that was added without the forced command behind it", () => {
    writeFileSync(join(root, "home/deploy/.ssh/authorized_keys"), `${OPERATOR}\n${CI_STAGE}\n`);
    assert.equal(run(stageArgs()).status, 0);
    assert.equal(read("home/deploy/.ssh/authorized_keys"), `${OPERATOR}\n${FORCED} ${CI_STAGE}\n`);
  });

  it("does not reload, and restores the sshd files, when sshd -t fails", () => {
    const r = run(stageArgs(), { STUB_SSHD_T_RC: "1" });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /sshd -t rejected the config/);
    assert.doesNotMatch(calls(), /reload/);
    assert.ok(!existsSync(join(root, "etc/ssh/sshd_config.d/10-ds-hardening.conf")), "drop-in removed");
    assert.equal(read("etc/ssh/sshd_config"), SSHD_CONFIG, "main config restored byte for byte");
  });

  it("refuses a breakglass sudoers file visudo rejects", () => {
    const r = run(stageArgs(), { STUB_VISUDO_RC: "1" });
    assert.equal(r.status, 1, r.out);
    assert.ok(!existsSync(join(root, "etc/sudoers.d/91-ds-breakglass")));
    assert.doesNotMatch(calls(), /reload/);
  });

  it("--dry-run prints the intended changes and changes nothing", () => {
    const before = snapshot();
    const r = run(stageArgs("--dry-run"));
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /would write .*10-ds-hardening\.conf/);
    assert.match(r.out, /would empty /);
    assert.match(r.out, /would create user breakglass/);
    assert.match(r.out, /would add CI key/);
    assert.deepEqual(snapshot(), before);
    assert.doesNotMatch(calls(), /reload|useradd|enable --now|visudo|sshd -t/);
  });

  for (const [what, args] of [
    ["no role", ["--breakglass-pubkey", "x"]],
    ["an unknown role", ["--role", "dev", "--breakglass-pubkey", "x"]],
    ["no breakglass key", ["--role", "stage"]],
    ["an unknown flag", ["--role", "stage", "--force"]],
  ]) {
    it(`exits 2 on ${what}`, () => {
      assert.equal(run(args).status, 2);
      assert.equal(calls(), "");
    });
  }

  it("refuses a key file with options, two keys, or the breakglass key as a CI key", () => {
    writeFileSync(join(keys, "opts.pub"), `no-pty ${CI_STAGE}\n`);
    writeFileSync(join(keys, "two.pub"), `${CI_STAGE}\n${CI_PROD}\n`);
    for (const bad of ["opts.pub", "two.pub", "breakglass.pub"]) {
      const r = run(["--role", "stage", "--breakglass-pubkey", join(keys, "breakglass.pub"), "--ci-pubkey", join(keys, bad)]);
      assert.equal(r.status, 2, `${bad}: ${r.out}`);
    }
    assert.equal(read("home/deploy/.ssh/authorized_keys"), `${OPERATOR}\n`);
  });
});
