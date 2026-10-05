#!/usr/bin/env node
// Trace check: registry-ru.md / process-to-be-ru.md IDs <-> IDEF0 model YAML (index.yaml).
// Usage (from the repo root): node apps/docs/content/specs/product/content-production/model/trace-check.mjs
// Exit 1 on: a dangling ID (in YAML, not in the registry or merged/excluded there);
// an in-TO-BE F-ID missing from the first decomposition level (A0); an F-ID placed in several A0 boxes;
// an IDEF0 structure fault (arrow end on a wrong side / boundary kind / unknown box; a box without
// a control or an output).
// Everything else (O-ID coverage, out-of-TO-BE placement, block mismatch, ICOM subset) is reported, never fails.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, "..");

const OBJECT_ROW = /^\|\s*(O-\d{3})\s*\|/;
const FUNCTION_ROW = /^\|\s*(F-\d{3})\s*\|/;
const EXCLUDED_STATUS = /^(исключён|объединён)/;
const BLOCK_HEADING = /^## (\d+)\. /;

const cells = (line) => line.split("|").map((cell) => cell.trim());
const asList = (value) =>
  value == null ? [] : Array.isArray(value) ? value : [value];
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "—");

/** "F-120…F-122" → F-120, F-121, F-122; "F-072" → F-072. */
function expandFunctionIds(text) {
  const ids = [];
  for (const match of text.matchAll(/F-(\d{3})(?:\s*…\s*F-(\d{3}))?/g)) {
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    for (let n = from; n <= to; n += 1)
      ids.push(`F-${String(n).padStart(3, "0")}`);
  }
  return ids;
}

/** Registry objects and functions with their status (object status = column 8, function status = column 11). */
function parseRegistry(text) {
  const objects = new Map();
  const functions = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (OBJECT_ROW.test(line)) {
      const c = cells(line);
      objects.set(c[1], { id: c[1], status: c[8] ?? "" });
    } else if (FUNCTION_ROW.test(line)) {
      const c = cells(line);
      functions.set(c[1], { id: c[1], status: c[11] ?? "" });
    }
  }
  return { objects, functions };
}

/** F-IDs outside TO-BE (line «не входят: …» of «Покрытие реестра») and F-IDs per numbered process block. */
function parseProcess(text) {
  const lines = text.split(/\r?\n/);
  const coverage = lines.find(
    (line) => /Итого функций в шагах/.test(line) && /не входят:/.test(line),
  );
  if (!coverage)
    throw new Error(
      "process-to-be-ru.md: «Итого функций в шагах … не входят: …» line not found",
    );
  const outside = new Set(expandFunctionIds(coverage.split("не входят:")[1]));
  const blocks = new Map();
  let current = null;
  for (const line of lines) {
    const heading = line.match(BLOCK_HEADING);
    if (heading) current = Number(heading[1]);
    else if (line.startsWith("## ")) current = null;
    else if (current !== null) {
      if (!blocks.has(current)) blocks.set(current, new Set());
      for (const id of expandFunctionIds(line)) blocks.get(current).add(id);
    }
  }
  return { outside, blocks };
}

const [registryText, processText, indexText] = await Promise.all([
  readFile(join(pkg, "registry-ru.md"), "utf8"),
  readFile(join(pkg, "process-to-be-ru.md"), "utf8"),
  readFile(join(here, "index.yaml"), "utf8"),
]);
const registry = parseRegistry(registryText);
const process_ = parseProcess(processText);
const index = parse(indexText);
const diagrams = [];
for (const entry of index.diagrams) {
  const diagram = parse(await readFile(join(here, entry.file), "utf8"));
  diagrams.push({ ...diagram, id: entry.id, parent: entry.parent });
}

const isExcluded = (entry) => EXCLUDED_STATUS.test(entry.status);
const liveObjects = [...registry.objects.values()]
  .filter((o) => !isExcluded(o))
  .map((o) => o.id);
const inToBe = [...registry.functions.values()]
  .filter((f) => !isExcluded(f) && !process_.outside.has(f.id))
  .map((f) => f.id);

const errors = [];
const warnings = [];
const byId = new Map(diagrams.map((d) => [d.id, d]));
const boundaryCodes = (arrow) =>
  [...asList(arrow.from), ...asList(arrow.to)]
    .map((end) => end.boundary)
    .filter(Boolean);

console.log(
  `Registry: ${registry.objects.size} objects (${liveObjects.length} live), ${registry.functions.size} functions; ` +
    `in TO-BE ${inToBe.length}, outside TO-BE: ${[...process_.outside].join(", ")}`,
);

for (const diagram of diagrams) {
  const functions = new Map(); // F-ID -> [box ids]
  const objects = new Map(); // O-ID -> [arrow ids]
  for (const box of diagram.boxes ?? []) {
    for (const id of box.functions ?? [])
      functions.set(id, [...(functions.get(id) ?? []), box.id]);
  }
  for (const arrow of diagram.arrows ?? []) {
    for (const id of arrow.objects ?? [])
      objects.set(id, [...(objects.get(id) ?? []), arrow.id]);
  }

  // Dangling: ID not in the registry, or merged/excluded there.
  for (const [id, where] of [...functions, ...objects]) {
    const known = id.startsWith("F-")
      ? registry.functions.get(id)
      : registry.objects.get(id);
    if (!known)
      errors.push(
        `${diagram.id}: dangling ${id} (${where.join(", ")}) — not in registry`,
      );
    else if (isExcluded(known))
      errors.push(
        `${diagram.id}: ${id} is «${known.status}» in registry (${where.join(", ")})`,
      );
  }

  const onArrows = liveObjects.filter((id) => objects.has(id));
  const missing = liveObjects.filter((id) => !objects.has(id));
  let line = `${diagram.id}: ${diagram.boxes?.length ?? 0} boxes, ${diagram.arrows?.length ?? 0} arrows; O-IDs on arrows ${onArrows.length}/${liveObjects.length} (${pct(onArrows.length, liveObjects.length)})`;

  if (diagram.parent === index.root) {
    const placed = inToBe.filter((id) => functions.has(id));
    line += `; in-TO-BE F-IDs in boxes ${placed.length}/${inToBe.length} (${pct(placed.length, inToBe.length)})`;
    for (const id of inToBe)
      if (!functions.has(id))
        errors.push(`${diagram.id}: in-TO-BE ${id} is not placed in any box`);
    for (const [id, boxes] of functions) {
      if (boxes.length > 1)
        errors.push(
          `${diagram.id}: ${id} is placed in several boxes (${boxes.join(", ")})`,
        );
      if (process_.outside.has(id))
        warnings.push(
          `${diagram.id}: ${id} is outside TO-BE but placed in ${boxes.join(", ")}`,
        );
    }
    // Each box should carry F-IDs that its process block(s) name.
    for (const box of diagram.boxes ?? []) {
      const blockIds = new Set(
        asList(box.process_blocks).flatMap((n) => [
          ...(process_.blocks.get(n) ?? []),
        ]),
      );
      const foreign = (box.functions ?? []).filter((id) => !blockIds.has(id));
      if (foreign.length)
        warnings.push(
          `${diagram.id}: ${box.id} carries ${foreign.join(", ")} not named in process block(s) ${asList(box.process_blocks).join(", ")}`,
        );
    }
  }
  console.log(line);
  if (missing.length)
    console.log(
      `  O-IDs not on ${diagram.id} arrows (${missing.length}): ${missing.join(", ")}`,
    );

  // IDEF0 structure: an arrow leaves a box output or enters through a boundary I/C/M code, and
  // ends on a box input/control/mechanism or a boundary O code; every box is controlled and produces.
  const boxIds = new Set((diagram.boxes ?? []).map((box) => box.id));
  const controlled = new Set();
  const producing = new Set();
  const checkEnd = (arrow, end, role) => {
    if (end?.boundary) {
      const allowed = role === "from" ? /^[ICM]\d+$/ : /^O\d+$/;
      if (!allowed.test(end.boundary))
        errors.push(
          `${diagram.id}: arrow ${arrow.id} ${role} boundary ${end.boundary} — ${role === "from" ? "a source boundary is I/C/M" : "a target boundary is O"}`,
        );
      return;
    }
    if (!boxIds.has(end?.box)) {
      errors.push(
        `${diagram.id}: arrow ${arrow.id} ${role} unknown box ${end?.box}`,
      );
      return;
    }
    const sides = role === "from" ? ["O"] : ["I", "C", "M"];
    if (!sides.includes(end.side)) {
      errors.push(
        `${diagram.id}: arrow ${arrow.id} ${role} ${end.box} side ${end.side} — allowed ${sides.join("/")}`,
      );
      return;
    }
    if (role === "from") producing.add(end.box);
    else if (end.side === "C") controlled.add(end.box);
  };
  for (const arrow of diagram.arrows ?? []) {
    for (const end of asList(arrow.from)) checkEnd(arrow, end, "from");
    for (const end of asList(arrow.to)) checkEnd(arrow, end, "to");
  }
  for (const id of boxIds) {
    if (!controlled.has(id))
      errors.push(`${diagram.id}: box ${id} has no control arrow`);
    if (!producing.has(id))
      errors.push(`${diagram.id}: box ${id} has no output arrow`);
  }

  // ICOM consistency: a child boundary arrow carries a subset of the parent arrow with the same code.
  const parent = diagram.parent ? byId.get(diagram.parent) : null;
  if (parent) {
    const parentByCode = new Map(
      (parent.arrows ?? []).map((arrow) => [
        arrow.id,
        new Set(arrow.objects ?? []),
      ]),
    );
    for (const arrow of diagram.arrows ?? []) {
      for (const code of boundaryCodes(arrow)) {
        const allowed = parentByCode.get(code);
        if (!allowed) {
          warnings.push(
            `${diagram.id}: arrow ${arrow.id} uses boundary ${code}, absent on ${parent.id}`,
          );
          continue;
        }
        const extra = (arrow.objects ?? []).filter((id) => !allowed.has(id));
        if (extra.length)
          warnings.push(
            `${diagram.id}: arrow ${arrow.id} (${code}) carries ${extra.join(", ")} not on ${parent.id}:${code}`,
          );
      }
    }
  }
}

for (const warning of warnings) console.log(`WARN  ${warning}`);
for (const error of errors) console.log(`ERROR ${error}`);
console.log(errors.length ? `FAIL: ${errors.length} error(s)` : "OK");
process.exit(errors.length ? 1 : 0);
