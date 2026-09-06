// CI readiness before provisioning (#1887). The read-only identity endpoint is
// the same origin/response check provision.sh performs before its first write.
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const MAX_BODY_BYTES = 16384;
const REQUIRED_SUCCESSES = 3;

function diagnostic(value, token) {
  return String(value)
    .split(token)
    .join("[REDACTED]")
    .split(JSON.stringify(token).slice(1, -1))
    .join("[REDACTED]")
    .replace(/[\r\n\t]/g, " ")
    .replace(/\p{Cc}/gu, "")
    .slice(0, 512);
}

async function readBoundedBody(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error(`response exceeds ${MAX_BODY_BYTES} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}

export async function waitForIdpReady({
  issuer,
  token,
  timeoutMs = 120000,
  requestTimeoutMs = 5000,
  intervalMs = 2000,
  fetchImpl = globalThis.fetch,
  now = () => globalThis.performance.now(),
  sleep: pause = sleep,
  log = (message) => console.error(message),
}) {
  let origin;
  try {
    origin = new URL(issuer);
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      typeof token !== "string" ||
      !token.trim() ||
      /[\r\n]/.test(token) ||
      [timeoutMs, requestTimeoutMs, intervalMs].some(
        (n) => !Number.isSafeInteger(n) || n <= 0 || n > 300000,
      )
    ) {
      throw new Error();
    }
  } catch {
    // Never echo configuration: an invalid issuer/PAT can itself contain secrets.
    throw new Error(
      "IdP readiness configuration: require an HTTP(S) origin, a nonempty single-line PAT, and positive time bounds <= 300000 ms",
    );
  }
  const endpoint = `${origin.origin}/admin/v1/instances/me`;
  const start = now();
  const deadline = start + timeoutMs;
  let streak = 0;
  let previousId;
  let last = "no response";
  let attempts = 0;
  while (now() < deadline) {
    attempts++;
    const controller = new globalThis.AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("request timeout")),
      Math.min(requestTimeoutMs, Math.max(1, deadline - now())),
    );
    try {
      const response = await fetchImpl(endpoint, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
        },
        redirect: "error",
        signal: controller.signal,
      });
      const body = await readBoundedBody(response);
      last = `HTTP ${response.status}: ${diagnostic(body || "(empty body)", token)}`;
      let id;
      if (response.status === 200) {
        try {
          id = JSON.parse(body)?.instance?.id;
        } catch {
          /* Wrong-origin/non-JSON response is never ready. */
        }
      }
      if (
        response.status === 200 &&
        typeof id === "string" &&
        /^[1-9][0-9]*$/.test(id)
      ) {
        streak = id === previousId ? streak + 1 : 1;
        previousId = id;
        if (streak >= REQUIRED_SUCCESSES && now() < deadline) {
          log(
            `IdP management API ready after ${Math.round(now() - start)} ms (${attempts} attempts; ${REQUIRED_SUCCESSES} consecutive identity responses)`,
          );
          return;
        }
      } else {
        streak = 0;
        previousId = undefined;
        if (response.status === 200) last += " (invalid instance identity)";
      }
    } catch (error) {
      streak = 0;
      previousId = undefined;
      last = `transport/response error: ${diagnostic(error.message, token)}`;
    } finally {
      clearTimeout(timer);
    }
    log(
      `IdP management API waiting: elapsed ${Math.round(now() - start)} ms, attempt ${attempts}, stable ${streak}/${REQUIRED_SUCCESSES}; ${last}`,
    );
    const remaining = deadline - now();
    if (remaining > 0) await pause(Math.min(intervalMs, remaining));
  }
  throw new Error(
    `IdP management API timeout after ${Math.round(now() - start)} ms (${attempts} attempts); last response: ${last}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await waitForIdpReady({
      issuer: process.env.IDP_ISSUER,
      token: process.env.IDP_SERVICE_TOKEN,
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
