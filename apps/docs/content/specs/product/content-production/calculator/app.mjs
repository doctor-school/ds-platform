// Unit cost calculator page of the DS content-production model (formulas: cost-model-ru.md).
/* global document, localStorage, Blob, FileReader -- a browser module, served as is */
// Every figure comes from compute.mjs; this file only picks inputs, maps edits to override keys
// (cost-model-ru.md «Правки») and lays the result out. Same pinned stack as ../viewer/.
import React from "react";
import { createRoot } from "react-dom/client";
import htm from "htm";
import { parse as parseYaml } from "yaml";
import {
  loadInputs,
  buildModel,
  computeProduct,
  periodPlan,
  roleHourlyCost,
  loopRounds,
  pick,
  SCENARIOS,
} from "./compute.mjs";

const html = htm.bind(React.createElement);
const { useState, useMemo, useEffect, useContext, createContext } = React;

const CUSTOM = "своя сборка";
const STORE = "ds-content-calculator";
const SCENARIO_NAME = { min: "мин", mid: "сред", max: "макс" };
const SCENARIO_CAPTION =
  "сред — рабочая оценка; мин и макс — крайние случаи, когда все оценки одновременно на границе, а не коридор";
const CLASS_NAME = {
  direct: "прямые",
  overhead: "накладные",
  reserve: "резерв",
  idle: "неиспользованная мощность",
};

// Browser storage is a convenience: private windows and blocked site data must not break the page.
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(`${STORE}:${key}`);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`${STORE}:${key}`, JSON.stringify(value));
    } catch {
      /* storage unavailable — the edit lives until reload */
    }
  },
};

const isPlainObject = (v) =>
  v != null && typeof v === "object" && !Array.isArray(v);

const f0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const f1 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const f2 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const rub = (v) => (v == null ? "не задано" : `${f0.format(v)} ₽`);
const hrs = (v) => (v == null ? "—" : `${f1.format(v)} ч`);
const n2 = (v) => (v == null ? "—" : f2.format(v));
const shape = (v) =>
  Array.isArray(v)
    ? v.map((x) => (x == null ? "?" : f2.format(x))).join("–")
    : v == null
      ? "не задано"
      : typeof v === "number"
        ? f2.format(v)
        : String(v);

/** Inputs with the page's custom composition added as one more product of the same schema. */
function withCustom(inputs, custom) {
  const items = custom.items
    .filter((i) => inputs.products.products[i.product] && i.qty > 0)
    .map((i) => ({ product: i.product, qty: i.qty }));
  if (custom.deals > 0) items.push({ product: "сделка", qty: "сделки" });
  const def = {
    name: "Своя сборка",
    basis: "собрана на странице калькулятора",
    parameters: {
      сделки: { draft: custom.deals, unit: "сделок на сборку" },
    },
    items,
  };
  return {
    ...inputs,
    products: {
      ...inputs.products,
      products: { ...inputs.products.products, [CUSTOM]: def },
    },
  };
}

const UNKNOWN = {
  leaf: "такого листа",
  loop: "такой петли",
  role: "такой роли",
  variable: "такой переменной",
  product: "такого продукта",
  parameter: "такого параметра",
  external: "такой внешней затраты",
  kind: "такого вида правки",
};
const plainError = (message) => {
  const m = /unknown (\w+)/.exec(message);
  return m && UNKNOWN[m[1]] ? `${UNKNOWN[m[1]]} в модели нет` : message;
};

/** Model with the edits that apply; an edit compute rejects is reported and left out. */
function evaluate(inputs, overrides, productName, describeKey) {
  const errors = [];
  let model;
  try {
    model = buildModel(inputs, overrides);
  } catch {
    const applied = {};
    for (const [key, value] of Object.entries(overrides)) {
      try {
        buildModel(inputs, { [key]: value });
        applied[key] = value;
      } catch (error) {
        errors.push(
          `правка «${describeKey(key)}» не применена: ${plainError(error.message)}`,
        );
      }
    }
    try {
      model = buildModel(inputs, applied);
    } catch (error) {
      errors.push(`правки не применены: ${plainError(error.message)}`);
      model = buildModel(inputs, {});
    }
  }
  let result = null;
  try {
    result = computeProduct(model, productName);
  } catch (error) {
    errors.push(`расчёт «${productName}» не выполнен: ${error.message}`);
  }
  return { model, result, errors };
}

/** Model value an override key replaces (undefined: the key names nothing the page edits). */
function baseValue(model, key) {
  const [kind, name, field] = key.split(":");
  switch (kind) {
    case "leaf":
      return model.leaves.get(name)?.hours;
    case "lead":
      return model.leaves.get(name)?.leadDays;
    case "loop": {
      const loop = model.loops.get(name);
      if (!loop) return undefined;
      return loop.rounds_from
        ? SCENARIOS.map((s) => loopRounds(model, name, s))
        : loop.rounds_draft;
    }
    case "wait":
      return model.loops.get(name)?.wait_days_per_round_draft;
    case "rate": {
      const rec = model.rates.get(name);
      if (!rec) return undefined;
      if (field === "monthly")
        return (
          rec.monthly_gross_rub?.[model.vars.region] ??
          rec.monthly_gross_rub?.moscow ??
          null
        );
      if (field === "hourly") return rec.hourly_rub ?? null;
      return null;
    }
    case "fte":
      return model.teamRoles.find((m) => m.role === name)?.fte ?? null;
    case "var":
      return model.vars[name];
    case "param":
      return model.params[name]?.[field];
    case "external":
      return model.externals[name]?.rub;
    default:
      return undefined;
  }
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Why a range cannot be applied: an empty bound, or bounds out of order (мин ≤ сред ≤ макс). */
function rangeProblem(values) {
  if (values.some((v) => v == null)) return "заполните все границы диапазона";
  if (values.some((v, i) => i && values[i - 1] > v))
    return values.length === 3
      ? "границы не по порядку: нужно мин ≤ сред ≤ макс"
      : "мин больше макс";
  return null;
}

/**
 * Edit value in the model's shape: a number for a range field becomes [n, n]; anything compute would
 * misread (wrong shape, empty or disordered bounds) is refused with a reason instead.
 */
function normaliseEdit(model, key, value) {
  const base = baseValue(model, key);
  if (base === undefined) return { value };
  if (typeof base === "string" || (base === null && typeof value === "string"))
    return typeof value === "string" || value === null
      ? { value }
      : { error: "ожидается значение из списка" };
  if (value === null)
    return base === null
      ? { value }
      : { error: "пустое значение — в модели здесь число" };
  if (Array.isArray(base)) {
    if (isNum(value)) return { value: base.map(() => value) };
    if (!Array.isArray(value) || value.length !== base.length)
      return { error: `ожидается диапазон из ${base.length} чисел` };
  }
  if (isNum(base) && !isNum(value)) return { error: "ожидается одно число" };
  if (Array.isArray(value)) {
    if (!value.every((v) => v == null || isNum(v)))
      return { error: "в диапазоне не число" };
    const problem = rangeProblem(value);
    return problem ? { error: problem } : { value };
  }
  return isNum(value) ? { value } : { error: "ожидается число" };
}

/** Edits split into those in the model's shape and those refused, with a plain reason each. */
function normaliseEdits(model, overrides, describeKey) {
  const clean = {};
  const errors = [];
  for (const [key, value] of Object.entries(overrides)) {
    const r = normaliseEdit(model, key, value);
    if ("error" in r)
      errors.push(`правка «${describeKey(key)}» не загружена: ${r.error}`);
    else clean[key] = r.value;
  }
  return { clean, errors };
}

const VAR_FALLBACK_LABEL = {
  employer_contributions_rate: "Ставка взносов работодателя в пределах базы",
};

/** Plain names of override keys and their values — the «Правки» list; the JSON file keeps keys. */
function describer(model, inputs) {
  const described = {
    ...inputs.teams.capacity_variables,
    ...inputs.products.variables,
  };
  const varLabel = (name) =>
    described[name]?.label ?? VAR_FALLBACK_LABEL[name] ?? name;
  const leafName = (id) => `${id} ${model.leaves.get(id)?.name ?? ""}`.trim();
  const productLabel = (name) => model.products[name]?.name ?? name;
  const name = (key) => {
    const [kind, id, field] = key.split(":");
    switch (kind) {
      case "leaf":
        return `Часы: ${leafName(id)}`;
      case "lead":
        return `Срок: ${leafName(id)}`;
      case "piece":
        return `Сдельная цена: ${leafName(id)}`;
      case "loop":
        return `Круги петли «${id}»`;
      case "wait":
        return `Ожидание между кругами петли «${id}»`;
      case "rate":
        return (
          {
            monthly: `Зарплата в месяц: ${id}`,
            hourly: `Подряд, ₽/ч: ${id}`,
            hourly_cost: `Калибровка ₽/ч: ${id}`,
          }[field] ?? `Ставка: ${id}`
        );
      case "fte":
        return `FTE на команду: ${id}`;
      case "var":
        return varLabel(id);
      case "param":
        return `${productLabel(id)}: ${String(field).replaceAll("_", " ")}`;
      case "external":
        return `Внешняя затрата: ${model.externals[id]?.name ?? id}`;
      case "plan":
        return `План: ${productLabel(id)} в месяц`;
      default:
        return key;
    }
  };
  const UNIT = {
    leaf: " ч",
    lead: " раб. дн.",
    wait: " раб. дн.",
    loop: " кр.",
    piece: " ₽ за проход",
    rate: " ₽",
    external: " ₽",
  };
  const value = (key, v) => {
    const [kind, id] = key.split(":");
    if (kind === "var" && VAR_OPTIONS[id])
      return VAR_OPTIONS[id].find(([k]) => k === (v ?? ""))?.[1] ?? shape(v);
    return v == null ? "не задано" : `${shape(v)}${UNIT[kind] ?? ""}`;
  };
  return { name, value, varLabel };
}

const Ctx = createContext(null);

const parseNum = (text) => {
  const t = String(text).replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
};
const showNum = (v) => (v == null ? "" : String(v).replace(".", ","));
const SLOT = { 1: [""], 2: ["мин", "макс"], 3: ["мин", "сред", "макс"] };

/** Slots shown for a value: a mismatched shape (a number on a range field) renders, never throws. */
const slotsOf = (value, n) =>
  Array.from({ length: n }, (_, i) =>
    Array.isArray(value) ? (value[i] ?? null) : (value ?? null),
  );

/**
 * Number / range editor: one input per slot of the model value ([min, max] or [min, mid, max]).
 * A value that is not a number, an emptied bound or disordered bounds is marked and not applied —
 * the last applied value stays; an empty field means «не задано» only where the model allows it.
 */
function NumberEdit({ value, base, label, nullable, onChange }) {
  const n = Array.isArray(base)
    ? base.length
    : Array.isArray(value)
      ? value.length
      : 1;
  const [text, setText] = useState(() => slotsOf(value, n).map(showNum));
  const sig = JSON.stringify(value);
  const problemOf = (texts) => {
    const vals = texts.map(parseNum);
    if (vals.some((v) => v === undefined)) return "не число";
    if (n === 1)
      return vals[0] === null && !nullable
        ? "пустое значение не применяется — введите число"
        : null;
    if (nullable && vals.every((v) => v === null)) return null;
    return rangeProblem(vals);
  };
  useEffect(() => {
    const parsed = text.map(parseNum);
    if (JSON.stringify(n === 1 ? parsed[0] : parsed) !== sig)
      setText(slotsOf(value, n).map(showNum));
    // Only an outside change (reset, import) rewrites what is being typed.
  }, [sig]);
  const problem = problemOf(text);
  const type = (i, t) => {
    const next = [...text];
    next[i] = t;
    setText(next);
    if (problemOf(next)) return;
    const vals = next.map(parseNum);
    const out = n === 1 ? vals[0] : vals.every((v) => v === null) ? null : vals;
    if (JSON.stringify(out) !== sig) onChange(out);
  };
  return html`${text.map(
    (t, i) =>
      html`${i ? html`<span class="muted">–</span>` : null}<input
          key=${i}
          inputmode="decimal"
          class=${problem ? "bad" : ""}
          aria-invalid=${problem ? "true" : "false"}
          aria-label=${`${label}${SLOT[n]?.[i] ? `, ${SLOT[n][i]}` : ""}`}
          title=${problem ? `не применено: ${problem}` : undefined}
          value=${t}
          onChange=${(e) => type(i, e.target.value)}
        />`,
  )}${
    problem
      ? html`<span class="err small" data-testid="field-problem"
          >не применено: ${problem}</span
        >`
      : null
  }`;
}

/** One editable model value, addressed by its override key; edited values are marked. */
function Field({ k, base, label, options }) {
  const c = useContext(Ctx);
  const edited = Object.hasOwn(c.ov, k);
  const value = edited ? c.ov[k] : base;
  return html`<span
    class=${`edit${edited ? " edited" : ""}`}
    title=${edited ? `изменено; в модели: ${shape(base)}` : "значение модели — можно править"}
  >
    ${
      options
        ? html`<select
            aria-label=${label}
            value=${value == null ? "" : value}
            onChange=${(e) => c.set(k, e.target.value === "" ? null : e.target.value)}
          >
            ${options.map(
              ([v, name]) => html`<option key=${v} value=${v}>${name}</option>`,
            )}
          </select>`
        : html`<${NumberEdit}
            value=${value}
            base=${base}
            label=${label}
            nullable=${base == null}
            onChange=${(v) =>
              JSON.stringify(v) === JSON.stringify(base)
                ? c.reset(k)
                : c.set(k, v)}
          />`
    }
    ${
      edited
        ? html`<span class="mark" aria-label="изменено">●</span
            ><button
              class="link"
              title="вернуть значение модели"
              aria-label=${`сбросить ${label}`}
              onClick=${() => c.reset(k)}
            >
              ↺
            </button>`
        : null
    }
  </span>`;
}

function LeafHours({ id }) {
  const c = useContext(Ctx);
  return html`<${Field}
    k=${`leaf:${id}`}
    base=${c.base.leaves.get(id).hours}
    label=${`часы за проход ${id}`}
  />`;
}

function LeafRef({ id }) {
  const c = useContext(Ctx);
  const leaf = c.model.leaves.get(id);
  return html`<a
      class="id"
      href=${`../viewer/#${encodeURIComponent(leaf.diagram)}`}
      target="_blank"
      rel="noopener"
      title="открыть диаграмму листа в просмотрщике"
      >${id}</a
    >
    ${leaf.name}`;
}

/** Trail lines: hours per pass × rounds × quantity = hours, × hourly cost = ₽. */
function TrailTable({ lines, showRole = true, showSum = true }) {
  const totalH = lines.reduce((a, l) => a + l.hours, 0);
  const totalC = lines.reduce((a, l) => a + (l.cost ?? 0), 0);
  return html`<div class="scroll">
    <table>
      <thead>
        <tr>
          <th>Лист</th>
          ${showRole ? html`<th>Роль</th>` : null}
          <th>ч за проход × круги × кол-во</th>
          <th class="num">часы</th>
          <th class="num">₽/ч</th>
          <th class="num">₽</th>
        </tr>
      </thead>
      <tbody>
        ${lines.map(
          (l, i) =>
            html`<tr key=${i}>
              <td><${LeafRef} id=${l.leaf} /></td>
              ${showRole ? html`<td>${l.role}</td>` : null}
              <td>
                <${LeafHours} id=${l.leaf} />
                <div class="small">
                  ${`${n2(l.hoursPerPass)} ч × ${n2(l.rounds)} кр. × ${n2(l.qty)}`}
                </div>
              </td>
              <td class="num">${hrs(l.hours)}</td>
              <td class="num">
                ${
                  l.hourlyCost == null
                    ? l.flags?.includes("сдельно")
                      ? "сдельно"
                      : "не задана"
                    : rub(l.hourlyCost)
                }
              </td>
              <td class="num">${rub(l.cost)}</td>
            </tr>`,
        )}
        ${
          showSum
            ? html`<tr class="sum">
                <td colspan=${showRole ? 3 : 2}>Сумма</td>
                <td class="num">${hrs(totalH)}</td>
                <td></td>
                <td class="num">${rub(totalC)}</td>
              </tr>`
            : null
        }
      </tbody>
    </table>
  </div>`;
}

function Drill({ name, amount, children, open = false, testid }) {
  return html`<details open=${open} data-testid=${testid}>
    <summary>
      <span class="name">${name}</span><span class="amount">${amount}</span>
    </summary>
    <div class="body">${children}</div>
  </details>`;
}

function DirectDrill({ r }) {
  const direct = r.trail.filter((l) => l.class === "direct");
  const qty = new Map(r.units.map((u) => [u.path.join(" → "), u.qty]));
  const groups = new Map();
  for (const l of direct) {
    const key = l.path.slice(0, -1).join(" → ");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  const roles = Object.entries(r.direct.byRole).sort(
    (a, b) => b[1].cost - a[1].cost,
  );
  return html`<${Drill}
    testid="drill-direct"
    name=${html`<b>Прямые затраты</b> <span class="muted small">${hrs(r.direct.hours)}</span>`}
    amount=${rub(r.direct.cost)}
  >
    <${Drill} name="По ролям" amount="" testid="direct-by-role">
      ${roles.map(
        ([role, v]) =>
          html`<${Drill}
            key=${role}
            name=${html`${role} <span class="muted small">${hrs(v.hours)}</span>`}
            amount=${rub(v.cost)}
          >
            <${TrailTable}
              lines=${direct.filter((l) => l.role === role)}
              showRole=${false}
            />
          <//>`,
      )}
    <//>
    <${Drill}
      name="По составу: продукт → единица → лист → роль"
      amount=""
      testid="direct-by-unit"
    >
      ${[...groups].map(
        ([key, lines]) =>
          html`<${Drill}
            key=${key}
            name=${html`${key}${" "}<span class="muted small"
                >× ${n2(qty.get(key))} ·
                ${hrs(lines.reduce((a, l) => a + l.hours, 0))}</span
              >`}
            amount=${rub(lines.reduce((a, l) => a + (l.cost ?? 0), 0))}
          >
            <${TrailTable} lines=${lines} />
          <//>`,
      )}
      <p class="small muted">
        Сумма групп = прямые затраты ${rub(r.direct.cost)}; строки без ставки в
        сумму не входят и дают флаг.
      </p>
    <//>
  <//>`;
}

function OverheadDrill({ r, plan }) {
  const own = r.trail.filter((l) => l.class === "overhead");
  return html`<${Drill}
    testid="drill-overhead"
    name=${html`<b>Накладные</b>`}
    amount=${rub(r.overhead.cost)}
  >
    <p>
      ${rub(r.overhead.perDirectHour)} на прямой час × ${hrs(r.direct.hours)}
      прямых часов = ${rub(r.overhead.cost)}.
    </p>
    <p class="small muted">
      Ставка накладных = пул месяца плана ${rub(plan.poolCost)} ÷
      ${hrs(plan.directHours)} прямых часов плана. План месяца:
      ${Object.entries(plan.sold)
        .map(([p, n]) => `${f2.format(n)} × ${p}`)
        .join(", ")}.
    </p>
    <${Drill} name="Пул накладных месяца плана" amount=${rub(plan.poolCost)}>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Лист</th>
              <th>Роль</th>
              <th>Откуда</th>
              <th class="num">часы</th>
              <th class="num">₽</th>
            </tr>
          </thead>
          <tbody>
            ${plan.poolLines.map(
              (l, i) =>
                html`<tr key=${i}>
                  <td><${LeafRef} id=${l.leaf} /></td>
                  <td>${l.role}</td>
                  <td>${l.source}</td>
                  <td class="num">${hrs(l.hours)}</td>
                  <td class="num">${rub(l.cost)}</td>
                </tr>`,
            )}
          </tbody>
        </table>
      </div>
    <//>
    ${
      own.length
        ? html`<${Drill}
            name="Накладные листья самой единицы (входят в пул через план)"
            amount=${hrs(r.overhead.ownHours)}
          >
            <${TrailTable} lines=${own} showSum=${false} />
          <//>`
        : null
    }
  <//>`;
}

function ReserveDrill({ r, model, scenario }) {
  const v = (name) => n2(pick(model.vars[name], scenario));
  const cfg = model.config.update_reserve;
  return html`<${Drill}
    testid="drill-reserve"
    name=${html`<b>Резерв актуализации</b>${" "}<span class="muted small">${hrs(r.reserve.hours)}</span>`}
    amount=${rub(r.reserve.cost)}
  >
    <p>
      На каждую единицу с линией выпуска: сигналов ${v("signals_per_unit")} ×
      лист ${cfg.signal_leaf} + доля затронутых ${v("affected_share")} × (листы
      ${cfg.affected_leaves.join(", ")} + доля пересборки ${v("rebuild_share")}
      × прямые часы линии единицы), × ставки ролей; сумма по всем единицам
      продукта.
    </p>
  <//>`;
}

function IdleDrill({ r, plan }) {
  return html`<${Drill}
    testid="drill-idle"
    name=${html`<b>Неиспользованная мощность штата</b>${" "}<span class="muted small">только в итоге «с полным фондом оплаты»</span>`}
    amount=${rub(r.idle.cost)}
  >
    <p>
      ${rub(r.idle.perDirectHour)} на прямой час × ${hrs(r.direct.hours)} прямых
      часов = ${rub(r.idle.cost)}.
    </p>
    <p class="small muted">
      Ставка = свободное оплаченное время штата за месяц плана
      ${rub(plan.idle.cost)} (${hrs(plan.idle.hours)}) ÷
      ${hrs(plan.directHours)} прямых часов плана. Состав по ролям — панель
      «Команда и период».
    </p>
  <//>`;
}

function ExternalsDrill({ r }) {
  const set = r.externals.reduce((a, e) => a + (e.cost ?? 0), 0);
  const amount = !r.externals.length
    ? "нет"
    : r.externals.every((e) => e.cost == null)
      ? "не задано"
      : rub(set);
  return html`<${Drill}
    testid="drill-externals"
    name=${html`<b>Внешние затраты</b>`}
    amount=${amount}
  >
    ${
      r.externals.length
        ? html`<div class="scroll">
            <table>
              <thead>
                <tr>
                  <th>Затрата</th>
                  <th class="num">кол-во</th>
                  <th>₽ за единицу</th>
                  <th class="num">₽</th>
                </tr>
              </thead>
              <tbody>
                ${r.externals.map(
                  (e) =>
                    html`<tr key=${e.id}>
                      <td>
                        ${e.name} <span class="muted small">на ${e.per}</span>
                      </td>
                      <td class="num">${n2(e.qty)}</td>
                      <td><${ExternalField} id=${e.id} /></td>
                      <td class="num">
                        ${
                          e.cost == null
                            ? html`<span class="err"
                                >не задано — не входит в итог</span
                              >`
                            : rub(e.cost)
                        }
                      </td>
                    </tr>`,
                )}
              </tbody>
            </table>
          </div>`
        : html`<p class="muted">У продукта нет внешних затрат.</p>`
    }
  <//>`;
}

function ExternalField({ id }) {
  const c = useContext(Ctx);
  return html`<${Field}
    k=${`external:${id}`}
    base=${c.base.externals[id].rub}
    label=${`внешняя затрата ${c.base.externals[id].name}`}
  />`;
}

function Headline({ r, model, productName }) {
  const cap = r.capacity;
  const days = model.vars.working_days_per_month;
  return html`<section class="card" data-testid="headline">
    <div class="totals">
      <div class="total" data-testid="total-by-load">
        <div class="label">по загрузке</div>
        <div class="value">${rub(r.total.byLoad)}</div>
        <div class="hint">
          прямые + накладные + резерв + заданные внешние; свободные часы штата
          не входят
        </div>
      </div>
      <div class="total" data-testid="total-full-payroll">
        <div class="label">с полным фондом оплаты</div>
        <div class="value">${rub(r.total.fullPayroll)}</div>
        <div class="hint">
          + неиспользованная мощность штата ${rub(r.idle.cost)} — оплаченное
          время команды, которое план не загрузил
        </div>
      </div>
    </div>
    <div class="facts">
      <span
        >Мощность одной
        команды:${" "}<b>${
          cap.perMonth == null
            ? "—"
            : `${n2(cap.perMonth)} ${productName === CUSTOM ? "сборки" : "ед."} в месяц`
        }</b>${
          cap.bottleneck ? html`, узкое место — <b>${cap.bottleneck}</b>` : null
        }</span
      >
      <span
        >Срок:${" "}<b
          >${
            r.leadDays == null
              ? "не считается (у продукта нет цепочки срока)"
              : `${f1.format(r.leadDays)} раб. дн. ≈ ${f1.format(r.leadDays / days)} мес.`
          }</b
        ></span
      >
      <span>Прямые часы: <b>${hrs(r.direct.hours)}</b></span>
    </div>
    ${
      r.flags.length
        ? html`<ul class="flags" data-testid="flags">
            ${r.flags.map((f) => html`<li key=${f}>${f}</li>`)}
          </ul>`
        : html`<p class="small muted">Флагов нет.</p>`
    }
  </section>`;
}

function Breakdown({ r, plan, model, scenario }) {
  return html`<section class="card">
    <h2>Из чего складывается</h2>
    <${DirectDrill} r=${r} />
    <${OverheadDrill} r=${r} plan=${plan} />
    <${ReserveDrill} r=${r} model=${model} scenario=${scenario} />
    <${ExternalsDrill} r=${r} />
    <${Drill}
      name=${html`<b>Итог «по загрузке»</b>`}
      amount=${rub(r.total.byLoad)}
      testid="sum-by-load"
    >
      <p>
        ${rub(r.direct.cost)} + ${rub(r.overhead.cost)} + ${rub(r.reserve.cost)}
        + ${rub(r.externals.reduce((a, e) => a + (e.cost ?? 0), 0))}
      </p>
    <//>
    <${IdleDrill} r=${r} plan=${plan} />
    <${Drill}
      name=${html`<b>Итог «с полным фондом оплаты»</b>`}
      amount=${rub(r.total.fullPayroll)}
    >
      <p>${rub(r.total.byLoad)} + ${rub(r.idle.cost)}</p>
    <//>
  </section>`;
}

function PeriodPanel({ plan, model, scenario }) {
  const c = useContext(Ctx);
  const rows = plan.idle.byRole;
  const contracted = rows.some((x) => x.contractorHours > 0);
  const sumOf = (k) => rows.reduce((a, x) => a + x[k], 0);
  const teamRows = model.teamRoles.map((m) => m.role);
  return html`<div data-testid="period">
    <p>
      План
      месяца:${" "}${Object.entries(plan.sold)
        .map(([p, n]) => `${f2.format(n)} × ${p}`)
        .join(", ")}
      ${plan.bottleneck ? ` (узкое место — ${plan.bottleneck})` : ""}.
      Команд:${" "}<${Field}
        k="var:teams"
        base=${c.base.vars.teams}
        label="число команд"
      />, загрузка продуктом${" "}<${Field}
        k="var:plan_mix"
        base=${c.base.vars.plan_mix}
        label="продукт плана"
        options=${Object.keys(c.base.products)
          .filter((p) => p !== CUSTOM)
          .map((p) => [p, p])}
      />${" "}на полную мощность.
    </p>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Роль</th>
            <th>FTE на команду</th>
            <th class="num">оплачено</th>
            <th class="num">непроизв.</th>
            <th class="num">загружено</th>
            ${contracted ? html`<th class="num">подряд</th>` : null}
            <th class="num">свободно</th>
            <th class="num">₽/ч штата</th>
            <th class="num">свободно, ₽</th>
            <th class="num">фонд оплаты</th>
          </tr>
        </thead>
        <tbody>
          ${teamRows.map((role) => {
            const x = rows.find((y) => y.role === role);
            const base = c.base.teamRoles.find((m) => m.role === role)?.fte;
            return html`<tr key=${role}>
              <td>${role}</td>
              <td>
                <${Field}
                  k=${`fte:${role}`}
                  base=${base}
                  label=${`FTE ${role}`}
                />
              </td>
              ${
                x
                  ? html`<td class="num">${hrs(x.paidHours)}</td>
                      <td class="num">${hrs(x.nonProduction)}</td>
                      <td class="num">${hrs(x.loaded)}</td>
                      ${
                        contracted
                          ? html`<td class="num">${hrs(x.contractorHours)}</td>`
                          : null
                      }
                      <td class="num">${hrs(x.idleHours)}</td>
                      <td class="num">${rub(x.ownHourlyCost)}</td>
                      <td class="num">${rub(x.idleCost)}</td>
                      <td class="num">${rub(x.payroll)}</td>`
                  : html`<td colspan=${contracted ? 8 : 7} class="muted small">
                      нет штатной зарплаты в ставках — в фонд оплаты не входит
                    </td>`
              }
            </tr>`;
          })}
          <tr class="sum">
            <td colspan="2">Итого за месяц</td>
            <td class="num">${hrs(sumOf("paidHours"))}</td>
            <td class="num">${hrs(sumOf("nonProduction"))}</td>
            <td class="num">${hrs(sumOf("loaded"))}</td>
            ${
              contracted
                ? html`<td class="num">${hrs(sumOf("contractorHours"))}</td>`
                : null
            }
            <td class="num">${hrs(plan.idle.hours)}</td>
            <td></td>
            <td class="num" data-testid="period-idle">
              ${rub(plan.idle.cost)}
            </td>
            <td class="num" data-testid="period-payroll">
              ${rub(sumOf("payroll"))}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="small muted">
      Свободно = оплачено − непроизводственные часы (встречи, найм, управление)
      − часы, которые загружают единицы плана. Их рубли, распределённые на
      прямые часы плана, — разница между итогами «по загрузке» и «с полным
      фондом оплаты» (${SCENARIO_NAME[scenario]}).
    </p>
  </div>`;
}

function LoopsPanel({ scenario }) {
  const c = useContext(Ctx);
  return html`<div class="scroll">
    <table>
      <thead>
        <tr>
          <th>Петля</th>
          <th>Кто одобряет</th>
          <th>Круги</th>
          <th>Ожидание между кругами, раб. дн.</th>
          <th class="num">круги сейчас</th>
        </tr>
      </thead>
      <tbody>
        ${[...c.base.loops.values()].map((loop) => {
          const derived = loop.rounds_from
            ? ["min", "mid", "max"].map((s) => loopRounds(c.base, loop.name, s))
            : null;
          return html`<tr key=${loop.name}>
            <td>
              ${loop.name}
              <div class="small muted">
                листы ${(loop.leaves ?? []).join(", ")}
              </div>
            </td>
            <td>${loop.approver}</td>
            <td>
              <${Field}
                k=${`loop:${loop.name}`}
                base=${derived ?? loop.rounds_draft}
                label=${`круги ${loop.name}`}
              />
              ${
                derived
                  ? html`<div class="small muted">
                      выводится из петель
                      ${loop.rounds_from.plus_extra_rounds_of.join(", ")}
                    </div>`
                  : null
              }
            </td>
            <td>
              <${Field}
                k=${`wait:${loop.name}`}
                base=${loop.wait_days_per_round_draft}
                label=${`ожидание ${loop.name}`}
              />
            </td>
            <td class="num">${n2(loopRounds(c.model, loop.name, scenario))}</td>
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
}

function RatesPanel({ scenario, roles }) {
  const c = useContext(Ctx);
  const region = c.model.vars.region;
  return html`<div class="scroll">
    <p class="small muted">
      Стоимость часа штата = зарплата × (1 + взносы) ÷ оплачиваемые часы;
      подряда — ставка × (1 + надбавка формы договора). «Калибровка ₽/ч»
      заменяет расчёт целиком. Регион ставок:
      ${VAR_OPTIONS.region.find(([k]) => k === region)?.[1] ?? region}.
    </p>
    <table>
      <thead>
        <tr>
          <th>Роль</th>
          <th>Зарплата в месяц, ₽</th>
          <th>Подряд, ₽/ч</th>
          <th>Калибровка ₽/ч</th>
          <th class="num">₽/ч сейчас</th>
        </tr>
      </thead>
      <tbody>
        ${[...c.base.rates.values()]
          .filter((rec) => roles.has(rec.role))
          .map((rec) => {
            const rate = roleHourlyCost(c.model, rec.role, scenario);
            return html`<tr key=${rec.role}>
              <td>
                ${rec.role}
                <div class="small muted">${rate.basis}</div>
              </td>
              <td>
                ${
                  rec.monthly_gross_rub
                    ? html`<${Field}
                        k=${`rate:${rec.role}:monthly`}
                        base=${
                          rec.monthly_gross_rub[region] ??
                          rec.monthly_gross_rub.moscow ??
                          null
                        }
                        label=${`зарплата ${rec.role}`}
                      />`
                    : html`<span class="muted">—</span>`
                }
              </td>
              <td>
                ${
                  rec.monthly_gross_rub && rec.hourly_rub == null
                    ? html`<span class="muted">—</span>`
                    : html`<${Field}
                        k=${`rate:${rec.role}:hourly`}
                        base=${rec.hourly_rub ?? null}
                        label=${`подряд ${rec.role}`}
                      />`
                }
              </td>
              <td>
                <${Field}
                  k=${`rate:${rec.role}:hourly_cost`}
                  base=${null}
                  label=${`калибровка ${rec.role}`}
                />
              </td>
              <td class="num">${rub(rate.value)}</td>
            </tr>`;
          })}
      </tbody>
    </table>
  </div>`;
}

const VAR_OPTIONS = {
  region: [
    ["moscow", "Москва"],
    ["russia_remote", "Россия, удалённо"],
  ],
  contractor_form: [
    ["", "по форме привлечения роли"],
    ["npd_self_employed", "самозанятый"],
    ["ip", "ИП"],
    ["gph_individual", "ГПХ с физлицом"],
    ["gph_individual_with_nsipz", "ГПХ с физлицом и взносом НСиПЗ"],
  ],
};

function VariablesPanel({ inputs }) {
  const c = useContext(Ctx);
  const described = {
    ...inputs.teams.capacity_variables,
    ...inputs.products.variables,
  };
  return html`<div class="scroll">
    <table>
      <thead>
        <tr>
          <th>Переменная</th>
          <th>Значение</th>
        </tr>
      </thead>
      <tbody>
        ${Object.keys(c.base.vars).map(
          (name) =>
            html`<tr key=${name}>
              <td>
                ${c.describe.varLabel(name)}
                <div class="small muted">
                  ${described[name]?.unit ?? "доля к зарплате"}
                </div>
              </td>
              <td>
                <${Field}
                  k=${`var:${name}`}
                  base=${c.base.vars[name]}
                  label=${c.describe.varLabel(name)}
                  options=${
                    name === "plan_mix"
                      ? Object.keys(c.base.products)
                          .filter((p) => p !== CUSTOM)
                          .map((p) => [p, p])
                      : VAR_OPTIONS[name]
                  }
                />
              </td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

function nestedProducts(model, name, seen = new Set()) {
  if (seen.has(name) || !model.products[name]) return seen;
  seen.add(name);
  for (const item of model.products[name].items)
    if (item.product) nestedProducts(model, item.product, seen);
  return seen;
}

function ParamsPanel({ productName }) {
  const c = useContext(Ctx);
  const rows = [];
  for (const p of nestedProducts(c.base, productName))
    if (p !== CUSTOM)
      for (const [name, def] of Object.entries(
        c.base.products[p].parameters ?? {},
      ))
        rows.push({ p, name, def });
  if (!rows.length)
    return html`<p class="muted">У продукта и его единиц нет параметров.</p>`;
  return html`<div class="scroll">
    <table>
      <thead>
        <tr>
          <th>Продукт</th>
          <th>Параметр</th>
          <th>Значение</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(
          ({ p, name, def }) =>
            html`<tr key=${`${p}|${name}`}>
              <td>${c.base.products[p].name ?? p}</td>
              <td>
                ${name.replaceAll("_", " ")}
                <div class="small muted">${def.unit}</div>
              </td>
              <td>
                <${Field}
                  k=${`param:${p}:${name}`}
                  base=${c.base.params[p][name]}
                  label=${`параметр ${p} ${name}`}
                />
              </td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

function ExternalsPanel() {
  const c = useContext(Ctx);
  return html`<div class="scroll">
    <table>
      <thead>
        <tr>
          <th>Затрата</th>
          <th>₽ за единицу</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(c.base.externals).map(
          ([id, e]) =>
            html`<tr key=${id}>
              <td>${e.name} <span class="muted small">на ${e.per}</span></td>
              <td><${ExternalField} id=${id} /></td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

function LeavesPanel({ r }) {
  const seen = new Map();
  for (const l of r.trail) if (l.leaf && !seen.has(l.leaf)) seen.set(l.leaf, l);
  return html`<div class="scroll">
    <table>
      <thead>
        <tr>
          <th>Лист</th>
          <th>Роль</th>
          <th>Вид</th>
          <th>Часы за проход</th>
        </tr>
      </thead>
      <tbody>
        ${[...seen.values()].map(
          (l) =>
            html`<tr key=${l.leaf}>
              <td><${LeafRef} id=${l.leaf} /></td>
              <td>${l.role}</td>
              <td>${CLASS_NAME[l.class]}</td>
              <td><${LeafHours} id=${l.leaf} /></td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

function EditsPanel() {
  const c = useContext(Ctx);
  const keys = Object.keys(c.ov);
  if (!keys.length)
    return html`<p class="muted">Правок нет — всё по модели.</p>`;
  return html`<table>
    <tbody>
      ${keys.map(
        (k) =>
          html`<tr key=${k}>
            <td>${c.describe.name(k)}</td>
            <td>${c.describe.value(k, c.ov[k])}</td>
            <td>
              <button class="link" onClick=${() => c.reset(k)}>
                ↺ сбросить
              </button>
            </td>
          </tr>`,
      )}
    </tbody>
  </table>`;
}

const TABS = [
  ["period", "Команда и период"],
  ["leaves", "Часы листьев"],
  ["loops", "Петли одобрения"],
  ["rates", "Ставки"],
  ["params", "Параметры продукта"],
  ["externals", "Внешние затраты"],
  ["vars", "Переменные"],
  ["edits", "Правки"],
];

function Calibration({ r, plan, model, inputs, productName, scenario }) {
  const c = useContext(Ctx);
  const [tab, setTab] = useState(() => store.get("tab", "period"));
  useEffect(() => store.set("tab", tab), [tab]);
  const roles = useMemo(() => {
    const set = new Set(r.trail.map((l) => l.role).filter(Boolean));
    for (const l of plan.poolLines) set.add(l.role);
    for (const m of model.teamRoles) set.add(m.role);
    return set;
  }, [r, plan, model]);
  const count = Object.keys(c.ov).length;
  return html`<section class="card">
    <h2>Калибровка</h2>
    <div class="tabs" role="tablist">
      ${TABS.map(
        ([id, name]) =>
          html`<button
            key=${id}
            role="tab"
            aria-selected=${tab === id}
            onClick=${() => setTab(id)}
          >
            ${name}${id === "edits" && count ? ` (${count})` : ""}
          </button>`,
      )}
    </div>
    ${
      tab === "period"
        ? html`<${PeriodPanel}
            plan=${plan}
            model=${model}
            scenario=${scenario}
          />`
        : tab === "leaves"
          ? html`<${LeavesPanel} r=${r} />`
          : tab === "loops"
            ? html`<${LoopsPanel} scenario=${scenario} />`
            : tab === "rates"
              ? html`<${RatesPanel} scenario=${scenario} roles=${roles} />`
              : tab === "params"
                ? html`<${ParamsPanel} productName=${productName} />`
                : tab === "externals"
                  ? html`<${ExternalsPanel} />`
                  : tab === "vars"
                    ? html`<${VariablesPanel} inputs=${inputs} />`
                    : html`<${EditsPanel} />`
    }
  </section>`;
}

function CustomBuilder({ custom, setCustom, products }) {
  const choices = Object.keys(products).filter(
    (p) => p !== CUSTOM && p !== "сделка",
  );
  const update = (i, patch) =>
    setCustom({
      ...custom,
      items: custom.items.map((it, j) => (j === i ? { ...it, ...patch } : it)),
    });
  return html`<section class="card" data-testid="custom">
    <h2>Своя сборка</h2>
    <div class="scroll">
      <table>
        <tbody>
          ${custom.items.map(
            (it, i) =>
              html`<tr key=${i}>
                <td>
                  <select
                    aria-label=${`единица ${i + 1}`}
                    value=${it.product}
                    onChange=${(e) => update(i, { product: e.target.value })}
                  >
                    ${choices.map(
                      (p) =>
                        html`<option key=${p} value=${p}>
                          ${products[p].name}
                        </option>`,
                    )}
                  </select>
                </td>
                <td>
                  <span class="edit"
                    >×
                    <input
                      inputmode="decimal"
                      aria-label=${`количество ${i + 1}`}
                      value=${showNum(it.qty)}
                      onChange=${(e) => {
                        const v = parseNum(e.target.value);
                        update(i, {
                          qty: v == null || v === undefined ? 0 : v,
                        });
                      }}
                  /></span>
                </td>
                <td>
                  <button
                    class="link"
                    onClick=${() =>
                      setCustom({
                        ...custom,
                        items: custom.items.filter((_, j) => j !== i),
                      })}
                  >
                    убрать
                  </button>
                </td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>
    <div class="toolbar" style=${{ marginTop: 8 }}>
      <button
        onClick=${() =>
          setCustom({
            ...custom,
            items: [...custom.items, { product: choices[0], qty: 1 }],
          })}
      >
        + единица
      </button>
      <span class="edit"
        >сделок по сборке:
        <input
          inputmode="decimal"
          aria-label="сделок по сборке"
          value=${showNum(custom.deals)}
          onChange=${(e) => {
            const v = parseNum(e.target.value);
            setCustom({
              ...custom,
              deals: v == null || v === undefined ? 0 : v,
            });
          }}
      /></span>
      <span class="small muted"
        >сделка — КП, договор, отчётные этапы и закрытие (продукт «сделка»); 0 —
        без неё</span
      >
    </div>
  </section>`;
}

const DEFAULT_CUSTOM = {
  items: [
    { product: "модуль", qty: 2 },
    { product: "вебинар", qty: 1 },
  ],
  deals: 1,
};

function download(overrides, note) {
  const date = new Date().toISOString().slice(0, 10);
  const body = JSON.stringify(
    { base: `${date}${note ? ` — ${note}` : ""}`, overrides },
    null,
    2,
  );
  const url = URL.createObjectURL(
    new Blob([body], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `правки-калькулятора-${date}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function App({ inputs }) {
  const productNames = Object.keys(inputs.products.products);
  const [productName, setProduct] = useState(() => {
    const p = store.get("product", "урок");
    return p === CUSTOM || productNames.includes(p) ? p : "урок";
  });
  const [scenario, setScenario] = useState(() => {
    const s = store.get("scenario", "mid");
    return ["min", "mid", "max"].includes(s) ? s : "mid";
  });
  const [overrides, setOverrides] = useState(() => {
    const o = store.get("overrides", {});
    return isPlainObject(o) ? o : {};
  });
  const [custom, setCustom] = useState(() => {
    const c = store.get("custom", null);
    return isPlainObject(c) && Array.isArray(c.items) ? c : DEFAULT_CUSTOM;
  });
  const [note, setNote] = useState(() => store.get("note", ""));
  const [importError, setImportError] = useState(null);
  useEffect(() => store.set("product", productName), [productName]);
  useEffect(() => store.set("scenario", scenario), [scenario]);
  useEffect(() => store.set("overrides", overrides), [overrides]);
  useEffect(() => store.set("custom", custom), [custom]);
  useEffect(() => store.set("note", note), [note]);

  const full = useMemo(() => withCustom(inputs, custom), [inputs, custom]);
  const base = useMemo(() => buildModel(full, {}), [full]);
  const describe = useMemo(() => describer(base, inputs), [base, inputs]);
  // Stored edits from an older page or a hand-edited file: normalise, report and drop the rest.
  const checked = useMemo(
    () => normaliseEdits(base, overrides, describe.name),
    [base, overrides, describe],
  );
  useEffect(() => {
    if (checked.errors.length) {
      setOverrides(checked.clean);
      setImportError(checked.errors.join("; "));
    }
  }, [checked]);
  const { model, result, errors } = useMemo(
    () => evaluate(full, checked.clean, productName, describe.name),
    [full, checked, productName, describe],
  );
  let plan = null;
  let planError = null;
  try {
    plan = periodPlan(model, scenario);
  } catch (error) {
    planError = `план периода не посчитан: ${error.message}`;
  }
  const ctx = {
    ov: overrides,
    set: (k, v) => setOverrides((o) => ({ ...o, [k]: v })),
    reset: (k) =>
      setOverrides((o) => {
        const next = { ...o };
        delete next[k];
        return next;
      }),
    base,
    model,
    describe,
  };
  const r = result?.[scenario];
  const count = Object.keys(overrides).length;

  const importFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!isPlainObject(data?.overrides))
          throw new Error("в файле нет раздела правок (overrides)");
        const { clean, errors: refused } = normaliseEdits(
          base,
          data.overrides,
          describe.name,
        );
        setOverrides(clean);
        setImportError(refused.length ? refused.join("; ") : null);
      } catch (error) {
        setImportError(
          `файл правок не прочитан: ${error instanceof SyntaxError ? "это не JSON" : error.message}`,
        );
      }
    };
    reader.readAsText(file);
  };

  return html`<${Ctx.Provider} value=${ctx}>
    <header>
      <h1>Себестоимость единицы</h1>
      <select
        aria-label="продукт"
        value=${productName}
        onChange=${(e) => setProduct(e.target.value)}
      >
        ${productNames.map(
          (p) =>
            html`<option key=${p} value=${p}>
              ${inputs.products.products[p].name}
            </option>`,
        )}
        <option value=${CUSTOM}>Своя сборка…</option>
      </select>
      <span class="seg" role="group" aria-label="сценарий">
        ${["min", "mid", "max"].map(
          (s) =>
            html`<button
              key=${s}
              aria-pressed=${scenario === s}
              onClick=${() => setScenario(s)}
            >
              ${SCENARIO_NAME[s]}
            </button>`,
        )}
      </span>
      <span class="caption">${SCENARIO_CAPTION}</span>
      <span class="spacer"></span>
      <span class="toolbar">
        ${
          count
            ? html`<span class="badge" data-testid="edits-count"
                >правок: ${count}</span
              >`
            : null
        }
        <input
          aria-label="пометка к правкам"
          placeholder="пометка к правкам"
          value=${note}
          onChange=${(e) => setNote(e.target.value)}
          style=${{ width: 150, padding: "3px 6px", border: "1px solid var(--frame)", borderRadius: 6 }}
        />
        <button onClick=${() => download(overrides, note)}>
          Скачать правки
        </button>
        <label>
          <button onClick=${(e) => e.currentTarget.nextElementSibling.click()}>
            Загрузить правки
          </button>
          <input
            type="file"
            accept="application/json,.json"
            aria-label="файл правок"
            hidden
            onChange=${(e) => {
              importFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <button disabled=${!count} onClick=${() => setOverrides({})}>
          Сбросить всё
        </button>
      </span>
    </header>
    <div class="wrap">
      <p class="small muted" style=${{ margin: 0 }}>
        Правки хранятся в этом браузере. В YAML модели их переносит ведущий
        PR-ом — передайте ему файл «Скачать правки».
      </p>
      ${
        [
          ...errors,
          ...(planError ? [planError] : []),
          ...(importError ? [importError] : []),
        ].length
          ? html`<div class="errbox" data-testid="errors">
              ${[...errors, planError, importError]
                .filter(Boolean)
                .map((e) => html`<div key=${e}>${e}</div>`)}
            </div>`
          : null
      }
      ${
        productName === CUSTOM
          ? html`<${CustomBuilder}
              custom=${custom}
              setCustom=${setCustom}
              products=${inputs.products.products}
            />`
          : null
      }
      ${
        r && plan
          ? html`<${Headline}
                r=${r}
                model=${model}
                productName=${productName}
              />
              <div class="cols">
                <${Breakdown}
                  r=${r}
                  plan=${plan}
                  model=${model}
                  scenario=${scenario}
                />
                <${Calibration}
                  r=${r}
                  plan=${plan}
                  model=${model}
                  inputs=${inputs}
                  productName=${productName}
                  scenario=${scenario}
                />
              </div>`
          : html`<section class="card">
              <p>
                Расчёт не выполнен — см. ошибку выше. Сбросьте последнюю правку
                или все правки.
              </p>
              <${EditsPanel} />
            </section>`
      }
    </div>
  <//>`;
}

class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return html`<div class="wrap">
      <div class="errbox">
        Страница не смогла показать расчёт: ${String(this.state.error.message)}
      </div>
      <p>
        <button
          onClick=${() => {
            store.set("overrides", {});
            this.setState({ error: null });
            document.location.reload();
          }}
        >
          Сбросить все правки и перезагрузить
        </button>
      </p>
    </div>`;
  }
}

const root = createRoot(document.getElementById("root"));
loadInputs(async (path) => {
  const response = await fetch(new URL(`../${path}`, import.meta.url));
  if (!response.ok)
    throw new Error(
      `файл ${path} не получен — сервер ответил HTTP ${response.status}`,
    );
  return response.text();
}, parseYaml)
  .then((inputs) =>
    root.render(html`<${Boundary}><${App} inputs=${inputs} /><//>`),
  )
  .catch((error) =>
    root.render(
      html`<p class="err" style=${{ padding: 16 }}>
        Не удалось загрузить модель: ${String(error?.message ?? error)}
      </p>`,
    ),
  );
