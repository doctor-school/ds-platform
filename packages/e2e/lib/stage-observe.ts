import { spawn as nodeSpawn } from "node:child_process";
import { isAbsolute } from "node:path";

/**
 * The read transport of the box-observing stage scenarios (Issue #3119).
 *
 * An operator reads the stage box with its own ssh (each lib's `sshCapture` path).
 * The Actions runner holds only the CI key, whose forced command
 * (`infra/deploy/bin/ds-deploy-entrypoint`) admits `observe <name>`: one named,
 * read-only observation of the stage `main` slot, parameters as JSON on stdin.
 * `.github/workflows/stage.yml` selects it by exporting the three
 * `E2E_STAGE_OBSERVE_*` variables (paths and a destination, never the key itself).
 */
export const STAGE_OBSERVATIONS = [
  "academy-host",
  "password-policy",
  "mirror-count",
  "auth-consent",
  "phone-account-count",
  "congress-snapshot",
  "wrong-verification",
] as const;
export type StageObservationName = (typeof STAGE_OBSERVATIONS)[number];
export type StageObserve = (
  name: StageObservationName,
  params: Record<string, unknown>,
) => Promise<string>;
export interface StageObserveTarget {
  destination: string;
  keyFile: string;
  knownHostsFile: string;
}

const FAILURE = "Stage observation failed";
const VARIABLES = [
  "E2E_STAGE_OBSERVE_SSH",
  "E2E_STAGE_OBSERVE_KEY",
  "E2E_STAGE_OBSERVE_KNOWN_HOSTS",
] as const;

/** The CI observe transport, or `undefined` for the operator's own ssh. */
export function stageObserveTarget(
  env: NodeJS.ProcessEnv = process.env,
): StageObserveTarget | undefined {
  const [destination, keyFile, knownHostsFile] = VARIABLES.map(
    (name) => env[name] ?? "",
  ) as [string, string, string];
  if (!destination && !keyFile && !knownHostsFile) return undefined;
  if (
    !/^[a-z_][a-z0-9_-]{0,31}@[A-Za-z0-9.-]+$/.test(destination) ||
    !isAbsolute(keyFile) ||
    !isAbsolute(knownHostsFile)
  )
    throw new Error(
      "E2E_STAGE_OBSERVE_SSH / _KEY / _KNOWN_HOSTS must be set together: user@host and two absolute paths",
    );
  return { destination, keyFile, knownHostsFile };
}

export function observeSshArgv(
  target: StageObserveTarget,
  name: StageObservationName,
): string[] {
  return [
    "-i",
    target.keyFile,
    "-o",
    `UserKnownHostsFile=${target.knownHostsFile}`,
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    target.destination,
    `observe ${name}`,
  ];
}

type Spawn = typeof nodeSpawn;

/** ssh to the forced command; resolves stdout on exit 0, else one fixed error. */
export function createStageObserve(
  target: StageObserveTarget,
  spawn: Spawn = nodeSpawn,
): StageObserve {
  return (name, params) =>
    new Promise((resolve, reject) => {
      if (!STAGE_OBSERVATIONS.includes(name)) {
        reject(new Error(FAILURE));
        return;
      }
      // stderr is ignored: ssh and the box reasons stay out of the public log.
      const child = spawn("ssh", observeSshArgv(target, name), {
        stdio: ["pipe", "pipe", "ignore"],
        signal: AbortSignal.timeout(30_000),
      });
      const chunks: Buffer[] = [];
      child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.on("error", () => reject(new Error(FAILURE)));
      child.on("close", (code) =>
        code === 0
          ? resolve(Buffer.concat(chunks).toString("utf8"))
          : reject(new Error(FAILURE)),
      );
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(JSON.stringify(params));
    });
}

/**
 * The transport choice of a lib's stage read: an injected `observe` wins, an
 * injected `capture` keeps the operator path, otherwise the environment decides.
 */
export function chooseStageObserve(
  effects?: { capture?: unknown; observe?: StageObserve },
  env: NodeJS.ProcessEnv = process.env,
): StageObserve | undefined {
  if (effects?.observe) return effects.observe;
  if (effects?.capture) return undefined;
  const target = stageObserveTarget(env);
  return target && createStageObserve(target);
}

/** observe serves the `main` slot only; the browser origin must be its academy host. */
export async function assertObservedMainOrigin(
  observe: StageObserve,
  base: string,
  slot: string,
): Promise<void> {
  if (slot !== "main") throw new Error(FAILURE);
  const host: unknown = JSON.parse(await observe("academy-host", {}));
  if (
    !host ||
    typeof host !== "object" ||
    Object.keys(host).join() !== "academy" ||
    new URL(base).hostname !== (host as { academy: unknown }).academy
  )
    throw new Error(FAILURE);
}
