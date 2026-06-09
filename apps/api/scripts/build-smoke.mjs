// Build smoke guard for @ds/api (Issue #158).
//
// Catches two regressions that the normal `build`/test jobs cannot:
//
//   Defect 1 — `nest build` silently emits no `dist/` on a WARM build.
//     With `composite: true` + base `incremental: true`, the buildinfo lives
//     outside `dist/`. `deleteOutDir: true` wipes `dist/` but the buildinfo
//     survives and goes stale, so the SECOND build emits nothing and
//     `node dist/main.js` dies with "Cannot find module". A single build never
//     sees this — so we build TWICE and assert `dist/main.js` after each.
//
//   Defect 2 — built ESM unresolvable on Node.
//     `authz.discovery.ts` imported `@nestjs/common/constants` (extensionless).
//     Under `moduleResolution: NodeNext` + `"type": "module"`, Node ESM cannot
//     resolve the extensionless subpath → `ERR_MODULE_NOT_FOUND`. Vitest/tsx
//     tolerate it, so only a real Node `import()` of the BUILT file catches it.
//
// Infra-free: both defects fail before any DB/Redis/Zitadel I/O, so this needs
// no services. Exits non-zero on any failure.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const distMain = join(apiRoot, "dist", "main.js");
const distDiscovery = join(apiRoot, "dist", "authz", "authz.discovery.js");

function fail(msg) {
  console.error(`\n[build:smoke] FAIL — ${msg}\n`);
  process.exit(1);
}

function runBuild(label) {
  console.log(`[build:smoke] ${label}: running \`nest build\` …`);
  const res = spawnSync("nest", ["build"], {
    cwd: apiRoot,
    stdio: "inherit",
    shell: true,
  });
  if (res.status !== 0) {
    fail(`${label}: \`nest build\` exited ${res.status}`);
  }
}

// ── Defect 1: cold build then warm build, dist/main.js must survive both ──
runBuild("cold build");
if (!existsSync(distMain)) {
  fail(`Defect 1 (cold): expected ${distMain} to exist after the first build`);
}
console.log(`[build:smoke] cold build OK — ${distMain} present`);

runBuild("warm build");
if (!existsSync(distMain)) {
  fail(
    `Defect 1 (warm): ${distMain} MISSING after a second build. ` +
      `Stale external tsbuildinfo + deleteOutDir wiped dist and tsc re-emitted nothing.`,
  );
}
console.log(`[build:smoke] warm build OK — ${distMain} still present`);

// ── Defect 2: real Node ESM import of the built discovery module ──
if (!existsSync(distDiscovery)) {
  fail(`expected ${distDiscovery} to exist (built authz.discovery.js)`);
}
console.log(`[build:smoke] importing built ESM ${distDiscovery} …`);
try {
  await import(pathToFileURL(distDiscovery).href);
} catch (err) {
  if (err && err.code === "ERR_MODULE_NOT_FOUND") {
    fail(
      `Defect 2: built ESM failed Node module resolution — ${err.message}. ` +
        `An extensionless subpath (e.g. @nestjs/common/constants) does not ` +
        `resolve under NodeNext + "type":"module"; use the .js subpath.`,
    );
  }
  // Any other error (e.g. a missing runtime dep) is not the resolution defect
  // this guard targets — surface it loudly rather than masking it.
  fail(`unexpected error importing built discovery module: ${err?.stack ?? err}`);
}

console.log(
  "\n[build:smoke] PASS — twice-built dist/main.js present and built ESM resolves on Node.\n",
);
process.exit(0);
