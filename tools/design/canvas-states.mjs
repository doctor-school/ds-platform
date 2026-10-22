// DS Platform — the control-state contract of vendored Claude Design canvases (#2221).
//
// The canvas runtime has no shared style layer, so every canvas carries its own
// copy of the control-state block in its helmet `<style>`, between
// `/* ds-states:begin */ … /* ds-states:end */`. This module is the ONE writer of
// that text (`generateStatesBlock`, from tokens.css) and of its placement
// (`stampCanvas`, run by `pnpm design:vendor`), and the body of the three checks
// `pnpm design:vendor --check` / the `canvas-provenance` guard run on every
// non-archive canvas:
//   1. untagged control — every `<a>`/`<button>` outside the designer toolbar
//      carries `data-btn="primary|secondary"`, `data-tab`, `data-check`,
//      `data-link` or `data-ghost`;
//   2. off-token native `style-hover`/`style-focus` — each declaration value is
//      a `var(--token)` of tokens.css or a literal equal to a tokens.css value;
//   3. state-block drift — the markers exist and re-stamping changes nothing.
// Checks 1+2 are BLOCK for every canvas not on the shrink-only legacy baseline
// (`design-source/states-baseline.json`, exact counts per canvas); check 3 is
// BLOCK for all. Tags are added in Claude Design, never here (#2389).

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TOKENS_REL = "packages/design-system/src/styles/tokens.css";
export const BASELINE_REL = "design-source/states-baseline.json";
export const STATES_BEGIN = "/* ds-states:begin */";
export const STATES_END = "/* ds-states:end */";

/**
 * Canvas theme variables the block reads first: a canvas that sets them on its
 * root (auth.dc.html, from its `toggleTheme` state) keeps its dark theme; any
 * other canvas falls back to the light tokens.css value.
 */
const CANVAS_VARS = {
  "--color-primary": "--primary",
  "--color-primary-hover": "--btn-hover",
  "--color-border": "--border",
  "--color-elevation-soft": "--elev",
  "--color-tint": "--tint",
  "--color-tint-foreground": "--tint-fg",
};

/** Designer-toolbar controls (fork panel, state pills) — the #2221 reference allowlist. */
const TOOLBAR =
  /\{\{ (t|st)\.style \}\}|toggleTheme|\{\{ (e|c|g|r|p)\.style \}\}|pill\(|hostTab|scrTab|errTab|capTab/;
const TAGGED =
  /\bdata-btn="(?:primary|secondary)"|\bdata-(?:tab|check|link|ghost)\b/;
/** A helmet-style rule whose selector starts with one of these belongs to the block. */
const OWNED_SELECTOR = /^\s*\[data-(?:btn|tab|check|link|ghost)\b/;

const DEFAULT_TOKENS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  TOKENS_REL,
);

function parseTokens(css) {
  const first = new Map();
  const values = new Set();
  for (const m of css.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
    if (!first.has(m[1])) first.set(m[1], m[2].trim());
    values.add(normValue(m[2]));
  }
  return { first, names: new Set(first.keys()), values };
}

function normValue(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*([,()])\s*/g, "$1")
    .replace(/(^|[^\d.])0\.(\d)/g, "$1.$2");
}

/** The block text, generated from tokens.css; never hand-edited. */
export function generateStatesBlock(tokensCss) {
  const { first } = parseTokens(tokensCss);
  const raw = (name) => {
    const value = first.get(name);
    if (value === undefined)
      throw new Error(`${TOKENS_REL}: token ${name} missing`);
    return value;
  };
  const literal = (name) =>
    raw(name).replace(/var\((--[\w-]+)\)/g, (_, n) => literal(n));
  const t = (name) =>
    CANVAS_VARS[name]
      ? `var(${CANVAS_VARS[name]},${literal(name)})`
      : raw(name).replace(/var\((--[\w-]+)\)/g, (_, n) => t(n));
  const rules = [
    `[data-btn]{transition:all ${t("--duration-fast")}}`,
    `[data-btn="primary"]:hover{background:${t("--color-primary-hover")}!important;border-color:${t("--color-primary-hover")}!important;box-shadow:${t("--shadow-btn-hover")}!important;transform:translate(2px,2px)}`,
    `[data-btn="primary"]:active{box-shadow:none!important;transform:translate(4px,4px)}`,
    `[data-btn="primary"]:focus-visible{box-shadow:${t("--shadow-btn-focus")}!important}`,
    `[data-btn="secondary"]:hover{background:${t("--color-tint")}!important;border-color:${t("--color-primary")}!important;box-shadow:${t("--shadow-ghost-hover")}!important;transform:translate(2px,2px)}`,
    `[data-btn="secondary"]:active{box-shadow:none!important;transform:translate(4px,4px)}`,
    `[data-btn="secondary"]:focus-visible{box-shadow:${t("--shadow-ghost-focus")}!important}`,
    `[data-btn]:disabled{opacity:.4;transform:none;box-shadow:none!important;pointer-events:none}`,
    `[data-tab="false"]:hover{background:${t("--color-tint")}!important;color:${t("--color-tint-foreground")}!important}`,
    `[data-check]:hover{border-color:${t("--color-primary")}!important}`,
    `[data-link]:hover{text-decoration:underline!important}`,
    `[data-link]:active{opacity:${t("--opacity-80")}!important}`,
    `[data-ghost]:hover{background:${t("--color-tint")}!important;color:${t("--color-tint-foreground")}!important}`,
    `[data-ghost]:focus-visible{box-shadow:${t("--shadow-focus-inset")}!important}`,
  ];
  return `${STATES_BEGIN}/* generated by pnpm design:vendor from ${TOKENS_REL}; edits here are overwritten */${rules.join("")}${STATES_END}`;
}

/** Drop the top-level rules the block owns from a helmet style text; keep the rest byte-exact. */
function stripOwnedRules(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) return out + css.slice(i);
    let depth = 0;
    let j = open;
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}" && --depth === 0) break;
    }
    const selector = css.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, "");
    if (!selector.split(",").some((s) => OWNED_SELECTOR.test(s)))
      out += css.slice(i, j + 1);
    i = j + 1;
  }
  return out;
}

/** Element content bounds `[start, end)` of the first `<tag …>…</tag>` inside `[from, to)`. */
function elementContent(text, tag, from, to) {
  const open = text.slice(from, to).search(new RegExp(String.raw`<${tag}\b`));
  if (open === -1) return null;
  const start = text.indexOf(">", from + open) + 1;
  const end = text.indexOf(`</${tag}>`, start);
  return end === -1 || end > to ? null : [start, end];
}

/**
 * Place `block` in the canvas helmet `<style>`: between existing markers, else
 * appended to the helmet `<style>` (a helmet without one gets one; a canvas
 * without a helmet gets `<helmet><style>…</style></helmet>` as the first child
 * of `<x-dc>`). Rules for block-owned selectors elsewhere in that style are
 * dropped, so the block is their only source. Idempotent.
 */
export function stampCanvas(text, block) {
  const b = text.indexOf(STATES_BEGIN);
  const e = text.indexOf(STATES_END);
  if (b !== -1 || e !== -1) {
    if (b === -1 || e < b || text.indexOf(STATES_BEGIN, b + 1) !== -1)
      throw new Error("malformed ds-states markers");
    const styleOpen = text.lastIndexOf("<style", b);
    const start = text.indexOf(">", styleOpen) + 1;
    const end = text.indexOf("</style>", e);
    if (styleOpen === -1 || end === -1)
      throw new Error("ds-states markers outside a <style> element");
    return `${text.slice(0, start)}${stripOwnedRules(text.slice(start, b))}${block}${stripOwnedRules(text.slice(e + STATES_END.length, end))}${text.slice(end)}`;
  }
  const helmet = elementContent(text, "helmet", 0, text.length);
  if (helmet) {
    const style = elementContent(text, "style", helmet[0], helmet[1]);
    if (style)
      return `${text.slice(0, style[0])}${stripOwnedRules(text.slice(style[0], style[1]))}${block}${text.slice(style[1])}`;
    return `${text.slice(0, helmet[1])}<style>${block}</style>${text.slice(helmet[1])}`;
  }
  const xdc = text.search(/<x-dc\b/);
  if (xdc === -1) throw new Error("no <x-dc> root to stamp");
  let at = text.indexOf(">", xdc) + 1;
  if (text.startsWith("\r\n", at)) at += 2;
  else if (text[at] === "\n") at += 1;
  return `${text.slice(0, at)}<helmet><style>${block}</style></helmet>\n${text.slice(at)}`;
}

const readDefaultTokens = () => readFileSync(DEFAULT_TOKENS, "utf8");

function lineAt(text, index) {
  let line = 1;
  for (
    let i = text.indexOf("\n");
    i !== -1 && i < index;
    i = text.indexOf("\n", i + 1)
  )
    line++;
  return line;
}

/** Checks 1+2 for one canvas: `{ untagged: [{line, tag}], offToken: [{line, attr, decl}] }`. */
export function measureCanvas(text, tokensCss = readDefaultTokens()) {
  const { names, values } = parseTokens(tokensCss);
  const untagged = [];
  for (const m of text.matchAll(/<(a|button)\b([^>]*)>/g))
    if (!TOOLBAR.test(m[2]) && !TAGGED.test(m[2]))
      untagged.push({ line: lineAt(text, m.index), tag: m[1] });
  const offToken = [];
  for (const m of text.matchAll(/\b(style-(?:hover|focus))="([^"]*)"/g))
    for (const decl of m[2]
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)) {
      const colon = decl.indexOf(":");
      const value =
        colon === -1
          ? ""
          : decl
              .slice(colon + 1)
              .replace(/\s*!important\s*$/, "")
              .trim();
      const tokenVar = /^var\((--[\w-]+)\)$/.exec(value);
      const ok =
        value &&
        (values.has(normValue(value)) || (tokenVar && names.has(tokenVar[1])));
      if (!ok) offToken.push({ line: lineAt(text, m.index), attr: m[1], decl });
    }
  return { untagged, offToken };
}

/** Non-archive `design-source/**\/*.dc.html` canvases, relative to design-source/, sorted. */
export function listStatedCanvases(root) {
  const base = join(root, "design-source");
  const out = [];
  const walk = (dir, rel) => {
    if (!existsSync(dir)) return;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (r !== "archive") walk(join(dir, d.name), r);
      } else if (d.name.endsWith(".dc.html")) out.push(r);
    }
  };
  walk(base, "");
  return out.sort();
}

export function readBaseline(root) {
  const path = join(root, BASELINE_REL);
  if (!existsSync(path)) return { version: 1, canvases: {} };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (
    parsed?.version !== 1 ||
    typeof parsed.canvases !== "object" ||
    !parsed.canvases
  )
    throw new Error(`${BASELINE_REL}: expected { version: 1, canvases: {…} }`);
  return parsed;
}

export function writeBaseline(root, baseline) {
  const canvases = Object.fromEntries(
    Object.keys(baseline.canvases)
      .sort()
      .map((k) => [k, baseline.canvases[k]]),
  );
  writeFileSync(
    join(root, BASELINE_REL),
    `${JSON.stringify({ ...baseline, canvases }, null, 2)}\n`,
    "utf8",
  );
}

/** Checks 1–3 over every non-archive canvas: `{ ok, problems }`, one problem per line. */
export function checkStates(root) {
  const tokensPath = join(root, TOKENS_REL);
  if (!existsSync(tokensPath))
    return {
      ok: false,
      problems: [`${TOKENS_REL} missing — the state block has no source`],
    };
  const tokensCss = readFileSync(tokensPath, "utf8");
  const block = generateStatesBlock(tokensCss);
  let baseline;
  try {
    baseline = readBaseline(root);
  } catch (error) {
    return { ok: false, problems: [error.message] };
  }
  const problems = [];
  const canvases = listStatedCanvases(root);
  for (const rel of canvases) {
    const label = `design-source/${rel}`;
    const text = readFileSync(join(root, "design-source", rel), "utf8");
    problems.push(...blockProblems(label, text, block));
    const { untagged, offToken } = measureCanvas(text, tokensCss);
    const allowed = baseline.canvases[rel];
    if (!allowed || untagged.length > allowed.untagged)
      for (const u of untagged)
        problems.push(
          `${label}:${u.line}: untagged control <${u.tag}> — tag it in Claude Design (data-btn="primary|secondary", data-tab, data-check, data-link, data-ghost) and re-vendor`,
        );
    if (!allowed || offToken.length > allowed.offToken)
      for (const o of offToken)
        problems.push(
          `${label}:${o.line}: off-token ${o.attr} value \`${o.decl}\` — use a tokens.css var(--…) or value, or tag the control`,
        );
    if (
      allowed &&
      (untagged.length < allowed.untagged ||
        offToken.length < allowed.offToken ||
        untagged.length + offToken.length === 0)
    )
      problems.push(
        `${label}: stale baseline entry in ${BASELINE_REL} — now untagged ${untagged.length} / offToken ${offToken.length}; lower it, or drop it when both are 0 (the baseline only shrinks)`,
      );
  }
  const present = new Set(canvases);
  for (const rel of Object.keys(baseline.canvases))
    if (!present.has(rel))
      problems.push(
        `design-source/${rel}: stale baseline entry in ${BASELINE_REL} — no such non-archive canvas`,
      );
  return { ok: problems.length === 0, problems };
}

function blockProblems(label, text, block) {
  const b = text.indexOf(STATES_BEGIN);
  if (b === -1 && text.indexOf(STATES_END) === -1)
    return [
      `${label}: no ds-states markers — run \`pnpm design:vendor --restamp\``,
    ];
  let stamped;
  try {
    stamped = stampCanvas(text, block);
  } catch (error) {
    return [`${label}: ${error.message}`];
  }
  if (text.slice(b, text.indexOf(STATES_END) + STATES_END.length) !== block)
    return [
      `${label}: ds-states block differs from the tokens.css-generated text — run \`pnpm design:vendor --restamp\` (the block is never hand-edited)`,
    ];
  if (stamped !== text)
    return [
      `${label}: state rules for block-owned selectors outside the ds-states block — run \`pnpm design:vendor --restamp\``,
    ];
  return [];
}

/** After a vendoring pass: drop clean canvases from the baseline and lower counts that fell. Never raises. */
export function shrinkBaseline(root, rels, tokensCss) {
  const baseline = readBaseline(root);
  let changed = false;
  for (const rel of rels) {
    const allowed = baseline.canvases[rel];
    if (!allowed) continue;
    const { untagged, offToken } = measureCanvas(
      readFileSync(join(root, "design-source", rel), "utf8"),
      tokensCss,
    );
    const next = {
      untagged: Math.min(allowed.untagged, untagged.length),
      offToken: Math.min(allowed.offToken, offToken.length),
    };
    if (next.untagged + next.offToken === 0) delete baseline.canvases[rel];
    else if (
      next.untagged !== allowed.untagged ||
      next.offToken !== allowed.offToken
    )
      baseline.canvases[rel] = next;
    else continue;
    changed = true;
  }
  if (changed) writeBaseline(root, baseline);
}
