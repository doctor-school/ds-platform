/**
 * One-off UI-evidence capture for #2435 (046 S4 — congress abstracts). Not a
 * test — a screenshot driver for the PR's `ui-render-*` / `ui-interactions`
 * markers, kept out of `e2e/*.spec.ts` so Playwright never collects it.
 * Mirrors `apps/doctor/e2e/ui-evidence-2434.mjs`.
 *
 * It drives the PRODUCTION standalone build of the branch head against the dev
 * stand (api on the branch database): it writes a congress event with the oral
 * and abstract intakes open — abstracts limited to 3 per account, the
 * first-author rule on — and provisions confirmed doctors registered for it
 * (the same rows `support/congress-stand.ts` documents; every registration
 * names «Иванова Мария Петровна», so author 1 is the same person everywhere).
 * The four profiles shoot an abstract draft (title, authors, «Текст тезисов»
 * with its five sections, statements, consent, the send panel with the total
 * counter); the interactions shoot the counter near the limit, the text above
 * it refused at send with the statements unmet, «Подать тезисы по этой работе»
 * on a sent talk and the prefilled draft it opens, the first-author
 * refusal (a colleague has already sent 3 abstracts with that first author),
 * and on a 390px phone the counter above the limit on one line and a failed
 * send that brings the focused error summary into view.
 *
 *   E2E_DOCTOR_URL=http://127.0.0.1:3004 MAILPIT_URL=… DATABASE_URL=<branch db> \
 *     node apps/doctor/e2e/ui-evidence-2435.mjs .github/ui-evidence/2435
 *
 * Boot recipe (bot protection in its stand bypass, the host built with an empty
 * `NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY`, the server bound to 127.0.0.1): the
 * docblock of `e2e/congress-submissions.spec.ts`.
 */

/* global localStorage, document, window */
// The identifiers above are referenced only inside `page.evaluate` callbacks,
// which run in the BROWSER, not in this Node process.

import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import pg from "pg";

const BASE = (process.env.E2E_DOCTOR_URL ?? "http://127.0.0.1:3004").replace(
  /\/$/,
  "",
);
const MAILPIT = (process.env.MAILPIT_URL ?? "").replace(/\/$/, "");
const OUT = process.argv[2] ?? ".github/ui-evidence/2435";
mkdirSync(OUT, { recursive: true });
const DAY = 86_400_000;

const VIEWPORTS = {
  desktop: { width: 1440, height: 1024 },
  mobile: { width: 390, height: 844 },
};

async function db(fn) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function verifyCode(email, after) {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const data = res.ok ? await res.json() : {};
    const hit = (data.messages ?? []).find(
      (m) =>
        Date.parse(m.Created) >= after - 1000 &&
        m.Subject.includes("код подтверждения"),
    );
    const code = hit?.Subject.match(/^([A-Za-z0-9]{4,12})\s+—/)?.[1];
    if (code) return code;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no verify code for ${email}`);
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
}

// ---- setup: event, doctors, registrations ----------------------------------
const eventId = randomUUID();
await db(async (c) => {
  await c.query(
    `INSERT INTO events (id, slug, title, school, starts_at, duration_min, description,
       specialties, partner_ref, program_pdf_ref, state, participation_format)
     VALUES ($1,$2,'VIII конгресс «Ортобиология»','Конгресс',$3,960,'Ежегодный конгресс.',
       $4,'sponsor:congress',NULL,'published','offline')`,
    [
      eventId,
      `orthobio-2435-${eventId.slice(0, 6)}`,
      new Date(Date.now() + 400 * DAY),
      ["cardiology"],
    ],
  );
  await c.query(
    `INSERT INTO congress_submission_settings (event_id, registration_url, first_author_counts)
     VALUES ($1,'https://orthobio.ru/registration', true)`,
    [eventId],
  );
  await c.query(
    `INSERT INTO congress_submission_kind_settings (event_id, kind, opens_at, closes_at, submit_limit)
     VALUES ($1,'oral',$2,$3,NULL), ($1,'abstract',$2,$3,3)`,
    [eventId, new Date(Date.now() - DAY), new Date(Date.now() + 40 * DAY)],
  );
});

/** A confirmed doctor registered for the congress (044 answers on the row). */
async function provision(tag) {
  const email = `e2e-2435-${tag}-${Date.now()}@ds.test`;
  const password = `Doc-${Date.now()}-aA1!`;
  const sentAt = Date.now();
  await post("/v1/storefront/doctor/register", {
    email,
    password,
    medicalWorkerDeclaration: true,
    consent: [{ purpose: "partner-data-sharing", version: "v1" }],
  });
  await post("/v1/auth/verify", {
    email,
    code: await verifyCode(email, sentAt),
  });
  await db((c) =>
    c.query(
      `INSERT INTO registrations (user_id, event_id, answers)
       SELECT id, $2, $3 FROM users WHERE email = $1`,
      [
        email,
        eventId,
        {
          surname: "Иванова",
          firstName: "Мария",
          patronymic: "Петровна",
          workplace: "ГКБ № 1, Москва",
        },
      ],
    ),
  );
  return { email, password };
}

async function signIn(page, who) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const status = await page.evaluate(
    async ([identifier, pw]) =>
      (
        await fetch("/v1/auth/login", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ identifier, password: pw }),
        })
      ).status,
    [who.email, who.password],
  );
  if (status !== 200) throw new Error(`sign-in ${status}`);
}

const browser = await chromium.launch();

/**
 * Through the section's own API as `who`: create a draft of `kind` (author 1
 * from the registration), write `content` into it and — when `send` — send it
 * with the consent and, for abstracts, both statements.
 */
async function draftAs(who, kind, content, send = false) {
  const ctx = await browser.newContext({ locale: "ru-RU" });
  const page = await ctx.newPage();
  await signIn(page, who);
  const outcome = await page.evaluate(
    async ([event, k, body, doSend]) => {
      const json = { "content-type": "application/json" };
      const base = "/v1/me/congress-submissions";
      const r = await fetch(base, {
        method: "POST",
        credentials: "include",
        headers: json,
        body: JSON.stringify({ eventId: event, kind: k }),
      });
      if (r.status !== 201) return `create ${r.status}`;
      const { id, authors } = await r.json();
      const p = await fetch(`${base}/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: json,
        body: JSON.stringify({
          title: body.title,
          body: body.body,
          authors: [
            ...authors.map((a) => ({ ...a, presenting: k === "oral" })),
            ...body.extraAuthors,
          ],
        }),
      });
      if (!p.ok) return `patch ${p.status}: ${await p.text()}`;
      if (doSend) {
        const s = await fetch(`${base}/${id}/send`, {
          method: "POST",
          credentials: "include",
          headers: json,
          body: JSON.stringify({
            acceptedConsents: ["congress-submission-personal-data"],
            ...(k === "abstract" ? { statements: ["plag", "trade"] } : {}),
          }),
        });
        if (!s.ok) return `send ${s.status}: ${await s.text()}`;
      }
      return "ok";
    },
    [eventId, kind, content, send],
  );
  if (outcome !== "ok") throw new Error(outcome);
  await ctx.close();
}

const COAUTHOR = {
  surname: "Орлов",
  firstName: "Виктор",
  patronymic: "Сергеевич",
  workplace: "НИИ ревматологии, Москва",
  presenting: false,
};

const ABSTRACT = {
  title:
    "Обогащённая тромбоцитами плазма при латеральном эпикондилите: результаты 12 месяцев",
  extraAuthors: [COAUTHOR],
  body: {
    relevance:
      "Латеральный эпикондилит — частая причина боли в локте у пациентов трудоспособного возраста; при неэффективности консервативного лечения выбор между инъекционными методиками остаётся открытым.",
    goal: "Сравнить эффект однократной инъекции PRP и глюкокортикоида через 3, 6 и 12 месяцев.",
    methods:
      "Проспективное рандомизированное исследование, 120 пациентов: 60 получили PRP, 60 — бетаметазон. Боль оценивали по ВАШ, функцию — по шкале PRTEE до инъекции и в контрольные точки.",
    results:
      "Через 3 месяца снижение боли было сопоставимым. Через 6 и 12 месяцев в группе PRP боль по ВАШ была ниже на 2,1 и 2,6 балла, функция по PRTEE — лучше на 18 и 24 балла (p < 0,01). Рецидивы: 5 % против 27 %.",
    conclusions:
      "PRP даёт более стойкий результат, чем глюкокортикоид, и может рассматриваться как метод выбора при хроническом течении.",
  },
};
const TALK = {
  title: "PRP при латеральном эпикондилите: результаты 120 пациентов",
  extraAuthors: [COAUTHOR],
  body: {
    goal: "Разобрать показания к PRP и отбор пациентов.",
    summary:
      "Материал 120 пациентов, сравнение с глюкокортикоидом, клинические случаи и выводы.",
  },
};
/** The same abstract with the results section grown to a total of 4 742. */
const sum = (b) =>
  Object.values(b).reduce((n, v) => n + Array.from(v).length, 0);
const LONG = {
  ...ABSTRACT,
  body: {
    ...ABSTRACT.body,
    results:
      ABSTRACT.body.results +
      " " +
      "Данные подтверждены при повторной оценке. ".repeat(200),
  },
};
LONG.body.results = Array.from(LONG.body.results)
  .slice(0, Array.from(LONG.body.results).length - (sum(LONG.body) - 4742))
  .join("");

// One abstract author per profile (each opens their own draft).
const authors = {};
for (const vp of Object.keys(VIEWPORTS)) {
  for (const theme of ["light", "dark"]) {
    const who = await provision(`${vp[0]}${theme[0]}`);
    await draftAs(who, "abstract", ABSTRACT);
    authors[`${vp}-${theme}`] = who;
  }
}
const longer = await provision("long");
await draftAs(longer, "abstract", LONG);
const speaker = await provision("talk");
await draftAs(speaker, "oral", TALK, true);
// A colleague has sent 3 abstracts with Иванова Мария Петровна first.
const colleague = await provision("colleague");
for (let i = 0; i < 3; i++)
  await draftAs(colleague, "abstract", ABSTRACT, true);
const refused = await provision("refused");
await draftAs(refused, "abstract", ABSTRACT);

// ---- captures ----------------------------------------------------------------
async function themed(viewport, theme, who) {
  const ctx = await browser.newContext({ viewport, locale: "ru-RU" });
  await ctx.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* storage blocked */
      }
    },
    ["ds-theme", theme],
  );
  const page = await ctx.newPage();
  await signIn(page, who);
  return { ctx, page };
}

async function shot(page, name, theme, full = true) {
  const dark = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
  if (dark !== (theme === "dark"))
    throw new Error(`${name}: expected ${theme}`);
  await page.waitForTimeout(400);
  const path = `${OUT}/${name}.png`;
  if (full) {
    // Grow the viewport to the document so the sticky send panel rests where a
    // reader scrolls to it (a `fullPage` capture would draw it mid-page).
    const viewport = page.viewportSize();
    const height = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    await page.setViewportSize({ width: viewport.width, height });
    await page.waitForTimeout(200);
    await page.screenshot({ path });
    await page.setViewportSize(viewport);
  } else {
    await page.screenshot({ path });
  }
  console.log(`${path} ${statSync(path).size}`);
}

/** Open the first draft from the list. */
async function openDraft(page) {
  await page.goto(`${BASE}/account/congress`);
  await page
    .getByTestId("congress-row")
    .first()
    .getByRole("button", { name: /Продолжить|Открыть/ })
    .click();
  await page.getByLabel("Название тезисов").waitFor();
}

/** Bring `locator` to the middle of the viewport before a viewport shot. */
async function centre(page, locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(200);
}

/** Tick a checkbox by its box (the label wraps a link for the consent). */
async function tick(page, name) {
  const box = page.getByRole("checkbox", { name });
  await box
    .locator("xpath=ancestor::label[1]")
    .click({ position: { x: 8, y: 10 } });
}

// The abstract form, four profiles.
for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
  for (const theme of ["light", "dark"]) {
    const { ctx, page } = await themed(
      viewport,
      theme,
      authors[`${vp}-${theme}`],
    );
    await openDraft(page);
    await shot(page, `${vp}-${theme}`, theme);
    await ctx.close();
  }
}

// Interactions (desktop light).
{
  const { ctx, page } = await themed(VIEWPORTS.desktop, "light", longer);
  await openDraft(page);
  const counter = page.getByTestId("congress-abstract-counter");
  // EARS-22 — near the limit: marked, «осталось 258».
  await counter.getByText("осталось").waitFor();
  await shot(page, "interactions-counter-near", "light", false);
  // Above it: «больше на N», then the send refused with the canvas line and
  // the two statements unmet.
  await page.getByLabel("Выводы").click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(
    " " + "Требуется дальнейшее наблюдение. ".repeat(10),
  );
  await counter.getByText("больше на").waitFor();
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await page
    .getByText(/Сократите текст тезисов до 5 000 знаков/)
    .first()
    .waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "interactions-over-limit-summary", "light", false);
  await centre(
    page,
    page.getByRole("checkbox", { name: "В тексте нет торговых наименований" }),
  );
  await shot(page, "interactions-statements-errors", "light", false);
  await ctx.close();
}
{
  const { ctx, page } = await themed(VIEWPORTS.desktop, "light", speaker);
  // EARS-25 — the sent talk's row offers «Подать тезисы по этой работе».
  await page.goto(`${BASE}/account/congress`);
  const row = page.getByTestId("congress-row").first();
  await row
    .getByRole("button", { name: "Подать тезисы по этой работе" })
    .waitFor();
  await shot(page, "interactions-abstract-from-row", "light", false);
  await row
    .getByRole("button", { name: "Подать тезисы по этой работе" })
    .click();
  await page.getByLabel("Название тезисов").waitFor();
  await shot(page, "interactions-abstract-from-draft", "light");
  await ctx.close();
}
{
  const { ctx, page } = await themed(VIEWPORTS.desktop, "light", refused);
  // EARS-24 — the first-author refusal at send.
  await openDraft(page);
  await tick(page, "В тексте нет некорректных заимствований");
  await tick(page, "В тексте нет торговых наименований");
  await tick(page, /Согласие на обработку/);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await page.getByRole("button", { name: "Да, отправить" }).click();
  await page
    .getByText(
      /С первым автором «Иванова Мария Петровна» уже отправлено 3 тезиса из 3/,
    )
    .waitFor();
  // A field-less refusal is still a failed send: the text is kept (EARS-30 canon).
  await page.getByText("Текст заявки сохранён.").waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "interactions-first-author-refusal", "light", false);
  await ctx.close();
}
// Mobile light: the counter above the limit in the sticky send panel —
// «N / 5 000» on one line — then a failed send: the error summary, a screen
// above the send bar, is scrolled into view and takes the focus.
{
  const { ctx, page } = await themed(VIEWPORTS.mobile, "light", longer);
  await openDraft(page);
  await page
    .getByTestId("congress-abstract-counter")
    .getByText("больше на")
    .waitFor();
  await shot(page, "interactions-counter-mobile", "light", false);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  const summary = page.getByRole("alert", { name: /^Заявка не отправлена/ });
  await summary.waitFor();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("role") === "alert",
  );
  await shot(page, "interactions-mobile-error-summary", "light", false);
  await ctx.close();
}

await browser.close();
