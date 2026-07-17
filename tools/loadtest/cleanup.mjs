#!/usr/bin/env node
// DS Platform — reap synthetic load-test users (#873 phase 1).
//
//   pnpm loadtest:cleanup              # reaps every user in the manifest
//   LOADTEST_CLEANUP_SWEEP=1 pnpm loadtest:cleanup   # ALSO sweep the whole
//                                                    # synthetic domain (belt+braces)
//
// Manifest reap deletes exactly the accounts `loadtest:provision` created. The
// optional domain sweep additionally searches Zitadel for EVERY user whose email
// ends with the reserved synthetic domain and deletes them — a safety net for a
// run that crashed before writing the manifest. The sweep is domain-scoped by
// construction, so it can only ever touch `@loadtest.invalid` accounts.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deleteByEmail, idpConfig } from "./zitadel.mjs";
import { invokedDirectly, optEnv } from "./lib.mjs";

const MANIFEST = optEnv(
  "LOADTEST_MANIFEST",
  resolve(process.cwd(), "tools/loadtest/.synthetic-users.json"),
);

function headers(token) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

/** Search every user whose email ends with the reserved domain (v2 ENDS_WITH). */
async function sweepDomain(cfg) {
  const res = await fetch(`${cfg.issuer}/v2/users`, {
    method: "POST",
    headers: headers(cfg.token),
    body: JSON.stringify({
      queries: [
        {
          emailQuery: {
            emailAddress: `@${cfg.domain}`,
            method: "TEXT_QUERY_METHOD_ENDS_WITH",
          },
        },
      ],
    }),
  });
  if (!res.ok) {
    console.log(`  sweep search → HTTP ${res.status} (skipped)`);
    return [];
  }
  const data = await res.json();
  return (data?.result ?? [])
    .map((u) => u?.preferredLoginName || u?.human?.email?.email)
    .filter(Boolean);
}

async function main() {
  const cfg = idpConfig();
  const emails = new Set();

  if (existsSync(MANIFEST)) {
    const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
    for (const u of m.users ?? []) if (u.email) emails.add(u.email);
    console.log(`manifest ${MANIFEST}: ${emails.size} user(s)`);
  } else {
    console.log(`no manifest at ${MANIFEST}`);
  }

  if (optEnv("LOADTEST_CLEANUP_SWEEP", "") === "1") {
    const swept = await sweepDomain(cfg);
    for (const e of swept) emails.add(e);
    console.log(`domain sweep @${cfg.domain}: ${swept.length} user(s)`);
  }

  let deleted = 0;
  let missing = 0;
  for (const email of emails) {
    const ok = await deleteByEmail(cfg, email);
    if (ok) {
      deleted += 1;
      console.log(`  DEL   ${email}`);
    } else {
      missing += 1;
      console.log(`  MISS  ${email} (already gone)`);
    }
  }
  console.log(`─ deleted ${deleted}, ${missing} already gone`);
  process.exit(0);
}

if (invokedDirectly(import.meta.url)) {
  main().catch((err) => {
    console.error(`cleanup: ${err.stack || err.message}`);
    process.exit(3);
  });
}
