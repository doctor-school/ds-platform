// Unit cost calculator core of the content-production model (formulas: cost-model-ru.md).
// Pure ES module for the browser and node: YAML text comes in through a caller-supplied reader
// and parser, numbers go out. No node-only imports — the viewer loads it through an import map.

export const SCENARIOS = ["min", "mid", "max"];
const WEEKS_PER_MONTH = 52 / 12;
// The team circle: its hours are split between team roles by FTE (capacity-ru.md); its
// composite_of in rates.yaml lists the same roles (trace-check), so the plan reconciles with payroll.
const TEAM_CIRCLE = "Продуктовая команда";
export const IDLE_LINE = "неиспользованная мощность штата";

/** Reads every input file through `readText(pathRelativeToPackageRoot)` and `parseYaml(text)`. */
export async function loadInputs(readText, parseYaml) {
  const read = async (path) => parseYaml(await readText(path));
  const index = await read("model/index.yaml");
  const diagrams = await Promise.all(
    index.diagrams.map((d) => read(`model/${d.file}`)),
  );
  const [loops, teams, rates, products] = await Promise.all([
    read("model/loops.yaml"),
    read("model/teams.yaml"),
    read("rates/rates.yaml"),
    read("calculator/products.yaml"),
  ]);
  return { diagrams, loops, teams, rates, products };
}

/** Value of a draft at a scenario: number as is, [min, max] or [min, mid, max], null stays null. */
export function pick(value, scenario) {
  if (value == null || typeof value !== "object") return value ?? null;
  if (value.length === 3)
    return value[{ min: 0, mid: 1, max: 2 }[scenario]] ?? null;
  const [lo, hi] = value;
  if (lo == null || hi == null) return null;
  if (scenario === "min") return lo;
  if (scenario === "max") return hi;
  return (lo + hi) / 2;
}

const product = (values) => values.reduce((a, b) => a * b, 1);
const sum = (values) => values.reduce((a, b) => a + b, 0);
const add = (map, key, value) => {
  map[key] = (map[key] ?? 0) + value;
};

/**
 * Normalised model with `overrides` applied. Override keys (flat map, cost-model-ru.md):
 * `leaf:<ID>` hours, `lead:<ID>` lead days, `loop:<name>` rounds, `wait:<name>` wait days,
 * `rate:<role>:monthly|hourly|hourly_cost`, `piece:<ID>` rub per pass, `fte:<role>`,
 * `var:<name>`, `param:<product>:<name>`, `external:<id>`, `plan:<product>` units per month.
 */
export function buildModel(inputs, overrides = {}) {
  // Parsed YAML is plain JSON data, so a JSON round-trip is a full deep copy.
  const src = JSON.parse(JSON.stringify(inputs));
  const leaves = new Map();
  for (const diagram of src.diagrams)
    for (const box of diagram.boxes ?? [])
      if (box.leaf)
        leaves.set(box.id, {
          id: box.id,
          name: box.name,
          diagram: diagram.id,
          role: box.effort.role,
          unit: box.effort.unit,
          hours: box.effort.hours_draft,
          leadDays: box.effort.lead_days_draft,
          iterations: box.effort.iterations ?? null,
        });
  const loops = new Map(src.loops.loops.map((loop) => [loop.name, loop]));
  const direction = src.teams.teams.find((t) => t.id === "direction");
  const teamRoleNames = new Set(
    [...direction.members, ...direction.draws_on].map((m) => m.role),
  );
  const teamRoles = [...direction.members, ...direction.draws_on]
    .filter((m) => m.fte_draft != null)
    .map((m) => ({ role: m.role, fte: m.fte_draft }));
  const vars = {};
  for (const [name, v] of Object.entries(src.teams.capacity_variables))
    vars[name] = v.draft;
  for (const [name, v] of Object.entries(src.products.variables))
    vars[name] = v.draft;
  vars.employer_contributions_rate =
    src.rates.variables.employer_contributions_rate.default;
  const rates = new Map(src.rates.roles.map((r) => [r.role, r]));
  const products = src.products.products;
  const params = {};
  for (const [name, p] of Object.entries(products))
    params[name] = Object.fromEntries(
      Object.entries(p.parameters ?? {}).map(([k, v]) => [k, v.draft]),
    );
  const externals = src.products.externals;
  const model = {
    leaves,
    loops,
    teamRoles,
    teamRoleNames,
    vars,
    rates,
    rateVariables: src.rates.variables,
    products,
    params,
    externals,
    config: src.products,
    hourlyCostOverride: {},
    piece: {},
    plan: null,
    cache: new Map(),
  };
  for (const [key, value] of Object.entries(overrides))
    applyOverride(model, key, value);
  return model;
}

function applyOverride(model, key, value) {
  const [kind, name, field] = key.split(":");
  const need = (thing, what) => {
    if (thing == null) throw new Error(`override ${key}: unknown ${what}`);
    return thing;
  };
  switch (kind) {
    case "leaf":
      need(model.leaves.get(name), "leaf").hours = value;
      return;
    case "lead":
      need(model.leaves.get(name), "leaf").leadDays = value;
      return;
    case "piece":
      need(model.leaves.get(name), "leaf");
      model.piece[name] = value;
      return;
    case "loop": {
      const loop = need(model.loops.get(name), "loop");
      delete loop.rounds_from;
      loop.rounds_draft = value;
      return;
    }
    case "wait":
      need(model.loops.get(name), "loop").wait_days_per_round_draft = value;
      return;
    case "rate": {
      const record = need(model.rates.get(name), "role");
      if (field === "hourly_cost") model.hourlyCostOverride[name] = value;
      else if (field === "hourly") record.hourly_rub = value;
      else if (field === "monthly")
        record.monthly_gross_rub = {
          ...(record.monthly_gross_rub ?? {}),
          [model.vars.region]: value,
        };
      else throw new Error(`override ${key}: field monthly|hourly|hourly_cost`);
      return;
    }
    case "fte": {
      const member = model.teamRoles.find((m) => m.role === name);
      if (member) member.fte = value;
      else {
        need(
          model.teamRoleNames.has(name) || model.rates.has(name) ? true : null,
          "role",
        );
        model.teamRoles.push({ role: name, fte: value });
      }
      return;
    }
    case "var":
      need(name in model.vars ? true : null, "variable");
      model.vars[name] = value;
      return;
    case "param":
      need(model.params[name], "product");
      need(field in model.params[name] ? true : null, "parameter");
      model.params[name][field] = value;
      return;
    case "external":
      need(model.externals[name], "external").rub = value;
      return;
    case "plan":
      need(model.products[name], "product");
      model.plan = { ...(model.plan ?? {}), [name]: value };
      return;
    default:
      throw new Error(`override ${key}: unknown kind`);
  }
}

const memo = (model, key, fn) => {
  if (!model.cache.has(key)) model.cache.set(key, fn());
  return model.cache.get(key);
};

/** Rounds of a loop: rounds_draft, or base + Σ (rounds − 1) of plus_extra_rounds_of; no loop → 1. */
export function loopRounds(model, name, scenario) {
  if (name == null) return 1;
  const loop = model.loops.get(name);
  if (!loop) throw new Error(`unknown loop «${name}»`);
  if (loop.rounds_from)
    return (
      loop.rounds_from.base +
      sum(
        loop.rounds_from.plus_extra_rounds_of.map(
          (other) => loopRounds(model, other, scenario) - 1,
        ),
      )
    );
  return pick(loop.rounds_draft, scenario);
}

/** Direct / overhead / reserve class of a leaf: role first (В8), then unit. */
export function leafClass(model, leaf) {
  const c = model.config.classification;
  if (c.overhead_role_prefixes.some((p) => leaf.role.startsWith(p)))
    return "overhead";
  if (c.overhead_units.includes(leaf.unit)) return "overhead";
  if (c.reserve_units.includes(leaf.unit)) return "reserve";
  return "direct";
}

const teamFte = (model, scenario) =>
  sum(model.teamRoles.map((m) => pick(m.fte, scenario)));

function contributions(model, monthly) {
  const v = model.rateVariables.employer_contributions_rate;
  const annual = monthly * 12;
  const base = v.base_2026_rub;
  const within = model.vars.employer_contributions_rate;
  const above = v.above_base_rate + v.nsipz_min;
  return (
    (within * Math.min(annual, base) + above * Math.max(0, annual - base)) / 12
  );
}

function contractorOnTop(model, record) {
  const on = model.rateVariables.contractor_on_top_rate;
  const form = model.vars.contractor_form;
  if (form != null) return on[form] ?? 0;
  return on.default_by_engagement?.[record.engagement] ?? 0;
}

/**
 * Hourly cost of a role at a scenario: { value | null, flags, basis }. `staff` prices штат time
 * only — non-production hours (meetings, hiring, management) are never the external pool's share.
 */
export function roleHourlyCost(model, role, scenario, staff = false) {
  return memo(model, `rate|${role}|${scenario}|${staff}`, () =>
    resolveRate(model, role, scenario, staff),
  );
}

function resolveRate(model, role, scenario, staff) {
  const override = model.hourlyCostOverride[role];
  if (override != null)
    return { value: pick(override, scenario), flags: [], basis: "калибровка" };
  const proxy = model.config.rate_proxy?.[role];
  if (proxy) {
    const r = roleHourlyCost(model, proxy, scenario, staff);
    return { ...r, flags: [...r.flags, `ставка взята по роли «${proxy}»`] };
  }
  const record = model.rates.get(role);
  if (!record) return { value: null, flags: ["нет записи ставки"], basis: "—" };
  if (record.composite_of && !record.monthly_gross_rub && !record.hourly_rub) {
    const weights = Object.fromEntries(
      model.teamRoles.map((m) => [m.role, pick(m.fte, scenario)]),
    );
    const parts = record.composite_of
      .map((member) => ({
        w: weights[member] ?? 1,
        r: roleHourlyCost(model, member, scenario, staff),
      }))
      .filter((p) => p.r.value != null);
    if (!parts.length)
      return { value: null, flags: ["ставки круга не заданы"], basis: "круг" };
    const w = sum(parts.map((p) => p.w));
    return {
      value: sum(parts.map((p) => p.w * p.r.value)) / w,
      flags: [...new Set(parts.flatMap((p) => p.r.flags))],
      basis: "круг: средневзвешенно по FTE",
    };
  }
  const inHouse = () => {
    const byRegion = record.monthly_gross_rub;
    if (!byRegion) return null;
    const flags = [];
    let monthly = byRegion[model.vars.region];
    if (monthly == null && model.vars.region !== "moscow") {
      monthly = byRegion.moscow;
      flags.push("ставка по Москве — для региона нет данных");
    }
    const m = pick(monthly, scenario);
    if (m == null) return null;
    return {
      value: (m + contributions(model, m)) / model.vars.paid_hours_per_month,
      flags,
      basis: "штат",
    };
  };
  const contractor = () => {
    const h = record.hourly_rub;
    if (!h) return null;
    const flags = [];
    let value = pick(h, scenario);
    if (value == null && Array.isArray(h)) {
      value = h[0] ?? h[1];
      flags.push(
        h[0] != null
          ? "ставка взята по нижней границе рынка — верхняя и, вероятно, средняя оценка занижены"
          : "ставка взята по верхней границе рынка — нижняя и, вероятно, средняя оценка завышены",
      );
    }
    if (value == null) return null;
    return {
      value: value * (1 + contractorOnTop(model, record)),
      flags,
      basis: "подряд",
    };
  };
  const contractorFirst = /^(подряд|гонорар|аутсорсинг)/.test(
    record.engagement ?? "",
  );
  const first = contractorFirst ? contractor() : inHouse();
  const second = contractorFirst ? inHouse() : contractor();
  const share = model.vars.media_external_share ?? 0;
  if (role.startsWith("Медиа-круг — ") && share > 0 && first && second) {
    const ext = first.basis === "подряд" ? first : second;
    const own = first.basis === "штат" ? first : second;
    if (staff)
      return { ...own, inHouse: own.value, contractor: null, share: 0 };
    return {
      value: (1 - share) * own.value + share * ext.value,
      flags: [...own.flags, ...ext.flags],
      basis: `штат + доля внешнего пула ${share}`,
      inHouse: own.value,
      contractor: ext.value,
      share,
    };
  }
  const chosen = first ?? second;
  if (!chosen) return { value: null, flags: ["ставка не задана"], basis: "—" };
  const own = chosen.basis === "штат" ? chosen : inHouse();
  return { ...chosen, inHouse: own?.value ?? null, contractor: null, share: 0 };
}

function paramValue(model, productName, qty, scenario) {
  if (typeof qty === "number") return qty;
  const value = pick(model.params[productName]?.[qty], scenario);
  if (value == null)
    throw new Error(`«${productName}»: parameter «${qty}» is not set`);
  return value;
}

function expand(model, productName, scenario, visit, qty = 1, path = []) {
  const p = model.products[productName];
  if (!p) throw new Error(`unknown product «${productName}»`);
  const here = [...path, productName];
  visit({ product: productName, qty, path: here });
  for (const item of p.items) {
    const n =
      paramValue(model, productName, item.qty ?? 1, scenario) *
      product(
        (item.per ?? []).map((k) =>
          paramValue(model, productName, k, scenario),
        ),
      );
    if (item.product)
      expand(model, item.product, scenario, visit, qty * n, here);
    else visit({ leaf: item.leaf, qty: qty * n, path: [...here, item.leaf] });
  }
}

function leafLine(model, id, qty, path, scenario) {
  const leaf = model.leaves.get(id);
  if (!leaf) throw new Error(`unknown leaf ${id}`);
  const hoursPerPass = pick(leaf.hours, scenario);
  const rounds = loopRounds(model, leaf.iterations, scenario);
  return {
    path,
    leaf: id,
    name: leaf.name,
    role: leaf.role,
    unit: leaf.unit,
    class: leafClass(model, leaf),
    qty,
    hoursPerPass,
    rounds,
    hours: hoursPerPass * rounds * qty,
  };
}

function costLine(model, line, scenario, staff = false) {
  const piece = model.piece[line.leaf];
  if (piece != null) {
    const record = model.rates.get(line.role);
    const onTop = record ? contractorOnTop(model, record) : 0;
    const rub = pick(piece, scenario) * (1 + onTop);
    return {
      ...line,
      hourlyCost: null,
      cost: rub * line.rounds * line.qty,
      flags: ["сдельно"],
    };
  }
  const rate = roleHourlyCost(model, line.role, scenario, staff);
  return {
    ...line,
    hourlyCost: rate.value,
    cost: rate.value == null ? null : line.hours * rate.value,
    flags: rate.flags,
  };
}

/** Hours of a product: trail lines unit → leaf → role, hours × rounds × quantity. */
export function productHours(model, productName, scenario) {
  return memo(model, `hours|${productName}|${scenario}`, () => {
    const lines = [];
    expand(model, productName, scenario, (node) => {
      if (node.leaf)
        lines.push(leafLine(model, node.leaf, node.qty, node.path, scenario));
    });
    const directByRole = {};
    const overheadByRole = {};
    for (const line of lines)
      add(
        line.class === "overhead" ? overheadByRole : directByRole,
        line.role,
        line.hours,
      );
    const directHours = sum(
      lines.filter((l) => l.class === "direct").map((l) => l.hours),
    );
    return { lines, directByRole, overheadByRole, directHours };
  });
}

function periodLeafCount(model, entry, scenario) {
  return product(entry.per.map((name) => pick(model.vars[name], scenario)));
}

/** Non-production hours of a team role per team-month: own period leaves + its FTE share of team leaves. */
function nonProduction(model, role, scenario) {
  const teams = model.vars.teams;
  const fte = pick(model.teamRoles.find((m) => m.role === role).fte, scenario);
  let hours = 0;
  for (const entry of model.config.period_leaves) {
    const leaf = model.leaves.get(entry.leaf);
    const h =
      pick(leaf.hours, scenario) *
      loopRounds(model, leaf.iterations, scenario) *
      (periodLeafCount(model, entry, scenario) / teams);
    if (leaf.role === role) hours += h;
    else if (leaf.role === TEAM_CIRCLE)
      hours += (h * fte) / teamFte(model, scenario);
  }
  return hours;
}

/** Hours by role with the team circle's hours split between team roles by FTE share. */
function splitCircle(model, byRole, scenario) {
  const out = { ...byRole };
  const shared = out[TEAM_CIRCLE] ?? 0;
  delete out[TEAM_CIRCLE];
  if (shared) {
    const total = teamFte(model, scenario);
    for (const m of model.teamRoles)
      add(out, m.role, (shared * pick(m.fte, scenario)) / total);
  }
  return out;
}

/** Team-role hours per product unit (direct lines). */
function teamHours(model, productName, scenario) {
  return splitCircle(
    model,
    productHours(model, productName, scenario).directByRole,
    scenario,
  );
}

/** Capacity of one direction team doing only this product: C = min A(r) ÷ H(r), bottleneck role. */
export function teamCapacity(model, productName, scenario) {
  return memo(model, `cap|${productName}|${scenario}`, () => {
    const H = teamHours(model, productName, scenario);
    const P = model.vars.paid_hours_per_month;
    const roles = model.teamRoles.map((m) => {
      const fte = pick(m.fte, scenario);
      const available = fte * P - nonProduction(model, m.role, scenario);
      const hours = H[m.role] ?? 0;
      return {
        role: m.role,
        fte,
        available,
        hours,
        perMonth: hours > 0 ? available / hours : null,
      };
    });
    const limiting = roles.filter((r) => r.perMonth != null);
    if (!limiting.length)
      return { perMonth: null, bottleneck: null, roles, commitments: {} };
    const worst = limiting.reduce((a, b) => (b.perMonth < a.perMonth ? b : a));
    const team = new Set(model.teamRoles.map((m) => m.role));
    const commitments = Object.fromEntries(
      Object.entries(H)
        .filter(([role]) => !team.has(role))
        .map(([role, h]) => [role, h * worst.perMonth]),
    );
    return {
      perMonth: worst.perMonth,
      bottleneck: worst.role,
      roles,
      commitments,
    };
  });
}

/** FTE of a team role needed for `perWeek` units a week: units/month × H ÷ (P − non-production per FTE). */
export function requiredFte(model, productName, role, perWeek, scenario) {
  const H = teamHours(model, productName, scenario)[role] ?? 0;
  const fte = pick(model.teamRoles.find((m) => m.role === role).fte, scenario);
  const perFte = nonProduction(model, role, scenario) / fte;
  return (
    (perWeek * WEEKS_PER_MONTH * H) / (model.vars.paid_hours_per_month - perFte)
  );
}

function leafLead(model, id, scenario) {
  const leaf = model.leaves.get(id);
  if (!leaf) throw new Error(`unknown leaf ${id} in a lead chain`);
  const n = loopRounds(model, leaf.iterations, scenario);
  const w = leaf.iterations
    ? pick(model.loops.get(leaf.iterations).wait_days_per_round_draft, scenario)
    : 0;
  return pick(leaf.leadDays, scenario) * n + (n - 1) * w;
}

function chainLead(model, node, scenario) {
  if (typeof node === "string") return leafLead(model, node, scenario);
  if (node.seq) return sum(node.seq.map((n) => chainLead(model, n, scenario)));
  if (node.par)
    return Math.max(...node.par.map((n) => chainLead(model, n, scenario)));
  throw new Error(`lead chain node needs seq or par: ${JSON.stringify(node)}`);
}

/** Lead time in working days: D(l) = d × n + (n − 1) × w along the chain; pipelines add takts. */
export function leadTime(model, productName, scenario) {
  const lead = model.products[productName]?.lead;
  if (!lead) return null;
  if (lead.chain) return chainLead(model, lead.chain, scenario);
  const pipe = lead.pipeline;
  const takt =
    model.vars.working_days_per_month /
    teamCapacity(model, pipe.stream, scenario).perMonth;
  const main =
    sum(pipe.first.map((p) => leadTime(model, p, scenario))) +
    (pipe.count - 1) * takt;
  const parallel = (pipe.parallel ?? []).map((p) =>
    leadTime(model, p, scenario),
  );
  return Math.max(main, ...parallel);
}

/**
 * Period plan per month: units (explicit `plan:` overrides, else `teams` direction teams at capacity
 * on `plan_mix`), direct hours, the overhead pool (overhead lines of the units + period leaves)
 * and the overhead rate per direct hour.
 */
export function periodPlan(model, scenario) {
  return memo(model, `plan|${scenario}`, () => {
    let sold;
    let bottleneck = null;
    if (model.plan) sold = { ...model.plan };
    else {
      const mix = model.vars.plan_mix;
      const cap = teamCapacity(model, mix, scenario);
      bottleneck = cap.bottleneck;
      sold = { [mix]: cap.perMonth * model.vars.teams };
    }
    const units = {};
    let directHours = 0;
    const poolLines = [];
    for (const [name, n] of Object.entries(sold)) {
      expand(model, name, scenario, (node) => {
        if (node.product) add(units, node.product, node.qty * n);
      });
      for (const line of productHours(model, name, scenario).lines) {
        const scaled = { ...line, qty: line.qty * n, hours: line.hours * n };
        if (line.class === "direct") directHours += scaled.hours;
        else if (line.class === "overhead")
          poolLines.push({
            ...costLine(model, scaled, scenario),
            source: name,
          });
      }
    }
    for (const entry of model.config.period_leaves) {
      const count = periodLeafCount(model, entry, scenario);
      if (!count) continue;
      const line = leafLine(model, entry.leaf, count, [entry.leaf], scenario);
      // Period leaves are non-production time of the team: штат hours at the штат rate.
      poolLines.push({
        ...costLine(model, line, scenario, true),
        source: "период",
      });
    }
    const poolCost = sum(poolLines.map((l) => l.cost ?? 0));
    const unpriced = poolLines.filter((l) => l.cost == null).map((l) => l.leaf);
    const idle = idleCapacity(model, sold, scenario);
    return {
      sold,
      units,
      bottleneck,
      directHours,
      poolLines,
      poolCost,
      unpriced,
      overheadPerDirectHour: directHours ? poolCost / directHours : 0,
      idle: {
        ...idle,
        perDirectHour: directHours ? idle.cost / directHours : 0,
      },
    };
  });
}

/**
 * Paid штат time of team roles that the plan leaves unused (owner decision 2026-10-05, #2522
 * «Idle paid time»): teams × FTE × P − non-production − hours the plan's units load, per role.
 */
function idleCapacity(model, sold, scenario) {
  const teams = model.vars.teams;
  const P = model.vars.paid_hours_per_month;
  const loadedBy = {};
  for (const [name, n] of Object.entries(sold))
    for (const line of productHours(model, name, scenario).lines)
      if (line.class !== "reserve") add(loadedBy, line.role, line.hours * n);
  const loaded = splitCircle(model, loadedBy, scenario);
  const flags = [];
  const byRole = model.teamRoles
    .filter((m) => model.rates.get(m.role)?.monthly_gross_rub)
    .map((m) => {
      const fte = pick(m.fte, scenario);
      const paidHours = teams * fte * P;
      const nonProd = teams * nonProduction(model, m.role, scenario);
      const load = loaded[m.role] ?? 0;
      // Loaded hours are charged at the blended rate: the external pool's share goes to the
      // contractor, the rest is штат time. Non-production hours are штат time at the штат rate
      // (the pool prices them so), and idle and payroll are штат time only.
      const rate = roleHourlyCost(model, m.role, scenario);
      const share = rate.share ?? 0;
      const own = rate.inHouse ?? rate.value ?? 0;
      const contractorHours = share * load;
      const free = paidHours - (nonProd + load - contractorHours);
      if (free < -1e-9) flags.push(`перегрузка штата: ${m.role}`);
      const idleHours = Math.max(0, free);
      return {
        role: m.role,
        teams,
        fte,
        paidHours,
        nonProduction: nonProd,
        loaded: load,
        idleHours,
        hourlyCost: rate.value,
        ownHourlyCost: own,
        idleCost: idleHours * own,
        payroll: paidHours * own,
        contractorHours,
        contractorCost: contractorHours * (rate.contractor ?? 0),
      };
    });
  return {
    byRole,
    hours: sum(byRole.map((r) => r.idleHours)),
    cost: sum(byRole.map((r) => r.idleCost)),
    flags,
  };
}

function reserveOfUnit(model, productName, scenario) {
  const p = model.products[productName];
  const v = model.vars;
  const signals = pick(v.signals_per_unit, scenario);
  const affected = pick(v.affected_share, scenario);
  const rebuild = pick(v.rebuild_share, scenario);
  const cfg = model.config.update_reserve;
  const one = (id) =>
    costLine(
      model,
      leafLine(model, id, 1, [productName, id], scenario),
      scenario,
    );
  const signal = one(cfg.signal_leaf);
  const per = cfg.affected_leaves.map(one);
  const line = productHours(model, productName, scenario)
    .lines.filter(
      (l) => l.class === "direct" && l.leaf.startsWith(p.reserve_line),
    )
    .map((l) => costLine(model, l, scenario));
  const lineHours = sum(line.map((l) => l.hours));
  const lineCost = sum(line.map((l) => l.cost ?? 0));
  return {
    hours:
      signals * signal.hours +
      affected * (sum(per.map((l) => l.hours)) + rebuild * lineHours),
    cost:
      signals * (signal.cost ?? 0) +
      affected * (sum(per.map((l) => l.cost ?? 0)) + rebuild * lineCost),
  };
}

/** Full unit cost = direct + allocated overhead + update reserve (+ externals that are set). */
export function unitCost(model, productName, scenario) {
  return memo(model, `cost|${productName}|${scenario}`, () => {
    const hours = productHours(model, productName, scenario);
    const trail = hours.lines.map((l) => costLine(model, l, scenario));
    const direct = trail.filter((l) => l.class === "direct");
    const byRole = {};
    for (const l of direct) {
      byRole[l.role] ??= { hours: 0, cost: 0 };
      byRole[l.role].hours += l.hours;
      byRole[l.role].cost += l.cost ?? 0;
    }
    const flags = new Set();
    for (const l of trail)
      for (const f of l.flags) flags.add(`${l.role}: ${f}`);
    for (const l of direct)
      if (l.cost == null) flags.add(`ставка не задана: ${l.role}`);
    const plan = periodPlan(model, scenario);
    if (plan.unpriced.length)
      flags.add(`накладные без ставки: ${plan.unpriced.join(", ")}`);
    for (const f of plan.idle.flags) flags.add(f);
    const directHours = sum(direct.map((l) => l.hours));
    const directCost = sum(direct.map((l) => l.cost ?? 0));
    const overheadCost = directHours * plan.overheadPerDirectHour;
    const reserve = { hours: 0, cost: 0 };
    const ext = {};
    const units = [];
    expand(model, productName, scenario, (node) => {
      if (!node.product) return;
      units.push({ path: node.path, product: node.product, qty: node.qty });
      const p = model.products[node.product];
      if (p.reserve_line) {
        const r = reserveOfUnit(model, node.product, scenario);
        reserve.hours += node.qty * r.hours;
        reserve.cost += node.qty * r.cost;
      }
      for (const id of p.externals ?? []) add(ext, id, node.qty);
    });
    const externals = Object.entries(ext).map(([id, qty]) => {
      const e = model.externals[id];
      const rub = pick(e.rub, scenario);
      return {
        id,
        name: e.name,
        per: e.per,
        qty,
        rub,
        cost: rub == null ? null : rub * qty,
        status: rub == null ? "не задано" : "задано",
      };
    });
    const unset = externals.filter((e) => e.rub == null);
    if (unset.length)
      flags.add(
        `внешние затраты не заданы: ${unset.map((e) => e.name).join(", ")}`,
      );
    const externalCost = sum(externals.map((e) => e.cost ?? 0));
    const idleCost = directHours * plan.idle.perDirectHour;
    const byLoad = directCost + overheadCost + reserve.cost + externalCost;
    trail.push({
      path: [productName],
      leaf: null,
      name: IDLE_LINE,
      role: null,
      class: "idle",
      qty: 1,
      hours: directHours,
      hoursPerPass: null,
      rounds: null,
      hourlyCost: plan.idle.perDirectHour,
      cost: idleCost,
      flags: [],
    });
    return {
      product: productName,
      scenario,
      direct: { hours: directHours, cost: directCost, byRole },
      overhead: {
        cost: overheadCost,
        perDirectHour: plan.overheadPerDirectHour,
        ownHours: sum(
          trail.filter((l) => l.class === "overhead").map((l) => l.hours),
        ),
      },
      reserve,
      externals,
      units,
      idle: { cost: idleCost, perDirectHour: plan.idle.perDirectHour },
      total: { byLoad, fullPayroll: byLoad + idleCost },
      flags: [...flags],
      trail,
    };
  });
}

/** Everything for one product at min / mid / max: cost, capacity and lead time. */
export function computeProduct(model, productName) {
  return Object.fromEntries(
    SCENARIOS.map((s) => [
      s,
      {
        ...unitCost(model, productName, s),
        capacity: teamCapacity(model, productName, s),
        leadDays: leadTime(model, productName, s),
      },
    ]),
  );
}
