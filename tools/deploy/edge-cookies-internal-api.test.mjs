// tools/deploy/edge-cookies-internal-api.test.mjs — Issue #3171, ADR-0015 §4.
//
// Both public edges (prod `api-prod/Caddyfile`, stage `stg-infra/Caddyfile`) are
// static text, so the two §4 edge requirements are locked by reading them:
// req 2 — the API's storefront-server-only prefix has no public route on ANY
// host that can reach the api (every app vhost proxies /v1 there, directly or
// through its Next BFF); req 4 — no app response gains a cookie `Domain` at the
// edge. Caddy itself is not run here; `caddy validate` is the box's own gate.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { INTERNAL_API_PREFIX } from "../../packages/schemas/src/internal-api/index.js";

const read = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const PROD = read("../../infra/deploy/compose/api-prod/Caddyfile");
const STAGE = read("../../infra/deploy/compose/stg-infra/Caddyfile");
const uncommented = (text) =>
  text.split("\n").filter((line) => !/^\s*#/.test(line));

/** Top-level site blocks of a Caddyfile: `{ address, body }`, comments dropped. */
function siteBlocks(text) {
  const blocks = [];
  let current = null;
  let depth = 0;
  for (const line of uncommented(text)) {
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    if (depth === 0 && opens > 0)
      current = { address: line.replace(/\{.*$/, "").trim(), body: [] };
    else if (current) current.body.push(line);
    depth += opens - closes;
    if (depth === 0 && current) {
      current.body.pop(); // the site's own closing brace
      blocks.push(current);
      current = null;
    }
  }
  return blocks;
}

// `handle` takes ONE matcher token, so the two paths live in a named matcher
// (#3273: the two-token form crash-looped the prod edge).
const INTERNAL_MATCHER = `@internal_api path ${INTERNAL_API_PREFIX} ${INTERNAL_API_PREFIX}/*`;
const INTERNAL_HANDLE = "handle @internal_api {";

test("ADR-0015 §4 req 2: the prod edge answers the internal API prefix 404 on every app vhost", () => {
  assert.equal(INTERNAL_API_PREFIX, "/v1/internal");
  const blocks = siteBlocks(PROD);
  const snippet = blocks.find(
    (b) => b.address === "(internal_api_unreachable)",
  );
  assert.ok(snippet, "the shared snippet exists");
  assert.deepEqual(
    snippet.body
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#")),
    [INTERNAL_MATCHER, INTERNAL_HANDLE, "respond 404", "}"],
    "the snippet routes the prefix nowhere — no upstream",
  );
  const appHosts = ["academy", "new", "login", "admin", "api"].map(
    (h) => `${h}.doctor.school`,
  );
  for (const host of appHosts) {
    const block = blocks.find((b) => b.address === host);
    assert.ok(block, `${host} vhost exists`);
    const body = block.body.map((l) => l.trim());
    assert.equal(
      body[0],
      "import internal_api_unreachable",
      `${host} imports the refusal first`,
    );
    // Every proxy sits inside a `handle`, so the snippet's more specific
    // `handle` wins over the catch-all (Caddy's handle blocks are exclusive).
    for (const [i, line] of body.entries()) {
      if (line.startsWith("reverse_proxy")) {
        const opener = body
          .slice(0, i)
          .reverse()
          .find((l) => l.endsWith("{"));
        assert.match(
          opener ?? "",
          /^handle\b/,
          `${host}: ${line} is inside a handle block`,
        );
      }
    }
  }
  // Every vhost that can reach the api (all but the IdP) is covered.
  for (const block of blocks) {
    if (
      /doctor\.school$/.test(block.address) &&
      block.address !== "id.doctor.school"
    ) {
      assert.ok(
        appHosts.includes(block.address),
        `${block.address} is in the covered set`,
      );
    }
  }
});

test("ADR-0015 §4 req 2: POST /v1/auth/login/otp/handoff stays routed on the public api vhost (003 EARS-44)", () => {
  const api = siteBlocks(PROD).find((b) => b.address === "api.doctor.school");
  const body = api.body.map((l) => l.trim());
  // `/v1/auth/*` matches none of the specific handles, so the catch-all carries it.
  const specific = body.filter((l) => /^handle \//.test(l));
  assert.ok(
    specific.every((l) => !/\/v1\/auth/.test(l) && !/\/v1\/\*/.test(l)),
    specific.join(" | "),
  );
  assert.ok(
    body.includes("handle {") && body.includes("reverse_proxy api:3000"),
  );
});

test("ADR-0015 §4 req 2: the stage edge answers the internal API prefix 404 on every slot host", () => {
  const lines = uncommented(STAGE).map((l) => l.trim());
  const start = lines.indexOf("@stage_internal_api {");
  assert.ok(start >= 0);
  const host = lines[start + 1].match(
    /^header_regexp internal Host "(.+)"$/,
  )?.[1];
  const slot = lines
    .find((l) => l.startsWith("@stage_slot header_regexp slot Host "))
    ?.match(/"(.+)"$/)?.[1];
  assert.equal(
    host,
    slot,
    "the refusal covers exactly the slot hosts, api-<slot> and every Next host",
  );
  assert.equal(
    lines[start + 2],
    `path ${INTERNAL_API_PREFIX} ${INTERNAL_API_PREFIX}/*`,
  );
  const handle = lines.indexOf("handle @stage_internal_api {");
  assert.ok(
    handle > start && handle < lines.indexOf("handle @stage_slot {"),
    "refused before the slot route",
  );
  assert.equal(lines[handle + 1], "respond 404");
});

test("ADR-0015 §4 req 4: neither edge sets or rewrites a cookie Domain for app responses", () => {
  for (const [name, text] of [
    ["prod", PROD],
    ["stage", STAGE],
  ]) {
    const cookieLines = uncommented(text).filter((l) =>
      /set-cookie|domain=|cookie_domain|cookie_path/i.test(l),
    );
    const exceptions = cookieLines.filter((l) =>
      /^\s*header \+Set-Cookie "ds_stage_gate=/.test(l),
    );
    // The one named exception: the stage gate's own cookie (not an app cookie).
    assert.deepEqual(
      cookieLines.filter((l) => !exceptions.includes(l)),
      [],
      `${name} edge touches no app cookie`,
    );
    assert.equal(exceptions.length, name === "stage" ? 1 : 0);
    assert.doesNotMatch(
      text.replace(/^\s*#.*$/gm, ""),
      /header_down\s+[-+]?Set-Cookie/i,
    );
  }
});
