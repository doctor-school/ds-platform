import { setTimeout as sleep } from "node:timers/promises";

// Used by the isolated image job. Every request shares the total boot deadline,
// including a server that accepts TCP but never sends HTTP headers.
export async function waitForHttp(
  url,
  { timeoutMs = 90000, intervalMs = 500 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let last = "connection unavailable";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: globalThis.AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      await response.body?.cancel();
      if (response.status >= 200 && response.status < 400)
        return response.status;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error.message;
    }
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`${url} not ready within ${timeoutMs}ms: ${last}`);
}

if (import.meta.main) {
  const url = process.argv[2];
  if (!url)
    throw new Error("Usage: node tools/scripts/image-readiness.mjs <url>");
  console.log(`ready: ${await waitForHttp(url)} ${url}`);
}
