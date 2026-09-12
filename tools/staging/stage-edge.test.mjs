// tools/staging/stage-edge.test.mjs — Issue #2194.
//
// The stage edge is STATIC: `infra/deploy/compose/stg-infra/Caddyfile` alone
// describes every host that can ever exist, through ONE regexp over the §3 naming
// convention. That regexp is unavoidably written more than once — the routing
// matchers live inside the wildcard site (where the domain suffix is already
// implied) and the on-demand-TLS `ask` responder judges a whole hostname — so the
// regression this file locks is that the copies AGREE, and that nothing generated
// crept back in.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { SLOT_NAME_RE } from "./slot.mjs";

const CADDYFILE = fileURLToPath(
  new URL(
    "../../infra/deploy/compose/stg-infra/Caddyfile",
    import.meta.url,
  ),
);
const text = readFileSync(CADDYFILE, "utf8");
const NEWLINE = "\n";
// Horizontal whitespace only: the table rows are re-joined with single spaces,
// and a newline must never be collapsed into one.
const SPACES = /[^\S\n]+/;

// The one slot-name alternation — DERIVED from the tool's authority rather than
// re-typed, so the edge cannot drift from the names `slot up` can actually create
// (a name the edge admits but the tool refuses mints a certificate, and the
// issuance quota is the only bound the static edge has).
const SLOT_ALTERNATION = `(${SLOT_NAME_RE.source.replace(/^\^\(\?:/, "").replace(/\)\$$/, "")})`;
/** The one app-label alternation, as §3 «Hostnames» lists it. */
const APP_ALTERNATION = "(academy|doctor|admin|api)";

function matcherRegexp(name) {
  // The DEFINITION line, not the prose that references the matcher by name: a
  // definition is the only place `@<name>` starts a line.
  const lines = text.split(NEWLINE);
  const at = lines.findIndex((line) => line.trimStart().startsWith(`@${name} `));
  assert.notEqual(at, -1, `matcher ${name} is missing from the Caddyfile`);
  const quoted = lines.slice(at, at + 4).join(NEWLINE).match(/"([^"]+)"/);
  assert.ok(quoted, `matcher ${name} does not carry a quoted regexp`);
  return quoted[1];
}

/** The `map` table rows, normalised to single spaces. */
function mapRows() {
  const lines = text.split(NEWLINE);
  const at = lines.findIndex((line) => line.includes("map {re.slot.1}"));
  assert.notEqual(at, -1, "the app -> service map table is missing");
  const rows = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === "}") break;
    rows.push(line.trim().split(SPACES).join(" "));
  }
  return rows;
}

test("the routing matcher and the ask responder use the same app alternation", () => {
  const slot = matcherRegexp("stage_slot");
  const ask = matcherRegexp("stage_ask");
  assert.ok(
    slot.includes(APP_ALTERNATION),
    `@stage_slot must list the apps as ${APP_ALTERNATION}, got ${slot}`,
  );
  assert.ok(
    ask.includes(APP_ALTERNATION),
    `@stage_ask must list the apps as ${APP_ALTERNATION}, got ${ask}`,
  );
});

test("every host matcher uses the same slot alternation", () => {
  for (const name of ["stage_slot", "stage_ask", "stage_centrifugo"]) {
    const pattern = matcherRegexp(name);
    assert.ok(
      pattern.includes(SLOT_ALTERNATION),
      `matcher ${name} must spell the slot as ${SLOT_ALTERNATION}, got ${pattern}`,
    );
  }
});

test("the edge admits exactly the slot names the tool can create", () => {
  const alternation = new RegExp(`^${SLOT_ALTERNATION}$`);
  for (const name of ["main", "pr-1", "pr-42", "pr-1234567890"]) {
    assert.ok(alternation.test(name), `${name} must be admitted`);
    assert.ok(SLOT_NAME_RE.test(name), `${name} must be a valid slot name`);
  }
  for (const name of ["pr-0", "pr-007", "pr-", "PR-1", "staging", "pr-12345678901"]) {
    assert.ok(!alternation.test(name), `${name} must not be admitted`);
    assert.ok(!SLOT_NAME_RE.test(name), `${name} must not be a valid slot name`);
  }
});

test("the ask responder answers for the shared IdP host too", () => {
  assert.match(matcherRegexp("stage_ask"), /\|id\)/);
});

test("the Centrifugo exemption is scoped to the api host and its two path families", () => {
  assert.match(matcherRegexp("stage_centrifugo"), /\^\(api\)-/);
  assert.match(text, /path \/connection\/websocket \/api\/\*/);
});

test("every public app label has an upstream in the map table", () => {
  assert.deepEqual(mapRows(), [
    "academy portal 3001",
    "doctor doctor 3004",
    "admin admin 3002",
    "api api 3000",
  ]);
});

test("nothing generated is imported or mounted any more", () => {
  assert.doesNotMatch(text, /\/etc\/caddy\/slots/);
  assert.doesNotMatch(text, /slots\.caddy|ask\.caddy/);
  assert.doesNotMatch(text, /import slot /);

  const compose = readFileSync(
    fileURLToPath(
      new URL(
        "../../infra/deploy/compose/stg-infra/compose.yml",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  assert.doesNotMatch(compose, /\/etc\/ds-platform\/caddy/);
  assert.doesNotMatch(compose, /slots\.json/);
});
