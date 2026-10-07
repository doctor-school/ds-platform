// Stage A mockup (#2661): management layer over the operation model. Monthly management totals
// (staff payroll, pools, period overhead) are allocated to products ABC-style, with the operation
// model as the read-only allocation key (formulas: mockup-management-notes-ru.md). Built on
// compute.mjs; with every input at its model estimate the results equal today's calculator.

import {
  SCENARIOS,
  buildModel,
  periodPlan,
  unitCost,
  roleHourlyCost,
  loopRounds,
  pick,
} from "./compute.mjs";

/** Cost pools of the management layer: one monthly total each, allocated by the model's role-hours. */
export const POOLS = [
  {
    id: "staff",
    name: "ФОТ штата команды направления",
    short: "ФОТ команды",
  },
  {
    id: "media",
    name: "Медиа-круг — обязательство мощности",
    short: "Медиа-круг",
  },
  { id: "experts", name: "Пул экспертов — гонорары", short: "Пул экспертов" },
  {
    id: "reviewers",
    name: "Пул медрецензентов",
    short: "Пул медрецензентов",
  },
  {
    id: "overhead",
    name: "Накладные периода: ядро, сервисный круг, коуч",
    short: "Накладные",
  },
];

const sum = (values) => values.reduce((a, b) => a + b, 0);
const add = (map, key, value) => {
  map[key] = (map[key] ?? 0) + value;
};

/** Cost pool of a role: team штат (with the team circle), media circle, expert / reviewer pools, overhead. */
export function roleGroup(model, role) {
  if (role === "Продуктовая команда") return "staff";
  if (
    model.teamRoles.some((m) => m.role === role) &&
    model.rates.get(role)?.monthly_gross_rub
  )
    return "staff";
  if (role.startsWith("Медиа-круг")) return "media";
  if (role.startsWith("Пул экспертов")) return "experts";
  if (role.startsWith("Пул медрецензентов")) return "reviewers";
  return "overhead";
}

/** Model per scenario for a management plan: `teams` and, when set, an explicit month plan. */
export function scenarioModel(inputs, s, { teams, plan }) {
  const overrides = {};
  if (teams != null) overrides["var:teams"] = teams;
  if (plan)
    for (const [name, n] of Object.entries(plan))
      if (n > 0) overrides[`plan:${name}`] = n;
  return buildModel(inputs, overrides);
}

/** Model estimate of every monthly management total for the month plan of a scenario. */
export function modelTotals(model, s) {
  const plan = periodPlan(model, s);
  const totals = { staff: 0, media: 0, experts: 0, reviewers: 0, overhead: 0 };
  totals.staff = sum(plan.idle.byRole.map((r) => r.payroll));
  for (const [name, n] of Object.entries(plan.sold))
    for (const l of unitCost(model, name, s).trail)
      if (l.class === "direct") {
        const g = roleGroup(model, l.role);
        if (g !== "staff") add(totals, g, (l.cost ?? 0) * n);
      }
  let staffNonProduction = 0;
  for (const l of plan.poolLines) {
    const g = roleGroup(model, l.role);
    if (g === "staff") staffNonProduction += l.cost ?? 0;
    else add(totals, g, l.cost ?? 0);
  }
  return { totals, staffNonProduction, plan };
}

function leafCost(model, id, s) {
  const leaf = model.leaves.get(id);
  const hours = pick(leaf.hours, s) * loopRounds(model, leaf.iterations, s);
  const rate = roleHourlyCost(model, leaf.role, s).value ?? 0;
  return { role: leaf.role, hours, cost: hours * rate };
}

/** Update reserve of a product split by cost pool (same formula as compute.mjs reserveOfUnit). */
function reserveByGroup(model, cost, s) {
  const out = {};
  const v = model.vars;
  const signals = pick(v.signals_per_unit, s);
  const affected = pick(v.affected_share, s);
  const rebuild = pick(v.rebuild_share, s);
  const cfg = model.config.update_reserve;
  for (const u of cost.units) {
    const p = model.products[u.product];
    if (!p.reserve_line) continue;
    const sig = leafCost(model, cfg.signal_leaf, s);
    add(out, roleGroup(model, sig.role), u.qty * signals * sig.cost);
    for (const id of cfg.affected_leaves) {
      const l = leafCost(model, id, s);
      add(out, roleGroup(model, l.role), u.qty * affected * l.cost);
    }
    const unit = unitCost(model, u.product, s);
    for (const l of unit.trail)
      if (l.class === "direct" && l.leaf.startsWith(p.reserve_line))
        add(
          out,
          roleGroup(model, l.role),
          u.qty * affected * rebuild * (l.cost ?? 0),
        );
  }
  return out;
}

/**
 * Management result of one scenario. `money` = monthly totals by pool (₽), `externals` = ₽ per unit
 * by external id (null = «не задано»), `prices` = ₽ by product (null = not set).
 */
export function manage(model, s, { money, externals = {}, prices = {} }) {
  const est = modelTotals(model, s);
  const { plan } = est;
  const k = {};
  for (const pool of POOLS)
    k[pool.id] =
      est.totals[pool.id] > 0
        ? (money[pool.id] ?? est.totals[pool.id]) / est.totals[pool.id]
        : 1;
  const overheadPool =
    k.overhead * est.totals.overhead + k.staff * est.staffNonProduction;
  const overheadRate = plan.directHours ? overheadPool / plan.directHours : 0;
  const idleCost = k.staff * plan.idle.cost;
  const idleRate = plan.directHours ? idleCost / plan.directHours : 0;

  const product = (name) => {
    const c = unitCost(model, name, s);
    const lines = c.trail
      .filter((l) => l.class === "direct")
      .map((l) => {
        const g = roleGroup(model, l.role);
        return { ...l, group: g, mcost: (l.cost ?? 0) * k[g] };
      });
    const directByGroup = {};
    for (const l of lines) add(directByGroup, l.group, l.mcost);
    const direct = sum(lines.map((l) => l.mcost));
    const overhead = c.direct.hours * overheadRate;
    const reserveGroups = reserveByGroup(model, c, s);
    const reserve = sum(
      Object.entries(reserveGroups).map(([g, v]) => v * k[g]),
    );
    const ext = c.externals.map((e) => {
      const rub = externals[e.id] ?? null;
      return { ...e, rub, cost: rub == null ? null : rub * e.qty };
    });
    const external = sum(ext.map((e) => e.cost ?? 0));
    const idle = c.direct.hours * idleRate;
    const byLoad = direct + overhead + reserve + external;
    const price = prices[name] ?? null;
    return {
      name,
      hours: c.direct.hours,
      lines,
      directByGroup,
      direct,
      overhead,
      reserve,
      externals: ext,
      externalUnset: ext.filter((e) => e.rub == null).map((e) => e.name),
      idle,
      byLoad,
      fullPayroll: byLoad + idle,
      price,
      today: c.total,
    };
  };

  // Reconciliation: Σ over the month plan of (direct + overhead + idle) = management totals.
  let allocated = 0;
  for (const [name, n] of Object.entries(plan.sold)) {
    const r = product(name);
    allocated += n * (r.direct + r.overhead + r.idle);
  }
  const inputsTotal = sum(POOLS.map((p) => money[p.id] ?? est.totals[p.id]));
  return {
    scenario: s,
    estimate: est.totals,
    k,
    plan,
    overheadPool,
    overheadRate,
    idleCost,
    idleRate,
    product,
    reconciliation: { allocated, inputs: inputsTotal },
  };
}

/** IDEF0 function chain of an operation: A3 → A31 → A313 (diagram prefixes) with box names. */
export function functionNames(inputs) {
  const names = {};
  for (const d of inputs.diagrams)
    for (const b of d.boxes ?? [])
      if (/^A\d+$/.test(b.id)) names[b.id] = b.name;
  return names;
}

export function functionChain(model, leafId) {
  const d = model.leaves.get(leafId)?.diagram ?? "";
  const chain = [];
  for (let i = 2; i <= d.length; i++) chain.push(d.slice(0, i));
  if (d === "A0") return [];
  return chain;
}

export { SCENARIOS };
