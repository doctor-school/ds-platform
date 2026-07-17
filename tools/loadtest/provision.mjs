#!/usr/bin/env node
// DS Platform — provision synthetic load-test users (#873 phase 1).
//
//   pnpm loadtest:provision            # provisions LOADTEST_USERS accounts
//   LOADTEST_USERS=50 pnpm loadtest:provision
//
// Writes a manifest (LOADTEST_MANIFEST, default tools/loadtest/.synthetic-users.json
// — gitignored) that `loadtest:cleanup` reaps. Env-driven; no host is hardcoded.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { intEnv, invokedDirectly, optEnv } from "./lib.mjs";
import {
  createSyntheticUser,
  idpConfig,
  resolveOrgId,
  syntheticEmail,
} from "./zitadel.mjs";

const MANIFEST = optEnv(
  "LOADTEST_MANIFEST",
  resolve(process.cwd(), "tools/loadtest/.synthetic-users.json"),
);

async function main() {
  const cfg = idpConfig();
  const count = intEnv("LOADTEST_USERS", 5);
  const orgId = await resolveOrgId(cfg);
  console.log(
    `provisioning ${count} synthetic user(s) @${cfg.domain} in org ${orgId} on ${cfg.issuer}`,
  );

  const created = [];
  let failed = 0;
  for (let i = 0; i < count; i += 1) {
    const email = syntheticEmail(cfg.domain);
    try {
      const r = await createSyntheticUser({ ...cfg, orgId, email });
      if (r.alreadyExisted) {
        console.log(`  DUP   ${email}`);
      } else {
        console.log(`  OK    ${email} (${r.sub})`);
      }
      created.push({ email, sub: r.sub ?? "", password: cfg.password });
    } catch (err) {
      failed += 1;
      console.log(`  FAIL  ${email} — ${err.message}`);
    }
  }

  writeFileSync(
    MANIFEST,
    JSON.stringify({ domain: cfg.domain, issuer: cfg.issuer, users: created }, null, 2),
  );
  console.log(
    `─ wrote ${created.length} user(s) to ${MANIFEST}${failed ? ` (${failed} failed)` : ""}`,
  );
  process.exit(failed > 0 && created.length === 0 ? 1 : 0);
}

if (invokedDirectly(import.meta.url)) {
  main().catch((err) => {
    console.error(`provision: ${err.stack || err.message}`);
    process.exit(3);
  });
}
