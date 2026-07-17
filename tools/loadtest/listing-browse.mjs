#!/usr/bin/env node
// DS Platform — `listing-browse` load scenario (#873 phase 1).
//
// Background browse noise: the public, cacheable event reads a logged-out
// visitor generates (recon — events.public.controller.ts, all `@Public`):
//   GET /v1/public/events                     (upcoming listing)
//   GET /v1/public/events?month=YYYY-MM        (month grid)
//   GET /v1/public/events/month-counts?year=Y  (month-picker counts)
//   GET /v1/public/events/:idOrSlug            (event page — when LOADTEST_EVENT_ID set)
//
// No auth, no mutation — safe to smoke against any target. All config env-driven.
//
//   LOADTEST_API_ORIGIN=http://localhost:3000 LOADTEST_VUS=5 \
//   LOADTEST_DURATION_SECONDS=10 pnpm loadtest:browse

import {
  apiOrigin,
  floatEnv,
  intEnv,
  invokedDirectly,
  optEnv,
  report,
  runVUs,
  timedFetch,
} from "./lib.mjs";

async function main() {
  const origin = apiOrigin();
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const year = String(now.getFullYear());
  const eventId = optEnv("LOADTEST_EVENT_ID", "");

  const paths = [
    `/v1/public/events`,
    `/v1/public/events?month=${month}`,
    `/v1/public/events/month-counts?year=${year}`,
  ];
  if (eventId) paths.push(`/v1/public/events/${encodeURIComponent(eventId)}`);

  const opts = {
    vus: intEnv("LOADTEST_VUS", 5),
    durationSeconds: intEnv("LOADTEST_DURATION_SECONDS", 10),
    rampSeconds: intEnv("LOADTEST_RAMP_SECONDS", 0),
    label: "listing-browse",
  };

  const samples = await runVUs(async ({ vu, samples }) => {
    const path = paths[(vu + samples.count) % paths.length];
    const r = await timedFetch(`${origin}${path}`, {
      headers: { "user-agent": "ds-loadtest/listing-browse" },
    });
    // A 404 on the optional event page (bad LOADTEST_EVENT_ID) is a config
    // miss, not a capacity signal — everything else counts by status.
    samples.record({ status: r.status, ms: r.ms });
  }, opts);

  const code = report("listing-browse", samples, {
    p95Ms: intEnv("LOADTEST_P95_MS", 0) || undefined,
    errorRate: floatEnv("LOADTEST_ERROR_RATE", NaN) || undefined,
  });
  process.exit(code);
}

if (invokedDirectly(import.meta.url)) {
  main().catch((err) => {
    console.error(`listing-browse: ${err.stack || err.message}`);
    process.exit(3);
  });
}
