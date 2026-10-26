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

/** The single-quoted DEPLOY_SUDOERS_CONTENT of harden-ssh.sh (#2987). */
function scriptDeploySudoers() {
  const m = SCRIPT_TEXT.match(/^DEPLOY_SUDOERS_CONTENT='([^']*)'$/m);
  assert.ok(m, "harden-ssh.sh defines DEPLOY_SUDOERS_CONTENT in single quotes");
  return m[1];
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
    const deployUser = yaml.match(/^ {2}- name: deploy\n((?: {4}.*\n)*)/m);
    assert.ok(deployUser, "cloud-init creates deploy");
    if (role === "prod") {
      // #2987: deploy holds the entrypoint and nothing else on prod.
      assert.equal(
        cloudInitFile(yaml, "/etc/sudoers.d/90-ds-deploy"),
        scriptDeploySudoers(),
        "the deploy sudoers file is byte-identical",
      );
      assert.equal(deployUser[1], "    shell: /bin/bash\n", "no group, no sudo rule, no key of its own");
    } else {
      // Stage (PR slots keep the operator lifecycle) keeps deploy's sudo. A new data box
      // starts the same: its hop line comes from the provisioning runbook and the first
      // release installs the data verbs, then `harden-ssh.sh --role data` (#3313) narrows.
      assert.ok(!yaml.includes("/etc/sudoers.d/90-ds-deploy"));
      assert.match(deployUser[1], /^ {4}sudo: \["ALL=\(ALL\) NOPASSWD:ALL"\]$/m);
    }
    assert.match(yaml, /^ {2}- name: breakglass\n {4}groups: \[sudo\]\n {4}shell: \/bin\/bash\n/m);
    assert.match(yaml, /^ {6}- "\$\{breakglass_ssh_pubkey\}"$/m, "the key is rendered by terraform");
    assert.match(yaml, /^ {2}- truncate -s 0 \/root\/.ssh\/authorized_keys$/m);
    assert.match(yaml, /^ {2}- sshd -t && systemctl reload ssh$/m, "sshd -t before the reload");
  });
}

test("2987: deploy's prod sudo right is the entrypoint, with no argument, keeping only the request", () => {
  assert.equal(
    scriptDeploySudoers(),
    'Defaults!/usr/local/bin/ds-deploy-entrypoint env_keep += "SSH_ORIGINAL_COMMAND"\n' +
      'deploy ALL=(root) NOPASSWD: /usr/local/bin/ds-deploy-entrypoint ""\n',
  );
});

const VISUDO = spawnSync("bash", ["-c", "PATH=$PATH:/usr/sbin:/sbin; command -v visudo"], { encoding: "utf8" });
test(
  "2987: visudo accepts the deploy and breakglass sudoers files",
  { skip: VISUDO.status !== 0 && "needs visudo" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "ds-sudoers-"));
    try {
      for (const [name, content] of [
        ["90-ds-deploy", scriptDeploySudoers()],
        ["91-ds-breakglass", SCRIPT_TEXT.match(/^sudoers_line='([^']*)'$/m)[1]],
      ]) {
        writeFileSync(join(dir, name), content, { mode: 0o440 });
        const r = spawnSync(VISUDO.stdout.trim(), ["-cf", join(dir, name)], { encoding: "utf8" });
        assert.equal(r.status, 0, `${name}: ${r.stdout}${r.stderr}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("2984: the drop-in turns root and password login off and caps MaxStartups", () => {
  const conf = scriptDropin()
    .split("\n")
    .filter((l) => l && !l.startsWith("#"));
  assert.deepEqual(conf, [
    "PermitRootLogin no",
    "PasswordAuthentication no",
    "KbdInteractiveAuthentication no",
    "MaxStartups 10:30:60",
    "PermitUserEnvironment no",
  ]);
});

const OPERATOR = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOPERATORKEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx deploy@ds-api-prod";
const BREAKGLASS = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBREAKGLASSxxxxxxxxxxxxxxxxxxxxxxxxxxxx owner-breakglass";
const CI_STAGE = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICISTAGEKEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxx gha-stage";
const CI_PROD = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICIPRODKEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx gha-prod";
const FORCED =
  'command="/usr/local/bin/ds-deploy-entrypoint",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding';
const FORCED_PROD =
  'command="sudo -n /usr/local/bin/ds-deploy-entrypoint",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-user-rc';
const HOP = 'restrict,from="192.168.0.20" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHOPKEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx ds-api-prod-hop';
const HOP_FORCED = `command="sudo -n /usr/local/bin/ds-deploy-entrypoint",${HOP}`;
const CLOUD_INIT_USERS = "# Created by cloud-init\n\n# User rules for deploy\ndeploy ALL=(ALL) NOPASSWD:ALL\n";
const GROUPS = "root:x:0:\nsudo:x:27:deploy\ndocker:x:999:deploy\ndeploy:x:1000:\n";

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
    writeFileSync(join(root, "etc/group"), GROUPS);
    writeFileSync(join(root, "etc/sudoers.d/90-cloud-init-users"), CLOUD_INIT_USERS);
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
        '  -T) [[ -n ${STUB_SSHD_T_WEAK:-} ]] && exit 0',
        "      printf '%s\\n' 'permitrootlogin no' 'passwordauthentication no' 'kbdinteractiveauthentication no' 'maxstartups 10:30:60' 'permituserenvironment no' ;;",
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
    // Real syntax is checked by the visudo test above; the stub refuses only a file
    // that would still give deploy everything.
    stub("visudo", '! grep -q "^deploy ALL=(ALL)" "$2" && exit "${STUB_VISUDO_RC:-0}"');
    stub(
      "gpasswd",
      [
        '[[ $1 == --root ]] && { prefix=$2; shift 2; }',
        '[[ $1 == -d ]] || exit 2',
        '[[ -z ${STUB_GPASSWD_RC:-} ]] || exit "$STUB_GPASSWD_RC"',
        'sed -E -i "/^$3:/ { s/([:,])$2(,|\\$)/\\1/; s/,\\$// }" "$prefix/etc/group"',
      ].join("\n"),
    );
    stub(
      "useradd",
      [
        "prefix=",
        '[[ $1 == --prefix ]] && prefix=$2',
        'echo "breakglass:x:1001:1001::/home/breakglass:/bin/bash" >> "$prefix/etc/passwd"',
        '[[ -z ${STUB_USERADD_FAIL:-} ]] || exit 1',
        'mkdir -p "$prefix/home/breakglass"',
      ].join("\n"),
    );
    stub("chown", "");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (args, env = {}) => {
    const r = spawnSync("bash", [SCRIPT, ...args], {
      env: {
        ...process.env,
        PATH: `${stubs}${delimiter}${process.env.PATH}`,
        STUB_DIR: dir,
        HARDEN_ROOT: root,
        SUDO_USER: "breakglass",
        ...env,
      },
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
  const prodArgs = (...extra) => [
    "--role",
    "prod",
    "--breakglass-pubkey",
    join(keys, "breakglass.pub"),
    "--ci-pubkey",
    join(keys, "ci-prod.pub"),
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
    // #2987: stage keeps deploy's sudo, groups and operator key.
    assert.ok(!existsSync(join(root, "etc/sudoers.d/90-ds-deploy")));
    assert.equal(read("etc/sudoers.d/90-cloud-init-users"), CLOUD_INIT_USERS);
    assert.equal(read("etc/group"), GROUPS);
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

  it("refuses a --ci-pubkey already on an unrestricted deploy line (the operator key), changing nothing", () => {
    writeFileSync(join(keys, "operator.pub"), `${OPERATOR}\n`);
    const before = snapshot();
    const r = run(["--role", "stage", "--breakglass-pubkey", join(keys, "breakglass.pub"), "--ci-pubkey", join(keys, "operator.pub")]);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /already an unrestricted key of deploy/);
    assert.deepEqual(snapshot(), before);
    assert.equal(calls(), "");
  });

  it("empties root's keys only after breakglass is in place: a failed useradd leaves them", () => {
    const r = run(stageArgs(), { STUB_USERADD_FAIL: "1" });
    assert.notEqual(r.status, 0, r.out);
    assert.equal(read("root/.ssh/authorized_keys"), `${OPERATOR}\n`);
  });

  it("does not reload, and restores the sshd files, when sshd -T misses a hardened value", () => {
    const r = run(stageArgs(), { STUB_SSHD_T_WEAK: "1" });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /sshd -T does not show/);
    assert.doesNotMatch(calls(), /reload/);
    assert.ok(!existsSync(join(root, "etc/ssh/sshd_config.d/10-ds-hardening.conf")), "drop-in removed");
    assert.equal(read("etc/ssh/sshd_config"), SSHD_CONFIG, "main config restored byte for byte");
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
    assert.equal(read("root/.ssh/authorized_keys"), `${OPERATOR}\n`, "root's keys untouched");
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

  it("2987: on prod, deploy keeps the entrypoint as root and nothing else", () => {
    // A CI key already present in the stage form is moved to the prod form.
    writeFileSync(join(root, "home/deploy/.ssh/authorized_keys"), `${OPERATOR}\n# note\n${FORCED} ${CI_PROD}\n`);
    const r = run(prodArgs());
    assert.equal(r.status, 0, r.out);
    assert.equal(read("home/deploy/.ssh/authorized_keys"), `${FORCED_PROD} ${CI_PROD}\n`, "the operator key is gone");
    assert.equal(read("etc/sudoers.d/90-ds-deploy"), scriptDeploySudoers());
    assert.equal(read("etc/sudoers.d/90-cloud-init-users"), "# Created by cloud-init\n\n# User rules for deploy\n");
    assert.equal(read("etc/group"), "root:x:0:\nsudo:x:27:\ndocker:x:999:\ndeploy:x:1000:\n");
    assert.equal(read("etc/ds-platform/box-role"), "prod\n");
    const log = calls();
    assert.match(log, /^gpasswd --root .* -d deploy sudo$/m);
    assert.match(log, /^gpasswd --root .* -d deploy docker$/m);
    assert.equal(log.match(/^visudo -cf /gm).length, 3, "breakglass, deploy, cloud-init-users");
    assert.ok(!readdirSync(join(root, "etc/sudoers.d")).some((f) => f.includes(".")), "no temp file left");
    const before = snapshot();
    rmSync(join(dir, "calls.log"));
    const again = run(prodArgs());
    assert.equal(again.status, 0, again.out);
    assert.match(again.out, /nothing to change/);
    assert.deepEqual(snapshot(), before);
    assert.doesNotMatch(calls(), /visudo|gpasswd|reload/);
  });

  it("2987: on prod, nothing of deploy's goes unless the run comes from a breakglass session", () => {
    for (const sudoUser of ["deploy", ""]) {
      const r = run(prodArgs(), { SUDO_USER: sudoUser });
      assert.notEqual(r.status, 0, r.out);
      assert.match(r.out, /from a breakglass session/);
      assert.equal(read("home/deploy/.ssh/authorized_keys"), `${OPERATOR}\n${FORCED_PROD} ${CI_PROD}\n`);
      assert.equal(read("etc/sudoers.d/90-cloud-init-users"), CLOUD_INIT_USERS);
      assert.equal(read("etc/group"), GROUPS);
    }
    const dry = run(prodArgs("--dry-run"), { SUDO_USER: "deploy" });
    assert.equal(dry.status, 0, dry.out);
    const ok = run(prodArgs(), { SUDO_USER: "breakglass" });
    assert.equal(ok.status, 0, ok.out);
    assert.equal(read("home/deploy/.ssh/authorized_keys"), `${FORCED_PROD} ${CI_PROD}\n`);
  });

  it("2987: on prod, a run with no CI key still leaves no unrestricted deploy line", () => {
    const r = run(["--role", "prod", "--breakglass-pubkey", join(keys, "breakglass.pub")]);
    assert.equal(r.status, 0, r.out);
    assert.equal(read("home/deploy/.ssh/authorized_keys"), "");
  });

  it("2987: on prod, nothing of deploy's goes while breakglass is not in place", () => {
    const r = run(prodArgs(), { STUB_USERADD_FAIL: "1" });
    assert.notEqual(r.status, 0, r.out);
    assert.equal(read("home/deploy/.ssh/authorized_keys"), `${OPERATOR}\n`);
    assert.equal(read("etc/sudoers.d/90-cloud-init-users"), CLOUD_INIT_USERS);
    assert.equal(read("etc/group"), GROUPS);
  });

  it("2987: on prod, a deploy sudoers file visudo rejects changes none of deploy's rights", () => {
    writeFileSync(join(stubs, "visudo"), '#!/usr/bin/env bash\ngrep -q "^deploy ALL=(root)" "$2" && exit 1\nexit 0\n');
    const r = run(prodArgs());
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /visudo rejected the deploy sudoers file/);
    assert.ok(!existsSync(join(root, "etc/sudoers.d/90-ds-deploy")));
    assert.equal(read("etc/sudoers.d/90-cloud-init-users"), CLOUD_INIT_USERS);
    assert.equal(read("etc/group"), GROUPS);
    assert.match(read("home/deploy/.ssh/authorized_keys"), /deploy@ds-api-prod/);
  });

  it("2987: --dry-run on prod names the narrowing and changes nothing", () => {
    const before = snapshot();
    const r = run(prodArgs("--dry-run"));
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /would write .*90-ds-deploy/);
    assert.match(r.out, /would remove deploy's rule from .*90-cloud-init-users/);
    assert.match(r.out, /would remove deploy from group sudo/);
    assert.match(r.out, /would remove deploy from group docker/);
    assert.match(r.out, /would remove every deploy key not behind the prod forced command/);
    assert.deepEqual(snapshot(), before);
  });

  // #3313: the data box. The installed entrypoint serves the data verbs (a release ran)
  // and deploy holds the operator key plus the one hop line of ds-api-prod.
  const dataArgs = (...extra) => ["--role", "data", "--breakglass-pubkey", join(keys, "breakglass.pub"), ...extra];
  const dataBox = ({ entrypoint = "DATA_VERBS='capabilities ship'\n", deployKeys = `${OPERATOR}\n${HOP}\n` } = {}) => {
    mkdirSync(join(root, "usr/local/bin"), { recursive: true });
    if (entrypoint !== null) writeFileSync(join(root, "usr/local/bin/ds-deploy-entrypoint"), entrypoint);
    writeFileSync(join(root, "home/deploy/.ssh/authorized_keys"), deployKeys);
  };

  it("3313: on data, the hop key reaches only the entrypoint as root and deploy holds nothing else", () => {
    dataBox();
    const r = run(dataArgs());
    assert.equal(r.status, 0, r.out);
    assert.equal(read("home/deploy/.ssh/authorized_keys"), `${HOP_FORCED}\n`, "the operator key is gone");
    assert.equal(read("etc/sudoers.d/90-ds-deploy"), scriptDeploySudoers());
    assert.equal(read("etc/sudoers.d/90-cloud-init-users"), "# Created by cloud-init\n\n# User rules for deploy\n");
    assert.equal(read("etc/group"), "root:x:0:\nsudo:x:27:\ndocker:x:999:\ndeploy:x:1000:\n");
    assert.equal(read("etc/ds-platform/box-role"), "data\n");
    assert.equal(read("root/.ssh/authorized_keys"), "");
    const before = snapshot();
    rmSync(join(dir, "calls.log"));
    const again = run(dataArgs());
    assert.equal(again.status, 0, again.out);
    assert.match(again.out, /nothing to change/);
    assert.deepEqual(snapshot(), before);
    assert.doesNotMatch(calls(), /visudo|gpasswd|reload/);
  });

  it("3313: on data, nothing changes while the installed entrypoint serves no data verbs", () => {
    for (const entrypoint of [null, "#!/usr/bin/env bash\nOBSERVATIONS='x'\n"]) {
      dataBox({ entrypoint });
      const before = snapshot();
      const r = run(dataArgs());
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, /serves no data verbs: run a release first/);
      assert.deepEqual(snapshot(), before);
      assert.equal(calls(), "");
    }
  });

  it("3313: on data, nothing changes unless deploy holds exactly one hop line", () => {
    for (const deployKeys of [`${OPERATOR}\n`, `${HOP}\n${HOP.replace("0.20", "0.21")}\n`, `${OPERATOR}\n${HOP_FORCED}\n${HOP}\n`]) {
      dataBox({ deployKeys });
      const before = snapshot();
      const r = run(dataArgs());
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, /hop lines .* not exactly one; nothing was changed/);
      assert.deepEqual(snapshot(), before);
      assert.equal(calls(), "");
    }
  });

  it("3313: on data, a hop line already behind the forced command is kept and the rest goes", () => {
    dataBox({ deployKeys: `${OPERATOR}\n# note\n${HOP_FORCED}\n` });
    const r = run(dataArgs());
    assert.equal(r.status, 0, r.out);
    assert.equal(read("home/deploy/.ssh/authorized_keys"), `${HOP_FORCED}\n`);
  });

  it("3313: on data, nothing of deploy's goes unless the run comes from a breakglass session", () => {
    dataBox();
    const r = run(dataArgs(), { SUDO_USER: "deploy" });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /run --role data from a breakglass session/);
    assert.equal(read("home/deploy/.ssh/authorized_keys"), `${OPERATOR}\n${HOP}\n`);
    assert.equal(read("etc/sudoers.d/90-cloud-init-users"), CLOUD_INIT_USERS);
    assert.equal(read("etc/group"), GROUPS);
  });

  it("3313: --dry-run on data names the narrowing and changes nothing", () => {
    dataBox();
    const before = snapshot();
    const r = run(dataArgs("--dry-run"), { SUDO_USER: "deploy" });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /would write .*90-ds-deploy/);
    assert.match(r.out, /would remove deploy's rule from .*90-cloud-init-users/);
    assert.match(r.out, /would remove deploy from group sudo/);
    assert.match(r.out, /would put the hop key behind the forced command and remove every other deploy key/);
    assert.deepEqual(snapshot(), before);
  });

  it("3313: --role data takes no CI key", () => {
    dataBox();
    const r = run(dataArgs("--ci-pubkey", join(keys, "ci-prod.pub")));
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /takes no --ci-pubkey/);
    assert.equal(calls(), "");
  });

  // #3320: the prod release converges ds-data-prod itself, over the hop, as deploy
  // (SUDO_USER=deploy): box-side checks that the break-glass path is in place and
  // usable take the place of the breakglass-session proof.
  const releaseArgs = (...extra) => ["--role", "data", "--from-release", ...extra];
  const breakglassBox = ({
    passwd = "breakglass:x:1001:1001::/home/breakglass:/bin/bash\n",
    shadow = "breakglass:!:20000:0:99999:7:::\n",
    keys: bgKeys = `${BREAKGLASS}\n`,
    sudoers = "breakglass ALL=(ALL) NOPASSWD:ALL\n",
  } = {}) => {
    writeFileSync(join(root, "etc/passwd"), `root:x:0:0::/root:/bin/bash\ndeploy:x:1000:1000::/home/deploy:/bin/bash\n${passwd}`);
    writeFileSync(join(root, "etc/shadow"), `root:*:20000:0:99999:7:::\ndeploy:!:20000:0:99999:7:::\n${shadow}`);
    mkdirSync(join(root, "home/breakglass/.ssh"), { recursive: true });
    if (bgKeys !== null) writeFileSync(join(root, "home/breakglass/.ssh/authorized_keys"), bgKeys);
    if (sudoers !== null) writeFileSync(join(root, "etc/sudoers.d/91-ds-breakglass"), sudoers);
  };

  it("3320: from a release, data narrows as deploy once the break-glass path checks out, breakglass untouched", () => {
    dataBox();
    breakglassBox();
    const r = run(releaseArgs(), { SUDO_USER: "deploy" });
    assert.equal(r.status, 0, r.out);
    assert.equal(read("home/deploy/.ssh/authorized_keys"), `${HOP_FORCED}\n`, "the operator key is gone");
    assert.equal(read("etc/sudoers.d/90-ds-deploy"), scriptDeploySudoers());
    assert.equal(read("etc/sudoers.d/90-cloud-init-users"), "# Created by cloud-init\n\n# User rules for deploy\n");
    assert.equal(read("etc/group"), "root:x:0:\nsudo:x:27:\ndocker:x:999:\ndeploy:x:1000:\n");
    assert.equal(read("etc/ds-platform/box-role"), "data\n");
    assert.equal(read("root/.ssh/authorized_keys"), "");
    assert.equal(read("home/breakglass/.ssh/authorized_keys"), `${BREAKGLASS}\n`, "the box's own break-glass key stays");
    assert.equal(read("etc/sudoers.d/91-ds-breakglass"), "breakglass ALL=(ALL) NOPASSWD:ALL\n");
    assert.doesNotMatch(calls(), /useradd|chown/, "a release never writes the break-glass user");
    assert.match(calls(), /visudo -cf .*91-ds-breakglass/, "the break-glass sudoers file is checked");
    assert.match(calls(), /^sshd -t/m);
    const before = snapshot();
    rmSync(join(dir, "calls.log"));
    const again = run(releaseArgs(), { SUDO_USER: "deploy" });
    assert.equal(again.status, 0, again.out);
    assert.match(again.out, /nothing to change/);
    assert.deepEqual(snapshot(), before);
  });

  const NARROWED_GROUPS = "root:x:0:\nsudo:x:27:\ndocker:x:999:\ndeploy:x:1000:\n";

  it("3320: an interrupted converge (hop line already forced, deploy still holding the cloud-init rule and groups) is finished by the next release", () => {
    dataBox({ deployKeys: `${HOP_FORCED}\n` });
    breakglassBox();
    const r = run(releaseArgs(), { SUDO_USER: "root" });
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.out, /nothing to change/);
    assert.equal(read("home/deploy/.ssh/authorized_keys"), `${HOP_FORCED}\n`);
    assert.equal(read("etc/sudoers.d/90-ds-deploy"), scriptDeploySudoers());
    assert.equal(read("etc/sudoers.d/90-cloud-init-users"), "# Created by cloud-init\n\n# User rules for deploy\n");
    assert.equal(read("etc/group"), NARROWED_GROUPS);
  });

  it("3320: a converge that stopped after the hop rewrite and before its reload is finished, reload included, by the next release", () => {
    dataBox();
    breakglassBox();
    const stopped = run(releaseArgs(), { SUDO_USER: "root", STUB_GPASSWD_RC: "1" });
    assert.notEqual(stopped.status, 0, stopped.out);
    assert.equal(read("home/deploy/.ssh/authorized_keys"), `${HOP_FORCED}\n`, "the hop line went first");
    assert.notEqual(read("etc/group"), NARROWED_GROUPS, "deploy is still in a group");
    assert.doesNotMatch(calls(), /systemctl reload ssh/, "the run stopped before its reload");
    rmSync(join(dir, "calls.log"));
    const next = run(releaseArgs(), { SUDO_USER: "root" });
    assert.equal(next.status, 0, next.out);
    assert.equal(read("etc/group"), NARROWED_GROUPS);
    assert.match(calls(), /^systemctl reload ssh$/m, "the sshd files the stopped run wrote take effect");
  });

  for (const [what, box, env, message] of [
    ["no breakglass user", { passwd: "" }, {}, /no user breakglass/],
    ["a breakglass without a login shell", { passwd: "breakglass:x:1001:1001::/home/breakglass:/usr/sbin/nologin\n" }, {}, /breakglass has no login shell/],
    ["an expired breakglass account", { shadow: "breakglass:!:20000:0:99999:7::1:\n" }, {}, /breakglass is locked: its account expired/],
    ["no breakglass shadow entry", { shadow: "" }, {}, /breakglass is locked: no shadow entry/],
    ["no breakglass authorized_keys", { keys: null }, {}, /breakglass's authorized_keys holds no key/],
    ["a breakglass authorized_keys with comments only", { keys: "# none\n\n" }, {}, /breakglass's authorized_keys holds no key/],
    ["no breakglass sudoers file", { sudoers: null }, {}, /91-ds-breakglass grants breakglass no NOPASSWD sudo/],
    ["a breakglass sudoers file visudo rejects", {}, { STUB_VISUDO_RC: "1" }, /visudo -c rejects .*91-ds-breakglass/],
    ["sshd -t rejecting the new config", {}, { STUB_SSHD_T_RC: "1" }, /sshd -t rejected the config/],
  ]) {
    it(`3320: from a release, data refuses and changes nothing on ${what}`, () => {
      dataBox();
      breakglassBox(box);
      const before = snapshot();
      const r = run(releaseArgs(), { SUDO_USER: "deploy", ...env });
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, message);
      assert.match(r.out, /nothing was changed/);
      assert.deepEqual(snapshot(), before);
      assert.doesNotMatch(calls(), /gpasswd|reload|useradd/);
    });
  }

  it("3320: --dry-run from a release runs the break-glass checks and names the narrowing", () => {
    dataBox();
    breakglassBox();
    const before = snapshot();
    const r = run(releaseArgs("--dry-run"), { SUDO_USER: "deploy" });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /would put the hop key behind the forced command/);
    assert.deepEqual(snapshot(), before);
    breakglassBox({ keys: "" });
    assert.equal(run(releaseArgs("--dry-run"), { SUDO_USER: "deploy" }).status, 1);
  });

  it("3320: --from-release is data's, and takes no break-glass key", () => {
    dataBox();
    breakglassBox();
    for (const args of [
      ["--role", "prod", "--from-release"],
      ["--role", "stage", "--from-release"],
      releaseArgs("--breakglass-pubkey", join(keys, "breakglass.pub")),
      ["--role", "data"],
    ]) {
      const r = run(args, { SUDO_USER: "deploy" });
      assert.equal(r.status, 2, `${args.join(" ")}: ${r.out}`);
    }
    assert.equal(calls(), "");
  });

  it("3320: --role prod still narrows nothing of deploy's outside a breakglass session", () => {
    const r = run(prodArgs(), { SUDO_USER: "deploy" });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /run --role prod from a breakglass session/);
    assert.equal(read("etc/sudoers.d/90-cloud-init-users"), CLOUD_INIT_USERS);
    assert.equal(read("etc/group"), GROUPS);
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
