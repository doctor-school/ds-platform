#!/usr/bin/env node
// DS Platform — dev-stand contract-level smoke test (setup-design §14.3).
//
// Probes all six dev-stand services from the HOST over the LAN — a true
// host→service reach, not a container-internal `docker exec`. The point of the
// smoke is to prove the published ports answer from a developer's machine, the
// way `apps/api` will reach them. Uses only Node built-ins plus `pg` (a
// workspace dependency); deliberately needs none of redis-cli / mc / websocat /
// grpcurl / swaks, so it runs on any recipe without extra installs.
//
//   Postgres    pg client        SELECT 1 + CREATE EXTENSION vector + ::vector
//   Redis       raw RESP / TCP   PING + SET + GET round-trip
//   MinIO       S3 SigV4 / HTTP  PUT bucket + PUT object + GET back (then clean)
//   Centrifugo  WS handshake     HTTP Upgrade → 101 + GET /health
//   Cerbos      HTTP             GET /_cerbos/health → SERVING
//   Mailpit     SMTP + HTTP API  deliver mail :1025 → confirm via :8025 API
//
// Endpoints are read from the personal `.env.local` — never hardcoded
// (AGENTS.md §9.1), so every recipe's host/ports flow through unchanged.
//
// Usage: pnpm dev:smoke      (exit 0 = all green; non-zero = a probe failed)

import net from "node:net";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const STAND_DIR = join(REPO_ROOT, "infra", "dev-stand");
const PROBE_TIMEOUT_MS = 15000;

// --- env (same lookup order as tools/dev/run.mjs) -------------------------

function loadEnv() {
  const candidates = [
    process.env.DS_PLATFORM_ENV_FILE,
    join(homedir(), ".ds-platform", ".env.local"),
    join(STAND_DIR, ".env.local"),
  ].filter(Boolean);
  const file = candidates.find((p) => existsSync(p));
  if (!file) {
    fail(
      `no .env.local found. Looked in:\n  ${candidates.join("\n  ")}\n` +
        "Copy infra/dev-stand/.env.example to ~/.ds-platform/.env.local and fill it in.",
    );
  }
  const env = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function fail(msg) {
  console.error(`smoke: ${msg}`);
  process.exit(2);
}

function require_(env, key) {
  const v = (env[key] || "").trim();
  if (!v) fail(`required key ${key} missing from .env.local`);
  return v;
}

// --- shared helpers -------------------------------------------------------

function withTimeout(promise, ms) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

function httpRequest(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolveReq, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolveReq({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
    req.on("error", reject);
    req.setTimeout(PROBE_TIMEOUT_MS, () =>
      req.destroy(new Error("socket timeout")),
    );
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// --- Postgres -------------------------------------------------------------

async function probePostgres(env) {
  const { Client } = pg;
  const client = new Client({
    connectionString: require_(env, "DATABASE_URL"),
    connectionTimeoutMillis: PROBE_TIMEOUT_MS,
  });
  await client.connect();
  try {
    const one = (await client.query("SELECT 1 AS ok")).rows[0].ok;
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    const vec = (await client.query("SELECT '[1,2,3]'::vector AS v")).rows[0].v;
    const ver = (await client.query("SHOW server_version")).rows[0]
      .server_version;
    return `pg ${ver} · SELECT 1=${one} · vector ext present · '[1,2,3]'::vector=${vec}`;
  } finally {
    await client.end();
  }
}

// --- Redis (minimal RESP client) ------------------------------------------

function encodeResp(args) {
  let out = `*${args.length}\r\n`;
  for (const a of args) out += `$${Buffer.byteLength(a)}\r\n${a}\r\n`;
  return out;
}

// Parse as many complete RESP replies as `buf` holds; returns the decoded
// values and the number of bytes consumed. Handles simple strings (+), errors
// (-), integers (:) and bulk strings ($) — all this probe sends.
function parseResp(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const type = String.fromCharCode(buf[i]);
    const nl = buf.indexOf("\r\n", i);
    if (nl === -1) break;
    const line = buf.toString("utf8", i + 1, nl);
    if (type === "+" || type === "-" || type === ":") {
      out.push(type === "-" ? new Error(line) : line);
      i = nl + 2;
    } else if (type === "$") {
      const len = Number(line);
      if (len === -1) {
        out.push(null);
        i = nl + 2;
      } else {
        const start = nl + 2;
        const end = start + len;
        if (buf.length < end + 2) break;
        out.push(buf.toString("utf8", start, end));
        i = end + 2;
      }
    } else {
      break;
    }
  }
  return { out, consumed: i };
}

function probeRedis(env) {
  return new Promise((resolveProbe, reject) => {
    const u = new URL(require_(env, "REDIS_URL"));
    const key = `ds:smoke:${Date.now()}`;
    const val = `ok-${Date.now()}`;
    const socket = net.connect({
      host: u.hostname,
      port: Number(u.port) || 6379,
    });
    socket.setTimeout(PROBE_TIMEOUT_MS, () =>
      socket.destroy(new Error("socket timeout")),
    );
    let buf = Buffer.alloc(0);
    socket.on("connect", () => {
      socket.write(
        encodeResp(["PING"]) +
          encodeResp(["SET", key, val]) +
          encodeResp(["GET", key]),
      );
    });
    socket.on("error", reject);
    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      const { out } = parseResp(buf);
      if (out.length < 3) return;
      const [ping, set, got] = out;
      socket.end();
      for (const r of out) if (r instanceof Error) return reject(r);
      if (ping !== "PONG") return reject(new Error(`PING returned ${ping}`));
      if (set !== "OK") return reject(new Error(`SET returned ${set}`));
      if (got !== val)
        return reject(new Error(`GET returned ${got}, expected ${val}`));
      resolveProbe(`PING=PONG · SET ${key} · GET round-trip matches`);
    });
  });
}

// --- MinIO (S3 SigV4, path-style) -----------------------------------------

const sha256hex = (data) =>
  crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key, data) =>
  crypto.createHmac("sha256", key).update(data).digest();

// Returns the SigV4 auth headers for one request. `Host` is left to Node (it
// sets it from the URL, matching the lowercased `host` we sign here).
function signS3({ method, url, body, region, accessKey, secretKey }) {
  const u = new URL(url);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body ?? "");
  const canonicalUri = u.pathname.split("/").map(encodeURIComponent).join("/");
  const canonicalHeaders = `host:${u.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join("\n");
  let signingKey = hmac(`AWS4${secretKey}`, dateStamp);
  signingKey = hmac(signingKey, region);
  signingKey = hmac(signingKey, "s3");
  signingKey = hmac(signingKey, "aws4_request");
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");
  return {
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

async function probeMinio(env) {
  const endpoint = require_(env, "S3_ENDPOINT").replace(/\/$/, "");
  const region = (env.S3_REGION || "us-east-1").trim();
  const accessKey = require_(env, "S3_ACCESS_KEY");
  const secretKey = require_(env, "S3_SECRET_KEY");
  const bucket = `ds-smoke-${Date.now()}`;
  const key = `smoke-${Date.now()}.txt`;
  const payload = `ds-platform dev-stand smoke ${new Date().toISOString()}\n`;

  const s3 = async (method, path, body) => {
    const url = `${endpoint}/${path}`;
    const headers = signS3({
      method,
      url,
      body: body ?? "",
      region,
      accessKey,
      secretKey,
    });
    if (body !== undefined) headers["Content-Length"] = Buffer.byteLength(body);
    return httpRequest(url, { method, headers, body });
  };

  const mb = await s3("PUT", bucket);
  if (mb.status !== 200)
    throw new Error(`mb ${bucket} → ${mb.status} ${mb.body.slice(0, 120)}`);
  const cp = await s3("PUT", `${bucket}/${key}`, payload);
  if (cp.status !== 200)
    throw new Error(`put object → ${cp.status} ${cp.body.slice(0, 120)}`);
  const get = await s3("GET", `${bucket}/${key}`);
  if (get.status !== 200 || get.body !== payload) {
    throw new Error(
      `get-back → ${get.status} (body match=${get.body === payload})`,
    );
  }
  // Best-effort cleanup so repeated runs do not litter the dev bucket list.
  await s3("DELETE", `${bucket}/${key}`).catch(() => {});
  await s3("DELETE", bucket).catch(() => {});
  return `mb ${bucket} · put+get ${key} (${Buffer.byteLength(payload)}B) match · cleaned up`;
}

// --- Centrifugo (WS handshake) --------------------------------------------

async function probeCentrifugo(env) {
  const base = require_(env, "CENTRIFUGO_URL").replace(/\/$/, "");
  const health = await httpRequest(`${base}/health`);
  if (health.status !== 200) throw new Error(`/health → ${health.status}`);
  const u = new URL(base);
  const status = await new Promise((resolveWs, reject) => {
    const req = http.request({
      host: u.hostname,
      port: Number(u.port) || 80,
      path: "/connection/websocket",
      method: "GET",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"),
      },
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolveWs(res.statusCode);
    });
    req.on("response", (res) =>
      reject(new Error(`server did not upgrade (status ${res.statusCode})`)),
    );
    req.on("error", reject);
    req.setTimeout(PROBE_TIMEOUT_MS, () =>
      req.destroy(new Error("socket timeout")),
    );
    req.end();
  });
  if (status !== 101)
    throw new Error(`WS upgrade returned ${status}, expected 101`);
  return `/health 200 · WS handshake → 101 Switching Protocols`;
}

// --- Cerbos ---------------------------------------------------------------

async function probeCerbos(env) {
  // HTTP health on the REST port (:3592 per compose; the issue text has the
  // HTTP/gRPC ports transposed — Cerbos serves /_cerbos/health over HTTP here).
  const base = require_(env, "CERBOS_URL").replace(/\/$/, "");
  const res = await httpRequest(`${base}/_cerbos/health`);
  if (res.status !== 200)
    throw new Error(
      `/_cerbos/health → ${res.status} ${res.body.slice(0, 120)}`,
    );
  let serving = res.body.trim();
  try {
    serving = JSON.parse(res.body).status ?? serving;
  } catch {
    /* plain-text body — keep as-is */
  }
  if (!/SERVING/i.test(serving)) throw new Error(`health status=${serving}`);
  return `/_cerbos/health 200 · status=${serving}`;
}

// --- Mailpit (SMTP send + API verify) -------------------------------------

function smtpSend({ host, port, from, to, message }) {
  return new Promise((resolveSmtp, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(PROBE_TIMEOUT_MS, () =>
      socket.destroy(new Error("socket timeout")),
    );
    const expected = [220, 250, 250, 250, 354, 250, 221];
    const commands = [
      null,
      "EHLO ds-platform-smoke\r\n",
      `MAIL FROM:<${from}>\r\n`,
      `RCPT TO:<${to}>\r\n`,
      "DATA\r\n",
      message,
      "QUIT\r\n",
    ];
    let step = 0;
    let buf = "";
    socket.on("error", reject);
    socket.on("data", (d) => {
      buf += d.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        if (!/^\d{3} /.test(line)) continue; // skip multi-line continuations (250-…)
        const code = Number(line.slice(0, 3));
        if (code !== expected[step]) {
          socket.destroy();
          return reject(
            new Error(
              `SMTP step ${step}: got ${code}, expected ${expected[step]} (${line})`,
            ),
          );
        }
        step += 1;
        if (step >= expected.length) {
          socket.end();
          return resolveSmtp();
        }
        if (commands[step]) socket.write(commands[step]);
      }
    });
  });
}

async function probeMailpit(env) {
  const host = require_(env, "SMTP_HOST");
  const port = Number(env.SMTP_PORT) || 1025;
  const uiPort = Number(env.MAILPIT_UI_PORT) || 8025;
  const token = `ds-smoke-${Date.now()}`;
  const from = "smoke@ds-platform.dev";
  const to = "smoke-target@example.com";
  const message =
    `From: ${from}\r\nTo: ${to}\r\nSubject: DS dev-stand smoke ${token}\r\n\r\n` +
    `Smoke probe ${token} at ${new Date().toISOString()}\r\n.\r\n`;
  await smtpSend({ host, port, from, to, message });
  const search = await httpRequest(
    `http://${host}:${uiPort}/api/v1/search?query=${encodeURIComponent(token)}`,
  );
  if (search.status !== 200)
    throw new Error(`Mailpit API /search → ${search.status}`);
  const found = JSON.parse(search.body).messages ?? [];
  if (found.length < 1)
    throw new Error(`message ${token} not found in Mailpit after delivery`);
  return `SMTP delivered · found in Mailpit API (subject "DS dev-stand smoke ${token}")`;
}

// --- runner ---------------------------------------------------------------

const PROBES = [
  ["Postgres", probePostgres],
  ["Redis", probeRedis],
  ["MinIO", probeMinio],
  ["Centrifugo", probeCentrifugo],
  ["Cerbos", probeCerbos],
  ["Mailpit", probeMailpit],
];

async function main() {
  const env = loadEnv();
  const standHost = (() => {
    try {
      return new URL(env.DATABASE_URL).hostname;
    } catch {
      return "(unknown)";
    }
  })();
  console.log(
    `dev-stand smoke — host→${standHost} — ${new Date().toISOString()}`,
  );
  console.log("─".repeat(72));
  let failed = 0;
  for (const [name, fn] of PROBES) {
    const t0 = Date.now();
    try {
      const detail = await withTimeout(fn(env), PROBE_TIMEOUT_MS);
      console.log(
        `  PASS  ${name.padEnd(11)} ${String(Date.now() - t0).padStart(5)}ms  ${detail}`,
      );
    } catch (err) {
      failed += 1;
      console.log(
        `  FAIL  ${name.padEnd(11)} ${String(Date.now() - t0).padStart(5)}ms  ${err.message}`,
      );
    }
  }
  console.log("─".repeat(72));
  console.log(
    failed === 0
      ? `all ${PROBES.length} services green`
      : `${failed}/${PROBES.length} probe(s) FAILED`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`smoke: unexpected error — ${err.stack || err.message}`);
  process.exit(3);
});
