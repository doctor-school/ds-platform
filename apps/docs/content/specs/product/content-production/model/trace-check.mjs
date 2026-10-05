#!/usr/bin/env node
// Trace check: registry-ru.md / process-to-be-ru.md IDs <-> IDEF0 model YAML (index.yaml).
// Usage (from the repo root): node apps/docs/content/specs/product/content-production/model/trace-check.mjs
// Exit 1 on: a dangling ID (in YAML, not in the registry or merged/excluded there);
// an in-TO-BE F-ID missing from the first decomposition level (A0); an F-ID placed in several A0 boxes;
// an IDEF0 structure fault (arrow end on a wrong side / boundary kind / unknown box; a box without
// a control or an output); an ICOM fault against the parent box (unmapped or wrong-side code, objects
// not on the parent arrow, a parent arrow of the box without a boundary arrow); a child diagram whose
// F-IDs differ from its parent box's or repeat; a box that is not exactly one of leaf / decomposed /
// `decomposition: pending`; a leaf without a full draft `effort` (one role of «Роли и круги», a
// sub-role only from the closed «Подроли» list of FORMAT-ru.md); a repeat box (`repeats`) that
// names a box absent from the model or carries F-IDs of its own; a leaf without a draft lead time;
// a leaf `iterations` that is no loops.yaml entry, or a loop whose leaves do not carry it; a loop
// fragment with a dangling step; a teams.yaml role outside «Роли и круги»; teams.yaml without
// paid_hours_per_month or with a second hours-per-month variable, an hours-per-month variable in
// ../rates/rates.yaml; a model role string without a rates.yaml record (NO_OWN_RATE aside), a rates
// record that is no model role or has no dated source.
// Everything else (O-ID coverage, out-of-TO-BE placement, block mismatch) is reported, never fails.
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
  // Role and circle names: first column of the «Роли и круги TO-BE» table, parenthetical dropped.
  const roles = new Set();
  let inRoles = false;
  for (const line of lines) {
    if (line.startsWith("## ")) inRoles = /^## Роли и круги/.test(line);
    else if (inRoles && /^\|/.test(line) && !/^\|\s*-/.test(line)) {
      const name = cells(line)[1].replace(/\s*\(.*\)\s*$/, "");
      if (name && !/^Круг \/ роль/.test(name)) roles.add(name);
    }
  }
  return { outside, blocks, roles };
}

const [registryText, processText, indexText, formatText] = await Promise.all([
  readFile(join(pkg, "registry-ru.md"), "utf8"),
  readFile(join(pkg, "process-to-be-ru.md"), "utf8"),
  readFile(join(here, "index.yaml"), "utf8"),
  readFile(join(here, "FORMAT-ru.md"), "utf8"),
]);
const registry = parseRegistry(registryText);
const process_ = parseProcess(processText);
const subRoles = parseSubRoles(formatText);
const index = parse(indexText);
const diagrams = [];
for (const entry of index.diagrams) {
  const diagram = parse(await readFile(join(here, entry.file), "utf8"));
  diagrams.push({ ...diagram, id: entry.id, parent: entry.parent });
}

/** Closed sub-role list: «Подроли» table of FORMAT-ru.md, circle → set of sub-role names. */
function parseSubRoles(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    /^Подроли — закрытый список/.test(line),
  );
  const map = new Map();
  if (start < 0) return map;
  for (const line of lines.slice(start + 1)) {
    if (/^#/.test(line)) break;
    if (!/^\|/.test(line) || /^\|\s*-/.test(line)) continue;
    const [, circle, list] = cells(line);
    if (!circle || circle === "Круг") continue;
    map.set(circle, new Set(list.split(",").map((name) => name.trim())));
  }
  return map;
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
const pending = [];
let totalLeaves = 0;
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
    const from = asList(arrow.from);
    if (from.length !== 1)
      errors.push(
        `${diagram.id}: arrow ${arrow.id} has ${from.length} sources — an arrow has one source and branches only in \`to\``,
      );
    for (const end of from) checkEnd(arrow, end, "from");
    for (const end of asList(arrow.to)) checkEnd(arrow, end, "to");
    // A boundary I/C/M arrow enters a box on the side its code names — never another boundary.
    const code = from[0]?.boundary;
    if (code)
      for (const end of asList(arrow.to))
        if (end?.boundary || (end?.box && end.side !== code[0]))
          errors.push(
            `${diagram.id}: arrow ${arrow.id} from boundary ${code} ends on ${end.boundary ? `boundary ${end.boundary}` : `${end.box} side ${end.side}`} — it enters a box on side ${code[0]}`,
          );
  }
  for (const id of boxIds) {
    if (!controlled.has(id))
      errors.push(`${diagram.id}: box ${id} has no control arrow`);
    if (!producing.has(id))
      errors.push(`${diagram.id}: box ${id} has no output arrow`);
  }

  // ICOM consistency with the parent box: a child boundary code maps to a parent arrow touching the
  // decomposed box on the side the code names (`icom` map; without it the code is the parent arrow
  // id, as on A0), carries a subset of its objects, and every parent arrow of the box is mapped.
  const parent = diagram.parent ? byId.get(diagram.parent) : null;
  const parentBox = parent?.boxes?.find((box) => box.id === diagram.id);
  if (parent && !parentBox)
    errors.push(
      `${diagram.id}: no box ${diagram.id} on parent diagram ${parent.id}`,
    );
  if (parentBox) {
    const touches = (arrow, side) =>
      side === "O"
        ? asList(arrow.from).some(
            (e) => e.box === parentBox.id && e.side === "O",
          )
        : asList(arrow.to).some(
            (e) => e.box === parentBox.id && e.side === side,
          );
    const parentArrows = new Map(
      (parent.arrows ?? []).map((arrow) => [arrow.id, arrow]),
    );
    const icom = diagram.icom ?? null;
    const target = (code) => (icom ? icom[code] : code);
    const used = new Set();
    for (const arrow of diagram.arrows ?? []) {
      for (const code of boundaryCodes(arrow)) {
        used.add(code);
        const parentArrow = parentArrows.get(target(code));
        if (!parentArrow) {
          errors.push(
            `${diagram.id}: arrow ${arrow.id} uses boundary ${code}, ${icom ? "not mapped in `icom` to" : "absent on"} ${parent.id}${icom && icom[code] ? ` (${icom[code]})` : ""}`,
          );
          continue;
        }
        if (!touches(parentArrow, code[0]))
          errors.push(
            `${diagram.id}: boundary ${code} → ${parent.id}:${parentArrow.id}, which does not touch ${parentBox.id} on side ${code[0]}`,
          );
        const allowed = new Set(parentArrow.objects ?? []);
        const extra = (arrow.objects ?? []).filter((id) => !allowed.has(id));
        if (extra.length)
          errors.push(
            `${diagram.id}: arrow ${arrow.id} (${code}) carries ${extra.join(", ")} not on ${parent.id}:${parentArrow.id}`,
          );
      }
    }
    if (icom)
      for (const code of Object.keys(icom))
        if (!used.has(code))
          errors.push(
            `${diagram.id}: \`icom\` code ${code} is used by no arrow`,
          );
    for (const arrow of parent.arrows ?? [])
      for (const side of ["I", "C", "O", "M"])
        if (
          touches(arrow, side) &&
          ![...used].some(
            (code) => code[0] === side && target(code) === arrow.id,
          )
        )
          errors.push(
            `${diagram.id}: parent arrow ${parent.id}:${arrow.id} (${side} of ${parentBox.id}) has no boundary arrow`,
          );

    // Functions: below A0 the parent box's F-IDs are exactly the union of the child boxes' F-IDs
    // (the A-0 box carries none; A0 is checked against the whole TO-BE set above).
    const own = new Set(parentBox.functions ?? []);
    if (diagram.parent !== index.root)
      for (const [id, boxes] of functions) {
        if (boxes.length > 1)
          errors.push(
            `${diagram.id}: ${id} is placed in several boxes (${boxes.join(", ")})`,
          );
        if (!own.has(id))
          errors.push(
            `${diagram.id}: ${id} is not a function of parent box ${parent.id}:${parentBox.id}`,
          );
      }
    if (diagram.parent !== index.root)
      for (const id of own)
        if (!functions.has(id))
          errors.push(
            `${diagram.id}: ${id} of parent box ${parentBox.id} is in no child box`,
          );
  }

  // Box state: a leaf with a draft effort, a box with a child diagram, or a box marked
  // `decomposition: pending` (a later decomposition step) — exactly one of them.
  let leaves = 0;
  for (const box of diagram.boxes ?? []) {
    const child = diagrams.some(
      (d) => d.id === box.id && d.parent === diagram.id,
    );
    const states = [box.leaf === true, child, box.decomposition === "pending"];
    if (states.filter(Boolean).length !== 1) {
      errors.push(
        `${diagram.id}: box ${box.id} must be exactly one of: leaf, decomposed (child diagram), decomposition: pending`,
      );
      continue;
    }
    if (box.decomposition === "pending")
      pending.push(`${diagram.id}:${box.id}`);
    if (!box.leaf) continue;
    leaves += 1;
    const effort = box.effort ?? {};
    for (const field of ["role", "unit", "hours_draft", "driver", "basis"])
      if (effort[field] == null || effort[field] === "")
        errors.push(`${diagram.id}: leaf ${box.id} effort has no ${field}`);
    if (effort.role != null) {
      const role = typeof effort.role === "string" ? effort.role : "";
      const circle = [...process_.roles].find(
        (name) => role === name || role.startsWith(`${name} — `),
      );
      if (!circle)
        errors.push(
          `${diagram.id}: leaf ${box.id} role «${effort.role}» is not one role or circle of «Роли и круги» (\`<name>\` or \`<name> — <sub-role>\`)`,
        );
      else if (role !== circle) {
        const sub = role.slice(`${circle} — `.length);
        if (!subRoles.get(circle)?.has(sub))
          errors.push(
            `${diagram.id}: leaf ${box.id} sub-role «${sub}» of «${circle}» is not in the «Подроли» list of FORMAT-ru.md`,
          );
      }
    }
    const hours = effort.hours_draft;
    const validHours =
      (typeof hours === "number" && hours >= 0) ||
      (Array.isArray(hours) &&
        hours.length === 2 &&
        hours.every((h) => typeof h === "number" && h >= 0) &&
        hours[0] <= hours[1]);
    if (hours != null && !validHours)
      errors.push(
        `${diagram.id}: leaf ${box.id} hours_draft must be a number or [min, max]`,
      );
  }
  if (leaves)
    console.log(`  ${diagram.id}: leaves ${leaves}/${diagram.boxes.length}`);
  totalLeaves += leaves;
}

// Repeat boxes: `repeats` names the boxes of another line whose step the box repeats; every named
// box exists in the model, and the repeat box carries no F-IDs (they stay in the named boxes).
const modelBoxIds = new Set(
  diagrams.flatMap((d) => (d.boxes ?? []).map((box) => box.id)),
);
for (const diagram of diagrams)
  for (const box of diagram.boxes ?? []) {
    if (box.repeats == null) continue;
    const repeats = asList(box.repeats);
    if (!repeats.length)
      errors.push(`${diagram.id}: box ${box.id} \`repeats\` is empty`);
    for (const id of repeats)
      if (!modelBoxIds.has(id))
        errors.push(
          `${diagram.id}: box ${box.id} repeats ${id} — no such box in the model`,
        );
    if ((box.functions ?? []).length)
      errors.push(
        `${diagram.id}: box ${box.id} repeats ${repeats.join(", ")} but carries F-IDs ${box.functions.join(", ")} — a repeat box has none`,
      );
  }

// Lead time, loops and teams (FORMAT-ru.md «Петли одобрения», «Команды и мощность»): every leaf
// carries a lead time; every leaf `iterations` resolves to a loops.yaml entry whose `leaves` carry
// exactly that variable; a loop fragment is a closed step graph; team roles come from «Роли и круги».
const isRange = (value, min = 0) =>
  (typeof value === "number" && value >= min) ||
  (Array.isArray(value) &&
    value.length === 2 &&
    value.every((v) => typeof v === "number" && v >= min) &&
    value[0] <= value[1]);
const resolveRole = (role, where) => {
  const name = typeof role === "string" ? role : "";
  const circle = [...process_.roles].find(
    (r) => name === r || name.startsWith(`${r} — `),
  );
  if (!circle) errors.push(`${where}: role «${role}» is not in «Роли и круги»`);
  else if (
    name !== circle &&
    !subRoles.get(circle)?.has(name.slice(`${circle} — `.length))
  )
    errors.push(`${where}: sub-role «${role}» is not in the «Подроли» list`);
};
const [loopsDoc, teamsDoc] = await Promise.all(
  ["loops.yaml", "teams.yaml"].map(async (file) =>
    parse(await readFile(join(here, file), "utf8")),
  ),
);
const leafById = new Map();
for (const diagram of diagrams)
  for (const box of diagram.boxes ?? [])
    if (box.leaf) leafById.set(box.id, { diagram: diagram.id, box });
const loopByName = new Map();
for (const loop of loopsDoc?.loops ?? []) {
  const where = `loops.yaml: «${loop.name}»`;
  if (loopByName.has(loop.name)) errors.push(`${where} is listed twice`);
  loopByName.set(loop.name, loop);
  for (const field of ["approver", "exit_rule", "basis"])
    if (loop[field] == null || loop[field] === "")
      errors.push(`${where} has no ${field}`);
  if ((loop.rounds_draft == null) === (loop.rounds_from == null))
    errors.push(`${where} needs exactly one of rounds_draft, rounds_from`);
  else if (
    loop.rounds_draft != null &&
    (!Array.isArray(loop.rounds_draft) || !isRange(loop.rounds_draft, 1))
  )
    errors.push(`${where} rounds_draft must be [min, max] with min ≥ 1`);
  else if (
    loop.rounds_from != null &&
    (!Number.isInteger(loop.rounds_from.base) ||
      loop.rounds_from.base < 1 ||
      !Array.isArray(loop.rounds_from.plus_extra_rounds_of) ||
      !loop.rounds_from.plus_extra_rounds_of.length ||
      Object.keys(loop.rounds_from).some(
        (key) => !["base", "plus_extra_rounds_of"].includes(key),
      ))
  )
    errors.push(
      `${where} rounds_from must be { base: integer ≥ 1, plus_extra_rounds_of: [loop names] } — rounds = base + Σ (rounds − 1)`,
    );
  if (!isRange(loop.wait_days_per_round_draft))
    errors.push(
      `${where} wait_days_per_round_draft must be a number or [min, max]`,
    );
  if (!asList(loop.leaves).length) errors.push(`${where} has no leaves`);
  for (const id of asList(loop.leaves)) {
    const leaf = leafById.get(id);
    if (!leaf) errors.push(`${where} leaf ${id} is not a leaf of the model`);
    else if (leaf.box.effort?.iterations !== loop.name)
      errors.push(
        `${where} leaf ${id} carries iterations «${leaf.box.effort?.iterations ?? "—"}»`,
      );
  }
  const steps = asList(loop.fragment);
  const stepIds = new Set(steps.map((step) => step.id));
  if (!steps.length) errors.push(`${where} has no fragment`);
  for (const step of steps) {
    const at = `${where} step ${step.id}`;
    if (!step.id || !step.step || !step.actor)
      errors.push(`${at} needs id, step, actor`);
    if (!["task", "wait", "decision"].includes(step.kind))
      errors.push(`${at} kind «${step.kind}» — task | wait | decision`);
    if (step.box != null && !modelBoxIds.has(step.box))
      errors.push(`${at} box ${step.box} is not in the model`);
    // A decision routes by explicit `yes` / `no`; task and wait steps by `next` only.
    const routes = step.kind === "decision" ? ["yes", "no"] : ["next"];
    for (const key of routes)
      if (step[key] == null) errors.push(`${at} has no ${key}`);
      else if (step[key] !== "end" && !stepIds.has(step[key]))
        errors.push(`${at} ${key} → ${step[key]} — no such step`);
    for (const key of ["next", "yes", "no", "loop_to"])
      if (step[key] != null && !routes.includes(key))
        errors.push(
          `${at}: «${key}» — a decision routes by yes / no, other steps by next`,
        );
  }
}
// Derived rounds: every loop named in `rounds_from.plus_extra_rounds_of` exists and has its own rounds_draft (no chains).
for (const loop of loopByName.values())
  for (const name of asList(loop.rounds_from?.plus_extra_rounds_of))
    if (loopByName.get(name)?.rounds_draft == null)
      errors.push(
        `loops.yaml: «${loop.name}» rounds_from names «${name}» — no loop with rounds_draft`,
      );
for (const [id, { diagram, box }] of leafById) {
  const effort = box.effort ?? {};
  if (!isRange(effort.lead_days_draft))
    errors.push(
      `${diagram}: leaf ${id} lead_days_draft must be a number or [min, max]`,
    );
  if (!effort.lead_days_basis)
    errors.push(`${diagram}: leaf ${id} effort has no lead_days_basis`);
  if (effort.iterations != null) {
    const loop = loopByName.get(effort.iterations);
    if (!loop)
      errors.push(
        `${diagram}: leaf ${id} iterations «${effort.iterations}» is not a loops.yaml name`,
      );
    else if (!asList(loop.leaves).includes(id))
      errors.push(
        `${diagram}: leaf ${id} is missing from loops.yaml «${loop.name}» leaves`,
      );
  }
}
for (const team of teamsDoc?.teams ?? []) {
  if (!asList(team.members).length)
    errors.push(`teams.yaml: ${team.id} has no members`);
  for (const member of asList(team.members)) {
    resolveRole(member.role, `teams.yaml: ${team.id} member`);
    if (!isRange(member.fte_draft))
      errors.push(
        `teams.yaml: ${team.id} member «${member.role}» fte_draft must be a number or [min, max]`,
      );
  }
  for (const pool of asList(team.draws_on))
    resolveRole(pool.role, `teams.yaml: ${team.id} draws_on`);
}
// One FTE-hours variable: teams.yaml owns paid_hours_per_month (capacity and the in-house hourly
// cost divide by the same hours); no other file or key redefines hours per month.
const HOURS_PER_MONTH = /hours?_(per_)?month/;
if (!isRange(teamsDoc?.capacity_variables?.paid_hours_per_month?.draft))
  errors.push(
    "teams.yaml: capacity_variables.paid_hours_per_month.draft is missing",
  );
for (const key of Object.keys(teamsDoc?.capacity_variables ?? {}))
  if (HOURS_PER_MONTH.test(key) && key !== "paid_hours_per_month")
    errors.push(
      `teams.yaml: capacity_variables.${key} — paid_hours_per_month is the only hours-per-month variable`,
    );
const ratesDoc = parse(
  await readFile(join(pkg, "rates", "rates.yaml"), "utf8"),
);
for (const key of Object.keys(ratesDoc?.variables ?? {}))
  if (HOURS_PER_MONTH.test(key))
    errors.push(
      `rates.yaml: variables.${key} — hours per month live in teams.yaml paid_hours_per_month`,
    );

// Rate coverage (../rates/rates.yaml): every role string of the model — leaf effort.role, box
// mechanisms, teams.yaml roles, «Роли и круги» and the closed sub-role list — has a rates.yaml
// record, unless it is a tool or an aggregate label listed in NO_OWN_RATE; every rates.yaml record
// names a model role and carries a dated source or `composite_of`.
const NO_OWN_RATE = new Set([
  // tools and external costs, not roles
  "Платформа DS",
  "ИИ-инструменты",
  "Студия",
  // aggregate mechanism labels of upper diagrams: each named role is rated by its own record
  "Продуктовая команда — аккаунт, продюсер",
  "Продуктовая команда — аккаунт, продюсер, методолог",
  "Продуктовая команда — медредактор-сценарист, менеджер эксперта, продюсер, менеджер мероприятий",
  "Продуктовая команда — методолог, продюсер, аккаунт, менеджеры экспертов",
  "Продуктовая команда — продюсер, команда-владелец направления",
  "Продуктовые команды",
  "Продуктовые команды — найм, деление, СОП",
  "Пул медрецензентов — по сигналу",
  "Пул медрецензентов — политика независимости",
  "Пул экспертов — амбассадор, эксперты",
  "Пул экспертов — эксперты, спикеры",
  "Сервисный круг — оператор платформы, режиссёр трансляции, поддержка",
  "Сервисный круг — юрист, бухгалтер",
  "Сервисный круг — юрист, оператор платформы, режиссёр трансляции, поддержка",
  "Ядро — стандарты, рынок, калькулятор, коуч",
]);
const rateRoles = new Set(asList(ratesDoc?.roles).map((record) => record.role));
const modelRoles = new Set([
  ...process_.roles,
  ...[...subRoles].flatMap(([circle, names]) =>
    [...names].map((name) => `${circle} — ${name}`),
  ),
]);
const needsRate = new Map(); // role string -> where first seen
const need = (role, where) => {
  const name = String(role ?? "").replace(/\s*\(.*\)\s*$/, "");
  if (name && !needsRate.has(name)) needsRate.set(name, where);
};
for (const role of modelRoles) need(role, "«Роли и круги» / «Подроли»");
for (const diagram of diagrams)
  for (const box of diagram.boxes ?? []) {
    if (box.effort?.role)
      need(box.effort.role, `${diagram.id}: leaf ${box.id}`);
    for (const m of asList(box.mechanisms))
      need(m, `${diagram.id}: box ${box.id} mechanism`);
  }
for (const team of teamsDoc?.teams ?? [])
  for (const entry of [...asList(team.members), ...asList(team.draws_on)])
    need(entry.role, `teams.yaml: ${team.id}`);
for (const [role, where] of needsRate)
  if (!rateRoles.has(role) && !NO_OWN_RATE.has(role))
    errors.push(
      `${where}: role «${role}» has no rates.yaml record (add one, or list it in NO_OWN_RATE if it is a tool or an aggregate label)`,
    );
for (const label of NO_OWN_RATE)
  if (!needsRate.has(label))
    warnings.push(`NO_OWN_RATE «${label}» is no longer used in the model`);
for (const record of asList(ratesDoc?.roles)) {
  if (!needsRate.has(record.role) || NO_OWN_RATE.has(record.role))
    errors.push(`rates.yaml: record «${record.role}» is no model role`);
  const dated = asList(record.sources).filter((s) => s?.url && s?.accessed);
  if (!record.composite_of && !dated.length)
    errors.push(
      `rates.yaml: record «${record.role}» has no source with url and accessed, nor composite_of`,
    );
}
// The team circle «Продуктовая команда» is the direction team: its hours split between the
// team roles with an FTE (capacity), so its composite rate must be read over the same roles.
const teamCircle = asList(ratesDoc?.roles).find(
  (r) => r.role === "Продуктовая команда",
);
const directionTeam = asList(teamsDoc?.teams).find((t) => t.id === "direction");
if (teamCircle && directionTeam) {
  const fteRoles = [
    ...asList(directionTeam.members),
    ...asList(directionTeam.draws_on),
  ]
    .filter((m) => m.fte_draft != null)
    .map((m) => m.role)
    .sort();
  const circle = [...asList(teamCircle.composite_of)].sort();
  if (JSON.stringify(circle) !== JSON.stringify(fteRoles))
    errors.push(
      `rates.yaml: «Продуктовая команда» composite_of must equal the teams.yaml direction roles with fte_draft (${fteRoles.join(", ")})`,
    );
}
console.log(
  `Rates: ${[...needsRate.keys()].filter((r) => rateRoles.has(r)).length} role strings with a record, ${[...needsRate.keys()].filter((r) => NO_OWN_RATE.has(r)).length} without own rate (NO_OWN_RATE)`,
);
console.log(
  `Loops: ${loopByName.size}; leaves with lead time: ${[...leafById.values()].filter(({ box }) => box.effort?.lead_days_draft != null).length}/${leafById.size}; teams: ${asList(teamsDoc?.teams).length}`,
);

if (pending.length) console.log(`Decomposition pending: ${pending.join(", ")}`);
console.log(`Leaves with draft effort: ${totalLeaves}`);

for (const warning of warnings) console.log(`WARN  ${warning}`);
for (const error of errors) console.log(`ERROR ${error}`);
console.log(errors.length ? `FAIL: ${errors.length} error(s)` : "OK");
process.exit(errors.length ? 1 : 0);
