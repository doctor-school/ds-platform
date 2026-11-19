import { readFile } from "node:fs/promises";

import {
  assertObservedMainOrigin,
  chooseStageObserve,
} from "./stage-observe.js";

interface PartnershipObservation {
  count: number;
  privateRecord: boolean;
}

const SYNTHETIC_CONTACT =
  /^partnership-4121-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}@example\.test$/;
const STAGE_ACADEMY = /^academy-(main|pr-[1-9]\d{0,9})\.[a-z0-9.-]+$/;
const FAILURE = "Stage partnership observation failed";

/** Recognizes the slot URL shape. The observer separately verifies the box domain. */
export function stageAcademyAddress(baseUrl: string | undefined) {
  if (!baseUrl) return undefined;
  const url = URL.parse(baseUrl);
  if (
    !url ||
    url.protocol !== "https:" ||
    url.port ||
    url.origin !== baseUrl.replace(/\/$/, "")
  ) {
    return undefined;
  }
  const slot = STAGE_ACADEMY.exec(url.hostname)?.[1];
  return slot
    ? { slot, origin: url.origin, hostname: url.hostname }
    : undefined;
}

type StageAddress = NonNullable<ReturnType<typeof stageAcademyAddress>>;

/** PR previews can verify the real fixture through the operator's loopback tunnel. */
export function stagePartnershipUnavailableOrigin(
  stage: StageAddress,
  loopback = process.env.E2E_ACADEMY_PARTNERSHIP_UNAVAILABLE_LOOPBACK,
): string {
  if (!loopback)
    return stage.origin.replace(
      "https://academy-",
      "https://academy-partnership-unavailable-",
    );
  const url = URL.parse(loopback);
  if (
    stage.slot === "main" ||
    !url ||
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.origin !== loopback.replace(/\/$/, "")
  ) {
    throw new Error(
      "The partnership fixture tunnel requires a PR slot and a plain IPv4 loopback origin",
    );
  }
  return url.origin;
}
function resultOf(output: string): PartnershipObservation {
  const result = JSON.parse(output) as Partial<PartnershipObservation> | null;
  if (
    !result ||
    Object.keys(result).length !== 2 ||
    typeof result.count !== "number" ||
    !Number.isSafeInteger(result.count) ||
    result.count < 0 ||
    typeof result.privateRecord !== "boolean" ||
    (result.privateRecord && result.count !== 1)
  ) {
    throw new Error(FAILURE);
  }
  return { count: result.count, privateRecord: result.privateRecord };
}

async function stageOperator(stage: StageAddress) {
  const staging = await import(
    new URL("../../../tools/staging/slot.mjs", import.meta.url).href
  );
  const { sshCapture } = await import(
    new URL("../../../tools/deploy/lib/remote.mjs", import.meta.url).href
  );
  const captureScript = (script: string) =>
    sshCapture(staging.STAGE_1, script, {
      sshOptions: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"],
      signal: AbortSignal.timeout(25_000),
      stderr: "pipe",
    });
  const capture = (argv: string[]) => captureScript(staging.quoteCommand(argv));
  const env = staging.parseEnvFile(
    await capture([
      "sudo",
      "grep",
      "-E",
      "^(export )?STAGE_BASE_DOMAIN=",
      staging.STAGE_ENV_FILE,
    ]),
  );
  if (
    stage.hostname !==
    staging.slotHostnames(stage.slot, staging.requiredBaseDomain(env)).academy
  ) {
    throw new Error(FAILURE);
  }
  return { capture, captureScript, quoteCommand: staging.quoteCommand };
}

async function readWithOperator(
  stage: StageAddress,
  contact: string,
): Promise<string> {
  const { capture } = await stageOperator(stage);
  // The CI key uses the box-global installed entrypoint. PR slots deliberately
  // never install it (#3125); the operator executes this same fixed predicate
  // from the checked-out source inside that one slot's portal.
  const entrypoint = await readFile(
    new URL("../../../infra/deploy/bin/ds-deploy-entrypoint", import.meta.url),
    "utf8",
  );
  const script = entrypoint
    .replaceAll("\r\n", "\n")
    .match(
      /\nread -r -d '' OBSERVE_PARTNERSHIP_JS <<'JS' \|\| true\n([\s\S]*?)\nJS\n/,
    )?.[1];
  if (!script) throw new Error(FAILURE);
  return capture([
    "sudo",
    "docker",
    "exec",
    `${stage.slot}-portal`,
    "node",
    "-e",
    script,
    contact,
  ]);
}

export async function readStagePartnershipObservation(
  academyBaseUrl: string,
  contact: string,
): Promise<PartnershipObservation> {
  try {
    const stage = stageAcademyAddress(academyBaseUrl);
    if (
      !stage ||
      contact !== contact.trim() ||
      !SYNTHETIC_CONTACT.test(contact)
    ) {
      throw new Error(FAILURE);
    }
    const observe = chooseStageObserve();
    if (observe) {
      await assertObservedMainOrigin(observe, stage.origin, stage.slot);
      return resultOf(await observe("academy-partnership", { contact }));
    }
    return resultOf(await readWithOperator(stage, contact));
  } catch {
    // Never expose a transport reply or stderr in an Actions report.
    throw new Error(FAILURE);
  }
}

export async function readStagePartnershipFaultCount(
  academyBaseUrl: string,
): Promise<number> {
  try {
    const stage = stageAcademyAddress(academyBaseUrl);
    if (!stage) throw new Error(FAILURE);
    const observe = chooseStageObserve();
    let output: string;
    if (observe) {
      await assertObservedMainOrigin(observe, stage.origin, stage.slot);
      output = await observe("academy-partnership-fault-count", {});
    } else {
      const { captureScript, quoteCommand } = await stageOperator(stage);
      const logs = quoteCommand([
        "sudo",
        "docker",
        "logs",
        "--tail",
        "200",
        `${stage.slot}-portal-partnership-unavailable`,
      ]);
      const count = quoteCommand([
        "awk",
        '$0 == "[academy-partnership] persistence_failed" { n++ } END { print n + 0 }',
      ]);
      output = await captureScript(`set -o pipefail\n${logs} 2>&1 | ${count}`);
    }
    const digits = output.trim();
    const count = Number(digits);
    if (!/^\d{1,3}$/.test(digits) || count > 200) {
      throw new Error(FAILURE);
    }
    return count;
  } catch {
    throw new Error(FAILURE);
  }
}
