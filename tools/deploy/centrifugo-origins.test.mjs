// tools/deploy/centrifugo-origins.test.mjs — Issue #2791.
//
// The regression this locks: prod Centrifugo rejected the doctor storefront's
// websocket upgrade (403) because `client.allowed_origins` in the api-prod
// Centrifugo config listed only the Academy host while the Caddyfile already
// served a second storefront (`new.doctor.school`). Every storefront vhost —
// a Caddy site block that reverse_proxies to the `portal` or `doctor` service,
// both of which mount the room chat — must be an allowed browser origin, and
// the allowlist must never fall back to the dev-only `*`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const API_PROD_DIR = join(REPO_ROOT, "infra", "deploy", "compose", "api-prod");

/** Services whose pages mount the room chat client (packages/room). */
const STOREFRONT_SERVICES = new Set(["portal", "doctor"]);

/**
 * Site addresses of every top-level Caddy block that reverse_proxies to a
 * storefront service. Minimal brace-depth scan: comments stripped, the global
 * options block (no address) skipped.
 */
function storefrontHosts(caddyfile) {
  const hosts = [];
  let depth = 0;
  let current = null;
  for (const raw of caddyfile.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") continue;
    if (depth === 0 && line.endsWith("{")) {
      const address = line.slice(0, -1).trim();
      current =
        address === ""
          ? null
          : { addresses: address.split(/[\s,]+/), storefront: false };
      depth = 1;
      continue;
    }
    if (depth > 0) {
      const proxy =
        /^reverse_proxy\s+(?:[a-z0-9]+:\/\/)?([a-z0-9_-]+):\d+/i.exec(line);
      if (proxy && current && STOREFRONT_SERVICES.has(proxy[1]))
        current.storefront = true;
      depth +=
        (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length;
      if (depth === 0) {
        if (current?.storefront) hosts.push(...current.addresses);
        current = null;
      }
    }
  }
  return hosts;
}

const caddyfile = readFileSync(join(API_PROD_DIR, "Caddyfile"), "utf8");
const centrifugo = JSON.parse(
  readFileSync(join(API_PROD_DIR, "centrifugo", "config.json"), "utf8"),
);
const allowedOrigins = centrifugo.client?.allowed_origins ?? [];

test("the Caddyfile scan finds both storefront vhosts (parser sanity)", () => {
  const hosts = storefrontHosts(caddyfile);
  assert.ok(
    hosts.includes("academy.doctor.school"),
    `hosts: ${hosts.join(", ")}`,
  );
  assert.ok(hosts.includes("new.doctor.school"), `hosts: ${hosts.join(", ")}`);
  assert.ok(
    !hosts.includes("api.doctor.school"),
    "api vhost is not a storefront",
  );
  assert.ok(
    !hosts.includes("admin.doctor.school"),
    "admin vhost is not a storefront",
  );
});

test("every storefront vhost is an allowed Centrifugo browser origin", () => {
  for (const host of storefrontHosts(caddyfile)) {
    assert.ok(
      allowedOrigins.includes(`https://${host}`),
      `https://${host} serves the room chat but is missing from client.allowed_origins in infra/deploy/compose/api-prod/centrifugo/config.json (${JSON.stringify(allowedOrigins)})`,
    );
  }
});

test("allowed_origins lists nothing beyond the storefront vhosts", () => {
  const expected = new Set(
    storefrontHosts(caddyfile).map((host) => `https://${host}`),
  );
  for (const origin of allowedOrigins) {
    assert.ok(
      expected.has(origin),
      `${origin} is not a storefront vhost of the api-prod Caddyfile`,
    );
  }
});

test("prod Centrifugo never allows the wildcard origin", () => {
  assert.ok(
    Array.isArray(allowedOrigins) && allowedOrigins.length > 0,
    "allowed_origins must be a non-empty list",
  );
  for (const origin of allowedOrigins) {
    assert.ok(!origin.includes("*"), `wildcard origin ${origin} is dev-only`);
  }
});
