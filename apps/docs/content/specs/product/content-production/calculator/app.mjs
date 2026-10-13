// Unit cost and price calculator page of the DS content-production model (formulas: cost-model-ru.md,
// screen structure: ui-research-ru.md).
/* global document, localStorage, Blob, FileReader, window -- a browser module, served as is */
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
  priceProduct,
  roleHourlyCost,
  roleEngagement,
  engagementPreset,
  staffHour,
  loopRounds,
  sensitivity,
  breakEvenSeries,
  budgetFit,
  pick,
  GRADES,
  GRADE_MIX,
  GRADE_LABELS,
  COURSES,
  COURSE_LABELS,
  DEFAULT_CTX,
  ENGAGEMENTS,
  ENGAGEMENT_LABELS,
  ARTICLES,
  ARTICLE_LABELS,
  PRICE_MODES,
} from "./compute.mjs";

// Not named `view`: Prettier reflows `view` templates by HTML whitespace rules, while htm drops
// whitespace that contains a line break — a reflow would glue words. Joins across lines use ${" "}.
const view = htm.bind(React.createElement);
const { useState, useMemo, useEffect, useRef, useContext, createContext } =
  React;

const CUSTOM = "своя сборка";
const STORE = "ds-content-calculator";
const CLASS_NAME = {
  direct: "прямые",
  overhead: "накладные",
  reserve: "резерв",
  idle: "неиспользованная мощность",
  tools: "инструменты",
  pending: "чёрный ящик",
};
const COURSE_LEVEL = { smooth: "min", usual: "mid", rework: "max" };
const PRICE_MODE_LABEL = {
  multiplier: "× множитель",
  markup: "наценка, %",
  margin: "маржа, %",
  fixed: "сумма, ₽",
};
const PRESET_LABEL = {
  staff: "Всё в штате",
  hourly: "Всё почасово",
  model: "Как в модели",
};
const VP_LABEL = { own: "своя команда", contractor: "подрядчик" };

// One map of every term and abbreviation the page uses; <Term> shows it as a styled tooltip on hover
// and on keyboard focus (a native title is neither styled nor reachable from the keyboard).
const GLOSSARY = {
  себестоимость:
    "Полная себестоимость единицы: прямые часы × ставки + накладные + резерв актуализации + внешние затраты + доля пула инструментов + неиспользованная мощность штата.",
  цена: "Сумма, которую платит спонсор за продукт: аванс + оплата за контакты по плану.",
  прибыль: "Цена − полная себестоимость, ₽.",
  наценка:
    "Наценка (markup) = прибыль ÷ себестоимость. Потолка нет: наценка 50 % — это маржа ≈ 33 %.",
  маржа:
    "Маржа (margin) = прибыль ÷ цена. Всегда меньше 100 %; маржа 20 % — это наценка 25 %.",
  множитель: "Множитель = цена ÷ себестоимость. Множитель 1,3 = наценка 30 %.",
  "ведущий способ":
    "Чем задаётся цена: множителем, наценкой, маржой или суммой в ₽. Остальные метрики пересчитываются из неё.",
  аванс:
    "Часть цены, которую спонсор платит независимо от результата: цена − план контактов × цена контакта.",
  результат: "Часть цены за контакты: контакты × цена контакта.",
  контакт:
    "Врач, который досмотрел или дослушал продукт либо участвовал в живом эфире — то, за что платит спонсор.",
  "цена контакта":
    "₽ за один контакт: середина полосы цены по размеру аудитории специальности × вес типа контакта продукта.",
  "тип контакта":
    "Каким способом врач встретился с продуктом (эфир, просмотр урока, серия). Вес типа отражает ценность контакта.",
  безубыточность:
    "Сколько контактов нужно, чтобы выручка покрыла полную себестоимость: (себестоимость − аванс) ÷ цена контакта.",
  "потолок бюджета":
    "Сколько спонсор готов заплатить за продукт. Жёсткий — выручка не выше потолка; со скидкой — контакты сверх потолка оплачиваются со скидкой.",
  "золотая цена":
    "Полоса разумной цены: от полной себестоимости (маржа 0) до меньшего из верхней границы рынка и потолка бюджета. Задана правилом, а не опросом покупателей.",
  "рыночный ориентир":
    "Диапазон цен похожих продуктов на рынке (rates.yaml market_references); можно поправить двумя полями.",
  "разрыв с рынком":
    "Отклонение себестоимости или цены от середины рыночного ориентира. Выше порога — выделено.",
  грейд:
    "Уровень специалистов: junior, middle, senior или смесь команды. Меняет ставки ролей, но не часы.",
  "смесь команды":
    "Грейд «смесь»: ставка каждой роли — средневзвешенная по долям junior / middle / senior из rates.yaml.",
  junior: "Начинающий специалист: нижняя часть рыночного диапазона ставки.",
  middle: "Специалист среднего уровня: медиана рынка.",
  senior: "Старший специалист: верхняя часть рыночного диапазона ставки.",
  "ход работы":
    "Как идёт работа: гладко, обычно или с переделками. Меняет часы, число кругов согласования и другие диапазоны модели — не ставки.",
  операция:
    "Нижний уровень схемы процесса: одно действие одной роли с часами за проход (в YAML модели — leaf).",
  петля:
    "Повтор согласования: операции петли проходят столько кругов, сколько раз результат возвращают на доработку.",
  круги: "Сколько раз операции петли проходят до одобрения.",
  FTE: "Full-time equivalent — доля полной ставки одного человека в команде (1 FTE = полный рабочий месяц).",
  ФОТ: "Фонд оплаты труда штата: зарплаты, премии, взносы и прочие расходы на сотрудника.",
  штат: "Сотрудник в штате: платим за весь оплачиваемый месяц, а не только за часы продукта.",
  самозанятый:
    "Исполнитель на налоге на профессиональный доход (НПД): платим за часы; надбавка формы договора из rates.yaml.",
  НПД: "Налог на профессиональный доход — режим самозанятого.",
  ИП: "Индивидуальный предприниматель: платим за часы; надбавка формы договора из rates.yaml.",
  ГПХ: "Договор гражданско-правового характера с физлицом: на вознаграждение начисляются взносы.",
  НСиПЗ:
    "Взнос на страхование от несчастных случаев и профзаболеваний — начисляется сверх основных взносов.",
  МСП: "Малый и средний бизнес: льготный режим взносов — пониженная ставка с части зарплаты выше 1,5 МРОТ.",
  gross: "Зарплата до вычета НДФЛ («грязными»), ₽ в месяц.",
  премия:
    "Премия — доля к gross; облагается взносами, поэтому прибавляется до взносов.",
  взносы:
    "Страховые взносы работодателя: общий режим — ставка до базы 2 979 000 ₽ в год, сверху 15,1 %; или режим МСП.",
  делитель:
    "Оплачиваемые часы одного FTE в месяц (145,7): отпуск и болезни уже вычтены.",
  "прочие расходы":
    "Прочие расходы на штатного сотрудника в месяц (рабочее место, техника, ДМС и т. п.), делятся на оплачиваемые часы.",
  "час штата":
    "Полная стоимость часа штатного сотрудника: (gross + премия + взносы + прочие расходы) ÷ оплачиваемые часы × масштаб ФОТ.",
  накладные:
    "Время команды, которое не относится к одной единице (договоры, публикация, система). Пул месяца плана делится на прямые часы плана.",
  "резерв актуализации":
    "Работа на будущие правки единицы за срок договора: сигналы неактуальности × доля затронутых × пересборка.",
  "неиспользованная мощность":
    "Оплаченное время штата, которое план месяца не загрузил. Входит только в итог «с полным фондом оплаты».",
  "пул инструментов":
    "Подписки, разовые покупки, платформа и оборудование в месяц, разделённые на прямые часы плана месяца.",
  "внешние затраты":
    "Затраты на стороне: студия, генерация, голоса, площадка, компоненты подрядчика. Нет значения — «не задано», не ноль.",
  "чёрный ящик":
    "Подпроцесс, который в схеме ещё не раскрыт: его часы неизвестны, строка «не задано» и флаг.",
  эксперт:
    "Внешний врач-эксперт: гонорар за час по грейду эксперта (врач, к.м.н., д.м.н., лидер мнений).",
  "грейд эксперта":
    "Учёная степень или статус эксперта — задаёт ставку его часа.",
  "узкое место":
    "Роль, которая первой упирается в свои часы и ограничивает мощность команды.",
  мощность:
    "Сколько единиц продукта одна команда делает в месяц при полной загрузке.",
  срок: "Срок единицы по цепочке операций, в рабочих днях.",
  "прямые часы":
    "Часы операций, которые относятся к этой единице (без накладных, резерва и простоя).",
  "по загрузке":
    "Себестоимость без неиспользованной мощности штата: только загруженные часы.",
  "с полным фондом оплаты":
    "Себестоимость с неиспользованной мощностью штата — рабочая база цены.",
  "авторская доля":
    "Доля маржи продукта автору курса — распределение прибыли, не себестоимость.",
  "расширенная кампания":
    "Опция пакета: платное привлечение врачей — цена привлечения контакта × контакты плана; работа кампании пока чёрный ящик.",
  торнадо:
    "Каждый драйвер меняется отдельно, остальные остаются как есть; бары отсортированы по размаху. Взаимодействия драйверов не показывает.",
  "масштаб статьи":
    "Множитель к статье затрат: 100 % — как в модели, 80 % — бюджет на статью на 20 % меньше.",
  "₽/ч": "Рублей за час.",
  "раб. дн.": "Рабочих дней.",
  "план месяца":
    "Чем занята команда в месяц (по умолчанию — продукт плана на полную мощность). Задаёт ставку накладных и простой, но не состав выбранного продукта.",
  "функции схемы":
    "Верхние блоки схемы процесса: продажа, проектирование, производство, выпуск, отчёт, развитие системы.",
  калибровка:
    "Ставка часа роли, заданная вручную, — заменяет расчёт из зарплаты или почасовой ставки.",
  сдельно: "Оплата за проход операции, а не за часы.",
  "форма привлечения":
    "Штат или внештатно (самозанятый, ИП, ГПХ): штат оплачивается месяцем, внештатный исполнитель — за часы.",
  "продакшн видеоподкаста":
    "Своя команда — свои часы монтажа, обложек и клипов и студийный час с работой студии. Подрядчик — пять компонентов подрядчика вместо этих часов и голая аренда студии.",
  "период счетов":
    "Как часто выставляются счета за срок производства: раз в месяц или в квартал.",
  КП: "Коммерческое предложение.",
  база: "Снимок метрик, с которым сравниваются текущие: модель без правок или запомненный кнопкой «Запомнить как базу».",
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
const fin = (v) => typeof v === "number" && Number.isFinite(v);

const f0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const f1 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const f2 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const rub = (v) =>
  v == null ? "не задано" : fin(v) ? `${f0.format(v)} ₽` : "—";
const hrs = (v) => (fin(v) ? `${f1.format(v)} ч` : "—");
const n2 = (v) => (fin(v) ? f2.format(v) : "—");
const pct = (v) => (fin(v) ? `${f1.format(v * 100)} %` : "—");
const sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "±");
const dRub = (v) => `${sign(v)}${f0.format(Math.abs(v))} ₽`;
const dPct = (v) => `${sign(v)}${f1.format(Math.abs(v * 100))} п. п.`;
const dNum = (v) => `${sign(v)}${f2.format(Math.abs(v))}`;
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
  leaf: "такой операции",
  loop: "такой петли",
  role: "такой роли",
  variable: "такой переменной",
  product: "такого продукта",
  parameter: "такого параметра",
  external: "такой внешней затраты",
  kind: "такого вида правки",
  article: "такой статьи затрат",
  "expert grade": "такого грейда эксперта",
  "price mode": "такого способа цены",
};
const plainError = (message) => {
  const m = /unknown ([\w ]+?)$/.exec(message);
  return m && UNKNOWN[m[1]] ? `${UNKNOWN[m[1]]} в модели нет` : message;
};

/** Model with the edits that apply; an edit compute rejects is reported and left out. */
function evaluate(inputs, overrides, productName, ctx, describeKey) {
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
    result = computeProduct(model, productName, ctx);
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
        ? COURSES.map((k) =>
            loopRounds(model, name, { ...DEFAULT_CTX, course: k }),
          )
        : loop.rounds_draft;
    }
    case "wait":
      return model.loops.get(name)?.wait_days_per_round_draft;
    case "rate":
    case "engage":
    case "grade":
    case "piece":
    case "price":
      // number, range or a list value: compute validates the key itself
      return null;
    case "expert":
      return model.experts.grades[name]?.per_hour_rub;
    case "scale":
      return model.scale[name];
    case "market":
      return model.marketRefs[name]?.rub ?? null;
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

/** Why a range cannot be applied: an empty bound, or bounds out of order. */
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
  if (
    typeof base === "string" ||
    typeof base === "boolean" ||
    (base === null && typeof value === "string")
  )
    return typeof value === typeof base || value === null || base === null
      ? { value }
      : { error: "ожидается значение из списка" };
  if (value === null)
    return base === null
      ? { value }
      : { error: "пустое значение — в модели здесь число" };
  if (Array.isArray(base)) {
    if (fin(value)) return { value: base.map(() => value) };
    if (!Array.isArray(value) || value.length !== base.length)
      return { error: `ожидается диапазон из ${base.length} чисел` };
  }
  if (fin(base) && !fin(value)) return { error: "ожидается одно число" };
  if (Array.isArray(value)) {
    if (!value.every((v) => v == null || fin(v)))
      return { error: "в диапазоне не число" };
    const problem = rangeProblem(value);
    return problem ? { error: problem } : { value };
  }
  return fin(value) ? { value } : { error: "ожидается число" };
}

// One buildModel per distinct edit: a stored edit of a kind this version no longer has (an old
// `var:contractor_form`, a scenario-era range) is dropped with a note instead of breaking the page.
const keyCheck = new Map();
function keyError(inputs, key, value) {
  const sig = `${key}=${JSON.stringify(value)}`;
  if (!keyCheck.has(sig)) {
    try {
      buildModel(inputs, { [key]: value });
      keyCheck.set(sig, null);
    } catch (error) {
      keyCheck.set(sig, plainError(error.message));
    }
  }
  return keyCheck.get(sig);
}

/** Edits split into those in the model's shape and those refused, with a plain reason each. */
function normaliseEdits(inputs, model, overrides, describeKey) {
  const clean = {};
  const errors = [];
  for (const [key, value] of Object.entries(overrides)) {
    const r = normaliseEdit(model, key, value);
    const refused = "error" in r ? r.error : keyError(inputs, key, r.value);
    if (refused)
      errors.push(
        `правка «${describeKey(key)}» (${shape(value)}) убрана: ${refused} — в этой версии калькулятора её нет или она в другом виде`,
      );
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
    const [kind, id, field, sub] = key.split(":");
    switch (kind) {
      case "leaf":
        return `Часы операции: ${leafName(id)}`;
      case "lead":
        return `Срок операции: ${leafName(id)}`;
      case "piece":
        return `Сдельная цена: ${leafName(id)}`;
      case "loop":
        return `Круги петли «${id}»`;
      case "wait":
        return `Ожидание между кругами петли «${id}»`;
      case "rate":
        return `${
          {
            monthly: "Зарплата gross в месяц",
            hourly: "Внештатный час, ₽",
            hourly_cost: "Калибровка ₽/ч",
          }[field] ?? "Ставка"
        }: ${id}${sub ? ` (${sub})` : ""}`;
      case "engage":
        return `Форма привлечения: ${id}`;
      case "grade":
        return `Грейд роли: ${id}`;
      case "expert":
        return `Час эксперта: ${id}`;
      case "scale":
        return `Бюджет статьи: ${ARTICLE_LABELS[id] ?? id}`;
      case "market":
        return `Рыночный ориентир: ${productLabel(id)}`;
      case "price":
        return `Цена «${productLabel(id)}»: ${PRICE_MODE_LABEL[field] ?? field}`;
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
    expert: " ₽/ч",
    external: " ₽",
    market: " ₽",
  };
  const value = (key, v) => {
    const [kind, id, field] = key.split(":");
    if (kind === "var" && VAR_OPTIONS[id])
      return VAR_OPTIONS[id].find(([k]) => k === (v ?? ""))?.[1] ?? shape(v);
    if (kind === "engage")
      return v == null ? "как в модели" : (ENGAGEMENT_LABELS[v] ?? v);
    if (kind === "grade")
      return v == null ? "грейд команды" : (GRADE_LABELS[v] ?? v);
    if (kind === "scale") return pct(v);
    if (kind === "price")
      return field === "markup" || field === "margin"
        ? pct(v)
        : field === "fixed"
          ? rub(v)
          : `× ${n2(v)}`;
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
// A ranged hours / rounds value is read by «Ход работы»: smooth → min, usual → middle, rework → max.
const COURSE_SLOTS = {
  1: undefined,
  2: ["гладко", "с переделками"],
  3: ["гладко", "обычно", "с переделками"],
};

/** Slots shown for a value: a mismatched shape (a number on a range field) renders, never throws. */
const slotsOf = (value, n) =>
  Array.from({ length: n }, (_, i) =>
    Array.isArray(value) ? (value[i] ?? null) : (value ?? null),
  );

/** A term with its glossary text: a styled tooltip on hover and keyboard focus (see TipLayer). */
function Term({ t, children }) {
  const text = GLOSSARY[t];
  if (!text) return children ?? t;
  return view`<span class="term" tabindex="0" data-tip=${text}
    >${children ?? t}</span
  >`;
}

/** One floating tooltip for every <Term>: fixed-positioned, so tables with overflow never clip it. */
function TipLayer() {
  const [tip, setTip] = useState(null);
  useEffect(() => {
    let current = null;
    const show = (e) => {
      const el = e.target?.closest?.("[data-tip]");
      if (!el || el === current) return;
      current?.removeAttribute("aria-describedby");
      current = el;
      el.setAttribute("aria-describedby", "term-tip");
      const box = el.getBoundingClientRect();
      const below = box.bottom + 120 < window.innerHeight;
      setTip({
        text: el.dataset.tip,
        left: Math.max(8, Math.min(box.left, window.innerWidth - 328)),
        top: below ? box.bottom + 6 : null,
        bottom: below ? null : window.innerHeight - box.top + 6,
      });
    };
    const hide = (e) => {
      const el = e.target?.closest?.("[data-tip]");
      if (!el || el !== current) return;
      if (e.relatedTarget && el.contains(e.relatedTarget)) return;
      el.removeAttribute("aria-describedby");
      current = null;
      setTip(null);
    };
    const esc = (e) => {
      if (e.key !== "Escape" || !current) return;
      current.removeAttribute("aria-describedby");
      current = null;
      setTip(null);
    };
    const scrolled = () => {
      if (!current) return;
      current.removeAttribute("aria-describedby");
      current = null;
      setTip(null);
    };
    document.addEventListener("pointerover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("pointerout", hide);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", scrolled, true);
    return () => {
      document.removeEventListener("pointerover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("pointerout", hide);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", scrolled, true);
    };
  }, []);
  return view`<div
    id="term-tip"
    role="tooltip"
    class="tiplayer"
    hidden=${!tip}
    style=${tip ? { left: tip.left, top: tip.top ?? "auto", bottom: tip.bottom ?? "auto" } : {}}
  >
    ${tip?.text}
  </div>`;
}

/**
 * Number / range editor: one input per slot of the model value ([min, max] or [min, mid, max]).
 * A value that is not a number, an emptied bound or disordered bounds is marked and not applied —
 * the last applied value stays; an empty field means «не задано» only where the model allows it.
 */
function NumberEdit({ value, base, label, nullable, onChange, slots, wide }) {
  const n = Array.isArray(base)
    ? base.length
    : Array.isArray(value)
      ? value.length
      : 1;
  const names = slots ?? SLOT[n];
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
    // Only an outside change (reset, import, another control) rewrites what is being typed.
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
  return view`${text.map(
    (t, i) =>
      view`${i ? view`<span class="muted">–</span>` : null}<input
          key=${i}
          inputmode="decimal"
          class=${`${problem ? "bad" : ""}${wide ? " wide" : ""}`}
          aria-invalid=${problem ? "true" : "false"}
          aria-label=${`${label}${names?.[i] ? `, ${names[i]}` : ""}`}
          placeholder=${names?.[i] || undefined}
          value=${t}
          onChange=${(e) => type(i, e.target.value)}
        />`,
  )}${
    problem
      ? view`<span class="err small" data-testid="field-problem"
          >не применено: ${problem}</span
        >`
      : null
  }`;
}

/** One editable model value, addressed by its override key; edited values are marked. */
function Field({ k, base, label, options, slots, wide }) {
  const c = useContext(Ctx);
  const edited = Object.hasOwn(c.ov, k);
  const value = edited ? c.ov[k] : base;
  const choose = (v) => {
    const next =
      v === "" ? null : v === "true" ? true : v === "false" ? false : v;
    if (JSON.stringify(next) === JSON.stringify(base ?? null)) c.reset(k);
    else c.set(k, next);
  };
  return view`<span class=${`edit${edited ? " edited" : ""}`}>
    ${
      options
        ? view`<select
            aria-label=${label}
            value=${value == null ? "" : String(value)}
            onChange=${(e) => choose(e.target.value)}
          >
            ${options.map(
              ([v, name]) => view`<option key=${v} value=${v}>${name}</option>`,
            )}
          </select>`
        : view`<${NumberEdit}
            value=${value}
            base=${base}
            label=${label}
            slots=${slots}
            wide=${wide}
            nullable=${base == null}
            onChange=${(v) =>
              JSON.stringify(v) === JSON.stringify(base)
                ? c.reset(k)
                : c.set(k, v)}
          />`
    }
    ${
      edited
        ? view`<span class="mark" aria-hidden="true">●</span
            ><button
              class="link"
              aria-label=${`сбросить ${label}; в модели: ${shape(base)}`}
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
  return view`<${Field}
    k=${`leaf:${id}`}
    base=${c.base.leaves.get(id).hours}
    label=${`часы за проход ${id}`}
  />`;
}

function LeafRef({ id }) {
  const c = useContext(Ctx);
  const leaf = c.model.leaves.get(id);
  if (!leaf) return view`<span class="id">${id}</span>`;
  return view`<a
      class="id"
      href=${`../viewer/#${encodeURIComponent(leaf.diagram)}`}
      target="_blank"
      rel="noopener"
      >${id}</a
    >
    ${leaf.name}`;
}

/** Trail lines: hours per pass × rounds × quantity = hours, × hourly cost = ₽. */
function TrailTable({ lines, showRole = true, showSum = true }) {
  const totalH = lines.reduce((a, l) => a + (l.hours ?? 0), 0);
  const totalC = lines.reduce((a, l) => a + (l.cost ?? 0), 0);
  return view`<div class="scroll">
    <table>
      <thead>
        <tr>
          <th><${Term} t="операция">Операция<//></th>
          ${showRole ? view`<th>Роль</th>` : null}
          <th>ч за проход × <${Term} t="круги">круги<//> × кол-во</th>
          <th class="num">часы</th>
          <th class="num"><${Term} t="₽/ч">₽/ч<//></th>
          <th class="num">₽</th>
        </tr>
      </thead>
      <tbody>
        ${lines.map(
          (l, i) =>
            view`<tr key=${i}>
              <td><${LeafRef} id=${l.leaf} /></td>
              ${showRole ? view`<td>${l.role}</td>` : null}
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
                      ? view`<${Term} t="сдельно">сдельно<//>`
                      : "не задана"
                    : rub(l.hourlyCost)
                }
              </td>
              <td class="num">${rub(l.cost)}</td>
            </tr>`,
        )}
        ${
          showSum
            ? view`<tr class="sum">
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
  return view`<details open=${open} data-testid=${testid}>
    <summary>
      <span class="name">${name}</span><span class="amount">${amount}</span>
    </summary>
    <div class="body">${children}</div>
  </details>`;
}

/** The team circle's direct hours cut per member role — freelance members at their own hour. */
function CircleMembers({ circle }) {
  return view`<div class="scroll">
    <p class="small muted">
      Часы круга делятся между участниками по FTE; внештатный участник — по
      своему часу.
    </p>
    <table data-testid="circle-members">
      <thead>
        <tr>
          <th>Участник</th>
          <th><${Term} t="форма привлечения">Форма<//></th>
          <th class="num">часы</th>
          <th class="num">₽/ч</th>
          <th class="num">₽</th>
        </tr>
      </thead>
      <tbody>
        ${circle.members.map(
          (m) =>
            view`<tr key=${m.role}>
              <td>${m.role}</td>
              <td>
                ${ENGAGEMENT_LABELS[m.engagement] ?? m.engagement}
                <span class="muted small">· ${ARTICLE_LABELS[m.article] ?? ""}</span>
              </td>
              <td class="num">${hrs(m.hours)}</td>
              <td class="num">${rub(m.hourlyCost)}</td>
              <td class="num">${rub(m.cost)}</td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

const topFunction = (id) => /^A\d/.exec(id ?? "")?.[0] ?? "—";

function DirectDrill({ r, model }) {
  const direct = r.trail.filter((l) => l.class === "direct");
  const qty = new Map(r.units.map((u) => [u.path.join(" → "), u.qty]));
  const groups = new Map();
  for (const l of direct) {
    const key = l.path.slice(0, -1).join(" → ");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  const fns = new Map();
  for (const l of direct) {
    const key = topFunction(l.leaf);
    if (!fns.has(key)) fns.set(key, []);
    fns.get(key).push(l);
  }
  const titles = new Map(model.inputs.diagrams.map((d) => [d.id, d.title]));
  const roles = Object.entries(r.direct.byRole).sort(
    (a, b) => b[1].cost - a[1].cost,
  );
  return view`<${Drill}
    testid="drill-direct"
    name=${view`<b>Прямые затраты</b> <span class="muted small"
        ><${Term} t="прямые часы">${hrs(r.direct.hours)}<//></span
      >`}
    amount=${rub(r.direct.cost)}
  >
    <${Drill} name="По ролям" amount="" testid="direct-by-role">
      ${roles.map(
        ([role, v]) =>
          view`<${Drill}
            key=${role}
            name=${view`${role}${" "}<span class="muted small"
                >${hrs(v.hours)} ·${" "}
                ${
                  r.direct.circle?.role === role
                    ? "круг"
                    : ENGAGEMENT_LABELS[roleEngagement(model, role)]
                }</span
              >`}
            amount=${rub(v.cost)}
          >
            ${
              r.direct.circle?.role === role
                ? view`<${CircleMembers} circle=${r.direct.circle} />`
                : null
            }
            <${TrailTable}
              lines=${direct.filter((l) => l.role === role)}
              showRole=${false}
            />
          <//>`,
      )}
    <//>
    <${Drill}
      name=${view`По <${Term} t="функции схемы">функциям схемы<//>`}
      amount=""
      testid="direct-by-function"
    >
      ${[...fns]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(
          ([fn, lines]) =>
            view`<${Drill}
              key=${fn}
              name=${view`<span class="id">${fn}</span> ${titles.get(fn) ?? ""}${" "}<span
                  class="muted small"
                  >${hrs(lines.reduce((a, l) => a + l.hours, 0))}</span
                >`}
              amount=${rub(lines.reduce((a, l) => a + (l.cost ?? 0), 0))}
            >
              <${TrailTable} lines=${lines} />
            <//>`,
        )}
    <//>
    <${Drill}
      name="По составу: продукт → единица → операция → роль"
      amount=""
      testid="direct-by-unit"
    >
      ${[...groups].map(
        ([key, lines]) =>
          view`<${Drill}
            key=${key}
            name=${view`${key}${" "}<span class="muted small"
                >× ${n2(qty.get(key))} ·${" "}
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

/** Staff hour of every штат role of the product: gross → bonus → contributions → divisor → other. */
function StaffHourDrill({ r, model, ctx }) {
  const roles = Object.keys(r.direct.byRole)
    .flatMap((role) =>
      r.direct.circle?.role === role
        ? r.direct.circle.members.map((m) => m.role)
        : [role],
    )
    .filter((role, i, all) => all.indexOf(role) === i)
    .filter((role) => roleEngagement(model, role) === "staff")
    .map((role) => staffHour(model, role, ctx))
    .filter((h) => h.full != null);
  if (!roles.length) return null;
  const mode =
    model.vars.contributions_mode === "msp_priority"
      ? "режим МСП"
      : "общий режим";
  return view`<${Drill}
    testid="drill-staff-hour"
    name=${view`<b><${Term} t="час штата">Час штата<//></b>${" "}<span class="muted small"
        >как считается ставка штатных ролей</span
      >`}
    amount=""
  >
    <p class="small muted">
      <${Term} t="gross">gross<//> → + <${Term} t="премия">премия<//>${" "}
      ${pct(model.vars.bonus_share)} → + <${Term} t="взносы">взносы<//>${" "}
      (${mode}) → ÷ <${Term} t="делитель">${n2(model.vars.paid_hours_per_month)} ч<//>${" "}
      → + <${Term} t="прочие расходы">прочие расходы<//>${" "}
      ${rub(model.vars.staff_other_costs_rub_month)} в месяц ÷ те же часы = час
      → × масштаб ФОТ ${pct(model.scale.payroll)} = полный час.
    </p>
    <div class="scroll">
      <table data-testid="staff-hour">
        <thead>
          <tr>
            <th>Роль · грейд</th>
            <th class="num">gross, мес.</th>
            <th class="num">+ премия</th>
            <th class="num">+ взносы</th>
            <th class="num">÷ часы → ₽/ч</th>
            <th class="num">+ прочие ₽/ч</th>
            <th class="num">час</th>
            <th class="num">полный час</th>
          </tr>
        </thead>
        <tbody>
          ${roles.map(
            (h) =>
              view`<tr key=${h.role}>
                <td>
                  ${h.role}
                  <span class="muted small">· ${GRADE_LABELS[h.grade] ?? h.grade}</span>
                </td>
                <td class="num">${rub(h.gross)}</td>
                <td class="num">${rub(h.bonus)}</td>
                <td class="num">${rub(h.contributions)}</td>
                <td class="num">${rub(h.payPerHour)}</td>
                <td class="num">${rub(h.otherPerHour)}</td>
                <td class="num">${rub(h.hour)}</td>
                <td class="num"><b>${rub(h.full)}</b></td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>
  <//>`;
}

function ExpertsDrill({ r, model, ctx }) {
  const c = useContext(Ctx);
  const experts = Object.keys(r.direct.byRole).filter(
    (role) => model.config.expert_roles?.[role],
  );
  if (!experts.length) return null;
  return view`<${Drill}
    testid="drill-experts"
    name=${view`<b><${Term} t="эксперт">Эксперты<//></b>`}
    amount=${rub(experts.reduce((a, role) => a + r.direct.byRole[role].cost, 0))}
  >
    <table>
      <tbody>
        ${experts.map((role) => {
          const rate = roleHourlyCost(model, role, ctx);
          const v = model.config.expert_roles[role];
          return view`<tr key=${role}>
            <td>${role}</td>
            <td>
              <${Term} t="грейд эксперта">грейд<//>${" "}<${Field}
                k=${`var:${v}`}
                base=${c.base.vars[v]}
                label=${`грейд эксперта ${role}`}
                options=${Object.keys(model.experts.grades).map((g) => [g, g])}
              />
            </td>
            <td class="num">${hrs(r.direct.byRole[role].hours)}</td>
            <td class="num">${rub(rate.value)}/ч</td>
            <td class="num">${rub(r.direct.byRole[role].cost)}</td>
          </tr>`;
        })}
      </tbody>
    </table>
    <p class="small muted">
      Час эксперта = середина диапазона грейда × (1 + надбавка формы договора) ×
      масштаб статьи «эксперты». Диапазоны грейдов — вкладка «Эксперты».
    </p>
  <//>`;
}

function OverheadDrill({ r, plan }) {
  const own = r.trail.filter((l) => l.class === "overhead");
  return view`<${Drill}
    testid="drill-overhead"
    name=${view`<b><${Term} t="накладные">Накладные<//></b>`}
    amount=${rub(r.overhead.cost)}
  >
    <p>
      ${rub(r.overhead.perDirectHour)} на прямой час × ${hrs(r.direct.hours)}${" "}
      прямых часов = ${rub(r.overhead.cost)}.
    </p>
    <p class="small muted">
      Ставка накладных = пул месяца плана ${rub(plan.poolCost)} ÷${" "}
      ${hrs(plan.directHours)} прямых часов плана. Чем занята команда в месяц —
      вкладка «План месяца команды».
    </p>
    <${Drill} name="Пул накладных месяца плана" amount=${rub(plan.poolCost)}>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Операция</th>
              <th>Роль</th>
              <th>Откуда</th>
              <th class="num">часы</th>
              <th class="num">₽</th>
            </tr>
          </thead>
          <tbody>
            ${plan.poolLines.map(
              (l, i) =>
                view`<tr key=${i}>
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
        ? view`<${Drill}
            name="Накладные операции самой единицы (входят в пул через план)"
            amount=${hrs(r.overhead.ownHours)}
          >
            <${TrailTable} lines=${own} showSum=${false} />
          <//>`
        : null
    }
  <//>`;
}

function ReserveDrill({ r, model, ctx }) {
  const v = (name) => n2(pick(model.vars[name], COURSE_LEVEL[ctx.course]));
  const cfg = model.config.update_reserve;
  return view`<${Drill}
    testid="drill-reserve"
    name=${view`<b><${Term} t="резерв актуализации">Резерв актуализации<//></b>${" "}<span
        class="muted small"
        >${hrs(r.reserve.hours)}</span
      >`}
    amount=${rub(r.reserve.cost)}
  >
    <p>
      На каждую единицу с линией выпуска: сигналов ${v("signals_per_unit")} ×
      операция ${cfg.signal_leaf} + доля затронутых ${v("affected_share")} ×
      (операции ${cfg.affected_leaves.join(", ")} + доля пересборки${" "}
      ${v("rebuild_share")} × прямые часы линии единицы), × ставки ролей; сумма
      по всем единицам продукта.
    </p>
  <//>`;
}

function IdleDrill({ r, plan }) {
  return view`<${Drill}
    testid="drill-idle"
    name=${view`<b><${Term} t="неиспользованная мощность">Неиспользованная мощность штата<//></b>${" "}<span
        class="muted small"
        >только в итоге «с полным фондом оплаты»</span
      >`}
    amount=${rub(r.idle.cost)}
  >
    <p>
      ${rub(r.idle.perDirectHour)} на прямой час × ${hrs(r.direct.hours)} прямых
      часов = ${rub(r.idle.cost)}.
    </p>
    <p class="small muted">
      Ставка = свободное оплаченное время штата за месяц плана${" "}
      ${rub(plan.idle.cost)} (${hrs(plan.idle.hours)}) ÷${" "}
      ${hrs(plan.directHours)} прямых часов плана. Состав по ролям — вкладка
      «План месяца команды».
    </p>
  <//>`;
}

function ToolsDrill({ r, plan }) {
  const t = plan.tools;
  const GROUP = {
    subscriptions: "подписки",
    oneOff: "разовые покупки (в месяц срока службы)",
    platform: "платформа DS",
    capex: "оборудование (в месяц срока службы)",
  };
  return view`<${Drill}
    testid="drill-tools"
    name=${view`<b><${Term} t="пул инструментов">Инструменты и инфраструктура<//></b>`}
    amount=${rub(r.tools.cost)}
  >
    <p>
      Пул месяца ${rub(t.total)} (ИИ ${rub(t.ai)}, прочее ${rub(t.other)}) ÷${" "}
      ${hrs(plan.directHours)} прямых часов плана = ${rub(t.perDirectHour)} на
      прямой час × ${hrs(r.direct.hours)} = ${rub(r.tools.cost)}.
    </p>
    <p class="small muted">
      Мест в подписках: ${n2(t.seats)}; комиссия посредника за зарубежные
      подписки ${pct(t.markup)}. Правка — вкладка «Инструменты».
    </p>
    <${Drill} name="Состав пула месяца" amount=${rub(t.total)}>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Позиция</th>
              <th>Группа</th>
              <th>Статья</th>
              <th class="num">₽ в месяц</th>
            </tr>
          </thead>
          <tbody>
            ${t.items.map(
              (i) =>
                view`<tr key=${i.item}>
                  <td>${i.item}</td>
                  <td>${GROUP[i.group]}</td>
                  <td>${ARTICLE_LABELS[i.article]}</td>
                  <td class="num">${rub(i.rub)}</td>
                </tr>`,
            )}
          </tbody>
        </table>
      </div>
    <//>
  <//>`;
}

function ExternalsDrill({ r }) {
  const set = r.externals.reduce((a, e) => a + (e.cost ?? 0), 0);
  const amount = !r.externals.length
    ? "нет"
    : r.externals.every((e) => e.cost == null)
      ? "не задано"
      : rub(set);
  return view`<${Drill}
    testid="drill-externals"
    name=${view`<b><${Term} t="внешние затраты">Внешние затраты<//></b>`}
    amount=${amount}
  >
    ${
      r.externals.length
        ? view`<div class="scroll">
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
                    view`<tr key=${e.id}>
                      <td>
                        ${e.name} <span class="muted small">на ${e.per}</span>
                      </td>
                      <td class="num">${n2(e.qty)}</td>
                      <td>
                        ${
                          e.id === "extended_campaign"
                            ? view`<${Field}
                                k="var:campaign_cost_per_contact"
                                base=${null}
                                label="стоимость привлечения контакта"
                              />`
                            : view`<${ExternalField} id=${e.id} />`
                        }
                      </td>
                      <td class="num">
                        ${
                          e.cost == null
                            ? view`<span class="err"
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
        : view`<p class="muted">У продукта нет внешних затрат.</p>`
    }
    ${
      r.pending.length
        ? view`<${Drill}
            testid="drill-pending"
            name=${view`<${Term} t="чёрный ящик">Чёрные ящики<//> — не задано`}
            amount=${`${r.pending.length} шт.`}
          >
            <ul class="small">
              ${r.pending.map(
                (p, i) =>
                  view`<li key=${i}>
                    <span class="id">${p.leaf}</span> ${p.boxName} ×${" "}
                    ${n2(p.qty)} — ${p.name}
                  </li>`,
              )}
            </ul>
          <//>`
        : null
    }
  <//>`;
}

function ExternalField({ id }) {
  const c = useContext(Ctx);
  const e = c.base.externals[id];
  if (!e) return view`<span class="muted">—</span>`;
  return view`<${Field}
    k=${`external:${id}`}
    base=${e.rub}
    label=${`внешняя затрата ${e.name}`}
  />`;
}

function Breakdown({ r, plan, model, ctx }) {
  return view`<section class="card" data-testid="breakdown">
    <h2>Из чего складывается <${Term} t="себестоимость">себестоимость<//></h2>
    <${DirectDrill} r=${r} model=${model} />
    <${StaffHourDrill} r=${r} model=${model} ctx=${ctx} />
    <${ExpertsDrill} r=${r} model=${model} ctx=${ctx} />
    <${OverheadDrill} r=${r} plan=${plan} />
    <${ReserveDrill} r=${r} model=${model} ctx=${ctx} />
    <${ExternalsDrill} r=${r} />
    <${ToolsDrill} r=${r} plan=${plan} />
    <${Drill}
      name=${view`<b>Итог «<${Term} t="по загрузке">по загрузке<//>»</b>`}
      amount=${rub(r.total.byLoad)}
      testid="sum-by-load"
    >
      <p>
        прямые ${rub(r.direct.cost)} + накладные ${rub(r.overhead.cost)} +
        резерв ${rub(r.reserve.cost)} + внешние ${rub(r.externalCost)} +
        инструменты ${rub(r.tools.cost)}
      </p>
    <//>
    <${IdleDrill} r=${r} plan=${plan} />
    <${Drill}
      name=${view`<b>Итог «<${Term} t="с полным фондом оплаты">с полным фондом оплаты<//>»</b>`}
      amount=${rub(r.total.fullPayroll)}
    >
      <p>${rub(r.total.byLoad)} + ${rub(r.idle.cost)}</p>
    <//>
    <${Drill} name="По статьям затрат" amount=${rub(r.total.fullPayroll)}>
      <table>
        <tbody>
          ${ARTICLES.map(
            (a) =>
              view`<tr key=${a}>
                <td>${ARTICLE_LABELS[a]}</td>
                <td class="num">${rub(r.articles[a])}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    <//>
  </section>`;
}

// ── KPI bar ──

function metricsOf(r) {
  if (!r) return null;
  const p = r.price;
  const plan = p.contacts.plan;
  return {
    cost: p.cost,
    price: p.price,
    profit: p.price - p.cost,
    markup: p.derived.markup,
    margin: p.derived.margin,
    multiplier: p.derived.multiplier,
    perContact: plan ? p.price / plan : null,
    breakEven: p.breakEvenContacts,
  };
}

function Kpi({ label, term, value, base, fmt, dfmt, lead, testid, hint }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setFlash((f) => f + 1);
    }
  }, [value]);
  const delta = fin(value) && fin(base) ? value - base : null;
  return view`<div class=${`kpi${lead ? " lead" : ""}`} data-testid=${testid}>
    <div class="label"><${Term} t=${term}>${label}<//>${hint ? view` <span class="hint">${hint}</span>` : null}</div>
    <div class=${flash ? "value flash" : "value"} key=${flash}>${fmt(value)}</div>
    <div class="delta">
      ${
        delta == null
          ? " "
          : Math.abs(delta) < 1e-9
            ? "= база"
            : `${dfmt(delta)} к базе`
      }
    </div>
  </div>`;
}

function KpiBar({ r, base, baseNote, onRemember, onForget, remembered }) {
  const m = metricsOf(r);
  const b = metricsOf(base) ?? {};
  const mode = r.price.mode;
  const be = (v) =>
    v == null ? "не достигается" : `${f0.format(Math.ceil(v))} контактов`;
  return view`<section class="kpibar" data-testid="kpi">
    <${Kpi} label="Себестоимость" term="себестоимость" value=${m.cost} base=${b.cost} fmt=${rub} dfmt=${dRub} testid="kpi-cost" />
    <${Kpi} label="Цена" term="цена" value=${m.price} base=${b.price} fmt=${rub} dfmt=${dRub} lead=${mode === "fixed"} testid="kpi-price" />
    <${Kpi} label="Прибыль" term="прибыль" value=${m.profit} base=${b.profit} fmt=${rub} dfmt=${dRub} testid="kpi-profit" />
    <${Kpi} label="Наценка" hint="прибыль ÷ себест." term="наценка" value=${m.markup} base=${b.markup} fmt=${pct} dfmt=${dPct} lead=${mode === "markup"} testid="kpi-markup" />
    <${Kpi} label="Маржа" hint="прибыль ÷ цена" term="маржа" value=${m.margin} base=${b.margin} fmt=${pct} dfmt=${dPct} lead=${mode === "margin"} testid="kpi-margin" />
    <${Kpi} label="Множитель" term="множитель" value=${m.multiplier} base=${b.multiplier} fmt=${(v) => (fin(v) ? `× ${f2.format(v)}` : "—")} dfmt=${dNum} lead=${mode === "multiplier"} testid="kpi-multiplier" />
    <${Kpi} label="Цена за контакт (план)" term="контакт" value=${m.perContact} base=${b.perContact} fmt=${(v) => (v == null ? "нет контактов" : rub(v))} dfmt=${dRub} testid="kpi-per-contact" />
    <${Kpi} label="Безубыточность" term="безубыточность" value=${m.breakEven} base=${b.breakEven} fmt=${be} dfmt=${(v) => `${sign(v)}${f0.format(Math.abs(v))}`} testid="kpi-break-even" />
    <div class="kpi baseline">
      <div class="label"><${Term} t="база">База сравнения<//></div>
      <div class="small">${baseNote}</div>
      <div class="toolbar">
        <button onClick=${onRemember} data-testid="remember-base">Запомнить как базу</button>
        ${remembered ? view`<button class="link" onClick=${onForget}>к модели без правок</button>` : null}
      </div>
    </div>
  </section>`;
}

// ── Charts (inline SVG, light theme) ──

const W = 720;
const niceMax = (v) => {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
};
const short = (v) =>
  !fin(v)
    ? "—"
    : Math.abs(v) >= 1e6
      ? `${f1.format(v / 1e6)} млн`
      : Math.abs(v) >= 1e3
        ? `${f0.format(v / 1e3)} тыс.`
        : f0.format(v);

/** «Золотая цена»: one ₽ axis with cost, price, the band, the market range and the budget cap. */
function GoldenBand({ r }) {
  const g = r.golden;
  const mk = r.market;
  const cap = r.price.budgetCap.value;
  const marks = [
    { v: r.price.cost, label: "себестоимость (пол)", cls: "m-cost" },
    { v: r.price.price, label: "цена", cls: "m-price" },
    mk && { v: mk.min, label: "рынок мин", cls: "m-market" },
    mk && { v: mk.max, label: "рынок макс", cls: "m-market" },
    cap != null && { v: cap, label: "потолок бюджета", cls: "m-cap" },
  ].filter(Boolean);
  const top = niceMax(Math.max(...marks.map((m) => m.v)) * 1.08);
  const L = 16;
  const R = W - 16;
  const x = (v) => L + ((R - L) * v) / top;
  const H = 70 + marks.length * 16;
  const sorted = [...marks].sort((a, b) => a.v - b.v);
  return view`<figure class="chart" data-testid="chart-golden">
    <svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Золотая цена: полоса, цена, рынок и потолок бюджета">
      ${mk ? view`<rect x=${x(mk.min)} y="20" width=${Math.max(1, x(mk.max) - x(mk.min))} height="10" class="c-market" />` : null}
      ${
        g.band
          ? view`<rect x=${x(g.band[0])} y="34" width=${Math.max(1, x(g.band[1]) - x(g.band[0]))} height="14" class="c-band" />`
          : null
      }
      <line x1=${L} x2=${R} y1="52" y2="52" class="axis" />
      ${[0, 0.25, 0.5, 0.75, 1].map(
        (t) => view`<g key=${t}>
          <line x1=${x(top * t)} x2=${x(top * t)} y1="52" y2="56" class="axis" />
          <text x=${x(top * t)} y="66" class="tick" text-anchor=${t === 0 ? "start" : t === 1 ? "end" : "middle"}>${short(top * t)}</text>
        </g>`,
      )}
      ${sorted.map((m, i) => {
        const y = 80 + i * 16;
        const anchor = x(m.v) > W * 0.7 ? "end" : "start";
        return view`<g key=${m.label}>
          <line x1=${x(m.v)} x2=${x(m.v)} y1="16" y2=${y - 10} class=${`mark ${m.cls}`} />
          <text x=${x(m.v) + (anchor === "end" ? -4 : 4)} y=${y - 2} text-anchor=${anchor} class=${`lbl ${m.cls}`}>${m.label}: ${rub(m.v)}</text>
        </g>`;
      })}
    </svg>
    <figcaption class="small muted">
      ${
        g.band
          ? view`Полоса <${Term} t="золотая цена">золотой цены<//>: ${rub(g.band[0])} – ${rub(g.band[1])};
              цена ${g.priceInBand ? view`<b class="ok">в полосе</b>` : view`<b class="err">вне полосы</b>`}.`
          : g.max == null
            ? "Верхней границы нет: нет рыночного ориентира и потолка бюджета."
            : view`<b class="err">Полосы нет:</b> себестоимость ${rub(g.min)} выше потолка ${rub(g.max)} — продукт дороже рынка или бюджета.`
      }
      ${" "}Серая полоса — рыночный ориентир, зелёная — золотая цена.
    </figcaption>
  </figure>`;
}

/** Tornado: each driver alone, low ↔ high, bars sorted by swing, a base line at the current value. */
function Tornado({ sens, metric }) {
  const rows = [...sens.drivers]
    .map((d) => ({ ...d, lo: d.low[metric], hi: d.high[metric] }))
    .map((d) => ({ ...d, swing: Math.abs(d.hi - d.lo) }))
    .sort((a, b) => b.swing - a.swing)
    .slice(0, 9);
  const base = sens.base[metric];
  const all = rows.flatMap((d) => [d.lo, d.hi]).concat(base);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min) * 0.05 || 1;
  const LW = 300;
  const L = LW + 8;
  const R = W - 70;
  const x = (v) => L + ((R - L) * (v - (min - pad))) / (max - min + 2 * pad);
  const rowH = 26;
  const H = rows.length * rowH + 34;
  return view`<svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Что двигает цену: торнадо" data-testid="chart-tornado">
    ${rows.map((d, i) => {
      const y = 8 + i * rowH;
      const segs = [
        { v: d.lo, cls: "c-low" },
        { v: d.hi, cls: "c-high" },
      ];
      return view`<g key=${d.id}>
        <text
          x=${LW}
          y=${y + 14}
          text-anchor="end"
          class="lbl"
          textLength=${d.label.length > 44 ? LW - 4 : undefined}
          lengthAdjust="spacingAndGlyphs"
          >${d.label}</text
        >
        ${segs.map(
          (s, j) =>
            view`<rect key=${j} x=${Math.min(x(base), x(s.v))} y=${y + 3} width=${Math.max(1, Math.abs(x(s.v) - x(base)))} height=${rowH - 8} class=${s.cls} />`,
        )}
        <text x=${Math.max(x(d.lo), x(d.hi)) + 4} y=${y + 14} class="tick">${short(Math.max(d.lo, d.hi))}</text>
        <text x=${Math.min(x(d.lo), x(d.hi)) - 4} y=${y + 14} text-anchor="end" class="tick">${
          Math.min(x(d.lo), x(d.hi)) - 4 > LW + 40
            ? short(Math.min(d.lo, d.hi))
            : ""
        }</text>
      </g>`;
    })}
    <line x1=${x(base)} x2=${x(base)} y1="4" y2=${H - 22} class="baseline" />
    <text x=${x(base)} y=${H - 8} text-anchor="middle" class="tick">база ${short(base)} ₽</text>
  </svg>`;
}

/** Break-even by contacts: studio cost (flat), revenue = advance + contacts × price per contact. */
function BreakEven({ r, series }) {
  const p = r.price;
  const cap = p.budgetCap.value;
  const top = series.at(-1).contacts || 1;
  const ymax = niceMax(
    Math.max(...series.map((s) => s.revenue), p.cost, cap ?? 0) * 1.08,
  );
  const L = 64;
  const R = W - 16;
  const T = 12;
  const B = 200;
  const x = (v) => L + ((R - L) * v) / top;
  const y = (v) => B - ((B - T) * v) / ymax;
  const path = series
    .map((s, i) => `${i ? "L" : "M"}${x(s.contacts)},${y(s.revenue)}`)
    .join(" ");
  const be = p.breakEvenContacts;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return view`<figure class="chart" data-testid="chart-break-even">
    <svg viewBox=${`0 0 ${W} 240`} role="img" aria-label="Безубыточность по контактам">
      ${ticks.map(
        (t) => view`<g key=${t}>
          <line x1=${L} x2=${R} y1=${y(ymax * t)} y2=${y(ymax * t)} class="grid" />
          <text x=${L - 6} y=${y(ymax * t) + 4} text-anchor="end" class="tick">${short(ymax * t)}</text>
          <text x=${x(top * t)} y=${B + 16} text-anchor="middle" class="tick">${f0.format(top * t)}</text>
        </g>`,
      )}
      ${["low", "plan", "high"].map((k) =>
        p.contacts[k] <= top
          ? view`<g key=${k}>
              <line x1=${x(p.contacts[k])} x2=${x(p.contacts[k])} y1=${T} y2=${B} class="mark m-market" />
              <text
                x=${x(p.contacts[k]) > R - 48 ? x(p.contacts[k]) - 3 : x(p.contacts[k]) + 3}
                y=${T + 10}
                text-anchor=${x(p.contacts[k]) > R - 48 ? "end" : "start"}
                class="tick"
              >${{ low: "мало", plan: "план", high: "много" }[k]}</text>
            </g>`
          : null,
      )}
      ${cap != null && cap <= ymax ? view`<line x1=${L} x2=${R} y1=${y(cap)} y2=${y(cap)} class="mark m-cap" /><text x=${R} y=${y(cap) - 4} text-anchor="end" class="lbl m-cap">потолок бюджета ${rub(cap)}</text>` : null}
      <line x1=${L} x2=${R} y1=${y(p.cost)} y2=${y(p.cost)} class="line-cost" />
      <text x=${L + 4} y=${y(p.cost) - 4} class="lbl m-cost">себестоимость ${rub(p.cost)}</text>
      <path d=${path} class="line-revenue" />
      ${
        be != null && be <= top
          ? view`<circle cx=${x(be)} cy=${y(p.cost)} r="5" class="dot" />`
          : null
      }
      <line x1=${L} x2=${R} y1=${B} y2=${B} class="axis" />
      <text x=${R} y=${B + 32} text-anchor="end" class="tick">контакты</text>
    </svg>
    <figcaption class="small">
      <b>${be == null ? "Безубыточность не достигается" : `Безубыточность: ${f0.format(Math.ceil(be))} контактов`}</b>
      <span class="muted">
        ${" "}— синяя линия: выручка = аванс ${rub(p.advance)} + контакты ×${" "}
        ${rub(p.pricePerContact.value ?? 0)}; серая — себестоимость.</span
      >
    </figcaption>
  </figure>`;
}

/** Cost vs margin: one stacked ₽ bar from 0 to the price, with the band, market and cap marks. */
function CostVsMargin({ r, base }) {
  const seg = (q) => [
    { k: "direct", label: "прямые", v: q.direct.cost },
    { k: "overhead", label: "накладные", v: q.overhead.cost },
    { k: "reserve", label: "резерв", v: q.reserve.cost },
    { k: "externals", label: "внешние", v: q.externalCost },
    { k: "tools", label: "инструменты", v: q.tools.cost },
    { k: "idle", label: "простой штата", v: q.idle.cost },
  ];
  const parts = seg(r);
  const before = base
    ? Object.fromEntries(seg(base).map((s) => [s.k, s.v]))
    : {};
  const profit = r.price.price - r.price.cost;
  const cap = r.price.budgetCap.value;
  const mk = r.market;
  const top = niceMax(
    Math.max(r.price.price, r.price.cost, mk?.max ?? 0, cap ?? 0) * 1.05,
  );
  const L = 16;
  const R = W - 16;
  const x = (v) => L + ((R - L) * v) / top;
  let acc = 0;
  const rects = parts.map((s) => {
    const r0 = acc;
    acc += s.v;
    return { ...s, x0: r0, x1: acc };
  });
  return view`<figure class="chart" data-testid="chart-cost-margin">
    <svg viewBox=${`0 0 ${W} 96`} role="img" aria-label="Себестоимость и маржа на одной оси">
      ${rects.map(
        (s, i) =>
          view`<rect key=${s.k} x=${x(s.x0)} y="18" width=${Math.max(0, x(s.x1) - x(s.x0))} height="26" class=${`seg seg${i}`} />`,
      )}
      ${
        profit >= 0
          ? view`<rect x=${x(r.price.cost)} y="18" width=${Math.max(0, x(r.price.price) - x(r.price.cost))} height="26" class="c-profit" />`
          : view`<rect x=${x(r.price.price)} y="46" width=${x(r.price.cost) - x(r.price.price)} height="6" class="c-loss" />`
      }
      ${mk ? view`<rect x=${x(mk.min)} y="8" width=${Math.max(1, x(mk.max) - x(mk.min))} height="6" class="c-market" />` : null}
      ${cap != null ? view`<line x1=${x(cap)} x2=${x(cap)} y1="4" y2="58" class="mark m-cap" />` : null}
      <line x1=${x(r.price.price)} x2=${x(r.price.price)} y1="12" y2="58" class="mark m-price" />
      <line x1=${L} x2=${R} y1="60" y2="60" class="axis" />
      ${[0, 0.5, 1].map(
        (t) =>
          view`<text key=${t} x=${x(top * t)} y="76" class="tick" text-anchor=${t === 0 ? "start" : t === 1 ? "end" : "middle"}>${short(top * t)} ₽</text>`,
      )}
    </svg>
    <ul class="legend">
      ${rects.map((s, i) => {
        const d = before[s.k] != null ? s.v - before[s.k] : 0;
        return view`<li key=${s.k}><i class=${`seg seg${i}`}></i>${s.label} ${rub(s.v)}${
          Math.abs(d) > 0.5 ? view` <b class="delta">${dRub(d)}</b>` : null
        }</li>`;
      })}
      <li><i class=${profit >= 0 ? "c-profit" : "c-loss"}></i>${profit >= 0 ? "прибыль" : "убыток"} ${rub(profit)}</li>
      ${mk ? view`<li><i class="c-market"></i>рынок ${rub(mk.min)} – ${rub(mk.max)}</li>` : null}
      ${cap != null ? view`<li><i class="m-cap-key"></i>потолок бюджета ${rub(cap)}</li>` : null}
    </ul>
  </figure>`;
}

/** «Грейд» × «Ход работы»: price and margin of the product in each of the 3 × 3 combinations. */
function Matrix({ model, productName, ctx, setCtx }) {
  const cells = useMemo(
    () =>
      GRADES.map((g) =>
        COURSES.map((k) => {
          try {
            const p = priceProduct(model, productName, { grade: g, course: k });
            return {
              g,
              k,
              cost: p.cost,
              price: p.price,
              margin: p.derived.margin,
            };
          } catch {
            return { g, k, cost: null, price: null, margin: null };
          }
        }),
      ),
    [model, productName],
  );
  return view`<div class="scroll">
    <table class="matrix" data-testid="matrix">
      <thead>
        <tr>
          <th><${Term} t="грейд">Грейд<//> \\ <${Term} t="ход работы">ход работы<//></th>
          ${COURSES.map((k) => view`<th key=${k}>${COURSE_LABELS[k]}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${cells.map(
          (row, i) =>
            view`<tr key=${GRADES[i]}>
              <th><${Term} t=${GRADES[i]}>${GRADE_LABELS[GRADES[i]]}<//></th>
              ${row.map(
                (c) =>
                  view`<td
                    key=${c.k}
                    class=${ctx.grade === c.g && ctx.course === c.k ? "current" : ""}
                  >
                    <button class="cell" onClick=${() => setCtx({ grade: c.g, course: c.k })}>
                      <span>цена ${rub(c.price)}</span>
                      <span class="small muted">себест. ${rub(c.cost)} · маржа ${pct(c.margin)}</span>
                    </button>
                  </td>`,
              )}
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

function Drivers({ r, base, model, productName, ctx, setCtx }) {
  const [metric, setMetric] = useState(() => store.get("tornado", "price"));
  useEffect(() => store.set("tornado", metric), [metric]);
  const sens = useMemo(() => {
    try {
      return sensitivity(model, productName, ctx);
    } catch {
      return null;
    }
  }, [model, productName, ctx]);
  const series = useMemo(() => {
    try {
      return breakEvenSeries(model, productName, ctx);
    } catch {
      return null;
    }
  }, [model, productName, ctx]);
  const step = model.vars.sensitivity_step;
  return view`<section class="card" data-testid="drivers">
    <h2>Что двигает цену</h2>
    <div class="toolbar">
      <span class="small muted"><${Term} t="торнадо">Торнадо<//> по:</span>
      <span class="seg" role="group" aria-label="метрика торнадо">
        ${[
          ["price", "цене"],
          ["cost", "себестоимости"],
        ].map(
          ([k, name]) =>
            view`<button key=${k} aria-pressed=${metric === k} onClick=${() => setMetric(k)}>${name}</button>`,
        )}
      </span>
    </div>
    ${sens ? view`<${Tornado} sens=${sens} metric=${metric} />` : view`<p class="err">Чувствительность не посчитана.</p>`}
    <p class="small muted">
      Каждый драйвер меняется отдельно, остальные — как сейчас. Грейд и ход
      работы — свои крайние значения; статьи затрат — ±${pct(step)} к масштабу
      статьи; рынок — его мин и макс. <span class="key c-low"></span> низкое
      значение входа, <span class="key c-high"></span> высокое. Взаимодействие
      драйверов торнадо не показывает — для него матрица ниже.
    </p>
    <h3>Себестоимость и маржа</h3>
    <${CostVsMargin} r=${r} base=${base} />
    <h3><${Term} t="безубыточность">Безубыточность<//> по контактам</h3>
    ${series ? view`<${BreakEven} r=${r} series=${series} />` : null}
    <h3>Матрица «Грейд» × «Ход работы»</h3>
    <${Matrix} model=${model} productName=${productName} ctx=${ctx} setCtx=${setCtx} />
    <p class="small muted">Клик по ячейке переключает грейд и ход работы.</p>
  </section>`;
}

// ── Price, contacts, market ──

/** Value of the leading price mode in the unit the person types: × , % or ₽. */
const toInput = (mode, v) =>
  !fin(v)
    ? ""
    : mode === "markup" || mode === "margin"
      ? showNum(Math.round(v * 1000) / 10)
      : mode === "multiplier"
        ? showNum(Math.round(v * 100) / 100)
        : showNum(Math.round(v));
const fromInput = (mode, v) =>
  mode === "markup" || mode === "margin" ? v / 100 : v;

function PriceValue({ mode, value, onChange }) {
  const [text, setText] = useState(() => toInput(mode, value));
  const sig = `${mode}|${value}`;
  useEffect(() => {
    const parsed = parseNum(text);
    if (parsed == null || Math.abs(fromInput(mode, parsed) - value) > 1e-9)
      setText(toInput(mode, value));
  }, [sig]);
  const parsed = parseNum(text);
  const problem =
    parsed === undefined || parsed === null
      ? "введите число"
      : mode === "margin" && parsed >= 100
        ? "маржа меньше 100 %"
        : parsed < 0 && mode !== "markup"
          ? "отрицательное значение"
          : null;
  return view`<span class="edit">
    <input
      class=${`wide${problem ? " bad" : ""}`}
      inputmode="decimal"
      aria-label=${`цена: ${PRICE_MODE_LABEL[mode]}`}
      aria-invalid=${problem ? "true" : "false"}
      value=${text}
      data-testid="price-value"
      onChange=${(e) => {
        setText(e.target.value);
        const v = parseNum(e.target.value);
        if (v == null || v === undefined) return;
        if (mode === "margin" && v >= 100) return;
        onChange(fromInput(mode, v));
      }}
    />
    <span class="muted">${mode === "multiplier" ? "×" : mode === "fixed" ? "₽" : "%"}</span>
    ${problem ? view`<span class="err small">не применено: ${problem}</span>` : null}
  </span>`;
}

function PriceBlock({ r, productName, model }) {
  const c = useContext(Ctx);
  const p = r.price;
  const own = model.productPrice[productName];
  const key = (mode) => `price:${productName}:${mode}`;
  const setMode = (mode, value) =>
    c.patch(
      Object.fromEntries(
        PRICE_MODES.map((m) => [key(m), m === mode ? value : undefined]),
      ),
    );
  const pc = p.pricePerContact;
  return view`<section class="card" data-testid="price">
    <h2><${Term} t="цена">Цена<//></h2>
    <div class="toolbar">
      <span class="small muted"><${Term} t="ведущий способ">Задаю цену через<//>:</span>
      <span class="seg" role="group" aria-label="ведущий способ цены">
        ${PRICE_MODES.map(
          (m) =>
            view`<button key=${m} aria-pressed=${p.mode === m} data-testid=${`price-mode-${m}`} onClick=${() => setMode(m, p.derived[m])}>
              ${PRICE_MODE_LABEL[m]}
            </button>`,
        )}
      </span>
      <${PriceValue} mode=${p.mode} value=${p.value} onChange=${(v) => setMode(p.mode, v)} />
      ${
        own
          ? view`<button class="link" onClick=${() => setMode(null)}>↺ как для всех продуктов</button>`
          : view`<span class="small muted">— общее значение для всех продуктов (вкладка «Переменные»)</span>`
      }
    </div>
    <table class="derived">
      <tbody>
        <tr>
          <td><${Term} t="себестоимость">Себестоимость<//> единицы</td>
          <td class="num"><b>${rub(p.cost)}</b></td>
          <td class="small muted">полная, с простоем штата; «по загрузке» ${rub(r.total.byLoad)}</td>
        </tr>
        <tr>
          <td><${Term} t="цена">Цена<//></td>
          <td class="num"><b>${rub(p.price)}</b></td>
          <td class="small muted">
            = <${Term} t="аванс">аванс<//> ${rub(p.advance)} (${pct(p.advanceShare)}) +${" "}
            <${Term} t="результат">результат<//>: план ${f0.format(p.contacts.plan)} контактов ×${" "}
            ${rub(pc.value ?? 0)} = ${rub(p.resultAtPlan)}
          </td>
        </tr>
        <tr>
          <td><${Term} t="прибыль">Прибыль<//></td>
          <td class="num">${rub(p.price - p.cost)}</td>
          <td class="small muted">цена − себестоимость</td>
        </tr>
        <tr class=${p.mode === "multiplier" ? "lead" : ""}>
          <td><${Term} t="множитель">Множитель<//></td>
          <td class="num">× ${n2(p.derived.multiplier)}</td>
          <td class="small muted">цена ÷ себестоимость</td>
        </tr>
        <tr class=${p.mode === "markup" ? "lead" : ""}>
          <td><${Term} t="наценка">Наценка<//></td>
          <td class="num">${pct(p.derived.markup)}</td>
          <td class="small muted">прибыль ÷ себестоимость</td>
        </tr>
        <tr class=${p.mode === "margin" ? "lead" : ""}>
          <td><${Term} t="маржа">Маржа<//></td>
          <td class="num">${pct(p.derived.margin)}</td>
          <td class="small muted">прибыль ÷ цена</td>
        </tr>
      </tbody>
    </table>
    ${p.flags.length ? view`<ul class="flags">${p.flags.map((f) => view`<li key=${f}>${f}</li>`)}</ul>` : null}
    <h3><${Term} t="рыночный ориентир">Рыночный ориентир<//> и <${Term} t="золотая цена">золотая цена<//></h3>
    <div class="toolbar">
      <span>рынок, ₽:</span>
      <${Field} k=${`market:${productName}`} base=${c.base.marketRefs[productName]?.rub ?? null} label="рыночный ориентир" wide=${true} />
      <span><${Term} t="потолок бюджета">потолок бюджета<//>, ₽:</span>
      <${Field} k="var:budget_cap" base=${c.base.vars.budget_cap} label="потолок бюджета спонсора" wide=${true} />
      <${Field} k="var:budget_cap_mode" base=${c.base.vars.budget_cap_mode} label="вид потолка" options=${VAR_OPTIONS.budget_cap_mode} />
      ${
        c.model.vars.budget_cap_mode === "tiered"
          ? view`<span>скидка сверх потолка</span><${Field} k="var:budget_tier_discount" base=${c.base.vars.budget_tier_discount} label="скидка сверх потолка" />`
          : null
      }
    </div>
    ${
      r.market
        ? view`<p data-testid="market-gap">
            <${Term} t="разрыв с рынком">Разрыв с серединой рынка<//> ${rub(r.market.mid)}:
            себестоимость <span class=${r.market.costFlag ? "gap-flag" : ""}>${sign(r.market.costGap)}${pct(Math.abs(r.market.costGap))}</span>
            ${" "}(${r.market.costPosition}), цена${" "}
            <span class=${r.market.priceFlag ? "gap-flag" : ""}>${sign(r.market.priceGap)}${pct(Math.abs(r.market.priceGap))}</span>
            ${" "}(${r.market.pricePosition}).${" "}
            <span class="small muted">Порог выделения ${pct(r.market.threshold)}.</span>
          </p>`
        : view`<p class="small muted">У продукта нет рыночного ориентира — задайте мин и макс.</p>`
    }
    <${GoldenBand} r=${r} />
  </section>`;
}

function ContactsBlock({ r, inputs }) {
  const c = useContext(Ctx);
  const p = r.price;
  const pc = p.pricePerContact;
  const type = pc.type
    ? inputs.rates.doctor_contacts.contact_types[pc.type]
    : null;
  const cap = p.budgetCap.value;
  return view`<section class="card" data-testid="contacts">
    <h2><${Term} t="контакт">Контакты<//> и выручка</h2>
    <p>
      ${
        type
          ? view`<${Term} t="тип контакта">Тип контакта<//>: <b>${type.label}</b>.
              ${" "}<${Term} t="цена контакта">Цена контакта<//> <b>${rub(pc.value)}</b>${" "}
              <span class="small muted"
                >${pc.source}${pc.band ? ` · полоса «${pc.band}» ${rub(pc.bandRub)} × вес ${n2(pc.weight)}` : ""}</span
              >`
          : view`<span class="muted">У продукта нет оплаты за контакты — цена целиком аванс.</span>`
      }
    </p>
    <div class="toolbar">
      <span>контакты мало / план / много:</span>
      <${Field} k="var:contacts" base=${c.base.vars.contacts} label="контакты" slots=${["мало", "план", "много"]} />
      <span>цена контакта, ₽:</span>
      <${Field} k="var:price_per_contact" base=${c.base.vars.price_per_contact} label="цена контакта" />
      <span>аудитория, врачей:</span>
      <${Field} k="var:audience_doctors" base=${c.base.vars.audience_doctors} label="размер аудитории" wide=${true} />
    </div>
    <div class="scroll">
      <table data-testid="outcomes">
        <thead>
          <tr>
            <th></th>
            <th class="num">мало</th>
            <th class="num">план</th>
            <th class="num">много</th>
          </tr>
        </thead>
        <tbody>
          ${[
            ["контактов", (o) => f0.format(o.contacts)],
            [
              "цена за контакт для спонсора",
              (o) => (o.contacts ? rub(o.revenue / o.contacts) : "—"),
            ],
            ["выручка", (o) => rub(o.revenue)],
            [
              "прибыль",
              (o) =>
                view`<span class=${o.margin < 0 ? "err" : ""}>${rub(o.margin)}</span>`,
            ],
            ["маржа", (o) => pct(o.marginShare)],
            [
              view`<${Term} t="авторская доля">авторская доля<//>`,
              (o) => rub(o.authorShare),
            ],
            [
              view`<${Term} t="потолок бюджета">потолок бюджета<//>`,
              (o) =>
                cap == null
                  ? "нет"
                  : p.advance + o.contacts * (pc.value ?? 0) > cap
                    ? view`<span class="warn">упёрлись в потолок</span>`
                    : view`<span class="ok">влезает</span>`,
            ],
          ].map(
            ([label, f], i) =>
              view`<tr key=${i}>
                <td>${label}</td>
                ${["low", "plan", "high"].map((k) => view`<td key=${k} class="num">${f(p.outcomes[k])}</td>`)}
              </tr>`,
          )}
        </tbody>
      </table>
    </div>
    <p>
      <${Term} t="безубыточность">Безубыточность<//>:${" "}
      <b data-testid="break-even"
        >${p.breakEvenContacts == null ? "не достигается" : `${f0.format(Math.ceil(p.breakEvenContacts))} контактов`}</b
      >.${" "}
      <${Term} t="период счетов">Счета<//>:${" "}
      <${Field} k="var:billing_period" base=${c.base.vars.billing_period} label="период счетов" options=${VAR_OPTIONS.billing_period} />
      ${" "}— срок ${f1.format(p.billing.leadMonths)} мес., ${p.billing.invoices} счёт(а) по${" "}
      ${rub(p.billing.perInvoice)} при плане.${" "}
      <${Term} t="авторская доля">Авторская доля<//>${" "}
      <${Field} k="var:author_share" base=${c.base.vars.author_share} label="авторская доля" />
    </p>
  </section>`;
}

/** Level 1 controls that belong to the product: video-podcast production, extended campaign. */
function ProductOptions({ productName }) {
  const c = useContext(Ctx);
  const nested = nestedProducts(c.base, productName);
  return view`<div class="toolbar" data-testid="product-options">
    ${
      nested.has("видеоподкаст")
        ? view`<span><${Term} t="продакшн видеоподкаста">Продакшн видеоподкаста<//>:</span>
            <${Field}
              k="var:video_podcast_production"
              base=${c.base.vars.video_podcast_production}
              label="продакшн видеоподкаста"
              options=${VAR_OPTIONS.video_podcast_production}
            />`
        : null
    }
    <label class="edit">
      <input
        type="checkbox"
        checked=${!!c.model.vars.extended_campaign}
        data-testid="extended-campaign"
        onChange=${(e) => (e.target.checked ? c.set("var:extended_campaign", true) : c.reset("var:extended_campaign"))}
      />
      <${Term} t="расширенная кампания">Расширенная кампания продвижения<//>
    </label>
  </div>`;
}

// ── Level 2: budget per cost article ──

function BudgetPanel({ r, model, ctx }) {
  const c = useContext(Ctx);
  const fit = useMemo(() => {
    try {
      return budgetFit(model, ctx);
    } catch {
      return null;
    }
  }, [model, ctx]);
  const edited = ARTICLES.filter((a) =>
    Object.hasOwn(c.ov, `scale:${a}`),
  ).length;
  return view`<section class="card" data-testid="budget">
    <h2>
      Бюджет по статьям ${edited ? view`<span class="badge">изменено ${edited}</span>` : null}
    </h2>
    <p class="small muted">
      <${Term} t="масштаб статьи">Масштаб статьи<//>: 100 % — как в модели.
      Ползунок для грубой оценки, поле — для точной суммы статьи в этой единице.
    </p>
    <table class="budget">
      <tbody>
        ${ARTICLES.map((a) => {
          const k = `scale:${a}`;
          const scale = model.scale[a];
          const amount = r.articles[a];
          const unit = scale ? amount / scale : 0;
          const set = (v) =>
            Math.abs(v - 1) < 1e-9 ? c.reset(k) : c.set(k, v);
          return view`<tr key=${a}>
            <td>${ARTICLE_LABELS[a]}</td>
            <td class="slider">
              <input
                type="range"
                min="0.3"
                max="2"
                step="0.05"
                value=${scale}
                aria-label=${`масштаб статьи ${ARTICLE_LABELS[a]}`}
                aria-valuetext=${pct(scale)}
                data-testid=${`slider-${a}`}
                onInput=${(e) => set(Number(e.target.value))}
                onChange=${(e) => set(Number(e.target.value))}
              />
              <span class="num small">${pct(scale)}</span>
            </td>
            <td class="num">
              <${RubEdit}
                value=${amount}
                disabled=${!unit}
                label=${`сумма статьи ${ARTICLE_LABELS[a]}`}
                onChange=${(v) => unit && set(v / unit)}
              />
            </td>
            <td>${Object.hasOwn(c.ov, k) ? view`<button class="link" onClick=${() => c.reset(k)}>↺</button>` : null}</td>
          </tr>`;
        })}
      </tbody>
    </table>
    <h3>Влезает ли в бюджет?</h3>
    ${
      !fit
        ? null
        : fit.fits
          ? view`<p class="ok" data-testid="budget-fit">Да: ни одна ставка не ниже рыночного минимума своего грейда.</p>`
          : view`<div data-testid="budget-fit">
              <p class="warn">Нельзя купить ниже рынка:</p>
              <ul>
                ${fit.below.map(
                  (b) =>
                    view`<li key=${`${b.role}|${b.article}`}>
                      ${b.role} (${GRADE_LABELS[b.grade] ?? b.grade}): ${rub(b.value)}${" "}
                      ${b.article === "payroll" ? "в месяц" : "за час"} &lt; рыночного минимума${" "}
                      ${rub(b.floor)}
                    </li>`,
                )}
              </ul>
            </div>`
    }
    ${
      r.golden.band
        ? view`<p class="small">
            <${Term} t="золотая цена">Золотая цена<//>: ${rub(r.golden.band[0])} –${" "}
            ${rub(r.golden.band[1])}.
          </p>`
        : null
    }
  </section>`;
}

function RubEdit({ value, onChange, label, disabled }) {
  const [text, setText] = useState(() => (fin(value) ? f0.format(value) : ""));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(fin(value) ? f0.format(value) : "");
  }, [value, focus]);
  return view`<span class="edit"
    ><input
      class="wide"
      inputmode="decimal"
      aria-label=${label}
      disabled=${disabled}
      value=${text}
      onFocus=${() => setFocus(true)}
      onBlur=${() => setFocus(false)}
      onChange=${(e) => {
        setText(e.target.value);
        const v = parseNum(e.target.value);
        if (fin(v) && v >= 0) onChange(v);
      }}
    /><span class="muted">₽</span></span
  >`;
}

// ── Level 3: calibration tabs ──

function PeriodPanel({ plan, model }) {
  const c = useContext(Ctx);
  const rows = plan.idle.byRole;
  const contracted = rows.some((x) => x.contractorHours > 0);
  const sumOf = (k) => rows.reduce((a, x) => a + x[k], 0);
  const teamRows = model.teamRoles.map((m) => m.role);
  return view`<div data-testid="period">
    <p>
      <b><${Term} t="план месяца">План месяца команды: чем занята<//></b>
      ${" "}— ${Object.entries(plan.sold)
        .map(([p, n]) => `${f2.format(n)} × ${p}`)
        .join(
          ", ",
        )}${plan.bottleneck ? view` (<${Term} t="узкое место">узкое место<//> — ${plan.bottleneck})` : ""}.
    </p>
    <p class="small muted">
      Этот план не меняет состав выбранного продукта. Он задаёт две ставки на
      прямой час: накладные (пул месяца ÷ прямые часы плана) и простой штата
      (свободное оплаченное время ÷ те же часы). Загрузите команду другим
      продуктом или числом команд — изменятся только эти две строки.
    </p>
    <p>
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
            <th><${Term} t="FTE">FTE<//> на команду</th>
            <th class="num">оплачено</th>
            <th class="num">непроизв.</th>
            <th class="num">загружено</th>
            ${contracted ? view`<th class="num">подряд</th>` : null}
            <th class="num">свободно</th>
            <th class="num">₽/ч штата</th>
            <th class="num">свободно, ₽</th>
            <th class="num"><${Term} t="ФОТ">ФОТ<//></th>
          </tr>
        </thead>
        <tbody>
          ${teamRows.map((role) => {
            const x = rows.find((y) => y.role === role);
            const base = c.base.teamRoles.find((m) => m.role === role)?.fte;
            return view`<tr key=${role}>
              <td>${role}</td>
              <td>
                <${Field} k=${`fte:${role}`} base=${base} label=${`FTE ${role}`} />
              </td>
              ${
                x
                  ? view`<td class="num">${hrs(x.paidHours)}</td>
                      <td class="num">${hrs(x.nonProduction)}</td>
                      <td class="num">${hrs(x.loaded)}</td>
                      ${contracted ? view`<td class="num">${hrs(x.contractorHours)}</td>` : null}
                      <td class="num">${hrs(x.idleHours)}</td>
                      <td class="num">${rub(x.ownHourlyCost)}</td>
                      <td class="num">${rub(x.idleCost)}</td>
                      <td class="num">${rub(x.payroll)}</td>`
                  : view`<td colspan=${contracted ? 8 : 7} class="muted small">
                      не в штате (${ENGAGEMENT_LABELS[roleEngagement(model, role)]}) —
                      оплата за часы, в ФОТ и простой не входит
                    </td>`
              }
            </tr>`;
          })}
          <tr class="sum">
            <td colspan="2">Итого за месяц</td>
            <td class="num">${hrs(sumOf("paidHours"))}</td>
            <td class="num">${hrs(sumOf("nonProduction"))}</td>
            <td class="num">${hrs(sumOf("loaded"))}</td>
            ${contracted ? view`<td class="num">${hrs(sumOf("contractorHours"))}</td>` : null}
            <td class="num">${hrs(plan.idle.hours)}</td>
            <td></td>
            <td class="num" data-testid="period-idle">${rub(plan.idle.cost)}</td>
            <td class="num" data-testid="period-payroll">${rub(sumOf("payroll"))}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="small muted">
      Свободно = оплачено − непроизводственные часы (встречи, найм, управление)
      − часы, которые загружают единицы плана.
    </p>
  </div>`;
}

function LoopsPanel({ ctx }) {
  const c = useContext(Ctx);
  return view`<div class="scroll">
    <table>
      <thead>
        <tr>
          <th><${Term} t="петля">Петля<//></th>
          <th>Кто одобряет</th>
          <th><${Term} t="круги">Круги<//></th>
          <th>Ожидание между кругами, <${Term} t="раб. дн.">раб. дн.<//></th>
          <th class="num">круги сейчас</th>
        </tr>
      </thead>
      <tbody>
        ${[...c.base.loops.values()].map((loop) => {
          const derived = loop.rounds_from
            ? COURSES.map((k) =>
                loopRounds(c.base, loop.name, { ...DEFAULT_CTX, course: k }),
              )
            : null;
          return view`<tr key=${loop.name}>
            <td>
              ${loop.name}
              <div class="small muted">операции ${(loop.leaves ?? []).join(", ")}</div>
            </td>
            <td>${loop.approver}</td>
            <td>
              <${Field}
                k=${`loop:${loop.name}`}
                base=${derived ?? loop.rounds_draft}
                label=${`круги ${loop.name}`}
                slots=${COURSE_SLOTS[Array.isArray(derived ?? loop.rounds_draft) ? (derived ?? loop.rounds_draft).length : 1]}
              />
              ${
                derived
                  ? view`<div class="small muted">
                      выводится из петель ${loop.rounds_from.plus_extra_rounds_of.join(", ")}
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
            <td class="num">${n2(loopRounds(c.model, loop.name, ctx))}</td>
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
}

/** Contractor hour of a record at a grade (mix → middle): the middle of its grade band. */
function contractorBase(rec, grade) {
  const g = grade === GRADE_MIX ? "middle" : grade;
  const band = rec.hourly_by_grade_rub?.[g];
  if (band) return Math.round((band[0] + band.at(-1)) / 2);
  const h = rec.hourly_rub;
  if (!Array.isArray(h)) return null;
  const [lo, hi] = h;
  if (lo != null && hi != null)
    return g === "junior" ? lo : g === "senior" ? hi : (lo + hi) / 2;
  return lo ?? hi ?? null;
}

function RatesPanel({ ctx, roles }) {
  const c = useContext(Ctx);
  const region = c.model.vars.region;
  const expert = (role) => !!c.base.config.expert_roles?.[role];
  return view`<div>
    <div class="toolbar" data-testid="engagement-presets">
      <span><${Term} t="форма привлечения">Форма привлечения<//> всех ролей:</span>
      ${Object.entries(PRESET_LABEL).map(
        ([k, name]) =>
          view`<button key=${k} data-testid=${`preset-${k}`} onClick=${() => c.patch(engagementPreset(c.base, k))}>${name}</button>`,
      )}
    </div>
    <p class="small muted">
      Час штата = (gross + премия + взносы + прочие расходы) ÷ оплачиваемые
      часы; внештатный час = середина диапазона грейда × (1 + надбавка формы
      договора). «Калибровка ₽/ч» заменяет расчёт целиком. Регион ставок:${" "}
      ${VAR_OPTIONS.region.find(([k]) => k === region)?.[1] ?? region}.
    </p>
    <div class="scroll">
      <table data-testid="rates">
        <thead>
          <tr>
            <th>Роль</th>
            <th><${Term} t="форма привлечения">Форма<//></th>
            <th><${Term} t="грейд">Грейд<//></th>
            <th><${Term} t="gross">Gross<//> в месяц, ₽</th>
            <th>Внештатный час, ₽</th>
            <th><${Term} t="калибровка">Калибровка ₽/ч<//></th>
            <th class="num">₽/ч сейчас</th>
          </tr>
        </thead>
        <tbody>
          ${[...c.base.rates.values()]
            .filter((rec) => roles.has(rec.role) && !expert(rec.role))
            .map((rec) => {
              const rate = roleHourlyCost(c.model, rec.role, ctx);
              const hour = staffHour(c.base, rec.role, ctx);
              const model = roleEngagement(c.base, rec.role);
              const composite = !!rec.composite_of;
              return view`<tr key=${rec.role}>
                <td>
                  ${rec.role}
                  <div class="small muted">${rate.basis}</div>
                </td>
                <td>
                  ${
                    composite
                      ? view`<span class="muted small">по участникам</span>`
                      : view`<${Field}
                          k=${`engage:${rec.role}`}
                          base=${null}
                          label=${`форма привлечения ${rec.role}`}
                          options=${[["", `как в модели: ${ENGAGEMENT_LABELS[model]}`], ...ENGAGEMENTS.map((e) => [e, ENGAGEMENT_LABELS[e]])]}
                        />`
                  }
                </td>
                <td>
                  ${
                    composite
                      ? null
                      : view`<${Field}
                          k=${`grade:${rec.role}`}
                          base=${null}
                          label=${`грейд ${rec.role}`}
                          options=${[["", "грейд команды"], ...GRADES.map((g) => [g, GRADE_LABELS[g]]), [GRADE_MIX, GRADE_LABELS[GRADE_MIX]]]}
                        />`
                  }
                </td>
                <td>
                  ${
                    hour.full != null && !composite
                      ? view`<${Field}
                          k=${`rate:${rec.role}:monthly`}
                          base=${Math.round(hour.gross)}
                          label=${`зарплата ${rec.role}, все грейды`}
                          wide=${true}
                        />`
                      : view`<span class="muted">—</span>`
                  }
                </td>
                <td>
                  ${
                    contractorBase(
                      rec,
                      c.model.roleGrade[rec.role] ?? ctx.grade,
                    ) != null && !composite
                      ? view`<${Field}
                          k=${`rate:${rec.role}:hourly`}
                          base=${contractorBase(rec, c.model.roleGrade[rec.role] ?? ctx.grade)}
                          label=${`внештатный час ${rec.role}, все грейды`}
                        />`
                      : view`<span class="muted">—</span>`
                  }
                </td>
                <td>
                  <${Field} k=${`rate:${rec.role}:hourly_cost`} base=${null} label=${`калибровка ${rec.role}`} />
                </td>
                <td class="num">
                  ${rub(rate.value)}
                  <div class="small muted">${ENGAGEMENT_LABELS[rate.engagement] ?? ""}</div>
                </td>
              </tr>`;
            })}
        </tbody>
      </table>
    </div>
  </div>`;
}

function ExpertsPanel() {
  const c = useContext(Ctx);
  const roles = Object.entries(c.base.config.expert_roles ?? {});
  return view`<div class="scroll" data-testid="experts">
    <table>
      <thead>
        <tr><th>Роль</th><th><${Term} t="грейд эксперта">Грейд эксперта<//></th></tr>
      </thead>
      <tbody>
        ${roles.map(
          ([role, v]) =>
            view`<tr key=${role}>
              <td>${role}<div class="small muted">${c.describe.varLabel(v)}</div></td>
              <td>
                <${Field} k=${`var:${v}`} base=${c.base.vars[v]} label=${`грейд ${role}`} options=${Object.keys(c.base.experts.grades).map((g) => [g, g])} />
              </td>
            </tr>`,
        )}
      </tbody>
    </table>
    <table>
      <thead>
        <tr><th>Грейд</th><th>Час эксперта, ₽ мин – макс</th></tr>
      </thead>
      <tbody>
        ${Object.entries(c.base.experts.grades).map(
          ([g, def]) =>
            view`<tr key=${g}>
              <td>${g}</td>
              <td><${Field} k=${`expert:${g}`} base=${def.per_hour_rub} label=${`час эксперта ${g}`} /></td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

const VAR_OPTIONS = {
  region: [
    ["moscow", "Москва"],
    ["russia_remote", "Россия, удалённо"],
  ],
  contributions_mode: [
    ["", "по умолчанию rates.yaml"],
    ["general", "общий режим"],
    ["msp_priority", "МСП"],
  ],
  price_mode: PRICE_MODES.map((m) => [m, PRICE_MODE_LABEL[m]]),
  budget_cap_mode: [
    ["hard", "жёсткий потолок"],
    ["tiered", "сверх потолка — со скидкой"],
  ],
  billing_period: [
    ["month", "раз в месяц"],
    ["quarter", "раз в квартал"],
  ],
  extended_campaign: [
    ["false", "нет"],
    ["true", "да"],
  ],
  video_podcast_production: [
    ["own", VP_LABEL.own],
    ["contractor", VP_LABEL.contractor],
  ],
};

function VariablesPanel({ inputs, only, skip = [] }) {
  const c = useContext(Ctx);
  const described = {
    ...inputs.teams.capacity_variables,
    ...inputs.products.variables,
  };
  const names = (only ?? Object.keys(c.base.vars)).filter(
    (n) => !skip.includes(n),
  );
  const experts = Object.keys(c.base.experts.grades).map((g) => [g, g]);
  return view`<div class="scroll">
    <table>
      <thead>
        <tr>
          <th>Переменная</th>
          <th>Значение</th>
        </tr>
      </thead>
      <tbody>
        ${names.map((name) => {
          const base = c.base.vars[name];
          const options =
            name === "plan_mix"
              ? Object.keys(c.base.products)
                  .filter((p) => p !== CUSTOM)
                  .map((p) => [p, p])
              : name.startsWith("expert_grade_")
                ? experts
                : VAR_OPTIONS[name];
          return view`<tr key=${name}>
            <td>
              ${c.describe.varLabel(name)}
              <div class="small muted">${described[name]?.unit ?? "доля к зарплате"}</div>
            </td>
            <td>
              ${
                isPlainObject(base)
                  ? view`<span class="small">${Object.entries(base)
                      .map(([k, v]) => `${k} ${n2(v)}`)
                      .join(" · ")}</span>`
                  : view`<${Field}
                      k=${`var:${name}`}
                      base=${base}
                      label=${c.describe.varLabel(name)}
                      options=${options}
                    />`
              }
            </td>
          </tr>`;
        })}
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
    return view`<p class="muted">У продукта и его единиц нет параметров.</p>`;
  return view`<div class="scroll">
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
            view`<tr key=${`${p}|${name}`}>
              <td>${c.base.products[p].name ?? p}</td>
              <td>
                ${name.replaceAll("_", " ")}
                <div class="small muted">${def.unit}</div>
              </td>
              <td>
                <${Field} k=${`param:${p}:${name}`} base=${c.base.params[p][name]} label=${`параметр ${p} ${name}`} />
              </td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

function ExternalsPanel() {
  const c = useContext(Ctx);
  return view`<div class="scroll">
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
            view`<tr key=${id}>
              <td>
                ${e.name} <span class="muted small">на ${e.per ?? "—"}</span>
                <div class="small muted">${e.basis ?? ""}</div>
              </td>
              <td><${ExternalField} id=${id} /></td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

function LeavesPanel({ r }) {
  const seen = new Map();
  for (const l of r.trail)
    if (l.leaf && l.class !== "pending" && !seen.has(l.leaf))
      seen.set(l.leaf, l);
  return view`<div class="scroll">
    <table>
      <thead>
        <tr>
          <th><${Term} t="операция">Операция<//></th>
          <th>Роль</th>
          <th>Вид</th>
          <th>Часы за проход</th>
        </tr>
      </thead>
      <tbody>
        ${[...seen.values()].map(
          (l) =>
            view`<tr key=${l.leaf}>
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
    return view`<p class="muted">Правок нет — всё по модели.</p>`;
  return view`<table>
    <tbody>
      ${keys.map(
        (k) =>
          view`<tr key=${k}>
            <td>${c.describe.name(k)}</td>
            <td>${c.describe.value(k, c.ov[k])}</td>
            <td>
              <button class="link" onClick=${() => c.reset(k)}>↺ сбросить</button>
            </td>
          </tr>`,
      )}
    </tbody>
  </table>`;
}

const TOOL_VARS = ["tool_seats", "payment_markup"];
const PRICE_VARS = [
  "price_mode",
  "price_value",
  "contacts",
  "audience_doctors",
  "price_per_contact",
  "budget_cap",
  "budget_cap_mode",
  "budget_tier_discount",
  "billing_period",
  "author_share",
  "market_gap_threshold",
  "sensitivity_step",
  "extended_campaign",
  "campaign_cost_per_contact",
  "video_podcast_production",
];

/** Tab of an override key — the «изменено N» badge and the group reset count it there. */
function tabOf(key) {
  const [kind, name] = key.split(":");
  if (["leaf", "lead", "piece"].includes(kind)) return "leaves";
  if (["loop", "wait"].includes(kind)) return "loops";
  if (["rate", "engage", "grade"].includes(kind)) return "rates";
  if (kind === "expert" || (kind === "var" && name.startsWith("expert_grade_")))
    return "experts";
  if (kind === "param") return "params";
  if (kind === "external") return "externals";
  if (
    kind === "fte" ||
    kind === "plan" ||
    (kind === "var" && ["teams", "plan_mix"].includes(name))
  )
    return "period";
  if (kind === "var" && TOOL_VARS.includes(name)) return "tools";
  if (kind === "var" && PRICE_VARS.includes(name)) return "price";
  if (kind === "var") return "vars";
  return "price";
}

const TABS = [
  ["period", "План месяца команды"],
  ["rates", "Ставки и форма привлечения"],
  ["experts", "Эксперты"],
  ["leaves", "Часы операций"],
  ["loops", "Петли одобрения"],
  ["params", "Параметры продукта"],
  ["externals", "Внешние затраты"],
  ["tools", "Инструменты"],
  ["price", "Цена и контакты"],
  ["vars", "Прочие переменные"],
  ["edits", "Все правки"],
];

function Calibration({ r, plan, model, inputs, productName, ctx }) {
  const c = useContext(Ctx);
  const [tab, setTab] = useState(() => {
    const t = store.get("tab", "period");
    return TABS.some(([id]) => id === t) ? t : "period";
  });
  useEffect(() => store.set("tab", tab), [tab]);
  const roles = useMemo(() => {
    const set = new Set(r.trail.map((l) => l.role).filter(Boolean));
    for (const l of plan.poolLines) set.add(l.role);
    for (const m of model.teamRoles) set.add(m.role);
    for (const m of r.direct.circle?.members ?? []) set.add(m.role);
    return set;
  }, [r, plan, model]);
  const counts = {};
  for (const k of Object.keys(c.ov))
    counts[tabOf(k)] = (counts[tabOf(k)] ?? 0) + 1;
  const total = Object.keys(c.ov).length;
  const resetTab = () =>
    c.patch(
      Object.fromEntries(
        Object.keys(c.ov)
          .filter((k) => tabOf(k) === tab)
          .map((k) => [k, undefined]),
      ),
    );
  const panel = {
    period: () => view`<${PeriodPanel} plan=${plan} model=${model} />`,
    rates: () => view`<${RatesPanel} ctx=${ctx} roles=${roles} />`,
    experts: () => view`<${ExpertsPanel} />`,
    leaves: () => view`<${LeavesPanel} r=${r} />`,
    loops: () => view`<${LoopsPanel} ctx=${ctx} />`,
    params: () => view`<${ParamsPanel} productName=${productName} />`,
    externals: () => view`<${ExternalsPanel} />`,
    tools: () => view`<${VariablesPanel} inputs=${inputs} only=${TOOL_VARS} />`,
    price: () =>
      view`<${VariablesPanel} inputs=${inputs} only=${PRICE_VARS} />`,
    vars: () =>
      view`<${VariablesPanel}
        inputs=${inputs}
        skip=${[...TOOL_VARS, ...PRICE_VARS, "teams", "plan_mix", ...Object.values(c.base.config.expert_roles ?? {})]}
      />`,
    edits: () => view`<${EditsPanel} />`,
  }[tab];
  return view`<section class="card" data-testid="calibration">
    <h2>Детали и точечные правки</h2>
    <div class="tabs" role="tablist">
      ${TABS.map(
        ([id, name]) =>
          view`<button key=${id} role="tab" aria-selected=${tab === id} onClick=${() => setTab(id)}>
            ${name}${
              id === "edits"
                ? total
                  ? ` (${total})`
                  : ""
                : counts[id]
                  ? view` <span class="badge">изменено ${counts[id]}</span>`
                  : null
            }
          </button>`,
      )}
    </div>
    ${
      tab !== "edits" && counts[tab]
        ? view`<p><button onClick=${resetTab}>↺ Сбросить правки этой вкладки (${counts[tab]})</button></p>`
        : null
    }
    ${panel()}
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
  return view`<section class="card" data-testid="custom">
    <h2>Своя сборка</h2>
    <div class="scroll">
      <table>
        <tbody>
          ${custom.items.map(
            (it, i) =>
              view`<tr key=${i}>
                <td>
                  <select aria-label=${`единица ${i + 1}`} value=${it.product} onChange=${(e) => update(i, { product: e.target.value })}>
                    ${choices.map((p) => view`<option key=${p} value=${p}>${products[p].name}</option>`)}
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
                  <button class="link" onClick=${() => setCustom({ ...custom, items: custom.items.filter((_, j) => j !== i) })}>убрать</button>
                </td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>
    <div class="toolbar" style=${{ marginTop: 8 }}>
      <button onClick=${() => setCustom({ ...custom, items: [...custom.items, { product: choices[0], qty: 1 }] })}>+ единица</button>
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
      <span class="small muted">сделка — <${Term} t="КП">КП<//>, договор, отчётные этапы и закрытие (продукт «сделка»); 0 — без неё</span>
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

function Seg({ label, value, options, onChange, testid }) {
  return view`<span class="seg" role="group" aria-label=${label} data-testid=${testid}>
    ${options.map(
      ([v, name]) =>
        view`<button key=${v} aria-pressed=${value === v} onClick=${() => onChange(v)}>${name}</button>`,
    )}
  </span>`;
}

function App({ inputs }) {
  const productNames = Object.keys(inputs.products.products);
  const [productName, setProduct] = useState(() => {
    const p = store.get("product", "урок");
    return p === CUSTOM || productNames.includes(p) ? p : "урок";
  });
  const [ctx, setCtxState] = useState(() => {
    try {
      return normalizeStored(store.get("ctx", DEFAULT_CTX));
    } catch {
      return { ...DEFAULT_CTX };
    }
  });
  const setCtx = (patch) => setCtxState((x) => ({ ...x, ...patch }));
  const [overrides, setOverrides] = useState(() => {
    const o = store.get("overrides", {});
    return isPlainObject(o) ? o : {};
  });
  const [custom, setCustom] = useState(() => {
    const c = store.get("custom", null);
    return isPlainObject(c) && Array.isArray(c.items) ? c : DEFAULT_CUSTOM;
  });
  const [note, setNote] = useState(() => store.get("note", ""));
  const [snapshot, setSnapshot] = useState(() => store.get("baseline", null));
  const [importError, setImportError] = useState(null);
  useEffect(() => store.set("product", productName), [productName]);
  useEffect(() => store.set("ctx", ctx), [ctx]);
  useEffect(() => store.set("overrides", overrides), [overrides]);
  useEffect(() => store.set("custom", custom), [custom]);
  useEffect(() => store.set("note", note), [note]);
  useEffect(() => store.set("baseline", snapshot), [snapshot]);

  const full = useMemo(() => withCustom(inputs, custom), [inputs, custom]);
  const base = useMemo(() => buildModel(full, {}), [full]);
  const describe = useMemo(() => describer(base, inputs), [base, inputs]);
  // Stored edits from an older page or a hand-edited file: normalise, report and drop the rest.
  const checked = useMemo(
    () => normaliseEdits(full, base, overrides, describe.name),
    [full, base, overrides, describe],
  );
  useEffect(() => {
    if (checked.errors.length) {
      setOverrides(checked.clean);
      setImportError(checked.errors.join("; "));
    }
  }, [checked]);
  const { model, result, errors } = useMemo(
    () => evaluate(full, checked.clean, productName, ctx, describe.name),
    [full, checked, productName, ctx, describe],
  );
  const plain = useMemo(() => {
    try {
      return computeProduct(base, productName, ctx);
    } catch {
      return null;
    }
  }, [base, productName, ctx]);
  let plan = null;
  let planError = null;
  try {
    plan = periodPlan(model, ctx);
  } catch (error) {
    planError = `план периода не посчитан: ${error.message}`;
  }
  const patch = (obj) =>
    setOverrides((o) => {
      const next = { ...o };
      for (const [k, v] of Object.entries(obj)) {
        if (v === undefined || v === null) delete next[k];
        else next[k] = v;
      }
      return next;
    });
  const ctxValue = {
    ov: overrides,
    set: (k, v) => setOverrides((o) => ({ ...o, [k]: v })),
    patch,
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
  const r = result;
  const count = Object.keys(overrides).length;
  const remembered = snapshot?.product === productName ? snapshot : null;
  const baseline = remembered?.result ?? plain;
  const baseNote = remembered
    ? `запомнена ${remembered.at} (${GRADE_LABELS[remembered.ctx.grade]}, ${COURSE_LABELS[remembered.ctx.course]})`
    : "модель без правок при тех же грейде и ходе работы";

  const importFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!isPlainObject(data?.overrides))
          throw new Error("в файле нет раздела правок (overrides)");
        const { clean, errors: refused } = normaliseEdits(
          full,
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
  const remember = () =>
    r &&
    setSnapshot({
      product: productName,
      ctx,
      at: new Date().toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      result: snapshotOf(r),
    });

  return view`<${Ctx.Provider} value=${ctxValue}>
    <${TipLayer} />
    <header>
      <h1>Себестоимость и цена</h1>
      <select aria-label="продукт" value=${productName} onChange=${(e) => setProduct(e.target.value)} data-testid="product">
        ${productNames.map((p) => view`<option key=${p} value=${p}>${inputs.products.products[p].name}</option>`)}
        <option value=${CUSTOM}>Своя сборка…</option>
      </select>
      <span class="ctl"
        ><${Term} t="грейд">Грейд<//>
        <${Seg}
          label="грейд"
          testid="grade"
          value=${ctx.grade}
          onChange=${(g) => setCtx({ grade: g })}
          options=${[...GRADES, GRADE_MIX].map((g) => [g, GRADE_LABELS[g]])}
      /></span>
      <span class="ctl"
        ><${Term} t="ход работы">Ход работы<//>
        <${Seg}
          label="ход работы"
          testid="course"
          value=${ctx.course}
          onChange=${(k) => setCtx({ course: k })}
          options=${COURSES.map((k) => [k, COURSE_LABELS[k]])}
      /></span>
      <span class="spacer"></span>
      <span class="toolbar">
        ${count ? view`<span class="badge" data-testid="edits-count">правок: ${count}</span>` : null}
        <input
          aria-label="пометка к правкам"
          placeholder="пометка к правкам"
          value=${note}
          onChange=${(e) => setNote(e.target.value)}
          class="note"
        />
        <button onClick=${() => download(overrides, note)}>Скачать правки</button>
        <label>
          <button onClick=${(e) => e.currentTarget.nextElementSibling.click()}>Загрузить правки</button>
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
        <button disabled=${!count} onClick=${() => setOverrides({})}>Сбросить всё</button>
      </span>
    </header>
    ${
      r
        ? view`<${KpiBar}
            r=${r}
            base=${baseline}
            baseNote=${baseNote}
            remembered=${!!remembered}
            onRemember=${remember}
            onForget=${() => setSnapshot(null)}
          />`
        : null
    }
    <div class="wrap">
      <p class="small muted" style=${{ margin: 0 }}>
        Правки хранятся в этом браузере. В YAML модели их переносит ведущий
        PR-ом — передайте ему файл «Скачать правки». Подчёркнутые пунктиром
        термины объясняются при наведении и при переходе клавишей Tab.
      </p>
      ${
        [...errors, planError, importError].filter(Boolean).length
          ? view`<div class="errbox" data-testid="errors">
              ${[...errors, planError, importError]
                .filter(Boolean)
                .map((e) => view`<div key=${e}>${e}</div>`)}
            </div>`
          : null
      }
      ${productName === CUSTOM ? view`<${CustomBuilder} custom=${custom} setCustom=${setCustom} products=${inputs.products.products} />` : null}
      ${
        r && plan
          ? view`<section class="card facts" data-testid="headline">
                <span><${Term} t="мощность">Мощность одной команды<//>: <b>${
                  r.capacity.perMonth == null
                    ? "—"
                    : `${n2(r.capacity.perMonth)} ${productName === CUSTOM ? "сборки" : "ед."} в месяц`
                }</b>${r.capacity.bottleneck ? view`, <${Term} t="узкое место">узкое место<//> — <b>${r.capacity.bottleneck}</b>` : null}</span>
                <span><${Term} t="срок">Срок<//>: <b>${
                  r.leadDays == null
                    ? "не считается (у продукта нет цепочки срока)"
                    : `${f1.format(r.leadDays)} раб. дн. ≈ ${f1.format(r.leadDays / model.vars.working_days_per_month)} мес.`
                }</b></span>
                <span><${Term} t="прямые часы">Прямые часы<//>: <b>${hrs(r.direct.hours)}</b></span>
                <span>«<${Term} t="по загрузке">По загрузке<//>»: <b data-testid="total-by-load">${rub(r.total.byLoad)}</b></span>
                <span>«<${Term} t="с полным фондом оплаты">С полным фондом оплаты<//>»: <b data-testid="total-full-payroll">${rub(r.total.fullPayroll)}</b></span>
                <${ProductOptions} productName=${productName} />
                ${
                  r.flags.length
                    ? view`<details class="flagbox" data-testid="flags">
                        <summary>Флаги расчёта: ${r.flags.length}</summary>
                        <ul class="flags">${r.flags.map((f) => view`<li key=${f}>${f}</li>`)}</ul>
                      </details>`
                    : view`<span class="small muted">Флагов нет.</span>`
                }
              </section>
              <div class="cols2">
                <div class="col">
                  <${PriceBlock} r=${r} productName=${productName} model=${model} />
                  <${ContactsBlock} r=${r} inputs=${inputs} />
                  <${BudgetPanel} r=${r} model=${model} ctx=${ctx} />
                </div>
                <div class="col sticky">
                  <${Drivers} r=${r} base=${baseline} model=${model} productName=${productName} ctx=${ctx} setCtx=${setCtx} />
                </div>
              </div>
              <${Breakdown} r=${r} plan=${plan} model=${model} ctx=${ctx} />
              <${Calibration}
                r=${r}
                plan=${plan}
                model=${model}
                inputs=${inputs}
                productName=${productName}
                ctx=${ctx}
              />`
          : view`<section class="card">
              <p>Расчёт не выполнен — см. ошибку выше. Сбросьте последнюю правку или все правки.</p>
              <${EditsPanel} />
            </section>`
      }
    </div>
  <//>`;
}

/** Stored ctx of an older page (a scenario string) or garbage → the default grade and course. */
function normalizeStored(value) {
  if (!isPlainObject(value)) return { ...DEFAULT_CTX };
  const grade = [...GRADES, GRADE_MIX].includes(value.grade)
    ? value.grade
    : DEFAULT_CTX.grade;
  const course = COURSES.includes(value.course)
    ? value.course
    : DEFAULT_CTX.course;
  return { grade, course };
}

/** The part of a result the baseline needs (KPI metrics and cost-vs-margin segments), JSON-safe. */
function snapshotOf(r) {
  return {
    price: {
      cost: r.price.cost,
      price: r.price.price,
      derived: r.price.derived,
      contacts: r.price.contacts,
      breakEvenContacts: r.price.breakEvenContacts,
    },
    direct: { cost: r.direct.cost },
    overhead: { cost: r.overhead.cost },
    reserve: { cost: r.reserve.cost },
    externalCost: r.externalCost,
    tools: { cost: r.tools.cost },
    idle: { cost: r.idle.cost },
  };
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
    return view`<div class="wrap">
      <div class="errbox">Страница не смогла показать расчёт: ${String(this.state.error.message)}</div>
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
    root.render(view`<${Boundary}><${App} inputs=${inputs} /><//>`),
  )
  .catch((error) =>
    root.render(
      view`<p class="err" style=${{ padding: 16 }}>
        Не удалось загрузить модель: ${String(error?.message ?? error)}
      </p>`,
    ),
  );
