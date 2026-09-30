/**
 * One-off UI-evidence capture for #2433 (046 S2 — «Мои заявки на Конгресс»).
 * Not a test — a screenshot driver for the PR's `ui-render-*` /
 * `ui-interactions` markers, kept out of `e2e/*.spec.ts` so Playwright never
 * collects it. Mirrors `apps/doctor/e2e/ui-evidence-2031.mjs`.
 *
 * It drives the PRODUCTION standalone build of the branch head against the dev
 * stand (api on the branch database): it provisions a doctor through the
 * doctor host register command and the 003 verify (Mailpit code), writes the
 * congress event, its intake settings and the 044 registration on the branch
 * database (the same rows `support/congress-stand.ts` documents), creates the
 * talks through the section's API and sets the committee statuses the S5
 * status route will write (`in_review`, `accepted`, `rejected`,
 * `needs_revision`, `withdrawn`) on the rows, so the list shows the canvas
 * «список» mix.
 *
 *   E2E_DOCTOR_URL=http://127.0.0.1:3004 MAILPIT_URL=… DATABASE_URL=<branch db> \
 *     node apps/doctor/e2e/ui-evidence-2433.mjs .github/ui-evidence/2433
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

const BASE = (process.env.E2E_DOCTOR_URL ?? "http://127.0.0.1:3004").replace(/\/$/, "");
const MAILPIT = (process.env.MAILPIT_URL ?? "").replace(/\/$/, "");
const OUT = process.argv[2] ?? ".github/ui-evidence/2433";
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

// ---- setup: event, doctor, registration ------------------------------------
const eventId = randomUUID();
await db(async (c) => {
  await c.query(
    `INSERT INTO events (id, slug, title, school, starts_at, duration_min, description,
       specialties, partner_ref, program_pdf_ref, state, participation_format)
     VALUES ($1,$2,'VIII конгресс «Ортобиология»','Конгресс',$3,960,'Ежегодный конгресс.',
       $4,'sponsor:congress',NULL,'published','offline')`,
    [eventId, `orthobio-2433-${eventId.slice(0, 6)}`, new Date(Date.now() + 400 * DAY), ["cardiology"]],
  );
  await c.query(
    `INSERT INTO congress_submission_settings (event_id, registration_url) VALUES ($1,'https://orthobio.ru/registration')`,
    [eventId],
  );
  await c.query(
    `INSERT INTO congress_submission_kind_settings (event_id, kind, opens_at, closes_at, submit_limit)
     VALUES ($1,'oral',$2,$3,NULL)`,
    [eventId, new Date(Date.now() - DAY), new Date(Date.now() + 40 * DAY)],
  );
});

/** A confirmed doctor registered for the congress (044 answers on the row). */
async function provision(tag) {
  const email = `e2e-2433-${tag}-${Date.now()}@ds.test`;
  const password = `Doc-${Date.now()}-aA1!`;
  const sentAt = Date.now();
  await post("/v1/storefront/doctor/register", {
    email,
    password,
    medicalWorkerDeclaration: true,
    consent: [{ purpose: "partner-data-sharing", version: "v1" }],
  });
  await post("/v1/auth/verify", { email, code: await verifyCode(email, sentAt) });
  // The throwaway dev-stand account, for a follow-up manual drive of the same list.
  console.log(`account ${email} ${password}`);
  await db((c) =>
    c.query(
      `INSERT INTO registrations (user_id, event_id, answers)
       SELECT id, $2, $3 FROM users WHERE email = $1`,
      [email, eventId, { surname: "Иванова", firstName: "Мария", patronymic: "Петровна", workplace: "ГКБ № 1, Москва" }],
    ),
  );
  return { email, password };
}
const author = await provision("evidence");
// First-time authors (one per viewport — each starts its own draft): no
// submission consent row yet, so the form asks for it.
const newcomers = { desktop: await provision("consent-d"), mobile: await provision("consent-m") };

const TALKS = [
  { title: "PRP при латеральном эпикондилите: результаты 120 пациентов", status: "needs_revision",
    comment: "Уточните дизайн исследования и критерии включения пациентов в разделе «Материалы и методы»." },
  { title: "Аутологичная жировая ткань при гонартрозе II стадии: 12 месяцев наблюдения", status: "in_review" },
  { title: "Возвращение в спорт после PRP-терапии: критерии допуска", status: "accepted" },
  { title: "Реабилитация после эндопротезирования тазобедренного сустава: опыт отделения", status: "rejected",
    comment: "Работа не соответствует тематике конгресса." },
  { title: "Ударно-волновая терапия при подошвенном фасциите: кому она не поможет", status: "submitted" },
  { title: "Комбинация PRP и гиалуроновой кислоты при гонартрозе: проспективное исследование", status: "withdrawn" },
];

async function signIn(page, who = author) {
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

const browser = await chromium.launch();

// Talks through the section API, as the author.
{
  const ctx = await browser.newContext({ locale: "ru-RU" });
  const page = await ctx.newPage();
  await signIn(page);
  const outcome = await page.evaluate(
    async ([event, talks]) => {
      const base = "/v1/me/congress-submissions";
      const json = { "content-type": "application/json" };
      for (const t of talks) {
        const r = await fetch(base, { method: "POST", credentials: "include", headers: json,
          body: JSON.stringify({ eventId: event, kind: "oral" }) });
        const { id } = await r.json();
        await fetch(`${base}/${id}`, { method: "PATCH", credentials: "include", headers: json,
          body: JSON.stringify({ title: t.title,
            authors: [{ surname: "Иванова", firstName: "Мария", patronymic: "Петровна",
              workplace: "ГКБ № 1, Москва", presenting: true }],
            body: { goal: "Разобрать показания и отбор пациентов.", summary: "Материал, случаи, выводы." } }) });
        const s = await fetch(`${base}/${id}/send`, { method: "POST", credentials: "include", headers: json,
          body: JSON.stringify({ acceptedConsents: ["congress-submission-personal-data"] }) });
        if (!s.ok) return `send ${s.status}`;
      }
      // One draft still being written.
      const d = await fetch(base, { method: "POST", credentials: "include", headers: json,
        body: JSON.stringify({ eventId: event, kind: "oral" }) });
      return d.status === 201 ? "ok" : `draft ${d.status}`;
    },
    [eventId, TALKS],
  );
  if (outcome !== "ok") throw new Error(outcome);
  await ctx.close();
}
await db(async (c) => {
  for (const t of TALKS) {
    if (t.status === "submitted") continue;
    await c.query(
      `UPDATE congress_submissions SET status = $3, committee_comment = $4, status_changed_at = now(),
         revision_due_at = CASE WHEN $3 = 'needs_revision' THEN $5::timestamptz ELSE NULL END
       WHERE event_id = $1 AND title = $2`,
      [eventId, t.title, t.status, t.comment ?? null, new Date(Date.now() + 2 * DAY + 5 * 3_600_000)],
    );
  }
});

// ---- captures ----------------------------------------------------------------
async function themed(viewport, theme, who = author) {
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
    // A `fullPage` capture keeps the original viewport for layout, so the
    // form's sticky send panel would be drawn mid-page. Grow the viewport to
    // the document instead: the panel then rests where a reader scrolls to it.
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

for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
  for (const theme of ["light", "dark"]) {
    const { ctx, page } = await themed(viewport, theme);
    await page.goto(`${BASE}/account/congress`);
    await page.getByTestId("congress-row").first().waitFor();
    await shot(page, `${vp}-${theme}`, theme);
    await ctx.close();
  }
}

// Interactions (desktop light unless named).
{
  const { ctx, page } = await themed(VIEWPORTS.desktop, "light");
  await page.goto(`${BASE}/account/congress`);
  await page.getByTestId("congress-row").first().waitFor();

  // Row hover.
  await page.getByTestId("congress-row").nth(1).hover();
  await shot(page, "interactions-row-hover", "light", false);

  // Status filter «На доработке».
  await page.getByRole("group", { name: "Мои заявки" }).getByRole("button", { name: /На доработке/ }).click();
  await shot(page, "interactions-filter-needs-revision", "light", false);
  await page.getByRole("group", { name: "Мои заявки" }).getByRole("button", { name: /Все/ }).click();

  // «Отозвать» asks first.
  const inReview = page.getByTestId("congress-row").filter({ hasText: "Аутологичная жировая ткань" });
  await inReview.getByRole("button", { name: "Отозвать" }).click();
  await shot(page, "interactions-withdraw-ask", "light", false);
  await inReview.getByRole("button", { name: "Отмена" }).click();

  // Kind choice.
  await page.getByRole("button", { name: "+ Новая заявка" }).click();
  await page.getByTestId("congress-pick-oral").waitFor();
  await page.getByTestId("congress-pick-oral").scrollIntoViewIfNeeded();
  await shot(page, "interactions-kind-choice", "light", false);

  // The oral form (the empty draft): error summary on a send with gaps.
  await page.getByTestId("congress-row").filter({ hasText: "Без темы" }).getByRole("button", { name: /Продолжить/ }).click();
  await page.getByLabel("Тема").waitFor();
  await shot(page, "interactions-oral-form", "light");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await page.getByRole("alert").first().waitFor();
  await shot(page, "interactions-send-error-summary", "light");

  // Fill and ask for the confirmation.
  await page.getByLabel("Тема").fill("Возвращение в спорт после PRP-терапии: критерии допуска");
  await page.getByLabel("Образовательная цель").fill("Критерии допуска к нагрузкам.");
  await page.getByLabel("Краткое содержание").fill("Материал, случаи, выводы.");
  await page.getByLabel("Краткое содержание").blur();
  await page.getByTestId("congress-save-state").getByText("Сохранено").waitFor();
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await page.getByText("Отправить заявку в программный комитет?").waitFor();
  await page.getByText("Отправить заявку в программный комитет?").scrollIntoViewIfNeeded();
  await shot(page, "interactions-send-confirm", "light", false);
  await page.getByRole("button", { name: "Да, отправить" }).click();
  await page.getByTestId("congress-status-plate").getByText("Отправлена").waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "interactions-sent", "light", false);

  // The needs-revision talk opened (comment + deadline + «Отправить снова»).
  await page.goto(`${BASE}/account/congress`);
  await page
    .getByTestId("congress-row")
    .filter({ hasText: "PRP при латеральном эпикондилите" })
    .getByRole("button", { name: /Продолжить/ })
    .click();
  await page.getByTestId("congress-committee-comment").waitFor();
  await shot(page, "interactions-needs-revision", "light");

  // The account-page row.
  await page.goto(`${BASE}/account`);
  await page.getByRole("link", { name: /Мои заявки на Конгресс/ }).waitFor();
  await shot(page, "interactions-account-row", "light");
  await ctx.close();
}

// Mobile dark: the oral form.
{
  const { ctx, page } = await themed(VIEWPORTS.mobile, "dark");
  await page.goto(`${BASE}/account/congress`);
  await page
    .getByTestId("congress-row")
    .filter({ hasText: "PRP при латеральном эпикондилите" })
    .getByRole("button", { name: /Продолжить/ })
    .click();
  await page.getByLabel("Тема").waitFor();
  await shot(page, "interactions-needs-revision-mobile-dark", "dark");
  await ctx.close();
}

// The consent row («Подтверждения», checkbox + policy link) of a first-time
// author (EARS-16), desktop and mobile light: refused without it, then ticked.
for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
  const { ctx, page } = await themed(viewport, "light", newcomers[vp]);
  await page.goto(`${BASE}/account/congress`);
  await page.getByTestId("congress-pick-oral").getByRole("button", { name: "Начать заявку →" }).click();
  await page.getByLabel("Тема").waitFor();
  await page.getByLabel("Тема").fill("Возвращение в спорт после PRP-терапии: критерии допуска");
  await page.getByLabel("Образовательная цель").fill("Критерии допуска к нагрузкам.");
  await page.getByLabel("Краткое содержание").fill("Материал, случаи, выводы.");
  await page.getByLabel("Краткое содержание").blur();
  await page.getByTestId("congress-save-state").getByText("Сохранено").waitFor();
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await page.getByText("Дайте согласие на обработку персональных данных").first().waitFor();
  await shot(page, `interactions-consent-${vp}`, "light");
  await ctx.close();
}

// The author resend (EARS-30): the needs-revision talk sent again before its
// deadline → «Отправить исправленную заявку?» → «Отправлена».
{
  const { ctx, page } = await themed(VIEWPORTS.desktop, "light");
  await page.goto(`${BASE}/account/congress`);
  await page
    .getByTestId("congress-row")
    .filter({ hasText: "PRP при латеральном эпикондилите" })
    .getByRole("button", { name: /Продолжить/ })
    .click();
  await page.getByRole("button", { name: "Отправить снова" }).click();
  await page.getByText("Отправить исправленную заявку?").waitFor();
  await page.getByText("Отправить исправленную заявку?").scrollIntoViewIfNeeded();
  await shot(page, "interactions-resend-confirm", "light", false);
  await page.getByRole("button", { name: "Да, отправить снова" }).click();
  await page.getByTestId("congress-status-plate").getByText("Отправлена").waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "interactions-resent", "light", false);
  await ctx.close();
}

await browser.close();
