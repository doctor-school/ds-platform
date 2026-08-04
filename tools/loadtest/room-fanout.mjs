#!/usr/bin/env node
// DS Platform — `room-fanout` load scenario (#873 phase 1).
//
// Models N doctors in a live webinar room (feature 006, recon fact 1):
//   login → GET /v1/events/:id/room (grant: chat {url,token,channel}, stream,
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
} from "./lib.mjs";
import {
  centrifugoHold,
  fetchRoomGrant,
  loadManifestCredentials,
  loginCookie,
  postRoomChat,
  postRoomHeartbeat,
} from "./room-seams.mjs";

async function main() {
  const origin = apiOrigin();
  const eventId = reqEnv("LOADTEST_EVENT_ID");
  const useProvisioned = optEnv("LOADTEST_USE_PROVISIONED", "") === "1";
  const pool = useProvisioned ? loadManifestCredentials() : [];
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
      cookie = await loginCookie(origin, cred.email, cred.password);
    }
    // 2. room grant
    const grantRes = await fetchRoomGrant(origin, eventId, cookie);
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
