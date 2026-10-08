import { appendFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";

interface PolicyReadEffects {
  capture: (script: string) => Promise<string>;
  fetch: typeof fetch;
}

async function recordCommand(command: Record<string, unknown>) {
  const log =
    process.env.E2E_STAND_COMMAND_LOG ??
    join(tmpdir(), "ds-e2e-stand-ops", "password-policy.jsonl");
  const path = relative(tmpdir(), log);
  if (!isAbsolute(log) || path.startsWith("..") || isAbsolute(path))
    throw new Error();
  await mkdir(dirname(log), { recursive: true });
  await appendFile(
    log,
    JSON.stringify({ at: new Date().toISOString(), ...command }) + "\n",
  );
}

/** 003 EARS-36: reads configuration; never writes a policy or credential. */
export async function readPasswordPolicy(
  base: string,
  effects?: PolicyReadEffects,
) {
  let policy;
  try {
    const url = new URL(base);
    const match = /^academy-(main|pr-[1-9][0-9]{0,9})\.[a-z0-9.-]+$/.exec(
      url.hostname,
    );
    if (
      !match ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port
    )
      throw new Error();
    const slots = await import(
      new URL("../../../tools/staging/slot.mjs", import.meta.url).href
    );
    const idp = await import(
      new URL("../../../tools/staging/idp.mjs", import.meta.url).href
    );
    const capture =
      effects?.capture ??
      (async (script: string) => {
        const remote = await import(
          new URL("../../../tools/deploy/lib/remote.mjs", import.meta.url).href
        );
        await recordCommand({
          command: "sshCapture",
          host: slots.STAGE_1,
          script,
          status: "started",
        });
        try {
          const result = await remote.sshCapture(slots.STAGE_1, script, {
            sshOptions: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"],
            signal: AbortSignal.timeout(20000),
            stderr: "pipe",
          });
          await recordCommand({
            command: "sshCapture",
            status: "completed",
          });
          return result;
        } catch {
          await recordCommand({
            command: "sshCapture",
            status: "failed",
          });
          throw new Error();
        }
      });
    slots.assertSlotName(match[1]);
    const env = slots.parseEnvFile(
      await capture(slots.quoteCommand(["sudo", "cat", slots.STAGE_ENV_FILE])),
    );
    const domain = slots.requiredBaseDomain(env);
    if (
      url.hostname !== slots.slotHostnames(match[1], domain).academy ||
      new URL(slots.resolveIdpBaseUrl(env)).origin !==
        `https://${slots.idpHostname(domain)}`
    )
      throw new Error();
    const pat = (
      await capture(slots.quoteCommand(["sudo", "cat", idp.IDP_PAT_FILE]))
    ).trim();
    const client = idp.createIdpClient({
      fetch:
        effects?.fetch ??
        (async (
          input: Parameters<typeof fetch>[0],
          init: Parameters<typeof fetch>[1],
        ) => {
          await recordCommand({
            command: "GET",
            url: String(input),
            status: "started",
          });
          try {
            const response = await fetch(input, {
              ...init,
              signal: AbortSignal.timeout(15000),
            });
            await recordCommand({
              command: "GET",
              status: "completed",
              httpStatus: response.status,
            });
            return response;
          } catch {
            await recordCommand({ command: "GET", status: "failed" });
            throw new Error();
          }
        }),
      baseUrl: slots.resolveIdpBaseUrl(env),
      pat,
    });
    const body = await client.request(
      "GET",
      "/admin/v1/policies/password/complexity",
    );
    policy = body?.policy;
  } catch {
    throw new Error("Live password-policy read failed");
  }
  const flags = [
    "hasUppercase",
    "hasLowercase",
    "hasNumber",
    "hasSymbol",
  ] as const;
  if (
    !policy ||
    ![8, "8"].includes(policy.minLength) ||
    flags.some((flag) => policy[flag] !== undefined && policy[flag] !== false)
  )
    throw new Error(
      "Live password policy is not minimum eight with every character-class flag off",
    );
  return {
    minLength: 8,
    hasUppercase: false,
    hasLowercase: false,
    hasNumber: false,
    hasSymbol: false,
  };
}
