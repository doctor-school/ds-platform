// tools/deploy/verify-scripts.mjs — pure generators of the on-box shell the two
// deploy verify gates run (Issue #1905). `prod.mjs` owns the ssh exec, output
// parsing and verdicts (`verifyRunningSha` / `verifyImagesBoot`); this module only
// returns text, so the per-service fragments (variable names, `\` continuations,
// `[ … ] && [ … ]` chains) are unit-testable without a real prod deploy
// (`verify-scripts.test.mjs`). Both the Actions release path and break-glass
// `pnpm deploy:prod` run these strings — keep their output byte-stable.

import { shellVarName } from "./service-set.mjs";

// Container-name prefix compose derives from the project name (`name:
// ds-api-prod` in the api-prod compose file): `<project>-<service>-1`.
export const CONTAINER_PREFIX = "ds-api-prod-";

/**
 * Truthful-success poll (DSO-127): up to ~4 min, until every container of
 * `services` runs `<image>:<sha>` and reports healthy. Prints one
 * `OK <state>` or `TIMEOUT <state>` line.
 *
 * @param {string} sha
 * @param {{ name: string, image: string }[]} services the TARGET tree's set (#1896)
 * @returns {string}
 */
export function verifyRunningShaScript(sha, services) {
  const reads = services
    .map(
      (s) =>
        `  ${shellVarName(s.name)}_img=$(sudo docker inspect ${CONTAINER_PREFIX}${s.name}-1 --format '{{.Config.Image}}' 2>/dev/null || echo absent)\n` +
        `  ${shellVarName(s.name)}_h=$(sudo docker inspect ${CONTAINER_PREFIX}${s.name}-1 --format '{{.State.Health.Status}}' 2>/dev/null || echo absent)`,
    )
    .join("\n");
  const state = services
    .map(
      (s) =>
        `${s.name}=$${shellVarName(s.name)}_img($${shellVarName(s.name)}_h)`,
    )
    .join(" ");
  const condition = services
    .map(
      (s) =>
        `[ "$${shellVarName(s.name)}_img" = "${s.image}:${sha}" ] && [ "$${shellVarName(s.name)}_h" = healthy ]`,
    )
    .join(" \\\n     && ");
  return `deadline=$(( $(date +%s) + 240 ))
while true; do
${reads}
  state="${state}"
  if ${condition}; then
    echo "OK $state"; break
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "TIMEOUT $state"; break
  fi
  sleep 5
done`;
}

/**
 * Pre-swap boot probe (#1410): one throwaway container per probed service,
 * asserting a non-5xx `/` from inside it. Prints one `<svc>=<STATUS>` line per
 * service (plus its boot log when not OK).
 *
 * @param {string} sha
 * @param {{ name: string, image: string, port: number }[]} probedServices `bootProbeSet(...)`
 * @returns {string}
 */
export function bootProbeScript(sha, probedServices) {
  return `probe() {
  svc="$1"; repo="$2"; port="$3"
  name="ds-bootcheck-$svc"
  sudo docker rm -f "$name" >/dev/null 2>&1 || true
  # -e PORT after --env-file on purpose: an explicit -e outranks the env-file, the
  # same precedence compose \`environment:\` has over \`env_file:\` (DSO-100).
  if ! sudo docker run -d --name "$name" --env-file /etc/ds-platform/api.env \\
        -e PORT="$port" -e HOSTNAME=0.0.0.0 "$repo:${sha}" >/dev/null 2>&1; then
    echo "$svc=NOSTART"; return
  fi
  deadline=$(( $(date +%s) + 120 ))
  status=PENDING
  while [ "$status" = PENDING ]; do
    running=$(sudo docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || echo false)
    if sudo docker exec "$name" node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      status=OK
    elif [ "$running" != true ]; then
      status=EXITED
    elif [ "$(date +%s)" -ge "$deadline" ]; then
      status=TIMEOUT
    else
      sleep 3
    fi
  done
  echo "$svc=$status"
  if [ "$status" != OK ]; then
    echo "---- $svc boot log (last 60) ----"
    sudo docker logs --tail 60 "$name" 2>&1 || true
  fi
  sudo docker rm -f "$name" >/dev/null 2>&1 || true
}
${probedServices.map((s) => `probe ${s.name} ${s.image} ${s.port}`).join("\n")}`;
}
