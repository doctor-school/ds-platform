import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { waitForHttp } from "./image-readiness.mjs";

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}/`;
}

test("#2104 readiness accepts a serving image after warm-up", async (t) => {
  let requests = 0;
  const url = await serve(t, (_, res) => {
    res.writeHead(++requests === 1 ? 503 : 200).end();
  });
  assert.equal(await waitForHttp(url, { timeoutMs: 1000, intervalMs: 5 }), 200);
  assert.equal(requests, 2);
});

test("#2104 readiness rejects missing routes and persistent server failures", async (t) => {
  for (const status of [404, 500]) {
    const url = await serve(t, (_, res) => res.writeHead(status).end());
    await assert.rejects(
      waitForHttp(url, { timeoutMs: 80, intervalMs: 5 }),
      /not ready/,
    );
  }
});

test("#2104 readiness accepts app redirects without following another server", async (t) => {
  const url = await serve(t, (_, res) => {
    res.writeHead(307, { location: "http://127.0.0.1:1/" }).end();
  });
  assert.equal(await waitForHttp(url, { timeoutMs: 1000 }), 307);
});

test("#2104 readiness deadline bounds a hanging HTTP response", async (t) => {
  const url = await serve(t, () => {});
  await assert.rejects(
    waitForHttp(url, { timeoutMs: 80, intervalMs: 5 }),
    /not ready/,
  );
});
