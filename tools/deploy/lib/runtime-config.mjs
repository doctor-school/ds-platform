// The runtime-config mechanism of a box's edge compose (#2801, #3274, #2920): the files a
// compose dir bind-mounts into its running containers, compared through those
// containers, backed up, validated, swapped onto by a restart of only the stale
// services, and put back on any failure.
//
// One mechanism, two targets: prod's api compose (tools/deploy/prod.mjs, caddy +
// centrifugo) and the stage box's shared stg-infra compose (tools/staging/slot.mjs, the
// stage `main` converge). A target names its compose dir, its mounts, where the
// previous files are kept, how a service's running container is found and how the
// stale services are restarted; every script below is generated from it.
//
// Single-file bind mounts stay pinned to the inode they were created with, so a file
// replaced on disk is served only after its container restarts. The comparison reads
// the mounted file through the RUNNING container via `docker exec cat` — `docker cp` on
// a single-file bind mount resolves to the HOST source path and so always reads the new
// file (#2801). A missing/unreadable comparison is conservatively stale. The
// post-restart comparison is the fail-closed proof that the new bytes are mounted.

/**
 * @typedef {{ service: string, file: string, mounted: string }} RuntimeConfigMount
 * @typedef {{
 *   composeDir: string,
 *   mounts: RuntimeConfigMount[],
 *   backupDir: string,
 *   containerLookup: string,
 *   restartScript: (services: string[]) => string,
 * }} RuntimeConfigTarget
 * `containerLookup` is a shell command printing the container id of the service named
 * by the shell variable `$service`; `restartScript` the body that restarts `services`.
 */

/** The services of a target, in its mount order, each once. */
export function runtimeConfigServices(target) {
  return [...new Set(target.mounts.map((m) => m.service))];
}

export function runtimeConfigComparisonScript(target) {
  return `cd ${target.composeDir}
mounted_file_matches() {
  local service="$1" shipped_path="$2" mounted_path="$3"
  local container_id mounted_copy result
  container_id=$(${target.containerLookup})
  [ -n "$container_id" ] || return 1
  mounted_copy=$(mktemp)
  if sudo docker exec "$container_id" cat "$mounted_path" >"$mounted_copy" 2>/dev/null \\
     && sudo cmp -s "$shipped_path" "$mounted_copy"; then
    result=0
  else
    result=1
  fi
  sudo rm -f "$mounted_copy"
  return "$result"
}
${target.mounts
  .map(
    (m) => `if mounted_file_matches ${m.service} ${m.file} ${m.mounted}; then
  echo '${m.service}=match'
else
  echo '${m.service}=mismatch'
fi
`,
  )
  .join("")}`;
}

/**
 * The services to restart: every one not reported `=match`. A service with several
 * mounts matches only when all of them do (its last line wins only if every line of it
 * says match).
 */
export function runtimeConfigServicesToRestart(comparisonOutput, target) {
  const lines = comparisonOutput.split(/\r?\n/);
  const mismatched = new Set(
    lines
      .filter((line) => line.endsWith("=mismatch"))
      .map((line) => line.slice(0, -"=mismatch".length)),
  );
  const matches = new Set(
    lines
      .filter((line) => line.endsWith("=match"))
      .map((line) => line.slice(0, -"=match".length)),
  );
  return runtimeConfigServices(target).filter(
    (service) => !matches.has(service) || mismatched.has(service),
  );
}

export function runtimeConfigRestartScript(services, target) {
  const known = runtimeConfigServices(target);
  if (
    services.length === 0 ||
    services.some((service) => !known.includes(service))
  ) {
    throw new Error("runtime config restart needs known service names");
  }
  return target.restartScript(services);
}

function assertFullSha(sha) {
  if (!/^[0-9a-f]{40}$/.test(String(sha)))
    throw new Error(`runtime config backup needs a full SHA, got: ${sha}`);
}

function mountSubdirs(target) {
  const dirs = [
    ...new Set(
      target.mounts
        .map((m) => m.file.split("/").slice(0, -1).join("/"))
        .filter(Boolean),
    ),
  ];
  return dirs.length ? dirs.map((d) => `"$dir/${d}"`).join(" ") : '"$dir"';
}

/**
 * The backup of the configs the running containers serve, taken for the release
 * (or rollback) of `sha`. A re-entered run of the same SHA keeps the backup its first
 * entry took — by then the tree, or even the mounts, may already carry the new bytes.
 * A new SHA retakes it through the running containers (the bytes actually served,
 * whatever an earlier failed run left on disk); only a service whose container cannot
 * be read falls back to the file on disk. A rollback records its own key
 * (`rollback-<sha>`): the backup a forward release of that same SHA once took holds the
 * configs from before it, not the running ones.
 */
export function runtimeConfigBackupScript(
  sha,
  target,
  { rollback = false } = {},
) {
  assertFullSha(sha);
  const key = rollback ? `rollback-${sha}` : sha;
  return `set -u
cd '${target.composeDir}' || exit 1
dir='${target.backupDir}'
recorded=$(sudo cat "$dir/for" 2>/dev/null || true)
if [ "$recorded" = '${key}' ]; then
  echo 'runtime-config-backup=kept ${key}'
  exit 0
fi
# umask 077: the backup dir and its files are root 0700/0600 as they are created.
umask 077
sudo mkdir -p ${mountSubdirs(target)} || exit 1
sudo rm -f "$dir/for"
copy=$(mktemp)
save() {
  local service="$1" shipped_path="$2" mounted_path="$3" container_id source
  container_id=$(${target.containerLookup} 2>/dev/null || true)
  if [ -n "$container_id" ] && sudo docker exec "$container_id" cat "$mounted_path" >"$copy" 2>/dev/null; then
    source=running
  elif sudo cat "$shipped_path" >"$copy" 2>/dev/null; then
    source=disk
  else
    echo "runtime-config-backup=FAILED $service"
    sudo rm -f "$copy"
    exit 1
  fi
  sudo cp "$copy" "$dir/$shipped_path" || exit 1
  echo "$service=$source"
}
${target.mounts.map((m) => `save ${m.service} ${m.file} ${m.mounted}`).join("\n")}
sudo rm -f "$copy"
printf '%s\\n' '${key}' | sudo tee "$dir/for" >/dev/null || exit 1
echo 'runtime-config-backup=taken ${key}'
`;
}

/** Puts the backed-up configs back into the compose dir; prints its verdict line. */
export function runtimeConfigRestoreScript(target) {
  return `set -u
cd '${target.composeDir}' || exit 1
dir='${target.backupDir}'
recorded=$(sudo cat "$dir/for" 2>/dev/null || true)
if [ -z "$recorded" ]; then
  echo 'runtime-config-restore=NO-BACKUP'
  exit 0
fi
${target.mounts
  .map(
    (m) =>
      `{ sudo cp "$dir/${m.file}" '${m.file}.ds-restore' && sudo chmod 0644 '${m.file}.ds-restore' && sudo mv -f '${m.file}.ds-restore' '${m.file}'; } || { echo 'runtime-config-restore=FAILED ${m.file}'; exit 0; }`,
  )
  .join("\n")}
echo "runtime-config-restore=restored (backup taken for $recorded)"
`;
}

/** The verdict line of a backup, restore or install script: `{ ok, detail }`, fail-closed. */
export function runtimeConfigStepVerdict(output, kind) {
  const line = String(output ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith(`runtime-config-${kind}=`));
  if (!line) return { ok: false, detail: `no runtime-config-${kind} verdict` };
  const detail = line.slice(`runtime-config-${kind}=`.length);
  const ok =
    kind === "backup"
      ? /^(kept|taken) /.test(detail)
      : kind === "install"
        ? detail.startsWith("done")
        : detail.startsWith("restored ");
  return { ok, detail };
}

/** The verdict of a caddy validate script: only an explicit VALID passes. */
export function caddyValidateVerdict(output) {
  const line = String(output ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith("caddy-validate="));
  if (!line) return { ok: false, reason: "no caddy-validate verdict" };
  const verdict = line.slice("caddy-validate=".length);
  if (/^VALID \S+$/.test(verdict))
    return { ok: true, image: verdict.slice("VALID ".length) };
  return { ok: false, reason: `Caddyfile ${verdict}` };
}

/**
 * Writes the given runtime config files into the compose dir. Base64 keeps the bytes
 * exact through the script transport.
 */
export function runtimeConfigInstallScript(files, target) {
  const known = target.mounts.map((m) => m.file);
  const names = Object.keys(files);
  if (
    names.length !== known.length ||
    names.some((name) => !known.includes(name))
  ) {
    throw new Error(
      `runtime config install needs exactly ${known.join(" + ")}`,
    );
  }
  return `set -eu
cd '${target.composeDir}'
${known
  .map(
    (name) =>
      `printf '%s' '${Buffer.from(files[name], "utf8").toString("base64")}' | base64 -d | sudo tee '${name}.ds-new' >/dev/null
sudo chmod 0644 '${name}.ds-new'
sudo mv -f '${name}.ds-new' '${name}'`,
  )
  .join("\n")}
echo 'runtime-config-install=done'
`;
}

/**
 * Compares, restarts only the stale services, and re-compares: the re-compare is the
 * proof the new bytes are mounted. Throws naming what is still stale.
 */
export async function applyRuntimeConfigs({
  target,
  compare,
  restart,
  log = (message) => console.log(message),
}) {
  const beforeApply = await compare();
  const servicesToRestart = runtimeConfigServicesToRestart(beforeApply, target);
  if (servicesToRestart.length > 0) {
    log(`      stale bind mount(s): ${servicesToRestart.join(", ")}`);
    await restart(runtimeConfigRestartScript(servicesToRestart, target));
  } else {
    log(
      runtimeConfigServices(target).length === 2
        ? "      both running mounts already match — no restart"
        : "      every running mount already matches — no restart",
    );
  }

  const afterApply = await compare();
  const staleAfterApply = runtimeConfigServicesToRestart(afterApply, target);
  if (staleAfterApply.length > 0) {
    throw new Error(
      `runtime config apply did not mount the shipped file(s): ${staleAfterApply.join(", ")}`,
    );
  }
  return { restarted: servicesToRestart };
}

/**
 * `applyRuntimeConfigs`, and on its failure the previous configs back on disk, every
 * service restarted onto them and re-compared. Throws with the restore's result.
 */
export async function applyRuntimeConfigsOrRestore({
  target,
  compare,
  restart,
  restore,
  log,
}) {
  try {
    return await applyRuntimeConfigs({ target, compare, restart, log });
  } catch (err) {
    const restored = runtimeConfigStepVerdict(
      await restore().catch(
        (e) => `runtime-config-restore=FAILED ${e.message}`,
      ),
      "restore",
    );
    const services = runtimeConfigServices(target);
    let result;
    if (!restored.ok) {
      result = `the previous configs were NOT restored (${restored.detail})`;
    } else {
      try {
        await restart(runtimeConfigRestartScript(services, target));
        const stale = runtimeConfigServicesToRestart(await compare(), target);
        result =
          stale.length === 0
            ? `the previous configs were restored and ${services.join(" + ")} restarted onto them — ${restored.detail}`
            : `the previous configs were restored on disk but ${stale.join(", ")} still do(es) not mount them — ${restored.detail}`;
      } catch (e) {
        result = `the previous configs were restored on disk, but the restart onto them failed (${e.message}) — ${restored.detail}`;
      }
    }
    throw new Error(`${err.message}; ${result}`, { cause: err });
  }
}
