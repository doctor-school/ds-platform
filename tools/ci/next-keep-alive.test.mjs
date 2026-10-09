// tools/ci/next-keep-alive.test.mjs — the Next servers behind a proxy keep an
// idle connection open longer than any client of theirs keeps it (Issue #2682).
// `node --test` (pnpm test:tools).
//
// The mechanism (#2682): a Next server closes an idle keep-alive connection
// after its `keepAliveTimeout` (Node default 5 s, +1 s buffer on Node 24). Its
// `/v1/*` rewrite proxy copies the api's hop-by-hop `Keep-Alive: timeout=72`
// (Fastify default) onto the response, so a Node fetch client keeps the socket
// pooled for ~70 s — and prod Caddy keeps its upstream connections ~120 s idle.
// A request written at the instant the server drops that "idle" socket fails
// with `SocketError: other side closed` (the admin MFA a11y fixture, run
// 37611010865). Every client must give up an idle connection BEFORE the server
// does, so each server's idle timeout must exceed every client's.
//
// No feature-spec behind these ids: #2682 is an engineering-task (AGENTS.md
// §3.8); the `EARS-N` titles follow the tools/** house convention.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

/** The Next apps that sit behind a proxy (Caddy in prod) and proxy `/v1/*` to the api. */
const PROXIED_APPS = ["admin", "portal", "doctor"];

/** Caddy's reverse_proxy default upstream idle keep-alive (2 min). */
const CADDY_UPSTREAM_IDLE_MS = 120_000;

const requireFrom = (app) => createRequire(join(ROOT, "apps", app, "package.json"));

/** The api's real idle timeout = the `Keep-Alive: timeout=` hint Next forwards. */
async function apiKeepAliveMs() {
  const fastify = requireFrom("api")("fastify");
  const app = fastify();
  await app.ready();
  const ms = app.server.keepAliveTimeout;
  await app.close();
  return ms;
}

function dockerfileKeepAlive(app) {
  const text = readFileSync(join(ROOT, "apps", app, "Dockerfile"), "utf8");
  const m = text.match(/^ENV\b.*\bKEEP_ALIVE_TIMEOUT=(\d+)/m);
  return m ? Number(m[1]) : undefined;
}

function flagValue(command) {
  const m = command.match(/--keepAliveTimeout[ =](\d+)/);
  return m ? Number(m[1]) : undefined;
}

/** Every `next start` invocation the app's scripts and Playwright configs run. */
function nextStartCommands(app) {
  const dir = join(ROOT, "apps", app);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const out = [];
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    if (/\bnext start\b/.test(cmd)) out.push({ where: `package.json#${name}`, cmd });
  }
  for (const file of readdirSync(dir).filter((f) => /^playwright.*\.ts$/.test(f))) {
    const text = readFileSync(join(dir, file), "utf8");
    for (const m of text.matchAll(/command:\s*`([^`]*\bnext start\b[^`]*)`/g)) {
      out.push({ where: file, cmd: m[1] });
    }
  }
  return out;
}

test("EARS-1: each proxied Next image keeps idle connections longer than Caddy and the forwarded api hint", async () => {
  const floor = Math.max(CADDY_UPSTREAM_IDLE_MS, await apiKeepAliveMs());
  for (const app of PROXIED_APPS) {
    const ms = dockerfileKeepAlive(app);
    assert.ok(ms !== undefined, `apps/${app}/Dockerfile sets no KEEP_ALIVE_TIMEOUT`);
    assert.ok(ms > floor, `apps/${app}/Dockerfile KEEP_ALIVE_TIMEOUT=${ms} must exceed ${floor}`);
  }
});

test("EARS-2: every `next start` of a proxied app carries the same idle timeout as its image", () => {
  for (const app of PROXIED_APPS) {
    const commands = nextStartCommands(app);
    assert.ok(commands.length > 0, `apps/${app} has no next start command`);
    assert.ok(dockerfileKeepAlive(app), `apps/${app}/Dockerfile sets no KEEP_ALIVE_TIMEOUT`);
    for (const { where, cmd } of commands) {
      assert.equal(
        flagValue(cmd),
        dockerfileKeepAlive(app),
        `apps/${app}/${where}: \`${cmd}\` must pass --keepAliveTimeout equal to the image's KEEP_ALIVE_TIMEOUT`,
      );
    }
  }
});

test("EARS-3: through Next's rewrite proxy a pooled connection idle past Node's default close is still the server's", async () => {
  // Real upstream (the api's Fastify defaults) -> Next's own rewrite proxy ->
  // Node fetch. With the configured idle timeout the server must still hold
  // the client's pooled socket after an idle gap past the default ~6 s close,
  // so the next request reuses it instead of racing the server's close.
  const keepAliveTimeout = dockerfileKeepAlive("admin");
  assert.ok(keepAliveTimeout, "apps/admin/Dockerfile sets no KEEP_ALIVE_TIMEOUT");

  const fastify = requireFrom("api")("fastify");
  const nextDir = dirname(requireFrom("admin").resolve("next/package.json"));
  const { proxyRequest } = requireFrom("admin")(
    join(nextDir, "dist/server/lib/router-utils/proxy-request.js"),
  );

  const api = fastify();
  api.post("/v1/probe", async () => ({ ok: true }));
  await api.listen({ port: 0, host: "127.0.0.1" });
  const apiPort = api.server.address().port;

  const front = createServer((req, res) => {
    proxyRequest(req, res, new URL(`http://127.0.0.1:${apiPort}${req.url}`)).catch(() => {});
  });
  front.keepAliveTimeout = keepAliveTimeout;
  let connections = 0;
  front.on("connection", () => connections++);
  await new Promise((r) => front.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${front.address().port}/v1/probe`;
  const post = async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await res.text();
    return res;
  };

  try {
    const first = await post();
    assert.match(first.headers.get("keep-alive") ?? "", /timeout=\d+/);
    await new Promise((r) => setTimeout(r, 6_500));
    const second = await post();
    assert.equal(second.status, 200);
    assert.equal(connections, 1, "the server closed the idle connection the client still pooled");
  } finally {
    front.closeAllConnections();
    await new Promise((r) => front.close(r));
    await api.close();
  }
});
