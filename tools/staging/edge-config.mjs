// The stg-infra edge config, owned by the stage `main` converge (#2920).
//
// The shared stg-infra compose on the stage box runs from /srv/ds-platform, a checkout
// nothing refreshes; its containers bind-mount files from that compose dir (the
// Caddyfile, postgresql.conf). Every `main` converge installs those files from the
// converged SHA's shipped tree and swaps the running containers onto them through the
// runtime-config mechanism prod uses (tools/deploy/lib/runtime-config.mjs): backup of
// what runs, install, `caddy validate` in the running caddy container (its real env),
// restart of only the stale services, the previous files put back on any failure.
// A PR slot never calls this: only `main` owns the shared edge.

import {
  applyRuntimeConfigsOrRestore,
  caddyValidateVerdict,
  runtimeConfigBackupScript,
  runtimeConfigComparisonScript,
  runtimeConfigRestoreScript,
  runtimeConfigServices,
  runtimeConfigStepVerdict,
} from "../deploy/lib/runtime-config.mjs";

export const STG_INFRA_COMPOSE_PATH = "infra/deploy/compose/stg-infra";
/** The compose dir the running stg-infra project was created from (its mount sources). */
export const STG_INFRA_COMPOSE_DIR = `/srv/ds-platform/${STG_INFRA_COMPOSE_PATH}`;
export const STG_INFRA_PROJECT = "stg-infra";
/** Root-only, outside the compose dir: the files the running containers served before. */
export const STG_INFRA_PREVIOUS_CONFIG_DIR =
  "/var/lib/ds-platform/stg-infra-edge-config/previous";
export const EDGE_CONFIG_MARKER = ".ds-edge-config";
const RESTART_HEALTH_POLLS = 90; // × 2 s: postgres' healthcheck start_period + retries

const SAFE_PATH_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/**
 * Every bind mount a compose file takes from its OWN dir (`./<file>:<path>`), by
 * service, in file order. Mounts of `../` sources, named volumes and long-syntax
 * entries are not the compose dir's files and are skipped.
 */
export function composeDirBindMounts(composeText) {
  const mounts = [];
  let inServices = false;
  let service = null;
  for (const raw of composeText.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    if (/^\S/.test(line)) {
      inServices = /^services:\s*$/.test(line);
      service = null;
      continue;
    }
    if (!inServices) continue;
    const key = line.match(/^ {2}([A-Za-z0-9._-]+):\s*$/);
    if (key) {
      service = key[1];
      continue;
    }
    const entry = line.match(
      /^\s+-\s+["']?\.\/([^:"'\s]+):([^:"'\s]+)(?::(?:ro|rw))?["']?\s*$/,
    );
    if (!entry || !service) continue;
    const [, file, mounted] = entry;
    if (
      !SAFE_PATH_RE.test(file) ||
      file.split("/").includes("..") ||
      !mounted.startsWith("/")
    ) {
      throw new Error(
        `refusing an unexpected compose-dir bind mount: ./${file}:${mounted}`,
      );
    }
    mounts.push({ service, file, mounted });
  }
  if (mounts.length === 0)
    throw new Error("the compose file declares no bind mount from its own dir");
  return mounts;
}

const CONTAINER_LOOKUP =
  `sudo docker ps -q --filter label=com.docker.compose.project=${STG_INFRA_PROJECT} ` +
  '--filter "label=com.docker.compose.service=$service"';

/**
 * The stg-infra compose as a runtime-config target. Containers are found by their
 * compose labels and restarted with `docker restart`: the compose CLI on this box
 * needs stage.env sourced for interpolation, and a restart (unlike a recreate) keeps
 * the slot-network attachments `slot up` made with `docker network connect`.
 */
export function stgInfraRuntimeConfigTarget(
  mounts,
  { composeDir = STG_INFRA_COMPOSE_DIR } = {},
) {
  return {
    composeDir,
    mounts,
    backupDir: STG_INFRA_PREVIOUS_CONFIG_DIR,
    containerLookup: CONTAINER_LOOKUP,
    restartScript: (services) => `set -u
for service in ${services.join(" ")}; do
  container_id=$(${CONTAINER_LOOKUP})
  [ -n "$container_id" ] || { echo "no running stg-infra container for $service" >&2; exit 1; }
  sudo docker restart "$container_id" >/dev/null || exit 1
  state=
  for _ in $(seq 1 ${RESTART_HEALTH_POLLS}); do
    state=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)
    case "$state" in healthy|running) break ;; esac
    sleep 2
  done
  case "$state" in
    healthy|running) echo "$service restarted ($state)" ;;
    *) echo "$service is $state after its restart" >&2; exit 1 ;;
  esac
done
`,
  };
}

/**
 * Copies each mounted file from the shipped tree's compose dir into the target's,
 * through a sibling temp file and a rename. Every source is checked before the first
 * file is replaced. `sourceDir` may start with `$HOME` (the slot tree).
 */
export function edgeConfigCopyScript({ sourceDir, target }) {
  const files = target.mounts.map((m) => m.file);
  return `set -u
src="${sourceDir}"
cd '${target.composeDir}' || { echo 'runtime-config-install=FAILED compose dir'; exit 0; }
${files.map((f) => `[ -f "$src/${f}" ] || { echo 'runtime-config-install=FAILED ${f}'; exit 0; }`).join("\n")}
${files
  .map(
    (f) =>
      `{ sudo cp "$src/${f}" '${f}.ds-new' && sudo chmod 0644 '${f}.ds-new' && sudo mv -f '${f}.ds-new' '${f}'; } || { echo 'runtime-config-install=FAILED ${f}'; exit 0; }`,
  )
  .join("\n")}
echo 'runtime-config-install=done ${files.join(" + ")}'
`;
}

/**
 * `caddy validate` of the compose dir's Caddyfile inside the RUNNING caddy container
 * (the exact binary and modules that will serve it). The candidate goes in on stdin to
 * a temp path; the live config is untouched.
 *
 * The converge log is public, and a validator error can echo the adapted config, so the
 * container's real stage.env values never reach the validator: every variable the
 * Caddyfile reads (`{$X}` / `{env.X}`, derived from the file itself) is overridden with
 * a syntactically valid stand-in — a bcrypt hash of a throwaway password for a `*HASH*`
 * variable, a reserved test domain for a `*DOMAIN*` one — as tools/ci/validate-caddyfiles.sh
 * does. Only the verdict and the validator's error lines are printed, never its raw output.
 */
export function caddyValidateInContainerScript(target) {
  return `set -u
cd '${target.composeDir}' || exit 1
service=caddy
container_id=$(${target.containerLookup} 2>/dev/null || true)
if [ -z "$container_id" ]; then
  echo 'caddy-validate=NO-CONTAINER'
  exit 0
fi
image=$(sudo docker inspect -f '{{.Config.Image}}' "$container_id" 2>/dev/null || true)
names=$(grep -oE '[{]([$]|env[.])[A-Za-z_][A-Za-z0-9_]*' Caddyfile | sed -E 's/^[{]([$]|env[.])//' | sort -u)
stand_ins=()
for name in $names; do
  case "$name" in
    *HASH*)
      hash=$(sudo docker exec "$container_id" caddy hash-password --plaintext ds-validate 2>/dev/null || true)
      [ -n "$hash" ] || { echo 'caddy-validate=NO-STAND-IN-HASH'; exit 0; }
      stand_ins+=(-e "$name=$hash") ;;
    *DOMAIN*) stand_ins+=(-e "$name=stage.example.test") ;;
    *) stand_ins+=(-e "$name=ds-validate-stand-in") ;;
  esac
done
log=$(mktemp)
if sudo docker exec -i \${stand_ins[@]+"\${stand_ins[@]}"} "$container_id" sh -c 'f=/tmp/Caddyfile.ds-validate; cat >"$f" && caddy validate --adapter caddyfile --config "$f"; rc=$?; rm -f "$f"; exit $rc' \\
     <Caddyfile >"$log" 2>&1; then
  echo "caddy-validate=VALID \${image:-unknown}"
else
  echo "caddy-validate=INVALID \${image:-unknown}"
  echo '---- caddy validate (error lines only) ----'
  grep -iE '(^|[^a-z])error' "$log" | tail -n 5 | cut -c1-400
fi
rm -f "$log"
`;
}

/** Records the installed SHA and time beside the files and prints them. */
export function edgeConfigMarkerScript({ sha, now, target }) {
  if (!/^[0-9a-f]{40}$/.test(String(sha)))
    throw new Error(`the edge config marker needs a full SHA, got: ${sha}`);
  const at = now.toISOString();
  return `set -eu
cd '${target.composeDir}'
printf 'sha=%s\\ninstalled=%s\\n' '${sha}' '${at}' | sudo tee '${EDGE_CONFIG_MARKER}.ds-new' >/dev/null
sudo chmod 0644 '${EDGE_CONFIG_MARKER}.ds-new'
sudo mv -f '${EDGE_CONFIG_MARKER}.ds-new' '${EDGE_CONFIG_MARKER}'
echo 'stage-edge-config=installed ${sha} at ${at} (${target.composeDir}/${EDGE_CONFIG_MARKER})'
`;
}

const indent = (out) =>
  String(out ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => `      ${l}`)
    .join("\n");

/**
 * The converge step. `capture(script)` runs a script on the box and resolves its
 * stdout (rejecting on a non-zero exit). Throws on any failure, after the previous
 * files are back on disk (and, past a restart, the services back on them).
 */
export async function applyStageEdgeConfig({
  sha,
  sourceDir,
  capture,
  log = (message) => console.log(message),
  now = () => new Date(),
}) {
  const mounts = composeDirBindMounts(
    await capture(`cat "${sourceDir}/compose.yml"\n`),
  );
  const target = stgInfraRuntimeConfigTarget(mounts);
  log(
    `      edge config files: ${mounts.map((m) => `${m.file} (${m.service})`).join(", ")}`,
  );

  const backup = runtimeConfigStepVerdict(
    await capture(runtimeConfigBackupScript(sha, target)).catch(
      (e) => `runtime-config-backup=FAILED ${e.message}`,
    ),
    "backup",
  );
  if (!backup.ok) {
    throw new Error(
      `cannot keep the running stg-infra edge config (${backup.detail}) — nothing was installed`,
    );
  }
  log(`      previous files kept in ${target.backupDir}: ${backup.detail}`);

  const restoreOnDisk = async (reason) => {
    const restored = runtimeConfigStepVerdict(
      await capture(runtimeConfigRestoreScript(target)).catch(
        (e) => `runtime-config-restore=FAILED ${e.message}`,
      ),
      "restore",
    );
    throw new Error(
      `${reason}; ${
        restored.ok
          ? `the previous edge config files were put back on disk — ${restored.detail}`
          : `the previous edge config files were NOT put back on disk (${restored.detail})`
      }`,
    );
  };

  const install = runtimeConfigStepVerdict(
    await capture(edgeConfigCopyScript({ sourceDir, target })).catch(
      (e) => `runtime-config-install=FAILED ${e.message}`,
    ),
    "install",
  );
  if (!install.ok) await restoreOnDisk(`edge config install ${install.detail}`);

  if (mounts.some((m) => m.service === "caddy" && m.file === "Caddyfile")) {
    const out = await capture(caddyValidateInContainerScript(target)).catch(
      (e) => `caddy-validate=FAILED ${e.message}`,
    );
    log(indent(out));
    const verdict = caddyValidateVerdict(out);
    if (!verdict.ok) await restoreOnDisk(verdict.reason);
  }

  const { restarted } = await applyRuntimeConfigsOrRestore({
    target,
    compare: () => capture(runtimeConfigComparisonScript(target)),
    restart: async (script) => log(indent(await capture(script))),
    restore: () => capture(runtimeConfigRestoreScript(target)),
    log,
  });
  log(
    indent(await capture(edgeConfigMarkerScript({ sha, now: now(), target }))),
  );
  return { restarted, services: runtimeConfigServices(target) };
}
