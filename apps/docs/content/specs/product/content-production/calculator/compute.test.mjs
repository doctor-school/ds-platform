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
  placementDirectory,
  offlineEvent,
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

test("productHours: lesson direct hours of line A31 = 77,5–155,5 per pass (effort-draft-ru.md)", () => {
  const onePass = buildModel(inputs, allRoundsOne);
  const a31 = (m, c) =>
    productHours(m, "урок", c)
      .lines.filter((line) => line.class === "direct" && A31.test(line.leaf))
      .reduce((sum, line) => sum + line.hours, 0);
  near(a31(onePass, at("smooth")), 77.5);
  near(a31(onePass, at("usual")), 116.25);
  near(a31(onePass, at("rework")), 155.5);
  for (const line of productHours(model, "урок", U).lines)
    near(line.hours, line.hoursPerPass * line.rounds * line.qty);
});

test("productHours: Медредактор-сценарист on a lesson = 81,75 h at «обычно» (capacity-ru.md)", () => {
  const { directByRole } = productHours(model, "урок", U);
  near(directByRole["Медредактор-сценарист"], 81.75);
  near(directByRole["Медиа-круг — монтажёр"], 29.5);
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

test("leadTime: lesson 91,25, episode ≈ 19, webinar 34,5, course design 61 working days", () => {
  near(leadTime(model, "урок", U), 91.25);
  near(leadTime(model, "эпизод подкаста", U), 19.25);
  near(leadTime(model, "вебинар", U), 34.5);
  near(leadTime(model, "проектирование курса", U), 61);
  const takt = 21 / teamCapacity(model, "урок", U).perMonth;
  near(leadTime(model, "модуль", U), 91.25 + 5 * takt);
  near(leadTime(model, "курс", U), 61 + 91.25 + 17 * takt);
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
    mid(g["лидер мнений"].per_hour_rub),
    1e-9,
  );
  near(
    roleHourlyCost(model, "Пул экспертов — эксперт", U).value,
    mid(g["к.м.н."].per_hour_rub),
    1e-9,
  );
  const kol = buildModel(inputs, { "var:expert_grade_author": "д.м.н." });
  near(
    roleHourlyCost(kol, "Пул экспертов — амбассадор", U).value,
    mid(g["д.м.н."].per_hour_rub),
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
  for (const leaf of ["A3241", "A3251"]) assert.ok(leaves.includes(leaf), leaf);
  const u = unitCost(m, "видеоподкаст", U);
  assert.ok(!u.externals.some((e) => e.id === "podcast_studio"));
  const bare = u.externals.find((e) => e.id === "podcast_studio_bare");
  near(bare.rub, mid(inputs.rates.external_costs.podcast_studio.market_rub), 1e-9);
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

test("2661-5: видеоподкаст «подрядчик» — the contractor director replaces the own director's hours A3243", () => {
  const m = buildModel(inputs, VP_CONTRACTOR);
  const lines = productHours(m, "видеоподкаст", U).lines;
  assert.ok(!lines.some((l) => l.leaf === "A3243"), "A3243 is priced twice");
  // the bare studio still rents for the shoot hours of A3243
  const shoot = productHours(model, "видеоподкаст", U).lines.find((l) => l.leaf === "A3243");
  const bare = unitCost(m, "видеоподкаст", U).externals.find((e) => e.id === "podcast_studio_bare");
  near(bare.qty, shoot.hours, 1e-9);
});

test("2661-11: scale:externals multiplies every external rate and sum, the extended campaign included", () => {
  const base = { "var:extended_campaign": true, "var:campaign_cost_per_contact": 100 };
  const one = unitCost(buildModel(inputs, base), "видеоподкаст", U);
  const two = unitCost(buildModel(inputs, { ...base, "scale:externals": 2 }), "видеоподкаст", U);
  assert.ok(one.externalCost > 0);
  near(two.externalCost, 2 * one.externalCost, 1e-6);
  near(two.total.byLoad - one.total.byLoad, one.externalCost, 1e-6);
  for (const e of one.externals) {
    const scaled = two.externals.find((x) => x.id === e.id);
    near(scaled.rub, 2 * e.rub, 1e-9);
    near(scaled.cost, 2 * e.cost, 1e-6);
  }
  near(two.articles.externals, 2 * one.articles.externals, 1e-6);
  const driver = sensitivity(model, "видеоподкаст", U).drivers.find((d) => d.id === "scale:externals");
  assert.ok(driver.high.cost > driver.low.cost);
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
  const lesson = unitCost(buildModel(inputs, { "var:extended_campaign": true }), "урок", U);
  const line = lesson.trail.find((l) => l.leaf === "A47");
  assert.equal(line.class, "pending");
  assert.equal(line.cost, null);
  assert.equal(line.name, PENDING_LINE);
  assert.ok(lesson.flags.some((f) => f.startsWith(PENDING_LINE) && f.includes("A47")));
  assert.ok(!unitCost(model, "вебинар", U).trail.some((l) => l.class === "pending"));
});

test("3068-5: A338 of the practical school is costed per participant (rates.yaml offline_events.school)", () => {
  const school = unitCost(model, "практическая школа", U);
  assert.ok(!school.trail.some((l) => l.class === "pending"));
  assert.ok(!school.flags.some((f) => f.includes("A338")));
  const line = school.externals.find((e) => e.id === "offline_school_participant");
  near(line.rub, mid(inputs.rates.offline_events.school.per_participant_rub), 1e-9);
  near(line.qty, mid(inputs.products.products["практическая школа"].parameters.участники.draft), 1e-9);
  near(line.cost, line.rub * line.qty, 1e-6);
  assert.equal(line.status, "задано");
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
  // per-team subscriptions scale with the number of direction teams
  const perTeam = t.opex_monthly
    .filter((o) => o.per === "team")
    .reduce((a, o) => a + o.rub_month * (o.usd ? 1 + markup : 1), 0);
  assert.ok(perTeam > 0);
  const two = toolsPool(buildModel(inputs, { "var:teams": 2, "var:tool_seats": seats }), U);
  near(two.byGroup.subscriptions - pool.byGroup.subscriptions, perTeam, 1e-6);
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

// ── 2661-8 / 3068 Price engine: placements, advance, distribution ──

const pv = inputs.products.variables;
const dir = inputs.products.placements;
const rampHour = (m, c = U) =>
  roleHourlyCost(m, "Медиа-круг — монтажёр", c).value;

test("3068-7: placement directory — five categories, owner weights, modes, tier, replacement hours", () => {
  const ids = placementDirectory(model).map((p) => p.id);
  assert.deepEqual(ids, Object.keys(dir));
  const categories = new Set(placementDirectory(model).map((p) => p.category));
  assert.equal(categories.size, 5);
  const w = Object.fromEntries(placementDirectory(model).map((p) => [p.id, p.weight]));
  assert.deepEqual(
    [w.background, w.close_up, w.plot_branch, w.science_inn, w.extra_star, w.extra_download, w.extra_webinar_block],
    [0.3, 0.6, 1.0, 0.5, 0.8, 0.4, 1.0],
  );
  for (const p of placementDirectory(model)) {
    for (const f of ["id", "name", "category", "examples", "modes", "tier", "weight", "creationShare", "replacementHours", "adLabel"])
      assert.ok(p[f] != null, `${p.id}.${f}`);
    assert.ok(p.modes.every((m) => m === "fixed" || m === "dynamic"));
    assert.ok(["anchor", "niche", "both"].includes(p.tier));
  }
  assert.deepEqual(dir.science_inn.modes, ["fixed"]);
  // the directory is editable through overrides like any other variable
  const edited = buildModel(inputs, { "placement:close_up:weight": 0.9 });
  assert.equal(placementDirectory(edited).find((p) => p.id === "close_up").weight, 0.9);
  assert.throws(() => buildModel(inputs, { "placement:nope:weight": 1 }), /placement/);
});

test("3068-1: offer — fixed placement = its creation share × leading price factor; dynamic = contact price × weight", () => {
  const p = priceProduct(model, "урок", U);
  near(p.derived.multiplier, 1.3, 1e-9);
  near(p.derived.markup, 0.3, 1e-9);
  const offerIds = pv.placement_offer.draft.map((o) => o.placement);
  assert.deepEqual(p.offer.map((l) => l.placement), offerIds);
  const science = p.offer.find((l) => l.placement === "science_inn");
  assert.equal(science.mode, "fixed");
  near(science.creationCost, dir.science_inn.creation_share * p.cost, 1e-6);
  near(science.fixedSum, science.creationCost * 1.3, 1e-6);
  assert.equal(science.rubPerContact, null);
  near(p.fixedSum, science.fixedSum, 1e-6);
  const branch = p.offer.find((l) => l.placement === "plot_branch");
  assert.equal(branch.fixedSum, null);
  near(branch.rubPerContact, p.pricePerContact.value * 1.0, 1e-9);
  const close = p.offer.find((l) => l.placement === "close_up");
  near(close.rubPerContact, p.pricePerContact.value * 0.6, 1e-9);
  near(p.rubPerContact, p.pricePerContact.value * 1.6, 1e-9);
  // a margin leading mode changes the factor of fixed sums
  const margin = priceProduct(
    buildModel(inputs, { "var:price_mode": "margin", "var:price_value": 0.25 }),
    "урок",
    U,
  );
  near(margin.offer.find((l) => l.placement === "science_inn").fixedSum, dir.science_inn.creation_share * margin.cost / 0.75, 1e-6);
  const own = priceProduct(buildModel(inputs, { "price:урок:multiplier": 2 }), "урок", U);
  assert.equal(own.mode, "multiplier");
  near(own.fixedSum, dir.science_inn.creation_share * own.cost * 2, 1e-6);
  // a mode the directory does not allow, or an unknown placement, is refused
  assert.throws(
    () => priceProduct(buildModel(inputs, { "var:placement_offer": [{ placement: "science_inn", mode: "dynamic" }] }), "урок", U),
    /science_inn/,
  );
  assert.throws(
    () => priceProduct(buildModel(inputs, { "var:placement_offer": [{ placement: "nope", mode: "fixed" }] }), "урок", U),
    /nope/,
  );
});

test("3068-2: advance = Σ fixed placements + advance share × mandatory part; investor contribution and contacts to recover it", () => {
  const u = unitCost(model, "урок", U);
  const p = priceProduct(model, "урок", U);
  const a = u.articles;
  near(p.mandatory.total, a.payroll + a.contractors + a.experts + a.externals, 1e-6);
  assert.equal(p.advanceShare, pv.advance_share.draft);
  near(p.advance, p.fixedSum, 1e-6);
  near(p.investorContribution, Math.max(0, p.totalCost - p.advance), 1e-6);
  near(p.investorRecoverContacts, p.breakEvenContacts, 1e-9);
  const half = priceProduct(buildModel(inputs, { "var:advance_share": 0.5 }), "урок", U);
  near(half.advance, half.fixedSum + 0.5 * half.mandatory.total, 1e-6);
  assert.ok(half.investorContribution < p.investorContribution);
  const full = priceProduct(
    buildModel(inputs, { "var:advance_share": 1, "var:placement_offer": [{ placement: "plot_branch", mode: "fixed" }, { placement: "close_up", mode: "fixed" }] }),
    "урок",
    U,
  );
  // tools are not a mandatory part: the investor still funds them unless fixed sums cover them
  near(full.investorContribution, Math.max(0, full.totalCost - full.advance), 1e-6);
  // a product without a contact type is paid by the advance only
  const deal = priceProduct(model, "сделка", U);
  assert.equal(deal.pricePerContact.value, null);
  assert.equal(deal.outcomes.plan.gross, 0);
});

test("3068-3: gross contact revenue → DS fund → lesson P&L → payback → 4/2/1 (+d) with 5 % royalty", () => {
  const p = priceProduct(model, "урок", U);
  const [lo, plan, hi] = pv.contacts.draft;
  for (const [level, contacts] of [["low", lo], ["plan", plan], ["high", hi]]) {
    const o = p.outcomes[level];
    assert.equal(o.contacts, contacts);
    near(o.gross, contacts * p.rubPerContact, 1e-6);
    near(o.dsFund, o.gross * pv.ds_fund_share.draft, 1e-6);
    near(o.net, o.gross - o.dsFund, 1e-6);
    near(o.revenue, p.advance + o.net, 1e-6);
    near(o.margin, o.revenue - p.totalCost, 1e-6);
    near(o.payback, Math.min(p.investorContribution, o.net), 1e-6);
    near(o.profit, Math.max(0, o.margin), 1e-6);
    const P = o.profit;
    const R = 0.05 * P;
    const x = (P - R) / 7;
    near(o.royalty, R, 1e-6);
    near(o.x, x, 1e-9);
    near(o.shares.investors, 4 * x, 1e-6);
    near(o.shares.investorReturn, 4 * x * 0.25, 1e-6);
    near(o.shares.bbmDevelopment, 4 * x * 0.75, 1e-6);
    near(o.shares.author, 2 * x + R, 1e-6);
    near(o.shares.pool, x, 1e-6);
    near(o.shares.bbm, 0, 1e-9);
    near(o.shares.investors + o.shares.author + o.shares.pool + o.shares.bbm, P, 1e-6);
  }
  // price at plan = what the partner pays at plan contacts
  near(p.price, p.advance + p.outcomes.plan.gross, 1e-6);
  // d = 1 takes a share for BBM
  const d = priceProduct(buildModel(inputs, { "var:share_bbm": 1, "var:contacts": [1e5, 2e5, 3e5] }), "урок", U);
  const o = d.outcomes.plan;
  assert.ok(o.profit > 0);
  near(o.shares.bbm, (o.profit * 0.95) / 8, 1e-6);
  // break-even: advance + net ≥ total cost
  const be = p.breakEvenContacts;
  near(p.advance + be * p.rubPerContact * (1 - pv.ds_fund_share.draft), p.totalCost, 1e-3);
});

test("3068-4: placement replacement — media-circle hours × 2 per term inside the dynamic placement cost, never billed", () => {
  const p = priceProduct(model, "урок", U);
  const hour = rampHour(model);
  let total = 0;
  for (const l of p.offer) {
    if (l.mode !== "dynamic") {
      assert.equal(l.replacementTotal, 0);
      continue;
    }
    const hours = mid(dir[l.placement].replacement_hours);
    near(l.replacementCost, hours * hour, 1e-6);
    assert.equal(l.replacements, 2);
    near(l.replacementTotal, 2 * l.replacementCost, 1e-6);
    assert.equal(l.replacementFlag, l.replacementCost > l.creationCost);
    total += l.replacementTotal;
  }
  near(p.replacementCost, total, 1e-6);
  near(p.totalCost, p.cost + total, 1e-6);
  // a switch re-generates every lesson episode of the product: a course = 18 lessons
  const course = priceProduct(model, "курс", U);
  assert.equal(course.episodes, 18);
  near(course.replacementCost, 18 * p.replacementCost, 1e-6);
  const cb = course.offer.find((l) => l.placement === "plot_branch");
  assert.equal(cb.replacementFlag, 18 * cb.replacementCost > cb.creationCost);
  assert.equal(priceProduct(model, "вебинар", U).episodes, 1);
  // not billed: the partner's price is unchanged by the replacement cost
  const pricey = priceProduct(buildModel(inputs, { "placement:plot_branch:replacement_hours": [100, 100] }), "урок", U);
  near(pricey.outcomes.plan.gross, p.outcomes.plan.gross, 1e-6);
  const branch = pricey.offer.find((l) => l.placement === "plot_branch");
  assert.equal(branch.replacementFlag, true);
  assert.ok(pricey.flags.some((f) => f.includes("plot_branch") || f.includes(dir.plot_branch.name)));
});

test("3068-5: offline event from the DS fund — seats = min(group, fund ÷ cost), held at the minimum group, queue", () => {
  const school = inputs.rates.offline_events.school;
  const cost = mid(school.per_participant_rub);
  const conv = inputs.rates.offline_events.conversion_online_to_offline;
  const ev = offlineEvent(model, 1.3e6, 100, U);
  assert.equal(ev.format, "school");
  near(ev.costPerParticipant, cost, 1e-9);
  assert.equal(ev.seats, Math.min(school.group[1], Math.floor(1.3e6 / cost)));
  assert.equal(ev.held, true);
  assert.equal(ev.held, ev.seats >= school.group[0]);
  near(ev.demand, 100 * conv, 1e-9);
  near(ev.queue, Math.max(0, ev.demand - ev.seats), 1e-9);
  near(ev.fundToClearQueue, ev.queue * cost, 1e-6);
  // below the minimum group the event is not held and has no seats
  const small = offlineEvent(model, cost * (school.group[0] - 1), 100, U);
  assert.equal(small.held, false);
  assert.equal(small.seats, 0);
  assert.equal(small.affordable, school.group[0] - 1);
  near(small.fundForMinGroup, school.group[0] * cost, 1e-6);
  // a large fund is capped by the group
  assert.equal(offlineEvent(model, 1e9, 100, U).seats, school.group[1]);
  // cadaver course — group per specimen × specimens
  const cad = inputs.rates.offline_events.cadaver;
  const c = offlineEvent(buildModel(inputs, { "var:offline_format": "cadaver" }), 1e9, 100, U);
  assert.equal(c.seats, cad.group[1] * cad.specimens);
  // course axis moves the per-participant cost to the range ends
  near(offlineEvent(model, 1e6, 100, at("smooth")).costPerParticipant, school.per_participant_rub[0], 1e-9);
  // the price outcome carries the event funded by its DS fund
  const p = priceProduct(model, "урок", U);
  const o = p.outcomes.plan;
  near(o.offline.fund, o.dsFund, 1e-6);
  near(o.offline.demand, o.contacts * conv, 1e-9);
});

test("3068-6: hard partner limit — contacts above it are not billed; the placement switches at a contact count", () => {
  const p = priceProduct(model, "урок", U);
  const branch = p.offer.find((l) => l.placement === "plot_branch");
  const cap = branch.rubPerContact * 500;
  const capped = priceProduct(buildModel(inputs, { "var:budget_cap": cap }), "урок", U);
  const b = capped.offer.find((l) => l.placement === "plot_branch");
  near(b.switchContacts, 500, 1e-9);
  const o = capped.outcomes.plan; // 1 000 contacts
  near(o.billed.plot_branch, cap, 1e-6);
  near(o.unbilledContacts.plot_branch, pv.contacts.draft[1] - 500, 1e-9);
  const close = capped.offer.find((l) => l.placement === "close_up");
  near(o.billed.close_up, Math.min(cap, close.rubPerContact * pv.contacts.draft[1]), 1e-6);
  near(o.gross, o.billed.plot_branch + o.billed.close_up, 1e-6);
  assert.equal(capped.budgetCap.value, cap);
  near(capped.budgetCap.switchContacts, Math.min(b.switchContacts, close.switchContacts), 1e-9);
  // the cap is always hard: the old tier options are gone
  for (const gone of ["budget_cap_mode", "budget_tier_discount", "author_share"]) {
    assert.ok(!(gone in pv), gone);
    assert.throws(() => buildModel(inputs, { [`var:${gone}`]: 1 }), /unknown variable/);
  }
  // break-even under a cap that never covers the cost is unreachable
  const tiny = priceProduct(buildModel(inputs, { "var:budget_cap": 1 }), "урок", U);
  assert.equal(tiny.breakEvenContacts, null);
});

test("3068-8: billing per quarter by default; author grade defaults to «лидер мнений»", () => {
  const p = priceProduct(model, "курс", U);
  assert.equal(p.billing.period, "quarter");
  assert.equal(p.billing.invoices, 1); // one quarter term, billed after the quarter
  near(p.billing.perInvoice, p.outcomes.plan.gross, 1e-6);
  const monthly = priceProduct(
    buildModel(inputs, { "var:billing_period": "month", "var:placement_term_quarters": 2 }),
    "курс",
    U,
  );
  assert.equal(monthly.billing.invoices, 6);
  near(monthly.billing.perInvoice, monthly.outcomes.plan.gross / 6, 1e-6);
  assert.equal(pv.expert_grade_author.draft, "лидер мнений");
  assert.equal(roleHourlyCost(model, "Пул экспертов — амбассадор", U).expertGrade, "лидер мнений");
});

test("3068-9: markup, margin and multiplier of the plan come from the same outcome as price and profit", () => {
  for (const product of ["урок", "курс"]) {
    const p = priceProduct(model, product, U);
    const o = p.outcomes.plan;
    // price = total cost with replacements + DS fund + profit at the plan contacts
    const outlay = p.totalCost + o.dsFund;
    near(p.price, outlay + o.margin, 1e-6);
    near(p.ratios.outlay, outlay, 1e-6);
    near(p.ratios.markup, o.margin / outlay, 1e-12);
    near(p.ratios.margin, o.margin / p.price, 1e-12);
    near(p.ratios.multiplier, p.price / outlay, 1e-12);
    near(p.ratios.multiplier, 1 + p.ratios.markup, 1e-12);
    assert.equal(Math.sign(p.ratios.margin), Math.sign(o.margin), product);
    near(o.marginShare, p.ratios.margin, 1e-12); // the scenario table's «маржа» is the same ratio
    const lowO = p.outcomes.low;
    near(lowO.marginShare, lowO.margin / (p.advance + lowO.gross), 1e-12);
  }
  // the leading mode still sets only the fixed-placement factor, not the plan ratios
  const p = priceProduct(model, "урок", U);
  near(p.derived.multiplier, 1.3, 1e-9);
  assert.ok(Math.abs(p.ratios.markup - p.derived.markup) > 1e-3);
});

test("3068-10: golden floor = (S′ − f·advance) ÷ (1 − f) — the price at which the DS fund leaves zero margin", () => {
  for (const product of ["урок", "курс"]) {
    const p = priceProduct(model, product, U);
    const g = goldenPrice(model, product, U);
    const f = model.vars.ds_fund_share;
    assert.ok(f > 0 && f < 1);
    near(g.min, (p.totalCost - f * p.advance) / (1 - f), 1e-6);
    // at the floor, revenue = advance + (floor − advance) after the fund = total cost
    near(p.advance + (g.min - p.advance) * (1 - f), p.totalCost, 1e-6);
    assert.ok(g.min > p.totalCost, product);
  }
  // an advance above the total cost: the floor is the advance (price never falls below it)
  const rich = buildModel(inputs, {
    "var:advance_share": 1,
    "var:price_mode": "multiplier",
    "var:price_value": 20,
  });
  const pr = priceProduct(rich, "урок", U);
  assert.ok(pr.advance > pr.totalCost);
  near(goldenPrice(rich, "урок", U).min, pr.advance, 1e-6);
});

test("3068-11: a dynamic placement sits in every lesson of a compound product — billed contacts = doctors × lessons", () => {
  const lesson = priceProduct(model, "урок", U);
  assert.equal(lesson.lessons, 1);
  near(lesson.outcomes.plan.billedContacts, pv.contacts.draft[1], 1e-9);
  for (const [product, lessons] of [["модуль", 6], ["курс", 18], ["специальность", 72]]) {
    const p = priceProduct(model, product, U);
    assert.equal(p.lessons, lessons, product);
    // contact price by the lesson's contact type
    assert.equal(p.pricePerContact.type, "single_lesson_view", product);
    near(p.pricePerContact.value, lesson.pricePerContact.value, 1e-9);
    for (const l of p.offer.filter((x) => x.mode === "dynamic")) {
      const ll = lesson.offer.find((x) => x.placement === l.placement);
      near(l.rubPerContact, ll.rubPerContact, 1e-9);
      near(l.rubPerDoctor, lessons * l.rubPerContact, 1e-9);
    }
    near(p.rubPerDoctor, lessons * p.rubPerContact, 1e-9);
    for (const level of ["low", "plan", "high"]) {
      const o = p.outcomes[level];
      near(o.billedContacts, o.contacts * lessons, 1e-9);
      near(o.gross, lessons * lesson.outcomes[level].gross, 1e-6);
    }
    // fixed placements stay one-off sums per product
    const sci = p.offer.find((l) => l.placement === "science_inn");
    near(sci.fixedSum, dir.science_inn.creation_share * p.cost * p.derived.multiplier, 1e-6);
    assert.equal(sci.rubPerDoctor, null);
    // break-even in doctors: advance + net billing of doctors × lessons covers the total cost
    near(p.advance + p.breakEvenContacts * p.rubPerDoctor * (1 - pv.ds_fund_share.draft), p.totalCost, 1e-3);
  }
  const course = priceProduct(model, "курс", U);
  // podcast episodes, webinars and clubs keep their own contact type, one contact per participant
  for (const [product, type] of [["эпизод подкаста", "podcast_live"], ["вебинар", "webinar_live"], ["клуб", "webinar_live"]]) {
    const p = priceProduct(model, product, U);
    assert.equal(p.lessons, 1, product);
    assert.equal(p.pricePerContact.type, type, product);
    near(p.outcomes.plan.gross, pv.contacts.draft[1] * p.rubPerContact, 1e-6);
  }
  // the partner limit per placement per term applies to the summed billing of all lessons
  const branch = course.offer.find((l) => l.placement === "plot_branch");
  const cap = branch.rubPerDoctor * 500;
  const capped = priceProduct(buildModel(inputs, { "var:budget_cap": cap }), "курс", U);
  const b = capped.offer.find((l) => l.placement === "plot_branch");
  near(b.switchContacts, 500, 1e-9);
  near(capped.outcomes.plan.billed.plot_branch, cap, 1e-6);
  near(capped.outcomes.plan.unbilledContacts.plot_branch, pv.contacts.draft[1] - 500, 1e-9);
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

test("2661-10: break-even series — contacts → gross, lesson P&L revenue (after the DS fund) vs total cost", () => {
  const p = priceProduct(model, "курс", U);
  const series = breakEvenSeries(model, "курс", U, 11);
  assert.equal(series.length, 11);
  assert.equal(series[0].contacts, 0);
  near(series[0].revenue, p.advance, 1e-6);
  for (const pt of series) {
    near(pt.cost, p.totalCost, 1e-9);
    // doctors × 18 lessons × ₽ per contact
    near(pt.gross, pt.contacts * p.rubPerDoctor, 1e-6);
    near(pt.revenue, p.advance + pt.gross * (1 - pv.ds_fund_share.draft), 1e-6);
  }
  near(p.rubPerDoctor, 18 * p.rubPerContact, 1e-9);
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
  // a regional gross is held against the region's own market floor, not Moscow's
  assert.deepEqual(budgetFit(buildModel(inputs, { "var:region": "russia_remote" }), U).below, []);
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
  const course = priceProduct(model, "курс", U);
  const f = model.vars.ds_fund_share;
  near(g.min, (course.totalCost - f * course.advance) / (1 - f), 1e-6);
  assert.equal(g.max, inputs.rates.market_references["курс"].rub[1]);
  const cap = g.min * 2;
  const capped = goldenPrice(buildModel(inputs, { "var:budget_cap": cap }), "курс", U);
  const pc = priceProduct(buildModel(inputs, { "var:budget_cap": cap }), "курс", U);
  near(capped.max, Math.min(pc.advance + 2 * cap, g.max), 1e-6);
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
  assert.ok(out.price.totalCost >= out.total.fullPayroll);
  assert.ok(out.price.price > 0);
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
