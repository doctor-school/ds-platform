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
const STAGE_ACADEMY = /^academy-(main|pr-[1-9]\d{0,9})\./;
const FAILURE = "Stage partnership observation failed";

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

async function readWithOperator(
  slot: string,
  host: string,
  contact: string,
): Promise<string> {
  const staging = await import(
    new URL("../../../tools/staging/slot.mjs", import.meta.url).href
  );
  const { sshCapture } = await import(
    new URL("../../../tools/deploy/lib/remote.mjs", import.meta.url).href
  );
  const capture = (argv: string[]) =>
    sshCapture(staging.STAGE_1, staging.quoteCommand(argv), {
      sshOptions: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"],
      signal: AbortSignal.timeout(25_000),
      stderr: "pipe",
    });
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
    host !==
    staging.slotHostnames(slot, staging.requiredBaseDomain(env)).academy
  ) {
    throw new Error(FAILURE);
  }
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
    `${slot}-portal`,
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
    const url = new URL(academyBaseUrl);
    const slot = STAGE_ACADEMY.exec(url.hostname)?.[1];
    if (
      !slot ||
      url.protocol !== "https:" ||
      url.origin !== academyBaseUrl.replace(/\/$/, "") ||
      url.port ||
      contact !== contact.trim() ||
      !SYNTHETIC_CONTACT.test(contact)
    ) {
      throw new Error(FAILURE);
    }
    const observe = chooseStageObserve();
    if (observe) {
      await assertObservedMainOrigin(observe, url.origin, slot);
      return resultOf(await observe("academy-partnership", { contact }));
    }
    return resultOf(await readWithOperator(slot, url.hostname, contact));
  } catch {
    // Never expose a transport reply or stderr in an Actions report.
    throw new Error(FAILURE);
  }
}
