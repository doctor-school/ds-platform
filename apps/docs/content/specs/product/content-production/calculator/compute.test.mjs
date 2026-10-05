// Calculator core checks against the worked figures of ../model/capacity-ru.md and
// ../model/effort-draft-ru.md. Run from the repo root:
//   node --test apps/docs/content/specs/product/content-production/calculator/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  loadInputs,
  buildModel,
  loopRounds,
  roleHourlyCost,
  productHours,
  teamCapacity,
  requiredFte,
  leadTime,
  periodPlan,
  unitCost,
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

test("loopRounds: script rounds derive from review and pharma stage 1 (rounds_from)", () => {
  const name = "итерации сценария до «зелёного»";
  assert.equal(loopRounds(model, name, "min"), 1);
  assert.equal(loopRounds(model, name, "mid"), 3);
  assert.equal(loopRounds(model, name, "max"), 5);
  assert.equal(loopRounds(model, "круги этапа 2 фармы", "mid"), 1.5);
  assert.equal(loopRounds(model, null, "mid"), 1);
});

test("productHours: lesson direct hours of line A31 = 77–152,5 per pass (effort-draft-ru.md)", () => {
  const onePass = buildModel(inputs, allRoundsOne);
  const a31 = (m, s) =>
    productHours(m, "урок", s)
      .lines.filter((line) => line.class === "direct" && A31.test(line.leaf))
      .reduce((sum, line) => sum + line.hours, 0);
  near(a31(onePass, "min"), 77);
  near(a31(onePass, "mid"), 114.75);
  near(a31(onePass, "max"), 152.5);
  // with rounds every line is hours per pass × rounds of its loop
  for (const line of productHours(model, "урок", "mid").lines)
    near(line.hours, line.hoursPerPass * line.rounds * line.qty);
});

test("productHours: Медредактор-сценарист on a lesson = 81,75 h at midpoints (capacity-ru.md)", () => {
  const { directByRole } = productHours(model, "урок", "mid");
  near(directByRole["Медредактор-сценарист"], 81.75);
  near(directByRole["Медиа-круг — монтажёр"], 28);
  near(directByRole["Аккаунт"], 5.875);
});

test("productHours: overhead leaves never land in direct hours", () => {
  const { overhead_role_prefixes: prefixes, overhead_units: units } =
    inputs.products.classification;
  for (const product of Object.keys(inputs.products.products))
    for (const line of productHours(model, product, "mid").lines) {
      const overhead =
        prefixes.some((p) => line.role.startsWith(p)) ||
        units.includes(line.unit);
      assert.equal(
        line.class,
        overhead ? "overhead" : "direct",
        `${product} ${line.leaf}`,
      );
    }
  const lesson = productHours(model, "урок", "mid");
  assert.equal(lesson.directByRole["Сервисный круг — юрист"], undefined);
  near(lesson.overheadByRole["Сервисный круг — юрист"], 1.25);
});

test("teamCapacity: 4,4 lessons a month, bottleneck Медредактор-сценарист (capacity-ru.md)", () => {
  const cap = teamCapacity(model, "урок", "mid");
  assert.equal(cap.bottleneck, "Медредактор-сценарист");
  assert.equal(Math.round(cap.perMonth * 10) / 10, 4.4);
  const editor = cap.roles.find((r) => r.role === "Медредактор-сценарист");
  near(editor.available, 2.5 * 145.7 - 0.9375);
  const expertManager = cap.roles.find((r) => r.role === "Менеджер эксперта");
  near(expertManager.available, 145.7 - 0.375 - 4);
});

test("requiredFte: one lesson a week needs ≈ 2,44 FTE Медредактор-сценарист", () => {
  const fte = requiredFte(model, "урок", "Медредактор-сценарист", 1, "mid");
  assert.equal(Math.round(fte * 100) / 100, 2.44);
});

test("leadTime: lesson 90,5, episode ≈ 19, webinar 34,5, course design 61 working days", () => {
  near(leadTime(model, "урок", "mid"), 90.5);
  near(leadTime(model, "эпизод подкаста", "mid"), 19.25);
  near(leadTime(model, "вебинар", "mid"), 34.5);
  near(leadTime(model, "проектирование курса", "mid"), 61);
  // module = first lesson + 5 × takt (21 days ÷ lesson capacity)
  const takt = 21 / teamCapacity(model, "урок", "mid").perMonth;
  near(leadTime(model, "модуль", "mid"), 90.5 + 5 * takt);
  near(leadTime(model, "курс", "mid"), 61 + 90.5 + 17 * takt);
});

test("roleHourlyCost: in-house = monthly × (1 + contributions) ÷ paid hours; contractor = hourly", () => {
  near(roleHourlyCost(model, "Аккаунт", "mid").value, (210000 * 1.302) / 145.7);
  near(roleHourlyCost(model, "Аккаунт", "min").value, (130000 * 1.302) / 145.7);
  near(roleHourlyCost(model, "Сервисный круг — бухгалтер", "mid").value, 750);
  // above the yearly contributions base the effective rate falls (rates.yaml variables)
  const consultant = roleHourlyCost(model, "Ядро — консультант рынка", "mid");
  assert.ok(consultant.value < (380000 * 1.302) / 145.7);
  // a pool rate with only a lower bound is that bound, flagged
  const reviewer = roleHourlyCost(model, "Пул медрецензентов", "max");
  assert.equal(reviewer.value, 900);
  assert.ok(reviewer.flags.includes("нижняя граница"));
  // composite circle = FTE-weighted member rates
  const team = roleHourlyCost(model, "Продуктовая команда", "mid").value;
  const lo = roleHourlyCost(model, "Медредактор-сценарист", "mid").value;
  const hi = roleHourlyCost(model, "Аккаунт", "mid").value;
  assert.ok(team > lo && team < hi);
  // proxy from rates.yaml proxy_role
  assert.equal(
    roleHourlyCost(model, "Медиа-круг — голос", "mid").value,
    roleHourlyCost(model, "Медиа-круг — монтажёр", "mid").value,
  );
});

test("periodPlan: default = one direction team at capacity on the course mix; pool ∝ direct hours", () => {
  const plan = periodPlan(model, "mid");
  assert.equal(plan.bottleneck, "Медредактор-сценарист");
  assert.ok(plan.units["урок"] > 4 && plan.units["урок"] < 4.44);
  near(plan.units["урок"], plan.units["эпизод подкаста"]);
  assert.ok(plan.poolCost > 0 && plan.directHours > 0);
  near(plan.overheadPerDirectHour, plan.poolCost / plan.directHours, 1e-9);
  // the pool contains the period leaves and the overhead lines of the plan's units
  assert.ok(plan.poolLines.some((line) => line.leaf === "A641"));
  assert.ok(plan.poolLines.some((line) => line.leaf === "A42"));
  assert.ok(!plan.poolLines.some((line) => line.leaf === "A312"));
});

test("unitCost: a null external cost never contributes to totals and is flagged «не задано»", () => {
  const lesson = unitCost(model, "урок", "mid");
  assert.ok(lesson.externals.length >= 2);
  for (const ext of lesson.externals) {
    assert.equal(ext.rub, null);
    assert.equal(ext.status, "не задано");
  }
  assert.ok(lesson.flags.includes("внешние затраты не заданы"));
  near(
    lesson.total,
    lesson.direct.cost + lesson.overhead.cost + lesson.reserve.cost,
    1e-6,
  );
  const withAi = unitCost(
    buildModel(inputs, { "external:ai_generation": 5000 }),
    "урок",
    "mid",
  );
  near(withAi.total - lesson.total, 5000, 1e-6);
});

test("unitCost: overrides change exactly the targeted figures", () => {
  const base = productHours(model, "урок", "mid").directByRole;
  const edited = productHours(
    buildModel(inputs, { "leaf:A3142": [10, 10] }),
    "урок",
    "mid",
  ).directByRole;
  for (const role of Object.keys(base))
    if (role === "Медиа-круг — дизайнер схем") near(edited[role], 10);
    else near(edited[role], base[role], 1e-9);
  const rated = buildModel(inputs, { "rate:Аккаунт:monthly": 240000 });
  near(roleHourlyCost(rated, "Аккаунт", "mid").value, (240000 * 1.302) / 145.7);
  near(
    roleHourlyCost(rated, "Продюсер", "mid").value,
    roleHourlyCost(model, "Продюсер", "mid").value,
    1e-9,
  );
  const fte = buildModel(inputs, { "fte:Медредактор-сценарист": 3 });
  assert.equal(
    Math.round(teamCapacity(fte, "урок", "mid").perMonth * 10) / 10,
    5.3,
  );
  const rounds = buildModel(inputs, {
    "loop:круги медрецензии до «зелёного»": 3,
  });
  assert.equal(loopRounds(rounds, "итерации сценария до «зелёного»", "mid"), 4);
  const reserve = buildModel(inputs, { "var:signals_per_unit": 0 });
  assert.ok(
    unitCost(reserve, "урок", "mid").reserve.cost <
      unitCost(model, "урок", "mid").reserve.cost,
  );
});

test("unitCost: module = 6 × lesson + club + its deal share", () => {
  for (const s of ["min", "mid", "max"]) {
    const [module, lesson, club, deal] = [
      "модуль",
      "урок",
      "клуб",
      "сделка",
    ].map((p) => unitCost(model, p, s));
    near(
      module.direct.hours,
      6 * lesson.direct.hours + club.direct.hours + deal.direct.hours,
      1e-6,
    );
    near(
      module.direct.cost,
      6 * lesson.direct.cost + club.direct.cost + deal.direct.cost,
      1e-6,
    );
    near(module.reserve.cost, 6 * lesson.reserve.cost, 1e-6);
    near(module.total, 6 * lesson.total + club.total + deal.total, 1e-6);
  }
});

test("unitCost: update reserve per lesson follows the В6 formula", () => {
  const s = "mid";
  const lesson = unitCost(model, "урок", s);
  const lineHours = productHours(model, "урок", s)
    .lines.filter((line) => line.class === "direct" && A31.test(line.leaf))
    .reduce((sum, line) => sum + line.hours, 0);
  // signals × A44 + affected × (A45 + A46 + rebuild × line hours)
  const expected = 0.125 * 1.25 + 0.2 * (1 + 0.75 + 0.2 * lineHours);
  near(lesson.reserve.hours, expected, 1e-9);
});

test("computeProduct: min ≤ mid ≤ max and a trail from unit to leaf to role", () => {
  const out = computeProduct(model, "курс");
  assert.ok(out.min.total <= out.mid.total && out.mid.total <= out.max.total);
  const line = out.mid.trail.find((l) => l.leaf === "A312");
  assert.deepEqual(line.path, ["курс", "урок", "A312"]);
  assert.equal(line.role, "Медредактор-сценарист");
  assert.equal(line.qty, 18);
  assert.ok(out.mid.capacity.perMonth > 0);
  assert.ok(out.mid.leadDays > 0);
});
