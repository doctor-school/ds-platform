import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";
import { waitForIdpReady } from "../../infra/dev-stand/idp/wait-ready.mjs";

const identity = (id = "123456789") => JSON.stringify({ instance: { id } });
const reply = (body = identity(), status = 200) =>
  new globalThis.Response(body, { status });

function fixture(responses, overrides = {}) {
  let time = 0;
  let index = 0;
  const calls = [];
  const logs = [];
  const options = {
    issuer: "http://idp.example.test",
    token: "private-test-pat",
    timeoutMs: 10000,
    intervalMs: 1000,
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    log: (message) => logs.push(message),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const next = responses[Math.min(index++, responses.length - 1)];
      if (next instanceof Error) throw next;
      return next();
    },
    ...overrides,
  };
  return { options, calls, logs, elapsed: () => time };
}

test("#1887: authenticated management readiness waits through refused connections and 503", async () => {
  const f = fixture([
    new Error("connect ECONNREFUSED"),
    () =>
      reply(
        '{"code":14,"message":"dial tcp [::1]:9080: connect: connection refused"}',
        503,
      ),
    () => reply(),
  ]);
  await waitForIdpReady(f.options);
  assert.equal(f.calls.length, 5);
  for (const call of f.calls) {
    assert.equal(call.url, "http://idp.example.test/admin/v1/instances/me");
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.headers.authorization, "Bearer private-test-pat");
    assert.equal(call.init.redirect, "error");
    assert.ok(call.init.signal instanceof globalThis.AbortSignal);
  }
  assert.match(f.logs.at(-1), /ready after 4000 ms.*3 consecutive/);
});

test("#1887: one early success is not stable readiness; errors reset the streak", async () => {
  const f = fixture([
    () => reply(),
    () => reply("unavailable", 503),
    () => reply(),
  ]);
  await waitForIdpReady(f.options);
  assert.equal(f.calls.length, 5);
});

test("#1887: a changed instance identity resets the readiness streak", async () => {
  const f = fixture([
    () => reply(identity("111")),
    () => reply(identity("222")),
  ]);
  await waitForIdpReady(f.options);
  assert.equal(f.calls.length, 4);
});

for (const body of [
  "",
  "<html>OK</html>",
  "{}",
  "null",
  '{"instance":{"id":123}}',
  '{"instance":{"id":""}}',
  '{"instance":{"id":"wrong origin"}}',
]) {
  test(`#1887: HTTP 200 without the expected JSON identity cannot pass: ${body}`, async () => {
    const f = fixture([() => reply(body)], { timeoutMs: 2000 });
    await assert.rejects(
      waitForIdpReady(f.options),
      /timeout after 2000 ms.*HTTP 200.*invalid instance identity/,
    );
    assert.equal(f.calls.length, 2);
  });
}

test("#1887: timeout includes the last status/response and elapsed time without the PAT", async () => {
  const f = fixture(
    [() => reply('{"message":"private-test-pat: backend unavailable"}', 503)],
    { timeoutMs: 2500 },
  );
  await assert.rejects(waitForIdpReady(f.options), (error) => {
    assert.match(
      error.message,
      /timeout after 2500 ms.*HTTP 503.*backend unavailable/,
    );
    assert.ok(!error.message.includes(f.options.token));
    return true;
  });
  assert.equal(f.elapsed(), 2500);
  assert.ok(f.logs.every((line) => !line.includes(f.options.token)));
});

test("#1887: transport diagnostics redact PAT and keep one bounded log line", async () => {
  const f = fixture([new Error(`private-test-pat\n${"x".repeat(2000)}`)], {
    timeoutMs: 1000,
  });
  await assert.rejects(waitForIdpReady(f.options), (error) => {
    assert.ok(!error.message.includes(f.options.token));
    assert.ok(!error.message.includes("\n"));
    assert.ok(error.message.length < 900);
    return true;
  });
});

test("#1887: a hanging request is cancelled within its deadline", async () => {
  const f = fixture([], {
    now: () => globalThis.performance.now(),
    timeoutMs: 40,
    requestTimeoutMs: 10,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    fetchImpl: async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  });
  await assert.rejects(
    waitForIdpReady(f.options),
    /timeout after .*request timeout/,
  );
});

test("#1887: the request deadline also bounds a response body that stalls", async () => {
  const f = fixture([], {
    now: () => globalThis.performance.now(),
    timeoutMs: 40,
    requestTimeoutMs: 10,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    fetchImpl: async (_url, { signal }) =>
      new globalThis.Response(
        new globalThis.ReadableStream({
          start(controller) {
            signal.addEventListener(
              "abort",
              () => controller.error(signal.reason),
              { once: true },
            );
          },
        }),
      ),
  });
  await assert.rejects(
    waitForIdpReady(f.options),
    /timeout after .*request timeout/,
  );
});

test("#1887: an oversized response is rejected rather than accepted or logged unbounded", async () => {
  const f = fixture([() => reply(`${identity()}${" ".repeat(20000)}`)], {
    timeoutMs: 1000,
  });
  await assert.rejects(
    waitForIdpReady(f.options),
    /response exceeds 16384 bytes/,
  );
});

for (const overrides of [
  { token: "" },
  { token: "bad\nheader" },
  { issuer: "https://user:secret@idp.example.test" },
  { issuer: "https://idp.example.test/wrong" },
  { issuer: "https://idp.example.test?token=secret" },
  { issuer: "file:///tmp/idp" },
  { timeoutMs: 0 },
  { intervalMs: 0 },
  { requestTimeoutMs: Infinity },
]) {
  test(`#1887: invalid configuration fails before any HTTP call: ${JSON.stringify(overrides)}`, async () => {
    const f = fixture([() => reply()], overrides);
    await assert.rejects(waitForIdpReady(f.options), /configuration/);
    assert.equal(f.calls.length, 0);
  });
}

test("#1887: both CI jobs gate provisioning on the same helper after reading the PAT", () => {
  const workflow = parse(
    readFileSync(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    ),
  );
  for (const jobName of ["api-e2e", "admin-e2e"]) {
    const steps = workflow.jobs[jobName].steps;
    const pat = steps.findIndex(
      (step) => step.name === "Read the bootstrap PAT",
    );
    const ready = steps.findIndex(
      (step) => step.run === "node infra/dev-stand/idp/wait-ready.mjs",
    );
    const provision = steps.findIndex(
      (step) => step.name === "Provision the IdP project, client and roles",
    );
    assert.ok(pat >= 0 && ready > pat && provision > ready, jobName);
    assert.equal(steps[ready]["continue-on-error"], undefined);
    assert.equal(steps[ready].if, undefined);
  }
});
