// Unit cost and price calculator core of the content-production model (formulas: cost-model-ru.md).
// Pure ES module for the browser and node: YAML text comes in through a caller-supplied reader
// and parser, numbers go out. No node-only imports — the viewer loads it through an import map.
//
// Two independent axes replace a joint min/mid/max scenario (#2661): `ctx.grade` («Грейд»:
// junior | middle | senior | mix) drives rates, `ctx.course` («Ход работы»: smooth | usual |
// rework) drives hours, rounds and the other ranged drivers of the model (min / mid / max).

export const GRADES = ["junior", "middle", "senior"];
export const GRADE_MIX = "mix";
export const GRADE_LABELS = {
  junior: "junior",
  middle: "middle",
  senior: "senior",
  mix: "смесь команды",
};
export const COURSES = ["smooth", "usual", "rework"];
export const COURSE_LABELS = {
  smooth: "гладко",
  usual: "обычно",
  rework: "с переделками",
};
const COURSE_LEVEL = { smooth: "min", usual: "mid", rework: "max" };
export const DEFAULT_CTX = Object.freeze({ grade: GRADE_MIX, course: "usual" });
export const ENGAGEMENTS = ["staff", "npd", "ip", "gph"];
export const ENGAGEMENT_LABELS = {
  staff: "штат",
  npd: "самозанятый",
  ip: "ИП",
  gph: "ГПХ",
};
const ON_TOP_KEY = { npd: "npd_self_employed", ip: "ip", gph: "gph_individual" };
export const ENGAGEMENT_PRESETS = ["staff", "hourly", "model"];
export const ARTICLES = [
  "payroll",
  "contractors",
  "experts",
  "externals",
  "tools_ai",
  "tools_other",
];
export const ARTICLE_LABELS = {
  payroll: "ФОТ штата",
  contractors: "внештатные исполнители",
  experts: "эксперты",
  externals: "внешние затраты",
  tools_ai: "инструменты: ИИ",
  tools_other: "инструменты: прочее и инфраструктура",
};
export const PRICE_MODES = ["multiplier", "markup", "margin", "fixed"];
const WEEKS_PER_MONTH = 52 / 12;
// The team circle: its hours are split between team roles by FTE (capacity-ru.md); its
// composite_of in rates.yaml lists the same roles (trace-check), so the plan reconciles with payroll.
const TEAM_CIRCLE = "Продуктовая команда";
export const IDLE_LINE = "неиспользованная мощность штата";
export const TOOLS_LINE = "инструменты и инфраструктура";
export const PENDING_LINE = "не задано: подпроцесс не раскрыт";

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

/** Value of a draft at a level min | mid | max: number as is, [min, max] or [min, mid, max]. */
export function pick(value, level) {
  if (value == null || typeof value !== "object") return value ?? null;
  if (value.length === 3)
    return value[{ min: 0, mid: 1, max: 2 }[level]] ?? null;
  const [lo, hi] = value;
  if (lo == null || hi == null) return null;
  if (level === "min") return lo;
  if (level === "max") return hi;
  return (lo + hi) / 2;
}

/** `{ grade, course }` with defaults; anything else (an old scenario string) is refused. */
export function normalizeCtx(ctx = DEFAULT_CTX) {
  if (ctx == null || typeof ctx !== "object")
    throw new Error(`ctx must be { grade, course }, got ${JSON.stringify(ctx)}`);
  const out = { ...DEFAULT_CTX, ...ctx };
  if (out.grade !== GRADE_MIX && !GRADES.includes(out.grade))
    throw new Error(`ctx: unknown grade «${out.grade}»`);
  if (!COURSES.includes(out.course))
    throw new Error(`ctx: unknown course «${out.course}»`);
  return out;
}

const level = (ctx) => COURSE_LEVEL[ctx.course];
const byCourse = (value, ctx) => pick(value, level(ctx));
const middle = (value) => pick(value, "mid");
const ctxKey = (ctx) => `${ctx.grade}|${ctx.course}`;
const product = (values) => values.reduce((a, b) => a * b, 1);
const sum = (values) => values.reduce((a, b) => a + b, 0);
const add = (map, key, value) => {
  map[key] = (map[key] ?? 0) + value;
};
const addAll = (target, source, factor = 1) => {
  for (const [k, v] of Object.entries(source ?? {})) add(target, k, v * factor);
};
const emptyArticles = () => Object.fromEntries(ARTICLES.map((a) => [a, 0]));

/**
 * Normalised model with `overrides` applied. Override keys (flat map, cost-model-ru.md):
 * `leaf:<ID>` hours, `lead:<ID>` lead days, `loop:<name>` rounds, `wait:<name>` wait days,
 * `rate:<role>:monthly[:<grade>]` gross, `rate:<role>:hourly[:<grade>]` contractor hour,
 * `rate:<role>:hourly_cost` calibrated hour, `engage:<role>` staff|npd|ip|gph (null = model),
 * `grade:<role>` junior|middle|senior|mix (null = team grade), `expert:<grade>` expert hour,
 * `piece:<ID>` rub per pass, `fte:<role>`, `var:<name>`, `param:<product>:<name>`,
 * `external:<id>` rub, `plan:<product>` units per month, `scale:<article>` budget factor,
 * `market:<product>` [min, max], `price:<product>:<mode>` leading price of one product.
 */
export function buildModel(inputs, overrides = {}) {
  // Parsed YAML is plain JSON data, so a JSON round-trip is a full deep copy.
  const src = JSON.parse(JSON.stringify(inputs));
  const leaves = new Map();
  const pending = new Map();
  for (const diagram of src.diagrams)
    for (const box of diagram.boxes ?? []) {
      if (box.decomposition === "pending")
        pending.set(box.id, { id: box.id, name: box.name, diagram: diagram.id });
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
    }
  const loops = new Map(src.loops.loops.map((loop) => [loop.name, loop]));
  const direction = src.teams.teams.find((t) => t.id === "direction");
  const teamRoleNames = new Set(
    [...direction.members, ...direction.draws_on].map((m) => m.role),
  );
  const teamRoles = [...direction.members, ...direction.draws_on]
    .filter((m) => m.fte_draft != null)
    .map((m) => ({ role: m.role, fte: m.fte_draft }));
  const rv = src.rates.variables;
  const vars = {};
  for (const [name, v] of Object.entries(src.teams.capacity_variables))
    vars[name] = v.draft;
  for (const [name, v] of Object.entries(src.products.variables))
    vars[name] = v.draft;
  // Money and rates.yaml-owned shares: a null draft in products.yaml means the rates.yaml default.
  const gradeMix = Object.fromEntries(
    GRADES.map((g) => [g, rv.default_team_grade_mix[g] ?? 0]),
  );
  const fromRates = {
    employer_contributions_rate: rv.employer_contributions_rate.default,
    contributions_mode: rv.contributions_modes.default,
    bonus_share: rv.bonus_share.default,
    staff_other_costs_rub_month: rv.staff_other_costs_rub_month.total_rub[1],
    grade_mix: gradeMix,
    payment_markup: src.rates.tools.payment_markup.default,
    campaign_cost_per_contact: middle(
      src.rates.doctor_contacts.paid_acquisition_cost_per_lead_rub.registration,
    ),
  };
  for (const [name, value] of Object.entries(fromRates))
    if (vars[name] == null) vars[name] = value;
  const rates = new Map(src.rates.roles.map((r) => [r.role, r]));
  const products = src.products.products;
  const params = {};
  for (const [name, p] of Object.entries(products))
    params[name] = Object.fromEntries(
      Object.entries(p.parameters ?? {}).map(([k, v]) => [k, v.draft]),
    );
  const externals = {};
  for (const [id, e] of Object.entries(src.products.externals)) {
    if (e.component) {
      // A component of a composite rates.yaml cost (external_costs.<group>.components.<key>):
      // a range at its middle; a per-clip price × clips per unit.
      const [group, key] = e.component.split(".");
      const g = src.rates.external_costs?.[group];
      const part = g?.components?.[key];
      const rub = !part
        ? null
        : part.rub_per_clip != null
          ? middle(part.rub_per_clip) * middle(part.clips_per_episode)
          : middle(part.rub);
      externals[id] = { ...e, rub, per: g?.per ?? null };
      continue;
    }
    if (e.market_of) {
      const of = src.rates.external_costs?.[e.market_of];
      const band = of?.market_rub;
      externals[id] = { ...e, rub: band ? middle(band) : null, per: of?.per ?? null };
      continue;
    }
    const cost = src.rates.external_costs?.[id];
    externals[id] = { ...e, rub: cost?.rub ?? null, per: cost?.per ?? null };
  }
  const model = {
    inputs,
    overrides: { ...overrides },
    leaves,
    pending,
    loops,
    teamRoles,
    teamRoleNames,
    vars,
    rates,
    rateVariables: rv,
    experts: src.rates.experts,
    tools: src.rates.tools,
    doctorContacts: src.rates.doctor_contacts,
    marketRefs: src.rates.market_references ?? {},
    products,
    params,
    externals,
    config: src.products,
    hourlyCostOverride: {},
    grossOverride: {},
    hourlyOverride: {},
    expertOverride: {},
    engagement: {},
    roleGrade: {},
    scale: Object.fromEntries(ARTICLES.map((a) => [a, 1])),
    market: {},
    productPrice: {},
    piece: {},
    plan: null,
    cache: new Map(),
  };
  for (const [key, value] of Object.entries(overrides))
    applyOverride(model, key, value);
  return model;
}

/** The model with more overrides on top of its own (sensitivity, presets). */
function derive(model, extra) {
  return buildModel(model.inputs, { ...model.overrides, ...extra });
}

function applyOverride(model, key, value) {
  const [kind, name, field, sub] = key.split(":");
  const need = (thing, what) => {
    if (thing == null) throw new Error(`override ${key}: unknown ${what}`);
    return thing;
  };
  const gradeKey = (g) => {
    if (g == null) return "all";
    if (!GRADES.includes(g)) throw new Error(`override ${key}: unknown grade`);
    return g;
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
      need(model.rates.get(name), "role");
      if (field === "hourly_cost") model.hourlyCostOverride[name] = value;
      else if (field === "hourly")
        (model.hourlyOverride[name] ??= {})[gradeKey(sub)] = value;
      else if (field === "monthly")
        (model.grossOverride[name] ??= {})[gradeKey(sub)] = value;
      else
        throw new Error(`override ${key}: field monthly|hourly|hourly_cost`);
      return;
    }
    case "engage":
      need(model.rates.get(name), "role");
      if (value != null && !ENGAGEMENTS.includes(value))
        throw new Error(`override ${key}: engagement ${ENGAGEMENTS.join("|")}`);
      if (value == null) delete model.engagement[name];
      else model.engagement[name] = value;
      return;
    case "grade":
      need(model.rates.get(name), "role");
      if (value != null && value !== GRADE_MIX && !GRADES.includes(value))
        throw new Error(`override ${key}: unknown grade`);
      if (value == null) delete model.roleGrade[name];
      else model.roleGrade[name] = value;
      return;
    case "expert":
      need(model.experts.grades[name], "expert grade");
      model.expertOverride[name] = value;
      return;
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
    case "var": {
      need(name in model.vars ? true : null, "variable");
      const options = model.config.variables?.[name]?.options;
      if (options && !options.includes(value))
        throw new Error(`override ${key}: ${name} is one of ${options.join("|")}`);
      model.vars[name] = value;
      return;
    }
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
    case "scale":
      need(ARTICLES.includes(name) ? true : null, "article");
      model.scale[name] = value;
      return;
    case "market":
      need(model.products[name], "product");
      model.market[name] = value;
      return;
    case "price":
      need(model.products[name], "product");
      need(PRICE_MODES.includes(field) ? true : null, "price mode");
      model.productPrice[name] = { mode: field, value };
      return;
    default:
      throw new Error(`override ${key}: unknown kind`);
  }
}

const memo = (model, key, fn) => {
  if (!model.cache.has(key)) model.cache.set(key, fn());
  return model.cache.get(key);
};

/** Rounds of a loop at the course: rounds_draft, or base + Σ (rounds − 1) of plus_extra_rounds_of; no loop → 1. */
export function loopRounds(model, name, ctx) {
  if (name == null) return 1;
  const c = normalizeCtx(ctx);
  const loop = model.loops.get(name);
  if (!loop) throw new Error(`unknown loop «${name}»`);
  if (loop.rounds_from)
    return (
      loop.rounds_from.base +
      sum(
        loop.rounds_from.plus_extra_rounds_of.map(
          (other) => loopRounds(model, other, c) - 1,
        ),
      )
    );
  return byCourse(loop.rounds_draft, c);
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

// Team size is a composition, not an hour driver: a ranged FTE is taken at its middle on every axis.
const fteOf = (member) => middle(member.fte);
const teamFte = (model) => sum(model.teamRoles.map(fteOf));

// ── Rates: engagement, grade, staff hour, contractor hour, expert hour ──

const hasMonthly = (record) =>
  Boolean(record?.monthly_gross_by_grade_rub) ||
  Object.values(record?.monthly_gross_rub ?? {}).some((v) => v != null);
const hasHourly = (record) =>
  Boolean(record?.hourly_by_grade_rub) ||
  (Array.isArray(record?.hourly_rub) && record.hourly_rub.some((v) => v != null));
const isExpertRole = (model, role) => Boolean(model.config.expert_roles?.[role]);

/** Engagement of a role: the per-role override, else «как в модели» from rates.yaml engagement. */
export function roleEngagement(model, role) {
  if (model.engagement[role]) return model.engagement[role];
  const text = model.rates.get(role)?.engagement ?? "";
  return /^штат/.test(text) ? "staff" : "npd";
}

/** Overrides of a preset: «Всё в штате» (staff), «Всё почасово» (hourly), «Как в модели» (model). */
export function engagementPreset(model, preset) {
  if (!ENGAGEMENT_PRESETS.includes(preset))
    throw new Error(`unknown engagement preset «${preset}»`);
  const out = {};
  for (const [role, record] of model.rates) {
    if (isExpertRole(model, role)) continue;
    if (preset === "model") out[`engage:${role}`] = null;
    else if (preset === "staff" && hasMonthly(record))
      out[`engage:${role}`] = "staff";
    else if (preset === "hourly" && hasHourly(record))
      out[`engage:${role}`] = "npd";
  }
  return out;
}

/** Grade of a role at the ctx: the per-role override, else the team grade. */
function roleGrade(model, role, ctx) {
  return model.roleGrade[role] ?? ctx.grade;
}

function gradeWeights(model, grade) {
  if (grade !== GRADE_MIX) return { [grade]: 1 };
  return model.vars.grade_mix;
}

/** A role-level [min, median, max] cut into grades by rates.yaml variables.grade_split. */
function gradeOfTriple(triple, g) {
  const [lo, hi] = [triple[0], triple.at(-1)];
  const med = triple.length === 3 ? triple[1] : (lo + hi) / 2;
  if (g === "junior") return (lo + med) / 2;
  if (g === "senior") return (med + hi) / 2;
  return med;
}

function grossAt(model, role, g, flags) {
  const o = model.grossOverride[role];
  if (o && (o[g] ?? o.all) != null) return middle(o[g] ?? o.all);
  const record = model.rates.get(role);
  const region = model.vars.region;
  const byGrade = record?.monthly_gross_by_grade_rub?.[g];
  if (region === "moscow" && byGrade) return byGrade[1];
  let triple = record?.monthly_gross_rub?.[region];
  if (triple == null && region !== "moscow") {
    triple = record?.monthly_gross_rub?.moscow;
    if (triple == null && !byGrade) return null;
    flags.add("ставка по Москве — для региона нет данных");
    if (byGrade) return byGrade[1];
  }
  if (triple == null) return null;
  return typeof triple === "number" ? triple : gradeOfTriple(triple, g);
}

function contributions(model, monthly) {
  const v = model.rateVariables.employer_contributions_rate;
  if (model.vars.contributions_mode === "msp_priority") {
    const m = v.msp_priority_alternative;
    const t = m.threshold_month_rub;
    return (
      Math.min(monthly, t) * m.up_to_1_5_mrot_rate +
      Math.max(monthly - t, 0) * m.above_1_5_mrot_rate +
      monthly * v.nsipz_min
    );
  }
  const annual = monthly * 12;
  const base = v.base_2026_rub;
  const within = model.vars.employer_contributions_rate;
  const above = v.above_base_rate + v.nsipz_min;
  return (
    (within * Math.min(annual, base) + above * Math.max(0, annual - base)) / 12
  );
}

function hourSteps(model, gross) {
  const bonus = gross * model.vars.bonus_share;
  const contrib = contributions(model, gross + bonus);
  const P = model.vars.paid_hours_per_month;
  const other = model.vars.staff_other_costs_rub_month;
  const payPerHour = (gross + bonus + contrib) / P;
  const otherPerHour = other / P;
  const hour = payPerHour + otherPerHour;
  return {
    gross,
    bonus,
    contributions: contrib,
    payPerHour,
    otherPerHour,
    hour,
  };
}

/**
 * Staff hour of a role, every step returned for the page breakdown (rates.yaml
 * formulas.in_house_hourly_cost_full): gross → + bonus → + contributions (mode) → ÷ paid hours →
 * + other costs ÷ paid hours = hour → × payroll budget scale = full. Grade «mix» weights each step.
 */
export function staffHour(model, role, ctx) {
  const c = normalizeCtx(ctx);
  const grade = roleGrade(model, role, c);
  return memo(model, `staff|${role}|${grade}`, () => {
    const flags = new Set();
    const parts = [];
    for (const [g, w] of Object.entries(gradeWeights(model, grade))) {
      if (!w) continue;
      const gross = grossAt(model, role, g, flags);
      if (gross != null) parts.push({ w, s: hourSteps(model, gross) });
    }
    const scale = model.scale.payroll;
    const base = {
      role,
      grade,
      contributionsMode: model.vars.contributions_mode,
      bonusShare: model.vars.bonus_share,
      paidHours: model.vars.paid_hours_per_month,
      otherPerMonth: model.vars.staff_other_costs_rub_month,
      scale,
    };
    if (!parts.length)
      return { ...base, full: null, flags: [...flags, "нет штатной ставки"] };
    const W = sum(parts.map((p) => p.w));
    const avg = (k) => sum(parts.map((p) => p.w * p.s[k])) / W;
    const hour = avg("hour");
    return {
      ...base,
      gross: avg("gross"),
      bonus: avg("bonus"),
      contributions: avg("contributions"),
      payPerHour: avg("payPerHour"),
      otherPerHour: avg("otherPerHour"),
      hour,
      full: hour * scale,
      flags: [...flags],
    };
  });
}

const LOW_ONLY =
  "ставка взята по нижней границе рынка — верхняя и, вероятно, средняя оценка занижены";
const HIGH_ONLY =
  "ставка взята по верхней границе рынка — нижняя и, вероятно, средняя оценка завышены";

function hourlyAt(model, role, g, flags) {
  const o = model.hourlyOverride[role];
  if (o && (o[g] ?? o.all) != null) return middle(o[g] ?? o.all);
  const record = model.rates.get(role);
  const band = record?.hourly_by_grade_rub?.[g];
  if (band) return middle(band);
  const h = record?.hourly_rub;
  if (!Array.isArray(h)) return null;
  const [lo, hi] = h;
  if (lo != null && hi != null)
    return g === "junior" ? lo : g === "senior" ? hi : (lo + hi) / 2;
  if (lo != null) {
    if (g !== "junior") flags.add(LOW_ONLY);
    return lo;
  }
  if (hi != null) {
    if (g !== "senior") flags.add(HIGH_ONLY);
    return hi;
  }
  return null;
}

function onTopRate(model, form) {
  const key = ON_TOP_KEY[form] ?? ON_TOP_KEY.npd;
  return model.rateVariables.contractor_on_top_rate[key] ?? 0;
}

/** Contractor hour of a role: middle of the grade band × (1 + on-top of the contract form). */
function contractorHour(model, role, ctx, form) {
  const grade = roleGrade(model, role, ctx);
  const flags = new Set();
  const parts = [];
  for (const [g, w] of Object.entries(gradeWeights(model, grade))) {
    if (!w) continue;
    const v = hourlyAt(model, role, g, flags);
    if (v != null) parts.push({ w, v });
  }
  if (!parts.length) return null;
  const base = sum(parts.map((p) => p.w * p.v)) / sum(parts.map((p) => p.w));
  const onTop = onTopRate(model, form);
  return {
    value: base * (1 + onTop) * model.scale.contractors,
    base,
    onTop,
    form,
    flags: [...flags],
    basis: "подряд",
    split: { contractors: 1 },
  };
}

/** Expert hour: rates.yaml experts.grades[grade].per_hour_rub (middle) × (1 + on-top). */
function expertHour(model, role) {
  const varName = model.config.expert_roles[role];
  const gradeName = model.vars[varName];
  const grade = model.experts.grades[gradeName];
  if (!grade)
    return {
      value: null,
      flags: [`нет грейда эксперта «${gradeName}»`],
      basis: "эксперт",
      split: { experts: 1 },
      article: "experts",
    };
  const engagement = roleEngagement(model, role);
  const base = middle(model.expertOverride[gradeName] ?? grade.per_hour_rub);
  const onTop = onTopRate(model, engagement === "staff" ? "npd" : engagement);
  return {
    value: base * (1 + onTop) * model.scale.experts,
    base,
    onTop,
    expertGrade: gradeName,
    engagement,
    flags: [],
    basis: `эксперт: ${gradeName}`,
    split: { experts: 1 },
    article: "experts",
    inHouse: null,
    contractor: null,
    share: 0,
  };
}

const mainArticle = (split) =>
  Object.entries(split ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

/**
 * Hourly cost of a role at the ctx: { value | null, flags, basis, engagement, article, split, inHouse }.
 * `staff` prices штат time only — non-production hours (meetings, hiring, management) are never the
 * external pool's share. `split` = shares of the hour by cost article (budget scales, articles).
 */
export function roleHourlyCost(model, role, ctx, staff = false) {
  const c = normalizeCtx(ctx);
  return memo(model, `rate|${role}|${ctxKey(c)}|${staff}`, () => {
    const r = resolveRate(model, role, c, staff);
    return { ...r, article: r.article ?? mainArticle(r.split) };
  });
}

function resolveRate(model, role, ctx, staff) {
  const engagement = roleEngagement(model, role);
  const override = model.hourlyCostOverride[role];
  if (override != null) {
    const article = engagement === "staff" ? "payroll" : "contractors";
    return {
      value: byCourse(override, ctx),
      flags: [],
      basis: "калибровка",
      engagement,
      split: { [article]: 1 },
      inHouse: engagement === "staff" ? byCourse(override, ctx) : null,
    };
  }
  const proxy = model.config.rate_proxy?.[role];
  if (proxy) {
    const r = roleHourlyCost(model, proxy, ctx, staff);
    return { ...r, flags: [...r.flags, `ставка взята по роли «${proxy}»`] };
  }
  if (isExpertRole(model, role)) return expertHour(model, role);
  const record = model.rates.get(role);
  if (!record)
    return { value: null, flags: ["нет записи ставки"], basis: "—", engagement, split: {} };
  if (record.composite_of && !hasMonthly(record) && !hasHourly(record)) {
    const weights = Object.fromEntries(
      model.teamRoles.map((m) => [m.role, fteOf(m)]),
    );
    const parts = record.composite_of
      .map((member) => ({
        w: weights[member] ?? 1,
        r: roleHourlyCost(model, member, ctx, staff),
      }))
      .filter((p) => p.r.value != null);
    if (!parts.length)
      return { value: null, flags: ["ставки круга не заданы"], basis: "круг", engagement, split: {} };
    const W = sum(parts.map((p) => p.w));
    const value = sum(parts.map((p) => p.w * p.r.value)) / W;
    const split = {};
    for (const p of parts) addAll(split, p.r.split, (p.w * p.r.value) / W / value);
    const own = parts.every((p) => p.r.inHouse != null)
      ? sum(parts.map((p) => p.w * p.r.inHouse)) / W
      : null;
    return {
      value,
      flags: [...new Set(parts.flatMap((p) => p.r.flags))],
      basis: "круг: средневзвешенно по FTE",
      engagement,
      split,
      inHouse: own,
    };
  }
  const inHouse = () => {
    const h = staffHour(model, role, ctx);
    if (h.full == null) return null;
    return {
      value: h.full,
      flags: h.flags,
      basis: "штат",
      split: { payroll: 1 },
      breakdown: h,
    };
  };
  const form = engagement === "staff" ? "npd" : engagement;
  const contractor = () => contractorHour(model, role, ctx, form);
  const freelance = engagement !== "staff";
  const first = freelance ? contractor() : inHouse();
  const second = freelance ? inHouse() : contractor();
  const share = model.vars.media_external_share ?? 0;
  if (!freelance && role.startsWith("Медиа-круг — ") && share > 0 && first && second) {
    if (staff)
      return { ...first, engagement, inHouse: first.value, contractor: null, share: 0 };
    const value = (1 - share) * first.value + share * second.value;
    return {
      value,
      flags: [...first.flags, ...second.flags],
      basis: `штат + доля внешнего пула ${share}`,
      engagement,
      split: {
        payroll: ((1 - share) * first.value) / value,
        contractors: (share * second.value) / value,
      },
      inHouse: first.value,
      contractor: second.value,
      share,
      breakdown: first.breakdown,
    };
  }
  const chosen = first ?? second;
  if (!chosen)
    return { value: null, flags: ["ставка не задана"], basis: "—", engagement, split: {} };
  const flags = [...chosen.flags];
  if (!first)
    flags.push(
      freelance
        ? "внештатного часа нет — взят час штата"
        : "штатной ставки нет — взят внештатный час",
    );
  return {
    ...chosen,
    flags,
    engagement,
    inHouse: chosen.basis === "штат" && !freelance ? chosen.value : null,
    contractor: null,
    share: 0,
  };
}

// ── Hours ──

function paramValue(model, productName, qty, ctx) {
  if (typeof qty === "number") return qty;
  const value = byCourse(model.params[productName]?.[qty], ctx);
  if (value == null)
    throw new Error(`«${productName}»: parameter «${qty}» is not set`);
  return value;
}

/** A product line with `when: { variable: value }` counts only while every variable has that value. */
const applies = (model, line) =>
  Object.entries(line.when ?? {}).every(([name, value]) => model.vars[name] === value);

function expand(model, productName, ctx, visit, qty = 1, path = []) {
  const p = model.products[productName];
  if (!p) throw new Error(`unknown product «${productName}»`);
  const here = [...path, productName];
  visit({ product: productName, qty, path: here });
  for (const item of p.items) {
    if (!applies(model, item)) continue;
    const n =
      paramValue(model, productName, item.qty ?? 1, ctx) *
      product((item.per ?? []).map((k) => paramValue(model, productName, k, ctx)));
    if (item.product) expand(model, item.product, ctx, visit, qty * n, here);
    else if (item.pending)
      visit({ pending: item.pending, qty: qty * n, path: [...here, item.pending] });
    else visit({ leaf: item.leaf, qty: qty * n, path: [...here, item.leaf] });
  }
}

function leafLine(model, id, qty, path, ctx) {
  const leaf = model.leaves.get(id);
  if (!leaf) throw new Error(`unknown leaf ${id}`);
  const hoursPerPass = byCourse(leaf.hours, ctx);
  const rounds = loopRounds(model, leaf.iterations, ctx);
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

function pendingLine(model, id, qty, path) {
  const box = model.pending.get(id);
  if (!box) throw new Error(`${id} is not a pending box of the model`);
  return {
    path,
    leaf: id,
    name: PENDING_LINE,
    boxName: box.name,
    role: null,
    unit: null,
    class: "pending",
    qty,
    hoursPerPass: null,
    rounds: null,
    hours: null,
    hourlyCost: null,
    cost: null,
    byArticle: {},
    flags: [`${PENDING_LINE} — ${id} «${box.name}»`],
  };
}

function costLine(model, line, ctx, staff = false) {
  const piece = model.piece[line.leaf];
  if (piece != null) {
    const engagement = roleEngagement(model, line.role);
    const onTop = onTopRate(model, engagement === "staff" ? "npd" : engagement);
    const rub = middle(piece) * (1 + onTop) * model.scale.contractors;
    const cost = rub * line.rounds * line.qty;
    return {
      ...line,
      hourlyCost: null,
      cost,
      article: "contractors",
      byArticle: { contractors: cost },
      flags: ["сдельно"],
    };
  }
  const rate = roleHourlyCost(model, line.role, ctx, staff);
  const cost = rate.value == null ? null : line.hours * rate.value;
  const byArticle = {};
  if (cost != null) addAll(byArticle, rate.split, cost);
  return {
    ...line,
    hourlyCost: rate.value,
    cost,
    article: rate.article,
    byArticle,
    flags: rate.flags,
  };
}

/** Hours of a product: trail lines unit → leaf → role, hours × rounds × quantity; black boxes apart. */
export function productHours(model, productName, ctx) {
  const c = normalizeCtx(ctx);
  return memo(model, `hours|${productName}|${c.course}`, () => {
    const lines = [];
    const pending = [];
    expand(model, productName, c, (node) => {
      if (node.leaf) lines.push(leafLine(model, node.leaf, node.qty, node.path, c));
      if (node.pending) pending.push(pendingLine(model, node.pending, node.qty, node.path));
    });
    const directByRole = {};
    const overheadByRole = {};
    for (const line of lines)
      add(line.class === "overhead" ? overheadByRole : directByRole, line.role, line.hours);
    const directHours = sum(lines.filter((l) => l.class === "direct").map((l) => l.hours));
    return { lines, pending, directByRole, overheadByRole, directHours };
  });
}

function periodLeafCount(model, entry, ctx) {
  return product(entry.per.map((name) => byCourse(model.vars[name], ctx)));
}

/** Non-production hours of a team role per team-month: own period leaves + its FTE share of team leaves. */
function nonProduction(model, role, ctx) {
  const teams = model.vars.teams;
  const fte = fteOf(model.teamRoles.find((m) => m.role === role));
  let hours = 0;
  for (const entry of model.config.period_leaves) {
    const leaf = model.leaves.get(entry.leaf);
    const h =
      byCourse(leaf.hours, ctx) *
      loopRounds(model, leaf.iterations, ctx) *
      (periodLeafCount(model, entry, ctx) / teams);
    if (leaf.role === role) hours += h;
    else if (leaf.role === TEAM_CIRCLE) hours += (h * fte) / teamFte(model);
  }
  return hours;
}

/** Hours by role with the team circle's hours split between team roles by FTE share. */
function splitCircle(model, byRole) {
  const out = { ...byRole };
  const shared = out[TEAM_CIRCLE] ?? 0;
  delete out[TEAM_CIRCLE];
  if (shared) {
    const total = teamFte(model);
    for (const m of model.teamRoles) add(out, m.role, (shared * fteOf(m)) / total);
  }
  return out;
}

/**
 * Direct hours and cost of the team circle cut per member role (composite_of, FTE weights as in its
 * rate): the cost share of a member is its weight × its hour, so the members add up to the circle line
 * and a freelance member shows at its own contractor hour.
 */
function circleMembers(model, line, ctx) {
  if (!line) return null;
  const weights = Object.fromEntries(model.teamRoles.map((m) => [m.role, fteOf(m)]));
  const parts = (model.rates.get(TEAM_CIRCLE)?.composite_of ?? [])
    .map((role) => ({ role, w: weights[role] ?? 1, r: roleHourlyCost(model, role, ctx) }))
    .filter((p) => p.r.value != null);
  const W = sum(parts.map((p) => p.w));
  const money = sum(parts.map((p) => p.w * p.r.value));
  return {
    role: TEAM_CIRCLE,
    hours: line.hours,
    cost: line.cost,
    members: parts.map((p) => {
      const hours = (line.hours * p.w) / W;
      const cost = money ? (line.cost * p.w * p.r.value) / money : 0;
      return {
        role: p.role,
        engagement: p.r.engagement,
        article: p.r.article,
        hours,
        hourlyCost: hours ? cost / hours : p.r.value,
        cost,
      };
    }),
  };
}

function teamHours(model, productName, ctx) {
  return splitCircle(model, productHours(model, productName, ctx).directByRole);
}

/** Capacity of one direction team doing only this product: C = min A(r) ÷ H(r), bottleneck role. */
export function teamCapacity(model, productName, ctx) {
  const c = normalizeCtx(ctx);
  return memo(model, `cap|${productName}|${c.course}`, () => {
    const H = teamHours(model, productName, c);
    const P = model.vars.paid_hours_per_month;
    const roles = model.teamRoles.map((m) => {
      const fte = fteOf(m);
      const available = fte * P - nonProduction(model, m.role, c);
      const hours = H[m.role] ?? 0;
      return { role: m.role, fte, available, hours, perMonth: hours > 0 ? available / hours : null };
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
    return { perMonth: worst.perMonth, bottleneck: worst.role, roles, commitments };
  });
}

/** FTE of a team role needed for `perWeek` units a week: units/month × H ÷ (P − non-production per FTE). */
export function requiredFte(model, productName, role, perWeek, ctx) {
  const c = normalizeCtx(ctx);
  const H = teamHours(model, productName, c)[role] ?? 0;
  const fte = fteOf(model.teamRoles.find((m) => m.role === role));
  const perFte = nonProduction(model, role, c) / fte;
  return (perWeek * WEEKS_PER_MONTH * H) / (model.vars.paid_hours_per_month - perFte);
}

function leafLead(model, id, ctx) {
  const leaf = model.leaves.get(id);
  if (!leaf) throw new Error(`unknown leaf ${id} in a lead chain`);
  const n = loopRounds(model, leaf.iterations, ctx);
  const w = leaf.iterations
    ? byCourse(model.loops.get(leaf.iterations).wait_days_per_round_draft, ctx)
    : 0;
  return byCourse(leaf.leadDays, ctx) * n + (n - 1) * w;
}

function chainLead(model, node, ctx) {
  if (typeof node === "string") return leafLead(model, node, ctx);
  if (node.seq) return sum(node.seq.map((n) => chainLead(model, n, ctx)));
  if (node.par) return Math.max(...node.par.map((n) => chainLead(model, n, ctx)));
  throw new Error(`lead chain node needs seq or par: ${JSON.stringify(node)}`);
}

/** Lead time in working days: D(l) = d × n + (n − 1) × w along the chain; pipelines add takts. */
export function leadTime(model, productName, ctx) {
  const c = normalizeCtx(ctx);
  const lead = model.products[productName]?.lead;
  if (!lead) return null;
  if (lead.chain) return chainLead(model, lead.chain, c);
  const pipe = lead.pipeline;
  const takt =
    model.vars.working_days_per_month / teamCapacity(model, pipe.stream, c).perMonth;
  const main =
    sum(pipe.first.map((p) => leadTime(model, p, c))) + (pipe.count - 1) * takt;
  const parallel = (pipe.parallel ?? []).map((p) => leadTime(model, p, c));
  return Math.max(main, ...parallel);
}

// ── Tools and infrastructure pool ──

/**
 * Monthly pool «Инструменты и инфраструктура» (rates.yaml tools): subscriptions (per seat × seats,
 * foreign ones + payment markup), one-off licences ÷ their life, Платформа DS, capex ÷ useful life.
 * AI subscriptions are the article tools_ai, the rest tools_other; each × its budget scale.
 */
export function toolsPool(model, ctx) {
  const c = normalizeCtx(ctx);
  return memo(model, `tools|${ctxKey(c)}`, () => {
    const cfg = model.config.tools_pool;
    const t = model.tools;
    const seats = model.vars.tool_seats ?? model.vars.teams * teamFte(model);
    const markup = model.vars.payment_markup;
    const ai = new Set(cfg.ai_items);
    const platform = new Set(cfg.platform_items);
    const items = [];
    const push = (item, group, rub) =>
      items.push({ item, group, article: ai.has(item) ? "tools_ai" : "tools_other", rub });
    for (const o of t.opex_monthly)
      push(
        o.item,
        "subscriptions",
        o.rub_month * (o.per === "seat" ? seats : 1) * (o.usd != null ? 1 + markup : 1),
      );
    for (const o of t.opex_one_off ?? [])
      push(o.item, "oneOff", (o.price_rub * (o.usd != null ? 1 + markup : 1)) / cfg.one_off_life_months);
    for (const p of t.platform_ds_monthly)
      if (platform.has(p.item)) push(p.item, "platform", middle(p.rub_month));
    for (const k of t.capex) push(k.item, "capex", k.price_rub / k.useful_life_months);
    const byGroup = { subscriptions: 0, oneOff: 0, platform: 0, capex: 0 };
    for (const i of items) byGroup[i.group] += i.rub;
    const raw = (article) => sum(items.filter((i) => i.article === article).map((i) => i.rub));
    const aiCost = raw("tools_ai") * model.scale.tools_ai;
    const other = raw("tools_other") * model.scale.tools_other;
    return { seats, markup, items, byGroup, ai: aiCost, other, total: aiCost + other };
  });
}

// ── Period plan, overhead and idle ──

/**
 * Period plan per month: units (explicit `plan:` overrides, else `teams` direction teams at capacity
 * on `plan_mix`), direct hours, the overhead pool (overhead lines of the units + period leaves),
 * the overhead rate per direct hour and the tools pool per direct hour.
 */
export function periodPlan(model, ctx) {
  const c = normalizeCtx(ctx);
  return memo(model, `plan|${ctxKey(c)}`, () => {
    let sold;
    let bottleneck = null;
    if (model.plan) sold = { ...model.plan };
    else {
      const mix = model.vars.plan_mix;
      const cap = teamCapacity(model, mix, c);
      bottleneck = cap.bottleneck;
      sold = { [mix]: cap.perMonth * model.vars.teams };
    }
    const units = {};
    let directHours = 0;
    const poolLines = [];
    for (const [name, n] of Object.entries(sold)) {
      expand(model, name, c, (node) => {
        if (node.product) add(units, node.product, node.qty * n);
      });
      for (const line of productHours(model, name, c).lines) {
        const scaled = { ...line, qty: line.qty * n, hours: line.hours * n };
        if (line.class === "direct") directHours += scaled.hours;
        else if (line.class === "overhead")
          poolLines.push({ ...costLine(model, scaled, c), source: name });
      }
    }
    for (const entry of model.config.period_leaves) {
      const count = periodLeafCount(model, entry, c);
      if (!count) continue;
      const line = leafLine(model, entry.leaf, count, [entry.leaf], c);
      // Period leaves are non-production time of the team: штат hours at the штат rate.
      poolLines.push({ ...costLine(model, line, c, true), source: "период" });
    }
    const poolCost = sum(poolLines.map((l) => l.cost ?? 0));
    const poolByArticle = {};
    for (const l of poolLines) addAll(poolByArticle, l.byArticle);
    const unpriced = poolLines.filter((l) => l.cost == null).map((l) => l.leaf);
    const idle = idleCapacity(model, sold, c);
    const tools = toolsPool(model, c);
    return {
      sold,
      units,
      bottleneck,
      directHours,
      poolLines,
      poolCost,
      poolByArticle,
      unpriced,
      overheadPerDirectHour: directHours ? poolCost / directHours : 0,
      idle: { ...idle, perDirectHour: directHours ? idle.cost / directHours : 0 },
      tools: { ...tools, perDirectHour: directHours ? tools.total / directHours : 0 },
    };
  });
}

/**
 * Paid штат time of team roles that the plan leaves unused (owner decision 2026-10-05, #2522
 * «Idle paid time»): teams × FTE × P − non-production − hours the plan's units load, per role.
 * Only штат-engaged roles carry payroll and idle time; a freelance role is paid per hour.
 */
function idleCapacity(model, sold, ctx) {
  const teams = model.vars.teams;
  const P = model.vars.paid_hours_per_month;
  const loadedBy = {};
  for (const [name, n] of Object.entries(sold))
    for (const line of productHours(model, name, ctx).lines)
      if (line.class !== "reserve") add(loadedBy, line.role, line.hours * n);
  const loaded = splitCircle(model, loadedBy);
  const flags = [];
  const byRole = model.teamRoles
    .filter((m) => roleEngagement(model, m.role) === "staff")
    .map((m) => ({ m, rate: roleHourlyCost(model, m.role, ctx) }))
    .filter(({ rate }) => rate.inHouse != null)
    .map(({ m, rate }) => {
      const fte = fteOf(m);
      const paidHours = teams * fte * P;
      const nonProd = teams * nonProduction(model, m.role, ctx);
      const load = loaded[m.role] ?? 0;
      // Loaded hours are charged at the blended rate: the external pool's share goes to the
      // contractor, the rest is штат time. Non-production hours are штат time at the штат rate
      // (the pool prices them so), and idle and payroll are штат time only.
      const share = rate.share ?? 0;
      const own = rate.inHouse;
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

function reserveOfUnit(model, productName, ctx) {
  const p = model.products[productName];
  const v = model.vars;
  const signals = byCourse(v.signals_per_unit, ctx);
  const affected = byCourse(v.affected_share, ctx);
  const rebuild = byCourse(v.rebuild_share, ctx);
  const cfg = model.config.update_reserve;
  const one = (id) => costLine(model, leafLine(model, id, 1, [productName, id], ctx), ctx);
  const signal = one(cfg.signal_leaf);
  const per = cfg.affected_leaves.map(one);
  const line = productHours(model, productName, ctx)
    .lines.filter((l) => l.class === "direct" && l.leaf.startsWith(p.reserve_line))
    .map((l) => costLine(model, l, ctx));
  const byArticle = {};
  addAll(byArticle, signal.byArticle, signals);
  for (const l of per) addAll(byArticle, l.byArticle, affected);
  for (const l of line) addAll(byArticle, l.byArticle, affected * rebuild);
  return {
    hours:
      signals * signal.hours +
      affected * (sum(per.map((l) => l.hours)) + rebuild * sum(line.map((l) => l.hours))),
    cost:
      signals * (signal.cost ?? 0) +
      affected *
        (sum(per.map((l) => l.cost ?? 0)) + rebuild * sum(line.map((l) => l.cost ?? 0))),
    byArticle,
  };
}

const normExternals = (list) =>
  (list ?? []).map((e) => (typeof e === "string" ? { id: e } : e));

const contactsPlan = (model) => byCourse(model.vars.contacts, { course: "usual" });

/**
 * Full unit cost = direct + allocated overhead + update reserve + externals + tools pool share;
 * «с полным фондом оплаты» adds the idle штат time. `articles` splits the full total by cost article.
 */
export function unitCost(model, productName, ctx) {
  const c = normalizeCtx(ctx);
  return memo(model, `cost|${productName}|${ctxKey(c)}`, () => {
    const hours = productHours(model, productName, c);
    const trail = hours.lines.map((l) => costLine(model, l, c));
    const direct = trail.filter((l) => l.class === "direct");
    const byRole = {};
    for (const l of direct) {
      byRole[l.role] ??= { hours: 0, cost: 0 };
      byRole[l.role].hours += l.hours;
      byRole[l.role].cost += l.cost ?? 0;
    }
    const flags = new Set();
    for (const l of trail) for (const f of l.flags) flags.add(`${l.role}: ${f}`);
    for (const l of direct) if (l.cost == null) flags.add(`ставка не задана: ${l.role}`);
    const plan = periodPlan(model, c);
    if (plan.unpriced.length) flags.add(`накладные без ставки: ${plan.unpriced.join(", ")}`);
    for (const f of plan.idle.flags) flags.add(f);
    const directHours = sum(direct.map((l) => l.hours));
    const directCost = sum(direct.map((l) => l.cost ?? 0));
    const overheadCost = directHours * plan.overheadPerDirectHour;
    const reserve = { hours: 0, cost: 0, byArticle: {} };
    const ext = {};
    const units = [];
    expand(model, productName, c, (node) => {
      if (!node.product) return;
      units.push({ path: node.path, product: node.product, qty: node.qty });
      const p = model.products[node.product];
      if (p.reserve_line) {
        const r = reserveOfUnit(model, node.product, c);
        reserve.hours += node.qty * r.hours;
        reserve.cost += node.qty * r.cost;
        addAll(reserve.byArticle, r.byArticle, node.qty);
      }
      for (const e of normExternals(p.externals)) {
        if (!applies(model, e)) continue;
        const factor = e.hours_of
          ? sum(
              productHours(model, node.product, c)
                .lines.filter((l) => e.hours_of.includes(l.leaf))
                .map((l) => l.hours),
            )
          : 1;
        add(ext, e.id, node.qty * factor);
      }
    });
    const externals = Object.entries(ext).map(([id, qty]) => {
      const e = model.externals[id];
      if (!e) throw new Error(`«${productName}»: unknown external «${id}»`);
      const rub = e.rub ?? null;
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
    const pending = [...hours.pending];
    if (model.vars.extended_campaign) {
      const cfg = model.config.extended_campaign;
      const contacts = contactsPlan(model);
      const rub = model.vars.campaign_cost_per_contact;
      externals.push({
        id: "extended_campaign",
        name: cfg.name,
        per: "контакт",
        qty: contacts,
        rub,
        cost: rub == null ? null : rub * contacts,
        status: rub == null ? "не задано" : "задано",
      });
      pending.push(pendingLine(model, cfg.pending, 1, [productName, cfg.pending]));
    }
    const unset = externals.filter((e) => e.rub == null);
    if (unset.length)
      flags.add(`внешние затраты не заданы: ${unset.map((e) => e.name).join(", ")}`);
    for (const l of pending) for (const f of l.flags) flags.add(f);
    trail.push(...pending);
    const externalCost = sum(externals.map((e) => e.cost ?? 0));
    const idleCost = directHours * plan.idle.perDirectHour;
    const toolsCost = directHours * plan.tools.perDirectHour;
    const byLoad = directCost + overheadCost + reserve.cost + externalCost + toolsCost;
    trail.push({
      path: [productName],
      leaf: null,
      name: TOOLS_LINE,
      role: null,
      class: "tools",
      qty: 1,
      hours: directHours,
      hoursPerPass: null,
      rounds: null,
      hourlyCost: plan.tools.perDirectHour,
      cost: toolsCost,
      flags: [],
    });
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
    const articles = emptyArticles();
    for (const l of direct) addAll(articles, l.byArticle);
    if (plan.poolCost) addAll(articles, plan.poolByArticle, overheadCost / plan.poolCost);
    addAll(articles, reserve.byArticle);
    articles.externals += externalCost;
    if (plan.tools.total) {
      articles.tools_ai += (toolsCost * plan.tools.ai) / plan.tools.total;
      articles.tools_other += (toolsCost * plan.tools.other) / plan.tools.total;
    }
    articles.payroll += idleCost;
    return {
      product: productName,
      ctx: c,
      direct: {
        hours: directHours,
        cost: directCost,
        byRole,
        circle: circleMembers(model, byRole[TEAM_CIRCLE], c),
      },
      overhead: {
        cost: overheadCost,
        perDirectHour: plan.overheadPerDirectHour,
        ownHours: sum(trail.filter((l) => l.class === "overhead").map((l) => l.hours)),
      },
      reserve: { hours: reserve.hours, cost: reserve.cost },
      externals,
      externalCost,
      pending,
      tools: {
        cost: toolsCost,
        perDirectHour: plan.tools.perDirectHour,
        ai: plan.tools.total ? (toolsCost * plan.tools.ai) / plan.tools.total : 0,
        other: plan.tools.total ? (toolsCost * plan.tools.other) / plan.tools.total : 0,
      },
      units,
      idle: { cost: idleCost, perDirectHour: plan.idle.perDirectHour },
      total: { byLoad, fullPayroll: byLoad + idleCost },
      articles,
      flags: [...flags],
      trail,
    };
  });
}

// ── Price, revenue and market ──

/** Price per contact of a product: the variable, else the audience band middle × contact-type weight. */
function pricePerContact(model, productName) {
  const type = model.products[productName]?.contact_type ?? null;
  if (!type) return { value: null, type: null, source: "нет оплаты за контакты" };
  if (model.vars.price_per_contact != null)
    return { value: model.vars.price_per_contact, type, source: "переменная" };
  const dc = model.doctorContacts;
  const n = model.vars.audience_doctors;
  const band = dc.price_per_contact_by_audience_size.find(
    (b) => n >= b.doctors[0] && (b.doctors[1] == null || n < b.doctors[1]),
  );
  const weight = middle(dc.contact_types[type].weight);
  return {
    value: middle(band.rub_per_contact) * weight,
    type,
    band: band.band,
    bandRub: middle(band.rub_per_contact),
    weight,
    source: "рынок: полоса аудитории × вес типа контакта",
  };
}

function capRevenue(model, raw) {
  const cap = model.vars.budget_cap;
  if (cap == null || raw <= cap) return raw;
  if (model.vars.budget_cap_mode === "tiered")
    return cap + (raw - cap) * (1 - model.vars.budget_tier_discount);
  return cap;
}

function leadingPrice(mode, value, cost) {
  switch (mode) {
    case "multiplier":
      return cost * value;
    case "markup":
      return cost * (1 + value);
    case "margin":
      return cost / (1 - value);
    case "fixed":
      return value;
    default:
      throw new Error(`unknown price mode «${mode}»`);
  }
}

/**
 * Price engine on the full unit cost (with idle): one leading mode (multiplier | markup | margin |
 * fixed), the others derived; price at plan = advance + plan contacts × price per contact; revenue,
 * margin and author share at low / plan / high contacts (budget cap applied); break-even contacts;
 * billing by month or quarter over the lead time.
 */
export function priceProduct(model, productName, ctx) {
  const c = normalizeCtx(ctx);
  return memo(model, `price|${productName}|${ctxKey(c)}`, () => {
    const u = unitCost(model, productName, c);
    const cost = u.total.fullPayroll;
    const lead = model.productPrice[productName] ?? {
      mode: model.vars.price_mode,
      value: model.vars.price_value,
    };
    const price = leadingPrice(lead.mode, lead.value, cost);
    const derived = {
      multiplier: price / cost,
      markup: price / cost - 1,
      margin: (price - cost) / price,
      fixed: price,
    };
    const pc = pricePerContact(model, productName);
    const per = pc.value ?? 0;
    const [low, plan, high] = model.vars.contacts;
    const advance = price - plan * per;
    const flags = [];
    if (advance < 0)
      flags.push("аванс отрицательный: оплата за контакты по плану выше цены");
    const outcome = (contacts) => {
      const revenue = capRevenue(model, advance + contacts * per);
      const margin = revenue - cost;
      return {
        contacts,
        revenue,
        margin,
        marginShare: revenue ? margin / revenue : null,
        authorShare: Math.max(0, margin) * model.vars.author_share,
      };
    };
    let breakEvenContacts;
    if (per > 0) breakEvenContacts = Math.max(0, (cost - advance) / per);
    else breakEvenContacts = advance >= cost ? 0 : null;
    if (breakEvenContacts != null && capRevenue(model, advance + breakEvenContacts * per) < cost - 1e-6)
      breakEvenContacts = null;
    const leadDays = leadTime(model, productName, c);
    const periodMonths = model.vars.billing_period === "quarter" ? 3 : 1;
    const leadMonths = leadDays == null ? 0 : leadDays / model.vars.working_days_per_month;
    const invoices = Math.max(1, Math.ceil(leadMonths / periodMonths));
    const planOutcome = outcome(plan);
    return {
      product: productName,
      ctx: c,
      cost,
      mode: lead.mode,
      value: lead.value,
      price,
      derived,
      advance,
      resultAtPlan: plan * per,
      advanceShare: price ? advance / price : null,
      pricePerContact: pc,
      contacts: { low, plan, high },
      outcomes: { low: outcome(low), plan: planOutcome, high: outcome(high) },
      breakEvenContacts,
      budgetCap: {
        value: model.vars.budget_cap,
        mode: model.vars.budget_cap_mode,
        discount: model.vars.budget_tier_discount,
      },
      leadDays,
      billing: {
        period: model.vars.billing_period,
        periodMonths,
        leadMonths,
        invoices,
        perInvoice: planOutcome.revenue / invoices,
      },
      flags,
    };
  });
}

/** Market reference of a product (rates.yaml market_references or `market:`) → gap vs cost and price. */
export function marketReference(model, productName, ctx) {
  const c = normalizeCtx(ctx);
  const ref = model.market[productName] ?? model.marketRefs[productName]?.rub;
  if (!ref) return null;
  const [min, max] = ref;
  const mid = (min + max) / 2;
  const p = priceProduct(model, productName, c);
  const threshold = model.vars.market_gap_threshold;
  const costGap = (p.cost - mid) / mid;
  const priceGap = (p.price - mid) / mid;
  const where = (x) => (x < min ? "ниже рынка" : x > max ? "выше рынка" : "в рынке");
  return {
    min,
    max,
    mid,
    source: model.market[productName] ? "переменная" : "rates.yaml market_references",
    cost: p.cost,
    price: p.price,
    costGap,
    priceGap,
    costPosition: where(p.cost),
    pricePosition: where(p.price),
    threshold,
    costFlag: Math.abs(costGap) > threshold,
    priceFlag: Math.abs(priceGap) > threshold,
  };
}

// ── Sensitivity, break-even, budget ──

/**
 * Tornado data: per driver the unit cost and price at the low and the high end — grade junior ↔
 * senior, course гладко ↔ с переделками, each cost article × (1 ∓ sensitivity_step), market
 * min ↔ max (price at the market bound) — sorted by swing.
 */
export function sensitivity(model, productName, ctx) {
  const c = normalizeCtx(ctx);
  const at = (m, x) => {
    const p = priceProduct(m, productName, x);
    return { cost: p.cost, price: p.price };
  };
  const base = at(model, c);
  const step = model.vars.sensitivity_step;
  const drivers = [
    {
      id: "grade",
      label: "Грейд: junior ↔ senior",
      low: at(model, { ...c, grade: "junior" }),
      high: at(model, { ...c, grade: "senior" }),
    },
    {
      id: "course",
      label: "Ход работы: гладко ↔ с переделками",
      low: at(model, { ...c, course: "smooth" }),
      high: at(model, { ...c, course: "rework" }),
    },
    ...ARTICLES.map((a) => ({
      id: `scale:${a}`,
      label: `${ARTICLE_LABELS[a]}: −${step * 100} % ↔ +${step * 100} %`,
      low: at(derive(model, { [`scale:${a}`]: model.scale[a] * (1 - step) }), c),
      high: at(derive(model, { [`scale:${a}`]: model.scale[a] * (1 + step) }), c),
    })),
  ];
  const ref = model.market[productName] ?? model.marketRefs[productName]?.rub;
  if (ref)
    drivers.push({
      id: "market",
      label: "Рыночный ориентир: min ↔ max",
      low: { cost: base.cost, price: ref[0] },
      high: { cost: base.cost, price: ref[1] },
    });
  for (const d of drivers)
    d.swing = Math.max(
      Math.abs(d.high.cost - d.low.cost),
      Math.abs(d.high.price - d.low.price),
    );
  drivers.sort((a, b) => b.swing - a.swing);
  return { base, drivers };
}

/** Break-even series: contacts from 0 to past max(high, break-even) → revenue vs cost. */
export function breakEvenSeries(model, productName, ctx, points = 21) {
  const p = priceProduct(model, productName, ctx);
  const per = p.pricePerContact.value ?? 0;
  const top = Math.max(p.contacts.high, (p.breakEvenContacts ?? 0) * 1.25) || 1;
  return Array.from({ length: points }, (_, i) => {
    const contacts = (top * i) / (points - 1);
    return {
      contacts,
      revenue: capRevenue(model, p.advance + contacts * per),
      cost: p.cost,
    };
  });
}

const rolesInUse = (model) =>
  new Set([
    ...[...model.leaves.values()].map((l) => l.role),
    ...model.teamRoles.map((m) => m.role),
  ]);

/**
 * «Укладывается ли в бюджет?»: roles and experts whose rate at the budget scales falls below the
 * market floor of their grade (staff gross — grade band min; contractor hour — grade band low end;
 * expert hour — per_hour_rub min).
 */
export function budgetFit(model, ctx) {
  const c = normalizeCtx(ctx);
  const below = [];
  for (const role of rolesInUse(model)) {
    const record = model.rates.get(role);
    if (!record) continue;
    if (isExpertRole(model, role)) {
      const r = roleHourlyCost(model, role, c);
      const grade = model.experts.grades[r.expertGrade];
      if (!grade) continue;
      const value = r.base * model.scale.experts;
      const floor = grade.per_hour_rub[0];
      if (value < floor - 1e-9)
        below.push({ kind: "expert", role, article: "experts", grade: r.expertGrade, value, floor });
      continue;
    }
    const engagement = roleEngagement(model, role);
    const grade = roleGrade(model, role, c);
    const weights = Object.entries(gradeWeights(model, grade)).filter(([, w]) => w);
    const W = sum(weights.map(([, w]) => w));
    if (engagement === "staff" && hasMonthly(record) && !model.grossOverride[role]) {
      const h = staffHour(model, role, c);
      if (h.full == null) continue;
      const floor =
        sum(
          weights.map(([g, w]) => {
            const band = record.monthly_gross_by_grade_rub?.[g];
            const t = record.monthly_gross_rub?.moscow;
            return w * (band ? band[0] : t ? t[0] : 0);
          }),
        ) / W;
      const value = h.gross * model.scale.payroll;
      if (value < floor - 1e-9)
        below.push({ kind: "role", role, article: "payroll", grade, value, floor });
    } else if (engagement !== "staff" && hasHourly(record) && !model.hourlyOverride[role]) {
      const flags = new Set();
      const base = sum(weights.map(([g, w]) => w * (hourlyAt(model, role, g, flags) ?? 0))) / W;
      const floor =
        sum(
          weights.map(([g, w]) => {
            const band = record.hourly_by_grade_rub?.[g];
            return w * (band ? band[0] : (record.hourly_rub?.[0] ?? 0));
          }),
        ) / W;
      const value = base * model.scale.contractors;
      if (value < floor - 1e-9)
        below.push({ kind: "role", role, article: "contractors", grade, value, floor });
    }
  }
  return { fits: below.length === 0, below, scale: { ...model.scale } };
}

/**
 * «Золотая цена»: from the price floor (full unit cost — zero margin) to the ceiling (the lower of
 * the market reference max and the budget cap); null when the floor is above the ceiling.
 */
export function goldenPrice(model, productName, ctx) {
  const c = normalizeCtx(ctx);
  const p = priceProduct(model, productName, c);
  const ref = model.market[productName] ?? model.marketRefs[productName]?.rub;
  const ceilings = [ref?.[1], model.vars.budget_cap].filter((x) => x != null);
  const min = p.cost;
  const max = ceilings.length ? Math.min(...ceilings) : null;
  const band = max != null && min <= max ? [min, max] : null;
  return {
    min,
    max,
    band,
    price: p.price,
    priceInBand: band ? p.price >= band[0] && p.price <= band[1] : null,
  };
}

/** Everything for one product at the ctx: cost, capacity, lead time, price, market and golden band. */
export function computeProduct(model, productName, ctx = DEFAULT_CTX) {
  const c = normalizeCtx(ctx);
  return {
    ...unitCost(model, productName, c),
    capacity: teamCapacity(model, productName, c),
    leadDays: leadTime(model, productName, c),
    price: priceProduct(model, productName, c),
    market: marketReference(model, productName, c),
    golden: goldenPrice(model, productName, c),
  };
}
