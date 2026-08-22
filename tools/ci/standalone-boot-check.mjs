#!/usr/bin/env node
// standalone-boot gate (#1410) — BOOT the Next standalone output, do not just build it.
//
// #1407: `next` 16.3.0 → 16.3.1 crash-looped the portal + admin standalone
// servers on prod. Every CI check was green: `next build` SUCCEEDS, typecheck /
// lint / unit / Playwright all run against a dev or `next start` server, and
// NOTHING in the pipeline ever executed `.next/standalone/**/server.js` — the
// exact artifact the production Docker images run (apps/portal/Dockerfile
// `CMD ["node","apps/portal/server.js"]`). A build-time-green, boot-time-fatal
// regression was therefore invisible until the containers were already swapped
// in production.
//
// This check closes that gap: it runs the standalone entry the image runs, in
// the layout the image builds (static + public copied alongside, per the
// Dockerfile), and asserts the server answers HTTP on `/` before the deadline.
// A crash-on-boot, an entry that never listens, or a 5xx-only server is red.
//
// Usage:  node tools/ci/standalone-boot-check.mjs [app ...]  (default: portal admin doctor)
// Requires the app's production build to exist already:
//         pnpm exec turbo run build --filter=@ds/portal --filter=@ds/admin --filter=@ds/doctor
//
// Env:
//   STANDALONE_BOOT_DEADLINE_MS  per-app boot deadline (default 90000)

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DEFAULT_APPS = ["portal", "admin", "doctor"];
const DEADLINE_MS = Number(process.env.STANDALONE_BOOT_DEADLINE_MS || 90_000);
const POLL_MS = 500;

// Repo root is DERIVED, never a path literal (tools/lint/no-hardcoded-path).
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const apps = process.argv.slice(2).filter(Boolean);
const targets = apps.length > 0 ? apps : DEFAULT_APPS;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mirror apps/<app>/Dockerfile exactly, and the ISOLATION is the load-bearing part:
//
//   COPY --from=build /repo/apps/<app>/.next/standalone           ./
//   COPY --from=build /repo/apps/<app>/.next/static  ./apps/<app>/.next/static
//   COPY --from=build /repo/apps/<app>/public        ./apps/<app>/public
//
// The image copies the traced bundle OUT of the repo into an empty /app. Booting
// `.next/standalone/**/server.js` IN PLACE does not reproduce that: Node's module
// resolution walks PARENT directories, so anything Next failed to trace is still
// found in the repo's own `node_modules` — and the check goes green on a bundle
// that cannot possibly run in the container. That is exactly the #1407 defect
// (`next` 16.3.1 stopped tracing `@swc/helpers` under pnpm → MODULE_NOT_FOUND on
// boot, in the image only). So: copy the bundle to a scratch dir OUTSIDE the repo
// tree and boot it there, with no repo `node_modules` above it.
//
// `verbatimSymlinks: true` on that copy is load-bearing, not a detail. Node's
// default `cpSync` RESOLVES each symlink and rewrites it to an ABSOLUTE target —
// pnpm's `node_modules` is a forest of links, so the scratch copy would point
// straight back into the repo store and re-open the very masking escape the
// scratch dir exists to close. `dereference: true` is the opposite failure: it
// launders out-of-bundle links into real files, so a dependency Next never
// traced silently becomes part of the "bundle". Keeping target strings VERBATIM
// is what the image actually does — Docker `COPY` restores a tar stream and
// writes literal link targets; it does NOT dereference links inside the copied
// tree. A link Next traced then resolves inside the scratch dir (green, as in
// the image); a link Next missed dangles (red, as in the image).
//
// PLATFORM: ubuntu (Linux) is the supported platform for this check, and CI runs
// it there. Windows is NOT supported: pnpm materialises `node_modules` entries as
// junctions carrying ABSOLUTE targets, so a verbatim copy still points back into
// the repo whatever this script does, while Linux links are relative and
// self-contained. That asymmetry is the whole Windows-red / Linux-green split —
// isolation is never weakened to make a local Windows run go green.
function assembleStandalone(app) {
  const appDir = join(ROOT, "apps", app);
  const built = join(appDir, ".next", "standalone");
  const entry = join(built, "apps", app, "server.js");
  if (!existsSync(entry)) {
    return {
      error:
        `standalone entry missing: ${entry}\n` +
        `  Build first: pnpm exec turbo run build --filter=@ds/${app}\n` +
        `  (and check apps/${app}/next.config.ts still sets output: "standalone")`,
    };
  }
  const scratch = mkdtempSync(join(tmpdir(), `ds-standalone-boot-${app}-`));
  cpSync(built, scratch, { recursive: true, verbatimSymlinks: true });
  const nested = join(scratch, "apps", app);
  for (const rel of [[".next", "static"], ["public"]]) {
    const from = join(appDir, ...rel);
    if (existsSync(from)) {
      cpSync(from, join(nested, ...rel), { recursive: true, force: true });
    }
  }
  return { standalone: scratch, entry: join(nested, "server.js") };
}

async function bootOne(app) {
  const { standalone, entry, error } = assembleStandalone(app);
  if (error) return { app, ok: false, reason: error };

  const port = await freePort();
  const child = spawn(process.execPath, [entry], {
    cwd: standalone,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const capture = (d) => {
    output += d.toString("utf8");
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);

  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });

  const deadline = Date.now() + DEADLINE_MS;
  let verdict = null;
  while (verdict === null) {
    if (exited) {
      verdict = {
        ok: false,
        reason:
          `the standalone server EXITED before serving a request ` +
          `(code=${exited.code} signal=${exited.signal}) — this is the #1407 crash-loop shape`,
      };
      break;
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        redirect: "manual",
      });
      if (res.status < 500) {
        verdict = {
          ok: true,
          reason: `HTTP ${res.status} on / (127.0.0.1:${port})`,
        };
        break;
      }
      verdict = {
        ok: false,
        reason: `the standalone server answered HTTP ${res.status} on / (5xx = not serving)`,
      };
      break;
    } catch {
      // not listening yet
    }
    if (Date.now() >= deadline) {
      verdict = {
        ok: false,
        reason: `no HTTP response on / within ${DEADLINE_MS} ms — the server never became reachable`,
      };
      break;
    }
    await sleep(POLL_MS);
  }

  if (!exited) {
    child.kill("SIGKILL");
    // Give the OS a beat to reap it so the runner does not leak a listener.
    await sleep(200);
  }
  rmSync(standalone, { recursive: true, force: true });
  return { app, ok: verdict.ok, reason: verdict.reason, log: output.trim() };
}

const results = [];
for (const app of targets) {
  process.stdout.write(`── standalone-boot: ${app}\n`);
  // Sequential on purpose: two Next servers on one runner would compete for
  // memory and turn a real red into a flaky one.
  const r = await bootOne(app);
  results.push(r);
  if (r.ok) {
    console.log(`   ✓ ${app}: ${r.reason}`);
  } else {
    console.error(`   ✗ ${app}: ${r.reason}`);
    if (r.log) {
      console.error(`   ---- ${app} standalone server output ----`);
      console.error(
        r.log
          .split(/\r?\n/)
          .slice(-60)
          .map((l) => `   ${l}`)
          .join("\n"),
      );
    }
  }
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(
    `\nstandalone-boot FAILED for: ${failed.map((r) => r.app).join(", ")}\n` +
      `The production images run exactly this entry (apps/<app>/Dockerfile CMD) — ` +
      `a red here is a prod crash-loop, not a CI quirk (#1407/#1410).`,
  );
  process.exit(1);
}
console.log(`\nstandalone-boot OK — ${results.map((r) => r.app).join(", ")}`);
