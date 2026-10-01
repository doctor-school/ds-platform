/**
 * One-off UI-evidence capture for #2434 (046 S3 — congress posters). Not a
 * test — a screenshot driver for the PR's `ui-render-*` / `ui-interactions`
 * markers, kept out of `e2e/*.spec.ts` so Playwright never collects it.
 * Mirrors `apps/doctor/e2e/ui-evidence-2433.mjs`.
 *
 * It drives the PRODUCTION standalone build of the branch head against the dev
 * stand (api on the branch database): it writes a congress event with the oral
 * and poster intakes open — the poster with an age limit of 40 years — and
 * provisions confirmed doctors registered for it (the same rows
 * `support/congress-stand.ts` documents). The four profiles shoot a first
 * poster draft (topic, birth date shown back, authors, «Цель», «Содержание»,
 * consent, send panel); the interactions shoot the birth date asked in a new
 * first poster draft, the authors section with no speaker pick, the
 * «Укажите дату рождения» error at send, a poster draft of a holder above the
 * limit (the refusal in place of the send) and that holder's kind choice; in
 * dark, the birth ask and the error summary (contrast printed for both themes);
 * and a send refused for a reason tied to no field (intake closed meanwhile).
 *
 *   E2E_DOCTOR_URL=http://127.0.0.1:3004 MAILPIT_URL=… DATABASE_URL=<branch db> \
 *     node apps/doctor/e2e/ui-evidence-2434.mjs .github/ui-evidence/2434
 *
 * Boot recipe (bot protection in its stand bypass, the host built with an empty
 * `NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY`, the server bound to 127.0.0.1): the
 * docblock of `e2e/congress-submissions.spec.ts`.
 */

/* global localStorage, document, getComputedStyle */
// The identifiers above are referenced only inside `page.evaluate` callbacks,
// which run in the BROWSER, not in this Node process.

import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import pg from "pg";

const BASE = (process.env.E2E_DOCTOR_URL ?? "http://127.0.0.1:3004").replace(/\/$/, "");
const MAILPIT = (process.env.MAILPIT_URL ?? "").replace(/\/$/, "");
const OUT = process.argv[2] ?? ".github/ui-evidence/2434";
mkdirSync(OUT, { recursive: true });
const DAY = 86_400_000;
const YEAR = new Date().getFullYear();
const isoBorn = (years) => `${YEAR - years}-06-15`;

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
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const data = res.ok ? await res.json() : {};
    const hit = (data.messages ?? []).find(
      (m) => Date.parse(m.Created) >= after - 1000 && m.Subject.includes("код подтверждения"),
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
    [eventId, `orthobio-2434-${eventId.slice(0, 6)}`, new Date(Date.now() + 400 * DAY), ["cardiology"]],
  );
  await c.query(
    `INSERT INTO congress_submission_settings (event_id, registration_url) VALUES ($1,'https://orthobio.ru/registration')`,
    [eventId],
  );
  await c.query(
    `INSERT INTO congress_submission_kind_settings (event_id, kind, opens_at, closes_at, submit_limit, max_age_years)
     VALUES ($1,'oral',$2,$3,NULL,NULL), ($1,'poster',$2,$3,NULL,40)`,
    [eventId, new Date(Date.now() - DAY), new Date(Date.now() + 40 * DAY)],
  );
});

/** A confirmed doctor registered for the congress (044 answers on the row). */
async function provision(tag) {
  const email = `e2e-2434-${tag}-${Date.now()}@ds.test`;
  const password = `Doc-${Date.now()}-aA1!`;
  const sentAt = Date.now();
  await post("/v1/storefront/doctor/register", {
    email,
    password,
    medicalWorkerDeclaration: true,
    consent: [{ purpose: "partner-data-sharing", version: "v1" }],
  });
  await post("/v1/auth/verify", { email, code: await verifyCode(email, sentAt) });
  await db((c) =>
    c.query(
      `INSERT INTO registrations (user_id, event_id, answers)
       SELECT id, $2, $3 FROM users WHERE email = $1`,
      [email, eventId, { surname: "Иванова", firstName: "Мария", patronymic: "Петровна", workplace: "ГКБ № 1, Москва" }],
    ),
  );
  return { email, password };
}

async function signIn(page, who) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const status = await page.evaluate(
    async ([identifier, pw]) =>
      (await fetch("/v1/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, password: pw }),
      })).status,
    [who.email, who.password],
  );
  if (status !== 200) throw new Error(`sign-in ${status}`);
}

// `--lang`: the native date control draws its format from the browser's UI
// language, not the context locale — a Russian browser shows «дд.мм.гггг».
const browser = await chromium.launch({ args: ["--lang=ru-RU"] });

/**
 * Through the section's own API as `who`: write the birth date, start a poster
 * draft and fill it; then, when `laterBirth` is given, correct the birth date
 * to it (a holder who ends above the limit with a draft in hand).
 */
async function posterDraft(who, birth, content, laterBirth) {
  const ctx = await browser.newContext({ locale: "ru-RU" });
  const page = await ctx.newPage();
  await signIn(page, who);
  const outcome = await page.evaluate(
    async ([event, birthDate, body, later]) => {
      const json = { "content-type": "application/json" };
      const put = (d) =>
        fetch("/v1/me/birth-date", { method: "PUT", credentials: "include", headers: json,
          body: JSON.stringify({ birthDate: d }) });
      if (!(await put(birthDate)).ok) return "birth";
      const base = "/v1/me/congress-submissions";
      const r = await fetch(base, { method: "POST", credentials: "include", headers: json,
        body: JSON.stringify({ eventId: event, kind: "poster" }) });
      if (r.status !== 201) return `create ${r.status}`;
      const { id, authors } = await r.json();
      if (body) {
        const p = await fetch(`${base}/${id}`, { method: "PATCH", credentials: "include", headers: json,
          body: JSON.stringify({ ...body, authors: [...authors, ...body.extraAuthors], extraAuthors: undefined }) });
        if (!p.ok) return `patch ${p.status}`;
      }
      if (later && !(await put(later)).ok) return "later birth";
      return "ok";
    },
    [eventId, birth, content, laterBirth ?? null],
  );
  if (outcome !== "ok") throw new Error(outcome);
  await ctx.close();
}

const POSTER = {
  title: "Аутологичная жировая ткань при гонартрозе II стадии: 12 месяцев наблюдения",
  extraAuthors: [
    { surname: "Орлов", firstName: "Виктор", patronymic: "Сергеевич", workplace: "НИИ ревматологии, Москва", presenting: false },
  ],
  body: {
    goal: "Оценить клинический эффект введения аутологичной жировой ткани через 12 месяцев.",
    content:
      "Проспективное наблюдение 48 пациентов с гонартрозом II стадии. Боль по ВАШ и функция по WOMAC до введения, через 3, 6 и 12 месяцев; сравнение с группой PRP.",
  },
};

// One first-time poster author per profile (each opens their own first draft).
const authors = {};
for (const vp of Object.keys(VIEWPORTS)) {
  for (const theme of ["light", "dark"]) {
    const who = await provision(`${vp[0]}${theme[0]}`);
    await posterDraft(who, isoBorn(31), POSTER);
    authors[`${vp}-${theme}`] = who;
  }
}
const asker = await provision("ask");
const senior = await provision("senior");
await posterDraft(senior, isoBorn(31), POSTER, isoBorn(52));

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
  const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  if (dark !== (theme === "dark")) throw new Error(`${name}: expected ${theme}`);
  await page.waitForTimeout(400);
  const path = `${OUT}/${name}.png`;
  if (full) {
    // Grow the viewport to the document so the sticky send panel rests where a
    // reader scrolls to it (a `fullPage` capture would draw it mid-page).
    const viewport = page.viewportSize();
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: viewport.width, height });
    await page.waitForTimeout(200);
    await page.screenshot({ path });
    await page.setViewportSize(viewport);
  } else {
    await page.screenshot({ path });
  }
  console.log(`${path} ${statSync(path).size}`);
}

/** Open the first poster draft from the list. */
async function openDraft(page) {
  await page.goto(`${BASE}/account/congress`);
  await page.getByTestId("congress-row").first().getByRole("button", { name: /Продолжить|Открыть/ }).click();
  await page.getByText("Дата рождения").first().waitFor();
}

// The poster form, four profiles.
for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
  for (const theme of ["light", "dark"]) {
    const { ctx, page } = await themed(viewport, theme, authors[`${vp}-${theme}`]);
    await openDraft(page);
    await page.getByLabel("Цель").waitFor();
    // The native date control draws its picker indicator from the UA colour
    // scheme: the DS theme root sets it per theme (#2434 review).
    const scheme = await page.getByLabel("Дата рождения").evaluate((el) => getComputedStyle(el).colorScheme);
    if (scheme !== theme) throw new Error(`${vp}-${theme}: color-scheme ${scheme}`);
    await shot(page, `${vp}-${theme}`, theme);
    await ctx.close();
  }
}

/**
 * WCAG contrast of the error summary parts against the summary's own
 * background (walks up to the first opaque ancestor). Colours go through a
 * 1px canvas so `oklch()` resolves to the rendered sRGB.
 */
async function summaryContrast(page, label) {
  const out = await page.locator('[data-screen-label="d-lk-congress · сводка ошибок"]').evaluate((wrap) => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const rgb = (c) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a };
    };
    const bgOf = (el) => {
      for (let n = el; n; n = n.parentElement) {
        const c = rgb(getComputedStyle(n).backgroundColor);
        if (c.a === 255) return c;
      }
      return rgb("#fff");
    };
    const lum = ({ r, g, b }) =>
      [r, g, b]
        .map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
    };
    const alert = wrap.querySelector('[role="alert"]') ?? wrap.firstElementChild;
    const bg = bgOf(alert);
    const parts = { frame: [alert, "borderTopColor"] };
    const title = alert.querySelector("p, h2, h3, strong, div");
    if (title) parts.title = [title, "color"];
    const item = alert.querySelector("a") ?? alert.querySelector("li");
    if (item) parts.item = [item, "color"];
    const saved = [...wrap.querySelectorAll("p")].at(-1);
    if (saved) parts.saved = [saved, "color", bgOf(saved)];
    return Object.fromEntries(
      Object.entries(parts).map(([k, [el, prop, own]]) => {
        const back = own ?? bg;
        const raw = rgb(getComputedStyle(el)[prop]);
        // A translucent colour is composited over its background first.
        const a = raw.a / 255;
        const fg = {
          r: raw.r * a + back.r * (1 - a),
          g: raw.g * a + back.g * (1 - a),
          b: raw.b * a + back.b * (1 - a),
        };
        return [k, `${getComputedStyle(el)[prop]} ${ratio(fg, back)}:1`];
      }),
    );
  });
  console.log(`contrast ${label}: ${JSON.stringify(out)}`);
}

/** Bring `locator` to the middle of the viewport before a viewport shot. */
async function centre(page, locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(200);
}

// Interactions (desktop light). «Начать заявку» creates the poster draft at
// once; the draft asks for the birth date (canvas `askBirth`, 046 EARS-19).
{
  const { ctx, page } = await themed(VIEWPORTS.desktop, "light", asker);
  await page.goto(`${BASE}/account/congress`);
  const card = page.getByTestId("congress-pick-poster");
  await card.getByRole("button", { name: "Начать заявку →" }).click();
  const birth = page.getByLabel("Дата рождения");
  await birth.waitFor();
  await centre(page, birth);
  await shot(page, "interactions-birth-ask", "light", false);
  // The authors in publication order, with no speaker pick (EARS-18).
  await centre(page, page.getByText("Порядок — как в публикации"));
  await shot(page, "interactions-poster-authors", "light", false);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await page.getByText("Укажите дату рождения").first().waitFor();
  await summaryContrast(page, "light");
  await centre(page, birth);
  await shot(page, "interactions-birth-error", "light", false);
  await ctx.close();
}
// Dark: the birth ask (the picker indicator follows the dark scheme) and the
// error summary at send.
{
  const who = await provision("ask-d");
  const { ctx, page } = await themed(VIEWPORTS.desktop, "dark", who);
  await page.goto(`${BASE}/account/congress`);
  await page.getByTestId("congress-pick-poster").getByRole("button", { name: "Начать заявку →" }).click();
  const birth = page.getByLabel("Дата рождения");
  await birth.waitFor();
  await centre(page, birth);
  await shot(page, "interactions-birth-ask-dark", "dark", false);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await page.getByText("Укажите дату рождения").first().waitFor();
  await summaryContrast(page, "dark");
  await centre(page, page.locator('[data-screen-label="d-lk-congress · сводка ошибок"]'));
  await shot(page, "interactions-summary-dark", "dark", false);
  await ctx.close();
}
{
  const { ctx, page } = await themed(VIEWPORTS.desktop, "light", senior);
  // The list row of an age-locked poster draft: «Открыть» and the age rule on
  // the meta line (canvas `draftClosed`, 046 EARS-20).
  await page.goto(`${BASE}/account/congress`);
  const row = page.getByTestId("congress-row").first();
  await row.getByRole("button", { name: "Открыть →" }).waitFor();
  await row.getByText(/постерные доклады принимают от участников младше 40 лет/).waitFor();
  await shot(page, "interactions-list-age-locked", "light", false);
  await openDraft(page);
  await page.getByText(/На эту дату вам будет/).first().waitFor();
  await shot(page, "interactions-send-age-refusal", "light");
  // Back on the kind choice, the stored date over the limit refuses the poster.
  await page.getByRole("button", { name: "← Мои заявки" }).first().click();
  await page.getByRole("button", { name: "+ Новая заявка" }).click();
  const card = page.getByTestId("congress-pick-poster");
  await card.getByText(/На эту дату вам будет/).waitFor();
  await centre(page, card);
  await shot(page, "interactions-picker-age-refusal", "light", false);
  await ctx.close();
}
// Mobile light: the birth date asked in the first poster draft.
{
  const who = await provision("ask-m");
  const { ctx, page } = await themed(VIEWPORTS.mobile, "light", who);
  await page.goto(`${BASE}/account/congress`);
  const card = page.getByTestId("congress-pick-poster");
  await card.getByRole("button", { name: "Начать заявку →" }).click();
  await page.getByLabel("Дата рождения").waitFor();
  await shot(page, "interactions-birth-ask-mobile", "light");
  await ctx.close();
}

// A refusal tied to no field: the poster intake closes while a complete draft
// is open; the send is refused with the banner and «Текст заявки сохранён.»
// stays (046-design-prompt-ru §8). Last, because it closes the event's intake.
{
  const { ctx, page } = await themed(VIEWPORTS.desktop, "light", authors["desktop-light"]);
  await openDraft(page);
  await page.getByLabel("Цель").waitFor();
  await db((c) =>
    c.query(
      `UPDATE congress_submission_kind_settings SET closes_at = $2 WHERE event_id = $1 AND kind = 'poster'`,
      [eventId, new Date(Date.now() - 60_000)],
    ),
  );
  const consent = page.getByRole("checkbox", { name: /Согласие/ });
  if (await consent.count()) await consent.check({ force: true });
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  const confirm = page.getByRole("button", { name: /Да, отправить/ });
  if (await confirm.count()) await confirm.click();
  await page.getByText("Текст заявки сохранён.").waitFor();
  await centre(page, page.getByText("Текст заявки сохранён."));
  await shot(page, "interactions-operation-refusal", "light", false);
  await ctx.close();
}

await browser.close();
