#!/usr/bin/env node
// DS Platform — `room-fanout` load scenario (#873 phase 1).
//
// Models N doctors in a live webinar room (feature 006, recon fact 1):
//   login → GET /v1/events/:id/room (grant: chat {url,token,channel}, stream,
//   heartbeatIntervalSeconds) → Centrifugo WS connect (server-side subscribe to
//   room:event:<id> via the connection token's channels claim) → hold, beating
//   POST /v1/events/:id/heartbeat every N seconds → a fraction of VUs POST
//   /v1/events/:id/chat (server-mediated publish; clients never publish direct).
//
// FIXTURE (phase-2 / smoke doc): the grant gate is authenticated AND registered
// (005 roster) AND live — so a real run needs LOADTEST_EVENT_ID pointing at a
// LIVE event whose roster includes the synthetic users (provision + a roster-join
// step). Absent that, GET /room returns the gate's 401/403/409; the scenario
// records it and reports the fixture gap rather than faking a grant.
//
//   LOADTEST_API_ORIGIN=http://localhost:3000 LOADTEST_EVENT_ID=<idOrSlug> \
//   LOADTEST_USE_PROVISIONED=1 LOADTEST_VUS=20 LOADTEST_DURATION_SECONDS=30 \
//   pnpm loadtest:room

import {
  apiOrigin,
  floatEnv,
  intEnv,
  invokedDirectly,
  optEnv,
  report,
  reqEnv,
  runVUs,
  sleep,
  timedFetch,
} from "./lib.mjs";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

function loadManifestEmails() {
  const path = optEnv(
    "LOADTEST_MANIFEST",
    resolve(process.cwd(), "tools/loadtest/.synthetic-users.json"),
  );
  if (!existsSync(path)) return [];
  const m = JSON.parse(readFileSync(path, "utf8"));
  return (m.users ?? []).map((u) => ({ email: u.email, password: u.password }));
}

/** BFF login; returns the Cookie header string to replay, or null. */
async function login(origin, email, password) {
  const res = await fetch(`${origin}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: email, password }),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  await res.text();
  if (!res.ok) return null;
  return setCookie.map((c) => c.split(";")[0]).join("; ") || null;
}

/**
 * Minimal Centrifugo v5 JSON-protocol client: connect with the token (server
 * auto-subscribes the room channel from the token's channels claim), answer
 * server pings ({} ⇄ {}), hold until `holdMs`. Resolves { connectMs, ok, error }.
 */
function centrifugoHold(wsUrl, token, holdMs) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let ws;
    try {
      ws = new globalThis.WebSocket(wsUrl);
    } catch (err) {
      resolve({ ok: false, connectMs: 0, error: `ws ctor: ${err.message}` });
      return;
    }
    let connectMs = 0;
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: connectMs > 0, connectMs }), holdMs);
    timer.unref?.();

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ connect: { token }, id: 1 }));
    });
    ws.addEventListener("message", (ev) => {
      const raw = typeof ev.data === "string" ? ev.data : "";
      for (const line of raw.split("\n").filter(Boolean)) {
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        // Server ping is an empty object — reply empty to keep the conn alive.
        if (Object.keys(msg).length === 0) {
          ws.send("{}");
          continue;
        }
        if (msg.id === 1) {
          if (msg.error) {
            done({ ok: false, connectMs: 0, error: `connect: ${msg.error.message}` });
          } else {
            connectMs = performance.now() - t0;
          }
        }
      }
    });
    ws.addEventListener("error", () => {
      done({ ok: false, connectMs, error: "ws error" });
    });
    ws.addEventListener("close", () => {
      done({ ok: connectMs > 0, connectMs });
    });
  });
}

async function main() {
  const origin = apiOrigin();
  const eventId = reqEnv("LOADTEST_EVENT_ID");
  const useProvisioned = optEnv("LOADTEST_USE_PROVISIONED", "") === "1";
  const pool = useProvisioned ? loadManifestEmails() : [];
  const chatFraction = floatEnv("LOADTEST_CHAT_FRACTION", 0.1);
  const roomPath = `/v1/events/${encodeURIComponent(eventId)}`;

  let gateReported = false;
  const opts = {
    vus: intEnv("LOADTEST_VUS", 10),
    durationSeconds: intEnv("LOADTEST_DURATION_SECONDS", 20),
    rampSeconds: intEnv("LOADTEST_RAMP_SECONDS", 5),
    label: "room-fanout",
  };

  const samples = await runVUs(async ({ vu, samples }) => {
    // 1. auth → cookie
    let cookie = null;
    if (pool.length > 0) {
      const cred = pool[vu % pool.length];
      cookie = await login(origin, cred.email, cred.password);
    }
    const authHeaders = cookie ? { cookie } : {};

    // 2. room grant
    const grantRes = await timedFetch(`${origin}${roomPath}/room`, {
      headers: { ...authHeaders, "user-agent": "ds-loadtest/room" },
    });
    samples.record({
      status: grantRes.status,
      ms: grantRes.ms,
      isError: grantRes.status >= 500 || grantRes.status === 0,
    });
    let grant;
    try {
      grant = JSON.parse(grantRes.body);
    } catch {
      grant = null;
    }
    if (!grant?.chat?.url || !grant?.chat?.token) {
      if (!gateReported) {
        gateReported = true;
        console.log(
          `  fixture gap: GET ${roomPath}/room → ${grantRes.status} (no grant). ` +
            `A real run needs a LIVE event whose roster includes the synthetic users ` +
            `(provision + roster-join). WS/heartbeat/chat legs are skipped this run.`,
        );
      }
      return;
    }

    // 3. WS connect + hold for one heartbeat window
    const beatSec = grant.heartbeatIntervalSeconds ?? 60;
    const hold = await centrifugoHold(grant.chat.url, grant.chat.token, beatSec * 1000);
    samples.record({
      status: hold.ok ? 200 : 0,
      ms: hold.connectMs || 1,
      isError: !hold.ok,
    });

    // 4. heartbeat
    const hb = await timedFetch(`${origin}${roomPath}/heartbeat`, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: "{}",
    });
    samples.record({
      status: hb.status,
      ms: hb.ms,
      isError: hb.status >= 500 || hb.status === 0,
    });

    // 5. chat publish (a fraction of VUs)
    if (vu / opts.vus < chatFraction) {
      const chat = await timedFetch(`${origin}${roomPath}/chat`, {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({ text: `loadtest vu${vu} ${Date.now()}` }),
      });
      samples.record({
        status: chat.status,
        ms: chat.ms,
        isError: chat.status >= 500 || chat.status === 0,
      });
    }
    await sleep(200);
  }, opts);

  const code = report("room-fanout", samples, {
    p95Ms: intEnv("LOADTEST_P95_MS", 0) || undefined,
    errorRate: floatEnv("LOADTEST_ERROR_RATE", NaN) || undefined,
  });
  process.exit(code);
}

if (invokedDirectly(import.meta.url)) {
  main().catch((err) => {
    console.error(`room-fanout: ${err.stack || err.message}`);
    process.exit(3);
  });
}
