// Calculator core checks against the worked figures of ../model/capacity-ru.md and
// ../model/effort-draft-ru.md, and the #2661 mechanics. Run from the repo root:
//   node --test "apps/docs/content/specs/product/content-production/calculator/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  ARTICLES,
  DEFAULT_CTX,
  IDLE_LINE,
  TOOLS_LINE,
  PENDING_LINE,
  loadInputs,
  buildModel,
  engagementPreset,
  loopRounds,
  staffHour,
  roleHourlyCost,
  productHours,
  teamCapacity,
  requiredFte,
  leadTime,
  periodPlan,
  toolsPool,
  unitCost,
  priceProduct,
  marketReference,
  sensitivity,
  breakEvenSeries,
  budgetFit,
  goldenPrice,
  computeProduct,
} from "./compute.mjs";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const inputs = await loadInputs(
  (path) => readFile(join(pkg, path), "utf8"),
  parse,
);
const model = buildModel(inputs);
const near = (actual, expected, eps = 0.01) =>
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${actual} is not within ${eps} of ${expected}`,
  );
const A31 = /^A31/;
const allRoundsOne = Object.fromEntries(
  inputs.loops.loops.map((loop) => [`loop:${loop.name}`, 1]),
);
const U = DEFAULT_CTX;
const at = (course, grade = "mix") => ({ grade, course });
const MID = at("usual", "middle");
const mid = ([lo, hi]) => (lo + hi) / 2;
const rate = (role) => inputs.rates.roles.find((r) => r.role === role);
const vars = inputs.rates.variables;
const P = 145.7;
const OTHER = vars.staff_other_costs_rub_month.total_rub[1];
const staffFull = (gross) => (gross * 1.302 + OTHER) / P;

// ── Model hours, capacity and lead time (course axis = «Ход работы») ──

test("loopRounds: script rounds derive from review and pharma stage 1 (rounds_from)", () => {
  const name = "итерации сценария до «зелёного»";
  assert.equal(loopRounds(model, name, at("smooth")), 1);
  assert.equal(loopRounds(model, name, at("usual")), 3);
  assert.equal(loopRounds(model, name, at("rework")), 5);
  assert.equal(loopRounds(model, "круги этапа 2 фармы", U), 1.5);
  assert.equal(loopRounds(model, null, U), 1);
});

test("productHours: lesson direct hours of line A31 = 77–152,5 per pass (effort-draft-ru.md)", () => {
  const onePass = buildModel(inputs, allRoundsOne);
  const a31 = (m, c) =>
    productHours(m, "урок", c)
      .lines.filter((line) => line.class === "direct" && A31.test(line.leaf))
      .reduce((sum, line) => sum + line.hours, 0);
  near(a31(onePass, at("smooth")), 77);
  near(a31(onePass, at("usual")), 114.75);
  near(a31(onePass, at("rework")), 152.5);
  for (const line of productHours(model, "урок", U).lines)
    near(line.hours, line.hoursPerPass * line.rounds * line.qty);
});

test("productHours: Медредактор-сценарист on a lesson = 81,75 h at «обычно» (capacity-ru.md)", () => {
  const { directByRole } = productHours(model, "урок", U);
  near(directByRole["Медредактор-сценарист"], 81.75);
  near(directByRole["Медиа-круг — монтажёр"], 28);
  near(directByRole["Аккаунт"], 5.875);
});

test("productHours: overhead leaves never land in direct hours", () => {
  const { overhead_role_prefixes: prefixes, overhead_units: units } =
    inputs.products.classification;
  for (const product of Object.keys(inputs.products.products))
    for (const line of productHours(model, product, U).lines) {
      const overhead =
        prefixes.some((p) => line.role.startsWith(p)) ||
        units.includes(line.unit);
      assert.equal(
        line.class,
        overhead ? "overhead" : "direct",
        `${product} ${line.leaf}`,
      );
    }
  const lesson = productHours(model, "урок", U);
  assert.equal(lesson.directByRole["Сервисный круг — юрист"], undefined);
  near(lesson.overheadByRole["Сервисный круг — юрист"], 1.25 * 0.75);
});

test("teamCapacity: 4,4 lessons a month, bottleneck Медредактор-сценарист (capacity-ru.md)", () => {
  const cap = teamCapacity(model, "урок", U);
  assert.equal(cap.bottleneck, "Медредактор-сценарист");
  assert.equal(Math.round(cap.perMonth * 10) / 10, 4.4);
  const editor = cap.roles.find((r) => r.role === "Медредактор-сценарист");
  near(editor.available, 2.5 * P - 0.9375);
  const expertManager = cap.roles.find((r) => r.role === "Менеджер эксперта");
  near(expertManager.available, P - 0.375 - 4);
  // capacity follows the course, never the grade
  assert.equal(
    teamCapacity(model, "урок", at("usual", "senior")).perMonth,
    cap.perMonth,
  );
});

test("requiredFte: one lesson a week needs ≈ 2,44 FTE Медредактор-сценарист", () => {
  const fte = requiredFte(model, "урок", "Медредактор-сценарист", 1, U);
  assert.equal(Math.round(fte * 100) / 100, 2.44);
});

test("leadTime: lesson 90,5, episode ≈ 19, webinar 34,5, course design 61 working days", () => {
  near(leadTime(model, "урок", U), 90.5);
  near(leadTime(model, "эпизод подкаста", U), 19.25);
  near(leadTime(model, "вебинар", U), 34.5);
  near(leadTime(model, "проектирование курса", U), 61);
  const takt = 21 / teamCapacity(model, "урок", U).perMonth;
  near(leadTime(model, "модуль", U), 90.5 + 5 * takt);
  near(leadTime(model, "курс", U), 61 + 90.5 + 17 * takt);
});

// ── 2661-1 Engagement per role ──

test("2661-1: engagement «как в модели» — штат for штат roles, самозанятый for pools; override per role", () => {
  assert.equal(roleHourlyCost(model, "Аккаунт", MID).engagement, "staff");
  assert.equal(roleHourlyCost(model, "Аккаунт", MID).basis, "штат");
  assert.equal(
    roleHourlyCost(model, "Пул медрецензентов", MID).engagement,
    "npd",
  );
  const band = rate("Аккаунт").hourly_by_grade_rub.middle;
  for (const [form, onTop] of [
    ["npd", 0],
    ["ip", 0],
    ["gph", vars.contractor_on_top_rate.gph_individual],
  ]) {
    const m = buildModel(inputs, { "engage:Аккаунт": form });
    const r = roleHourlyCost(m, "Аккаунт", MID);
    assert.equal(r.engagement, form);
    near(r.value, mid(band) * (1 + onTop), 1e-9);
  }
  assert.throws(
    () => buildModel(inputs, { "engage:Аккаунт": "аутсорс" }),
    /engagement/,
  );
});

test("2661-1: a freelance role has no idle time and no payroll", () => {
  const m = buildModel(inputs, { "engage:Аккаунт": "npd" });
  const plan = periodPlan(m, U);
  assert.ok(!plan.idle.byRole.some((r) => r.role === "Аккаунт"));
  assert.ok(
    periodPlan(model, U).idle.byRole.some((r) => r.role === "Аккаунт"),
  );
  assert.ok(plan.idle.cost < periodPlan(model, U).idle.cost);
});

test("2661-1: presets «Всё в штате / Всё почасово / Как в модели»", () => {
  const staff = engagementPreset(model, "staff");
  assert.equal(staff["engage:Медиа-круг — монтажёр"], "staff");
  assert.equal(staff["engage:Пул медрецензентов"], undefined); // no monthly data
  const hourly = engagementPreset(model, "hourly");
  assert.equal(hourly["engage:Аккаунт"], "npd");
  const allHourly = buildModel(inputs, hourly);
  assert.equal(periodPlan(allHourly, U).idle.cost, 0);
  assert.equal(periodPlan(allHourly, U).idle.byRole.length, 0);
  const back = buildModel(inputs, {
    ...hourly,
    ...engagementPreset(model, "model"),
  });
  assert.equal(roleHourlyCost(back, "Аккаунт", MID).engagement, "staff");
  assert.throws(() => engagementPreset(model, "все"), /preset/);
});

// ── 2661-2 Explicit staff hour ──

test("2661-2: staff hour = (gross + bonus + contributions) ÷ paid hours + other costs ÷ paid hours, every step returned", () => {
  const gross = rate("Аккаунт").monthly_gross_by_grade_rub.middle[1];
  const h = staffHour(model, "Аккаунт", MID);
  assert.equal(h.gross, gross);
  assert.equal(h.bonus, 0);
  near(h.contributions, gross * 0.302, 1e-6);
  assert.equal(h.contributionsMode, "general");
  assert.equal(h.paidHours, P);
  near(h.payPerHour, (gross * 1.302) / P, 1e-9);
  assert.equal(h.otherPerMonth, OTHER);
  near(h.otherPerHour, OTHER / P, 1e-9);
  near(h.full, staffFull(gross), 1e-9);
  near(roleHourlyCost(model, "Аккаунт", MID).value, h.full, 1e-9);
  // MSP preferential mode (rates.yaml contributions_modes.msp_priority)
  const msp = staffHour(
    buildModel(inputs, { "var:contributions_mode": "msp_priority" }),
    "Аккаунт",
    MID,
  );
  near(
    msp.contributions,
    40639.5 * 0.3 + (gross - 40639.5) * 0.15 + gross * 0.002,
    1e-6,
  );
  // bonus is subject to contributions
  const bonus = staffHour(
    buildModel(inputs, { "var:bonus_share": 0.083 }),
    "Аккаунт",
    MID,
  );
  near(bonus.bonus, gross * 0.083, 1e-6);
  near(bonus.contributions, gross * 1.083 * 0.302, 1e-6);
  // above the yearly contributions base the effective rate falls
  const senior = staffHour(model, "Ядро — консультант рынка", at("usual", "senior"));
  assert.ok(senior.contributions < senior.gross * 0.302);
});

// ── 2661-3 Grade × course axes ──

test("2661-3: «Грейд» drives rates — junior < middle < senior, mix = default_team_grade_mix, per-role override", () => {
  const r = (g, m = model) => roleHourlyCost(m, "Аккаунт", at("usual", g)).value;
  assert.ok(r("junior") < r("middle") && r("middle") < r("senior"));
  const w = vars.default_team_grade_mix;
  near(
    r("mix"),
    w.junior * r("junior") + w.middle * r("middle") + w.senior * r("senior"),
    1e-6,
  );
  const o = buildModel(inputs, { "grade:Аккаунт": "senior" });
  near(r("junior", o), r("senior"), 1e-9);
  near(
    roleHourlyCost(o, "Продюсер", at("usual", "junior")).value,
    roleHourlyCost(model, "Продюсер", at("usual", "junior")).value,
    1e-9,
  );
  // contractor grade = middle of the grade band
  const m = buildModel(inputs, { "engage:Методолог": "npd" });
  near(
    roleHourlyCost(m, "Методолог", at("usual", "senior")).value,
    mid(rate("Методолог").hourly_by_grade_rub.senior),
    1e-9,
  );
});

test("2661-3: «Ход работы» drives hours and rounds only; old scenario strings are refused", () => {
  const cost = (c) => unitCost(model, "урок", c);
  assert.ok(cost(at("smooth")).direct.hours < cost(at("rework")).direct.hours);
  near(
    roleHourlyCost(model, "Аккаунт", at("smooth")).value,
    roleHourlyCost(model, "Аккаунт", at("rework")).value,
    1e-9,
  );
  assert.equal(
    cost(at("usual", "junior")).direct.hours,
    cost(at("usual", "senior")).direct.hours,
  );
  assert.ok(
    cost(at("usual", "junior")).direct.cost <
      cost(at("usual", "senior")).direct.cost,
  );
  assert.throws(() => unitCost(model, "урок", "mid"), /ctx/);
  assert.throws(() => unitCost(model, "урок", { grade: "lead" }), /grade/);
});

// ── 2661-4 Experts ──

test("2661-4: experts are priced by grade × hours (rates.yaml experts), never also as a flat fee", () => {
  const g = inputs.rates.experts.grades;
  near(
    roleHourlyCost(model, "Пул экспертов — амбассадор", U).value,
    mid(g["д.м.н."].per_hour_rub),
    1e-9,
  );
  near(
    roleHourlyCost(model, "Пул экспертов — эксперт", U).value,
    mid(g["к.м.н."].per_hour_rub),
    1e-9,
  );
  const kol = buildModel(inputs, { "var:expert_grade_author": "лидер мнений" });
  near(
    roleHourlyCost(kol, "Пул экспертов — амбассадор", U).value,
    mid(g["лидер мнений"].per_hour_rub),
    1e-9,
  );
  assert.equal(roleHourlyCost(model, "Пул экспертов — спикер", U).article, "experts");
  // A3241 (podcast guest) and A339 (event speaker) are priced lines; no speaker-fee externals
  const speaker = mid(g["к.м.н."].per_hour_rub);
  for (const [product, leaf] of [
    ["эпизод подкаста", "A3241"],
    ["вебинар", "A339"],
    ["клуб", "A339"],
  ]) {
    const u = unitCost(model, product, U);
    const line = u.trail.find((l) => l.leaf === leaf);
    near(line.cost, line.hours * speaker, 1e-6);
    assert.ok(
      !u.externals.some((e) => /speaker/.test(e.id)),
      u.externals.map((e) => e.id).join(","),
    );
  }
  // course author per course (A28), lesson speaker per lesson (A3112)
  const course = unitCost(model, "курс", U);
  assert.equal(course.trail.find((l) => l.leaf === "A28").qty, 1);
  assert.equal(course.trail.find((l) => l.leaf === "A3112").qty, 18);
  assert.ok(course.articles.experts > 0);
});

// ── 2661-5 External costs and black boxes ──

test("2661-5: external costs default from rates.yaml external_costs; studio × recording hours", () => {
  const lesson = unitCost(model, "урок", U);
  for (const ext of lesson.externals) {
    assert.equal(ext.rub, inputs.rates.external_costs[ext.id].rub);
    assert.equal(ext.status, "задано");
  }
  assert.ok(!lesson.flags.some((f) => f.startsWith("внешние затраты не заданы")));
  const episode = unitCost(model, "эпизод подкаста", U);
  const studio = episode.externals.find((e) => e.id === "podcast_studio");
  const recording = productHours(model, "эпизод подкаста", U).lines.find(
    (l) => l.leaf === "A3242",
  ).hours;
  near(studio.qty, recording, 1e-9);
  near(studio.cost, 20000 * recording, 1e-6);
  const video = unitCost(model, "видеоподкаст", U).externals.find(
    (e) => e.id === "podcast_studio",
  );
  near(
    video.qty,
    productHours(model, "видеоподкаст", U).lines.find((l) => l.leaf === "A3243")
      .hours,
    1e-9,
  );
  const free = unitCost(buildModel(inputs, { "external:ai_generation": 0 }), "урок", U);
  near(lesson.total.byLoad - free.total.byLoad, 50000, 1e-6);
  const unset = unitCost(
    buildModel(inputs, { "external:ai_generation": null }),
    "урок",
    U,
  );
  assert.ok(
    unset.flags.includes(
      `внешние затраты не заданы: ${inputs.products.externals.ai_generation.name}`,
    ),
  );
});

const VP_CONTRACTOR = { "var:video_podcast_production": "contractor" };

test("2661-5: видеоподкаст «своя команда» (default) — own operation hours A3252/A3253 + studio hour, no component lines", () => {
  assert.equal(model.vars.video_podcast_production, "own");
  const u = unitCost(model, "видеоподкаст", U);
  assert.ok(!u.externals.some((e) => e.id.startsWith("video_podcast_")));
  assert.ok(!u.externals.some((e) => e.id === "podcast_studio_bare"));
  const studio = u.externals.find((e) => e.id === "podcast_studio");
  assert.equal(studio.rub, inputs.rates.external_costs.podcast_studio.rub);
  const leaves = productHours(model, "видеоподкаст", U).lines.map((l) => l.leaf);
  for (const leaf of ["A3252", "A3253"]) assert.ok(leaves.includes(leaf), leaf);
});

test("2661-5: видеоподкаст «подрядчик» — five components replace A3252/A3253 hours, studio at the bare-rental middle", () => {
  const m = buildModel(inputs, VP_CONTRACTOR);
  const leaves = productHours(m, "видеоподкаст", U).lines.map((l) => l.leaf);
  for (const leaf of ["A3252", "A3253"]) assert.ok(!leaves.includes(leaf), leaf);
  for (const leaf of ["A3241", "A3243", "A3251"]) assert.ok(leaves.includes(leaf), leaf);
  const u = unitCost(m, "видеоподкаст", U);
  assert.ok(!u.externals.some((e) => e.id === "podcast_studio"));
  const bare = u.externals.find((e) => e.id === "podcast_studio_bare");
  near(bare.rub, mid(inputs.rates.external_costs.podcast_studio.market_rub), 1e-9);
  near(
    bare.qty,
    productHours(m, "видеоподкаст", U).lines.find((l) => l.leaf === "A3243").hours,
    1e-9,
  );
  // the audio episode keeps its own studio hour in both modes
  assert.ok(unitCost(m, "эпизод подкаста", U).externals.some((e) => e.id === "podcast_studio"));
  assert.throws(() => buildModel(inputs, { "var:video_podcast_production": "x" }), /video_podcast_production/);
});

test("2661-5: видеоподкаст «подрядчик» carries the rates.yaml video_podcast components as its own external lines", () => {
  const vp = inputs.rates.external_costs.video_podcast;
  const c = vp.components;
  const expected = {
    video_podcast_crew: mid(c.multi_camera_crew.rub),
    video_podcast_director: mid(c.director.rub),
    video_podcast_grading: mid(c.grading_graphics.rub),
    video_podcast_cover: mid(c.cover.rub),
    video_podcast_clips: mid(c.clips.rub_per_clip) * mid(c.clips.clips_per_episode),
  };
  const contractor = buildModel(inputs, VP_CONTRACTOR);
  const lines = unitCost(contractor, "видеоподкаст", U).externals;
  for (const [id, rub] of Object.entries(expected)) {
    const line = lines.find((e) => e.id === id);
    assert.ok(line, `видеоподкаст has no external line ${id}`);
    near(line.rub, rub, 1e-9);
    assert.equal(line.per, vp.per);
    near(line.cost, rub * line.qty, 1e-6);
    assert.equal(line.qty, 1);
  }
  // the audio episode has none of them
  const episode = unitCost(model, "эпизод подкаста", U).externals;
  assert.ok(!episode.some((e) => e.id.startsWith("video_podcast_")));
  // a component is editable like any external
  const edited = unitCost(
    buildModel(inputs, { ...VP_CONTRACTOR, "external:video_podcast_cover": 0 }),
    "видеоподкаст",
    U,
  );
  near(
    unitCost(contractor, "видеоподкаст", U).total.byLoad - edited.total.byLoad,
    expected.video_podcast_cover,
    1e-6,
  );
});

test("2661-2: «Продуктовая команда» hours are exposed per member role, freelance members included", () => {
  const m = buildModel(inputs, { "engage:Аккаунт": "npd" });
  const u = unitCost(m, "курс", U);
  const circle = u.direct.circle;
  assert.equal(circle.role, "Продуктовая команда");
  const H = u.direct.byRole["Продуктовая команда"].hours;
  near(circle.hours, H, 1e-9);
  const account = circle.members.find((x) => x.role === "Аккаунт");
  assert.equal(account.engagement, "npd");
  assert.equal(account.article, "contractors");
  const rate = roleHourlyCost(m, "Аккаунт", U).value;
  near(account.cost, account.hours * rate, 1e-6);
  near(
    circle.members.reduce((a, x) => a + x.hours, 0),
    H,
    1e-9,
  );
  near(
    circle.members.reduce((a, x) => a + x.cost, 0),
    u.direct.byRole["Продуктовая команда"].cost,
    1e-6,
  );
  // a product without circle lines has no circle block
  assert.equal(unitCost(m, "урок", U).direct.circle, null);
});

test("2661-5: a black box (decomposition: pending) is a «не задано: подпроцесс не раскрыт» line", () => {
  const school = unitCost(model, "практическая школа", U);
  const line = school.trail.find((l) => l.leaf === "A338");
  assert.equal(line.class, "pending");
  assert.equal(line.cost, null);
  assert.equal(line.name, PENDING_LINE);
  assert.ok(school.flags.some((f) => f.startsWith(PENDING_LINE) && f.includes("A338")));
  assert.ok(!unitCost(model, "вебинар", U).trail.some((l) => l.class === "pending"));
});

// ── 2661-6 Tools and infrastructure pool ──

test("2661-6: tools pool = subscriptions + Платформа DS + capex ÷ useful life, allocated per direct hour", () => {
  const t = inputs.rates.tools;
  const pool = toolsPool(model, U);
  const seats = model.teamRoles.reduce(
    (a, m) => a + (Array.isArray(m.fte) ? mid(m.fte) : m.fte),
    0,
  );
  near(pool.seats, seats, 1e-9);
  const markup = t.payment_markup.default;
  const aiItems = new Set(inputs.products.tools_pool.ai_items);
  const ai = t.opex_monthly
    .filter((o) => aiItems.has(o.item))
    .reduce(
      (a, o) =>
        a + o.rub_month * (o.per === "seat" ? seats : 1) * (o.usd ? 1 + markup : 1),
      0,
    );
  near(pool.ai, ai, 1e-6);
  const capex = t.capex.reduce((a, c) => a + c.price_rub / c.useful_life_months, 0);
  near(pool.byGroup.capex, capex, 1e-6);
  near(pool.total, pool.ai + pool.other, 1e-9);
  assert.ok(pool.byGroup.platform > 0);
  const plan = periodPlan(model, U);
  near(plan.tools.perDirectHour, pool.total / plan.directHours, 1e-9);
  const lesson = unitCost(model, "урок", U);
  near(lesson.tools.cost, lesson.direct.hours * plan.tools.perDirectHour, 1e-6);
  const line = lesson.trail.find((l) => l.class === "tools");
  assert.equal(line.name, TOOLS_LINE);
  near(
    lesson.total.byLoad,
    lesson.direct.cost +
      lesson.overhead.cost +
      lesson.reserve.cost +
      lesson.externalCost +
      lesson.tools.cost,
    1e-6,
  );
});

// ── 2661-7 Extended campaign ──

test("2661-7: extended campaign = cost per contact × planned contacts, its own work a black box", () => {
  const on = buildModel(inputs, { "var:extended_campaign": true });
  const base = unitCost(model, "курс", U);
  const withCampaign = unitCost(on, "курс", U);
  const cpc = mid(inputs.rates.doctor_contacts.paid_acquisition_cost_per_lead_rub.registration);
  const plan = inputs.products.variables.contacts.draft[1];
  const line = withCampaign.externals.find((e) => e.id === "extended_campaign");
  near(line.cost, cpc * plan, 1e-6);
  near(withCampaign.total.byLoad - base.total.byLoad, cpc * plan, 1e-6);
  assert.ok(withCampaign.trail.some((l) => l.leaf === "A47" && l.class === "pending"));
  assert.ok(!base.externals.some((e) => e.id === "extended_campaign"));
});

// ── 2661-8 Price engine ──

test("2661-8: one leading price mode, the other three derived", () => {
  const p = priceProduct(model, "курс", U);
  near(p.price, p.cost * 1.3, 1e-6);
  near(p.derived.multiplier, 1.3, 1e-9);
  near(p.derived.markup, 0.3, 1e-9);
  near(p.derived.margin, 0.3 / 1.3, 1e-9);
  near(p.derived.fixed, p.price, 1e-9);
  const margin = priceProduct(
    buildModel(inputs, { "var:price_mode": "margin", "var:price_value": 0.25 }),
    "курс",
    U,
  );
  near(margin.price, margin.cost / 0.75, 1e-6);
  const fixed = priceProduct(
    buildModel(inputs, { "var:price_mode": "fixed", "var:price_value": 9e6 }),
    "курс",
    U,
  );
  assert.equal(fixed.price, 9e6);
  near(fixed.derived.multiplier, 9e6 / fixed.cost, 1e-9);
  const own = priceProduct(buildModel(inputs, { "price:курс:multiplier": 2 }), "курс", U);
  near(own.price, own.cost * 2, 1e-6);
  assert.equal(own.mode, "multiplier");
});

test("2661-8: advance + result split, contacts low / plan / high, break-even, author share, billing", () => {
  const p = priceProduct(model, "курс", U);
  const band = inputs.rates.doctor_contacts.price_per_contact_by_audience_size[1];
  const weight = mid(inputs.rates.doctor_contacts.contact_types.series_view.weight);
  near(p.pricePerContact.value, mid(band.rub_per_contact) * weight, 1e-9);
  assert.equal(p.pricePerContact.type, "series_view");
  const [lo, plan, hi] = inputs.products.variables.contacts.draft;
  near(p.advance, p.price - plan * p.pricePerContact.value, 1e-6);
  near(p.outcomes.plan.revenue, p.price, 1e-6);
  near(p.outcomes.low.revenue, p.advance + lo * p.pricePerContact.value, 1e-6);
  near(p.outcomes.high.revenue, p.advance + hi * p.pricePerContact.value, 1e-6);
  near(p.outcomes.plan.margin, p.price - p.cost, 1e-6);
  near(p.outcomes.plan.authorShare, 0.1 * (p.price - p.cost), 1e-6);
  // break-even never goes below zero contacts: an advance above the cost breaks even at 0
  near(
    p.breakEvenContacts,
    Math.max(0, (p.cost - p.advance) / p.pricePerContact.value),
    1e-6,
  );
  const thin = priceProduct(buildModel(inputs, { "var:price_value": 0.05 }), "курс", U);
  assert.ok(thin.advance < thin.cost);
  near(
    thin.breakEvenContacts,
    (thin.cost - thin.advance) / thin.pricePerContact.value,
    1e-6,
  );
  assert.ok(thin.breakEvenContacts > 0);
  // budget cap: hard by default, tiered discount as an option
  const hard = priceProduct(buildModel(inputs, { "var:budget_cap": p.price }), "курс", U);
  near(hard.outcomes.high.revenue, p.price, 1e-6);
  const tiered = priceProduct(
    buildModel(inputs, { "var:budget_cap": p.price, "var:budget_cap_mode": "tiered" }),
    "курс",
    U,
  );
  near(
    tiered.outcomes.high.revenue,
    p.price + (p.outcomes.high.revenue - p.price) * 0.5,
    1e-6,
  );
  // billing period
  const months = p.leadDays / 21;
  assert.equal(p.billing.invoices, Math.max(1, Math.ceil(months)));
  const quarter = priceProduct(buildModel(inputs, { "var:billing_period": "quarter" }), "курс", U);
  assert.equal(quarter.billing.invoices, Math.max(1, Math.ceil(months / 3)));
  near(quarter.billing.perInvoice, p.price / quarter.billing.invoices, 1e-6);
  // a product without a contact type is paid by advance only
  const deal = priceProduct(model, "сделка", U);
  assert.equal(deal.pricePerContact.value, null);
  near(deal.advance, deal.price, 1e-9);
});

// ── 2661-9 Market reference ──

test("2661-9: market reference per product → gap vs cost and price, flagged above the threshold", () => {
  const m = marketReference(model, "курс", U);
  const [lo, hi] = inputs.rates.market_references["курс"].rub;
  near(m.mid, (lo + hi) / 2, 1e-9);
  near(m.costGap, (m.cost - m.mid) / m.mid, 1e-9);
  near(m.priceGap, (m.price - m.mid) / m.mid, 1e-9);
  assert.equal(m.costFlag, Math.abs(m.costGap) > 0.5);
  const edited = marketReference(
    buildModel(inputs, { "market:курс": [m.cost, m.cost] }),
    "курс",
    U,
  );
  near(edited.costGap, 0, 1e-9);
  assert.equal(edited.costFlag, false);
  assert.equal(marketReference(model, "сделка", U), null);
});

// ── 2661-10 Sensitivity ──

test("2661-10: sensitivity — per driver low/high cost and price, sorted by swing (tornado data)", () => {
  const s = sensitivity(model, "курс", U);
  const ids = s.drivers.map((d) => d.id);
  for (const id of ["grade", "course", "market", ...ARTICLES.map((a) => `scale:${a}`)])
    assert.ok(ids.includes(id), id);
  for (let i = 1; i < s.drivers.length; i++)
    assert.ok(s.drivers[i - 1].swing >= s.drivers[i].swing);
  const grade = s.drivers.find((d) => d.id === "grade");
  assert.ok(grade.low.cost < grade.high.cost);
  const course = s.drivers.find((d) => d.id === "course");
  near(course.low.cost, priceProduct(model, "курс", at("smooth")).cost, 1e-6);
  const market = s.drivers.find((d) => d.id === "market");
  assert.equal(market.low.price, inputs.rates.market_references["курс"].rub[0]);
  near(market.low.cost, s.base.cost, 1e-9);
});

test("2661-10: break-even series — contacts → revenue vs cost", () => {
  const p = priceProduct(model, "курс", U);
  const series = breakEvenSeries(model, "курс", U, 11);
  assert.equal(series.length, 11);
  assert.equal(series[0].contacts, 0);
  near(series[0].revenue, p.advance, 1e-6);
  for (const pt of series) {
    near(pt.cost, p.cost, 1e-9);
    near(pt.revenue, p.advance + pt.contacts * p.pricePerContact.value, 1e-6);
  }
  assert.ok(series.at(-1).contacts >= p.breakEvenContacts);
});

// ── 2661-11 Budget per cost article ──

test("2661-11: a scale per cost article; below-market roles listed; golden price band", () => {
  const half = buildModel(inputs, { "scale:payroll": 0.5 });
  near(
    roleHourlyCost(half, "Аккаунт", MID).value,
    roleHourlyCost(model, "Аккаунт", MID).value * 0.5,
    1e-9,
  );
  near(
    roleHourlyCost(half, "Пул медрецензентов", MID).value,
    roleHourlyCost(model, "Пул медрецензентов", MID).value,
    1e-9,
  );
  assert.equal(budgetFit(model, U).fits, true);
  const fit = budgetFit(half, U);
  assert.equal(fit.fits, false);
  assert.ok(fit.below.some((b) => b.role === "Аккаунт" && b.article === "payroll"));
  const experts = budgetFit(buildModel(inputs, { "scale:experts": 0.3 }), U);
  assert.ok(experts.below.some((b) => b.role === "Пул экспертов — амбассадор"));
  const noAi = toolsPool(buildModel(inputs, { "scale:tools_ai": 0 }), U);
  assert.equal(noAi.ai, 0);
  near(noAi.other, toolsPool(model, U).other, 1e-9);
  for (const a of ARTICLES) assert.ok(a in unitCost(model, "урок", U).articles, a);
  const sumArticles = Object.values(unitCost(model, "урок", U).articles).reduce(
    (a, b) => a + b,
    0,
  );
  near(sumArticles, unitCost(model, "урок", U).total.fullPayroll, 1e-3);
  const g = goldenPrice(model, "курс", U);
  near(g.min, unitCost(model, "курс", U).total.fullPayroll, 1e-6);
  assert.equal(g.max, inputs.rates.market_references["курс"].rub[1]);
  const capped = goldenPrice(buildModel(inputs, { "var:budget_cap": g.min * 2 }), "курс", U);
  assert.equal(capped.max, Math.min(g.min * 2, g.max));
});

// ── 2661-12 Products ──

test("2661-12: видеоподкаст added, конгресс removed, A27/A28 wired into course design", () => {
  assert.ok(!("конгресс" in inputs.products.products));
  const video = productHours(model, "видеоподкаст", U).lines.map((l) => l.leaf);
  for (const leaf of ["A3241", "A3243", "A3252", "A3253"]) assert.ok(video.includes(leaf), leaf);
  const design = productHours(model, "проектирование курса", U).lines;
  const a272 = design.filter((l) => l.leaf === "A272").reduce((a, l) => a + l.qty, 0);
  near(a272, 1 + 2.5, 1e-9); // appendix per course + a framework per new expert
  assert.equal(design.find((l) => l.leaf === "A271").qty, 1);
  assert.equal(design.find((l) => l.leaf === "A28").role, "Пул экспертов — амбассадор");
  assert.ok(computeProduct(model, "видеоподкаст", U).total.fullPayroll > 0);
});

test("2661: rates.yaml review follow-ups — contact types hold only types; tools carry sources with a publisher", () => {
  const dc = inputs.rates.doctor_contacts;
  for (const [key, type] of Object.entries(dc.contact_types))
    assert.ok(type.weight != null, `contact_types.${key} is not a contact type`);
  const t = inputs.rates.tools;
  const entries = [
    t.fx,
    t.payment_markup,
    ...t.opex_monthly,
    ...t.opex_one_off,
    ...t.platform_ds_monthly,
    ...t.capex,
  ];
  for (const e of entries) {
    assert.ok(Array.isArray(e.sources) && e.sources.length, JSON.stringify(e).slice(0, 80));
    for (const s of e.sources) assert.ok(s.publisher && s.url, JSON.stringify(s));
  }
});

// ── Legacy mechanics on the new axes ──

test("roleHourlyCost: circle = FTE-weighted member rates; proxy roles; lower-bound pool flag", () => {
  const team = roleHourlyCost(model, "Продуктовая команда", U).value;
  const expected =
    model.teamRoles.reduce(
      (a, t) =>
        a +
        (Array.isArray(t.fte) ? mid(t.fte) : t.fte) *
          roleHourlyCost(model, t.role, U).value,
      0,
    ) /
    model.teamRoles.reduce((a, t) => a + (Array.isArray(t.fte) ? mid(t.fte) : t.fte), 0);
  near(team, expected, 1e-6);
  assert.equal(
    roleHourlyCost(model, "Медиа-круг — голос", U).value,
    roleHourlyCost(model, "Медиа-круг — монтажёр", U).value,
  );
  assert.deepEqual(roleHourlyCost(model, "Медиа-круг — голос", U).flags, [
    "ставка взята по роли «Медиа-круг — монтажёр»",
  ]);
  const reviewer = roleHourlyCost(model, "Пул медрецензентов", at("usual", "senior"));
  assert.equal(reviewer.value, 900);
  assert.ok(
    reviewer.flags.includes(
      "ставка взята по нижней границе рынка — верхняя и, вероятно, средняя оценка занижены",
    ),
  );
});

test("periodPlan: default = one direction team at capacity on the course mix; pool ∝ direct hours", () => {
  const plan = periodPlan(model, U);
  assert.equal(plan.bottleneck, "Медредактор-сценарист");
  assert.ok(plan.units["урок"] > 4 && plan.units["урок"] < 4.44);
  near(plan.units["урок"], plan.units["эпизод подкаста"]);
  assert.ok(plan.poolCost > 0 && plan.directHours > 0);
  near(plan.overheadPerDirectHour, plan.poolCost / plan.directHours, 1e-9);
  assert.ok(plan.poolLines.some((line) => line.leaf === "A641"));
  assert.ok(plan.poolLines.some((line) => line.leaf === "A42"));
  assert.ok(!plan.poolLines.some((line) => line.leaf === "A312"));
});

test("unitCost: overrides change exactly the targeted figures", () => {
  const base = productHours(model, "урок", U).directByRole;
  const edited = productHours(
    buildModel(inputs, { "leaf:A3142": [10, 10] }),
    "урок",
    U,
  ).directByRole;
  for (const role of Object.keys(base))
    if (role === "Медиа-круг — дизайнер схем") near(edited[role], 10);
    else near(edited[role], base[role], 1e-9);
  const rated = buildModel(inputs, { "rate:Аккаунт:monthly": 240000 });
  near(roleHourlyCost(rated, "Аккаунт", U).value, staffFull(240000), 1e-9);
  const graded = buildModel(inputs, { "rate:Аккаунт:monthly:senior": 230000 });
  near(roleHourlyCost(graded, "Аккаунт", at("usual", "senior")).value, staffFull(230000), 1e-9);
  near(
    roleHourlyCost(graded, "Аккаунт", MID).value,
    roleHourlyCost(model, "Аккаунт", MID).value,
    1e-9,
  );
  const fte = buildModel(inputs, { "fte:Медредактор-сценарист": 3 });
  assert.equal(Math.round(teamCapacity(fte, "урок", U).perMonth * 10) / 10, 5.3);
  const rounds = buildModel(inputs, { "loop:круги медрецензии до «зелёного»": 3 });
  assert.equal(loopRounds(rounds, "итерации сценария до «зелёного»", U), 4);
  const reserve = buildModel(inputs, { "var:signals_per_unit": 0 });
  assert.ok(unitCost(reserve, "урок", U).reserve.cost < unitCost(model, "урок", U).reserve.cost);
  assert.throws(() => buildModel(inputs, { "fte:Медредактор": 3 }), /unknown role/);
  const joined = buildModel(inputs, { "fte:Медиа-круг — монтажёр": 1 });
  assert.ok(joined.teamRoles.some((m) => m.role === "Медиа-круг — монтажёр"));
});

test("unitCost: module = 6 × lesson + club + its deal share", () => {
  for (const c of ["smooth", "usual", "rework"]) {
    const [module, lesson, club, deal] = ["модуль", "урок", "клуб", "сделка"].map((p) =>
      unitCost(model, p, at(c)),
    );
    near(module.direct.hours, 6 * lesson.direct.hours + club.direct.hours + deal.direct.hours, 1e-6);
    near(module.direct.cost, 6 * lesson.direct.cost + club.direct.cost + deal.direct.cost, 1e-6);
    near(module.reserve.cost, 6 * lesson.reserve.cost, 1e-6);
    const qty = Object.fromEntries(module.units.map((u) => [u.path.join(" → "), u.qty]));
    assert.equal(qty["модуль"], 1);
    assert.equal(qty["модуль → урок"], 6);
    assert.equal(qty["модуль → клуб"], 1);
    for (const t of ["byLoad", "fullPayroll"])
      near(module.total[t], 6 * lesson.total[t] + club.total[t] + deal.total[t], 1e-6);
  }
});

test("unitCost: update reserve per lesson follows the В6 formula", () => {
  const lesson = unitCost(model, "урок", U);
  const lineHours = productHours(model, "урок", U)
    .lines.filter((line) => line.class === "direct" && A31.test(line.leaf))
    .reduce((sum, line) => sum + line.hours, 0);
  near(lesson.reserve.hours, 0.125 * 1.25 + 0.2 * (1 + 0.75 + 0.2 * lineHours), 1e-9);
});

test("unitCost: both totals — «по загрузке» and «с полным фондом оплаты» with an idle trail line", () => {
  const lesson = unitCost(model, "урок", U);
  const plan = periodPlan(model, U);
  near(lesson.idle.cost, lesson.direct.hours * plan.idle.perDirectHour, 1e-6);
  near(lesson.total.fullPayroll, lesson.total.byLoad + lesson.idle.cost, 1e-6);
  const line = lesson.trail.find((l) => l.class === "idle");
  assert.equal(line.name, IDLE_LINE);
  near(line.cost, lesson.idle.cost, 1e-6);
});

test("computeProduct: smooth ≤ usual ≤ rework, junior ≤ senior, a trail from unit to leaf to role", () => {
  const total = (c) => computeProduct(model, "курс", c).total.fullPayroll;
  assert.ok(total(at("smooth")) <= total(at("usual")) && total(at("usual")) <= total(at("rework")));
  assert.ok(total(at("usual", "junior")) <= total(at("usual", "senior")));
  const out = computeProduct(model, "курс", U);
  const line = out.trail.find((l) => l.leaf === "A312");
  assert.deepEqual(line.path, ["курс", "урок", "A312"]);
  assert.equal(line.role, "Медредактор-сценарист");
  assert.equal(line.qty, 18);
  assert.ok(out.capacity.perMonth > 0);
  assert.ok(out.leadDays > 0);
  assert.ok(out.price.price > out.total.fullPayroll);
  assert.ok(out.market.mid > 0);
});

test("periodPlan: idle штат capacity per team role = FTE × P × teams − non-production − loaded hours", () => {
  const plan = periodPlan(model, U);
  const editor = plan.idle.byRole.find((r) => r.role === "Медредактор-сценарист");
  near(editor.idleHours, 0, 1e-6);
  const account = plan.idle.byRole.find((r) => r.role === "Аккаунт");
  near(account.idleHours, account.fte * P * account.teams - account.nonProduction - account.loaded, 1e-9);
  assert.ok(account.idleHours > 50);
  near(account.idleCost, account.idleHours * roleHourlyCost(model, "Аккаунт", U).value, 1e-6);
  near(plan.idle.cost, plan.idle.byRole.reduce((a, r) => a + r.idleCost, 0), 1e-6);
  near(plan.idle.perDirectHour, plan.idle.cost / plan.directHours, 1e-9);
});

/** Σ over the plan's sold units of a unit-cost part, per month. */
const planSum = (m, c, part) =>
  Object.entries(periodPlan(m, c).sold).reduce(
    (acc, [name, n]) => acc + n * part(unitCost(m, name, c)),
    0,
  );

const reconcile = (m, c, { freelanceCircle = false } = {}) => {
  const plan = periodPlan(m, c);
  const team = new Set(plan.idle.byRole.map((r) => r.role));
  team.add("Продуктовая команда");
  const payroll = plan.idle.byRole.reduce((a, r) => a + r.payroll, 0);
  const contracted = plan.idle.byRole.reduce((a, r) => a + r.contractorCost, 0);
  // A freelance member of the circle is paid per hour for its share of circle hours: that money
  // is the circle lines' contractors article, outside every штат payroll. Only for a model whose
  // circle has no media_external_share: a штат member's external share is already in contractorCost.
  const circleContractors = (l) =>
    freelanceCircle && l.role === "Продуктовая команда" ? (l.byArticle?.contractors ?? 0) : 0;
  let otherDirect = 0;
  let circleFreelance = 0;
  for (const [name, n] of Object.entries(plan.sold))
    for (const l of unitCost(m, name, c).trail) {
      if (l.class !== "direct") continue;
      if (!team.has(l.role)) otherDirect += n * (l.cost ?? 0);
      else circleFreelance += n * circleContractors(l);
    }
  let otherPool = 0;
  for (const l of plan.poolLines)
    if (!team.has(l.role)) otherPool += l.cost ?? 0;
    else circleFreelance += circleContractors(l);
  const full = planSum(m, c, (u) => u.direct.cost + u.overhead.cost + u.idle.cost + u.tools.cost);
  near(
    full,
    payroll + contracted + circleFreelance + otherDirect + otherPool + plan.tools.total,
    1e-3,
  );
  return plan;
};

test("reconciliation: Σ units of the plan = штат payroll + other roles' direct cost and pool + tools pool", () => {
  for (const c of ["smooth", "usual", "rework"])
    for (const g of ["junior", "mix", "senior"]) {
      const plan = reconcile(model, at(c, g));
      const byLoad = planSum(model, at(c, g), (u) => u.direct.cost + u.overhead.cost + u.tools.cost);
      const full = planSum(model, at(c, g), (u) => u.direct.cost + u.overhead.cost + u.tools.cost + u.idle.cost);
      near(byLoad, full - plan.idle.cost, 1e-3);
    }
});

test("reconciliation at media_external_share 0,5: idle and payroll at the штат rate, contractor share per loaded hour", () => {
  const m = buildModel(inputs, { "var:media_external_share": 0.5 });
  for (const c of ["smooth", "usual", "rework"]) {
    const plan = reconcile(m, at(c));
    const host = plan.idle.byRole.find((r) => r.role === "Медиа-круг — медиа-ведущий");
    assert.ok(host.ownHourlyCost < roleHourlyCost(m, "Медиа-круг — медиа-ведущий", at(c)).value);
    near(host.payroll, host.paidHours * host.ownHourlyCost, 1e-6);
    near(host.contractorHours, 0.5 * host.loaded, 1e-9);
    // non-production hours of the circle are штат time at the штат rate
    const circle = plan.poolLines.find(
      (l) => l.source === "период" && l.role === "Продуктовая команда",
    );
    assert.ok(circle.hourlyCost < roleHourlyCost(m, "Продуктовая команда", at(c)).value);
  }
});

test("reconciliation with a freelance team role: its hours are contractor cost, never payroll", () => {
  reconcile(buildModel(inputs, { "engage:Методолог": "gph" }), U, { freelanceCircle: true });
});

test("урок: A3132 (lawyer, ad section) only on the sponsored share of lessons", () => {
  const none = buildModel(inputs, { "param:урок:доля_спонсорских": 0 });
  assert.equal(productHours(none, "урок", U).overheadByRole["Сервисный круг — юрист"] ?? 0, 0);
});

test("overrides: piece:<leaf> applies the contractor on-top of the role's engagement", () => {
  const leaf = "A3143";
  const cost = (o) =>
    unitCost(buildModel(inputs, { [`piece:${leaf}`]: 1000, ...o }), "урок", U).trail.find(
      (l) => l.leaf === leaf,
    );
  const base = cost({ "engage:Медиа-круг — медицинская визуализация": "npd" });
  const gph = cost({ "engage:Медиа-круг — медицинская визуализация": "gph" });
  near(gph.cost, base.cost * 1.3, 1e-6);
});
