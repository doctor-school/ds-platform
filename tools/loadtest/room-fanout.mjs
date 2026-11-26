#!/usr/bin/env node
// DS Platform — `room-fanout` load scenario (#873 phase 1).
//
// Models N doctors in a live webinar room (feature 006, recon fact 1):
//   login → POST /v1/events/:id/registration (once per account, idempotent) →
//   GET /v1/events/:id/room (grant: chat {url,token,channel}, stream,
//   heartbeatIntervalSeconds) → Centrifugo WS connect (server-side subscribe to
//   room:event:<id> via the connection token's channels claim) → hold the socket
//   for one reported cadence N → send exactly one sampled
//   POST /v1/events/:id/heartbeat → a fraction of VUs POST /v1/events/:id/chat
//   (server-mediated publish; clients never publish direct). This capacity leg
//   does not simulate Page Visibility or the production client's immediate and
//   repeating heartbeat loop; component/Playwright tests verify that client
//   behavior. `room-behavior` separately verifies server-side count timing and
//   reconnect continuity.
//
// FIXTURE (smoke + run protocol): the grant gate is authenticated AND registered
// (005 roster) AND live — so a real run needs LOADTEST_EVENT_ID pointing at a
// LIVE event and the provisioned synthetic users (LOADTEST_USE_PROVISIONED=1);
// each account joins the roster itself through the registration command. Absent
// that, GET /room returns the gate's 401/403/409; the scenario records it and
// reports the fixture gap rather than faking a grant.
//
// HARD PROD GUARD (fail-closed, lib.mjs `productionGate`): this scenario
// REFUSES to run when any origin it requests is production — the api, the
// storefront and sign-in host its sign-in drives, the Centrifugo origin, or a
// URL it follows from a server answer (the IdP authorize hop, the storefront
// callback, the room grant's WebSocket) — until `LOADTEST_ROOM_PROD_CONFIRMED=1`
// is set. A production room run loads the live realtime path real doctors are
// on, and its chat leg publishes real messages into the event's room chat that
// every participant sees — so it runs only in the owner-approved window,
// against the dedicated synthetic event of the run protocol (README «Run
// protocol»).
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
  productionGate,
  report,
  reqEnv,
  runVUs,
  sleep,
} from "./lib.mjs";
import {
  centrifugoHold,
  ensureRoomRegistration,
  fetchRoomGrant,
  loadManifestCredentials,
  loginCookie,
  postRoomChat,
  postRoomHeartbeat,
} from "./room-seams.mjs";

/**
 * Fail-closed production tripwire (exported for the guard test). Throws unless
 * every origin the run requests (`origin` plus every lib.mjs `RUN_ORIGIN_ENV`
 * value) is non-production OR the operator has explicitly confirmed the
 * approved run window via LOADTEST_ROOM_PROD_CONFIRMED=1. Returns the run's
 * `allowTarget` check for the URLs it follows from server answers.
 */
export function assertRoomFanoutAllowed(origin, env = process.env) {
  return productionGate(
    {
      scenario: "room-fanout",
      confirmation: "LOADTEST_ROOM_PROD_CONFIRMED",
      refusal:
        `it loads the live webinar realtime path real doctors are on, and its chat ` +
        `leg publishes messages every participant of the room sees. Set ` +
        `LOADTEST_ROOM_PROD_CONFIRMED=1 ONLY inside the owner-approved run window, ` +
        `against the dedicated synthetic event of the run protocol ` +
        `(tools/loadtest/README.md «Run protocol»).`,
      origins: { LOADTEST_API_ORIGIN: origin },
    },
    env,
  );
}

async function main() {
  const origin = apiOrigin();
  // Guard FIRST — before the manifest is read or any request is issued.
  const allowTarget = assertRoomFanoutAllowed(origin);
  const eventId = reqEnv("LOADTEST_EVENT_ID");
  const useProvisioned = optEnv("LOADTEST_USE_PROVISIONED", "") === "1";
  const pool = useProvisioned ? loadManifestCredentials() : [];
  const chatFraction = floatEnv("LOADTEST_CHAT_FRACTION", 0.1);
  const roomPath = `/v1/events/${encodeURIComponent(eventId)}`;

  let gateReported = false;
  /** Manifest indexes whose account is already on the event's roster. */
  const rostered = new Set();
  /** Manifest index → the account's live session Cookie header. */
  const sessions = new Map();
  const opts = {
    vus: intEnv("LOADTEST_VUS", 10),
    durationSeconds: intEnv("LOADTEST_DURATION_SECONDS", 20),
    rampSeconds: intEnv("LOADTEST_RAMP_SECONDS", 5),
    label: "room-fanout",
  };

  const samples = await runVUs(async ({ vu, samples }) => {
    // 1. auth → cookie
    // A doctor signs in once and stays in the room: the session is minted on
    // an account's first iteration and reused, re-minted only after the gate
    // answers 401. Signing in on every iteration would model no real doctor and
    // would spend the fixed per-IP sign-in entry windows (README «Rate limits»).
    let cookie = null;
    const account = pool.length > 0 ? vu % pool.length : -1;
    if (account >= 0) {
      cookie = sessions.get(account) ?? null;
      if (!cookie) {
        const cred = pool[account];
        cookie = await loginCookie(
          origin,
          cred.email,
          cred.password,
          allowTarget,
        );
        if (cookie) sessions.set(account, cookie);
      }
    }
    // 1b. roster: the grant gate admits registered doctors only (005), so each
    // signed-in account joins the roster once through the real, idempotent
    // product command — the same seam the room-behavior verifier uses.
    if (cookie && !rostered.has(account)) {
      const reg = await ensureRoomRegistration(origin, eventId, cookie);
      samples.record({
        status: reg.status,
        ms: reg.ms,
        isError: reg.status >= 500 || reg.status === 0,
      });
      if (reg.ok) rostered.add(account);
    }
    // 2. room grant
    const grantRes = await fetchRoomGrant(origin, eventId, cookie);
    samples.record({
      status: grantRes.status,
      ms: grantRes.ms,
      isError: grantRes.status >= 500 || grantRes.status === 0,
    });
    if (grantRes.status === 401 && account >= 0) sessions.delete(account);
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
            `The scenario joins each account to the roster itself; what remains is ` +
            `the event not being live, LOADTEST_USE_PROVISIONED=1 unset ` +
            `(no accounts), or the sign-in failing. WS/heartbeat/chat legs are ` +
            `skipped this run.`,
        );
      }
      return;
    }

    // 3. WS connect + hold for one heartbeat window — the grant's WebSocket is
    // a URL no env var names, so it passes the gate before the connect.
    allowTarget(grant.chat.url, "the room grant's WebSocket");
    const beatSec = grant.heartbeatIntervalSeconds ?? 60;
    const hold = await centrifugoHold(
      grant.chat.url,
      grant.chat.token,
      grant.chat.channel,
      beatSec * 1000,
    );
    samples.record({
      status: hold.ok ? 200 : 0,
      ms: hold.connectMs || 1,
      isError: !hold.ok,
    });

    // 4. one heartbeat sample after the N-second socket hold
    const hb = await postRoomHeartbeat(origin, eventId, cookie);
    samples.record({
      status: hb.status,
      ms: hb.ms,
      isError: hb.status >= 500 || hb.status === 0,
    });

    // 5. chat publish (a fraction of VUs)
    if (vu / opts.vus < chatFraction) {
      const chat = await postRoomChat(
        origin,
        eventId,
        cookie,
        `loadtest vu${vu} ${Date.now()}`,
      );
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
