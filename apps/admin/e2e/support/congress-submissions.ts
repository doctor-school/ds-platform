import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE } from "@ds/schemas";
import { bootstrapDoctorSession } from "./admin-session";
import { ADMIN_ORIGIN } from "./sign-in";

/**
 * Seeding for the 046 committee specs, through the PRODUCTION writers only —
 * no database write, no fixture endpoint:
 *
 *  - the platform administrator opens the event's intake through the real 046
 *    settings screen (`openOralIntake`);
 *  - an author is a freshly registered doctor who signs in, sets a display
 *    name and registers for the event through the platform path (044 EARS-16),
 *    then writes and sends submissions through `/v1/me/congress-submissions`
 *    exactly as the cabinet section's client does (`packages/congress-submissions`).
 */

/** Today's Moscow calendar day, `offsetDays` away. */
export function mskDay(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000 + 3 * 3_600_000)
    .toISOString()
    .slice(0, 10);
}

/** 046 EARS-2 — the oral intake open from today for a week, via the settings screen. */
export async function openOralIntake(page: Page, eventId: string): Promise<void> {
  await page.goto(`/events/${eventId}/congress-intake`);
  await expect(page.getByTestId("congress-intake-form")).toBeVisible({
    timeout: 20_000,
  });
  await page
    .getByTestId("intake-registrationUrl")
    .fill("https://orthobio.ru/congress/registration");
  await page.getByTestId("intake-oral-opensOn").fill(mskDay(0));
  await page.getByTestId("intake-oral-lastDay").fill(mskDay(7));
  await page.getByTestId("intake-save").click();
  await expect(page.getByTestId("congress-intake-saved")).toBeVisible();
}

export interface CongressAuthor {
  email: string;
  context: BrowserContext;
  page: Page;
}

/** One author, signed in in their OWN browser context and registered for the event. */
export async function congressAuthor(
  browser: Browser,
  eventSlug: string,
  displayName: string,
): Promise<CongressAuthor> {
  const { email, password } = await bootstrapDoctorSession(
    ADMIN_ORIGIN,
    "author",
  );
  const context = await browser.newContext({ baseURL: ADMIN_ORIGIN });
  const page = await context.newPage();
  await page.goto("/login");
  const outcome = await page.evaluate(
    async (input) => {
      const json = { "content-type": "application/json" };
      const login = await fetch("/v1/auth/login", {
        method: "POST",
        credentials: "include",
        headers: json,
        body: JSON.stringify({
          identifier: input.email,
          password: input.password,
        }),
      });
      if (!login.ok) return `login HTTP ${login.status}`;
      const named = await fetch("/v1/me/display-name", {
        method: "PUT",
        credentials: "include",
        headers: json,
        body: JSON.stringify({ displayName: input.displayName }),
      });
      if (!named.ok) return `display-name HTTP ${named.status}`;
      const registered = await fetch(
        `/v1/events/${encodeURIComponent(input.eventSlug)}/registration`,
        { method: "POST", credentials: "include" },
      );
      if (!registered.ok) return `registration HTTP ${registered.status}`;
      return "ok";
    },
    { email, password, displayName, eventSlug },
  );
  expect(outcome, `author ${email}`).toBe("ok");
  return { email, context, page };
}

/** A same-origin JSON call in the author's own session. */
async function call(
  author: CongressAuthor,
  method: string,
  url: string,
  json?: unknown,
): Promise<{ status: number; body: unknown }> {
  return author.page.evaluate(
    async (input) => {
      const res = await fetch(input.url, {
        method: input.method,
        credentials: "include",
        headers: {
          accept: "application/json",
          ...(input.json !== undefined
            ? { "content-type": "application/json" }
            : {}),
        },
        ...(input.json !== undefined
          ? { body: JSON.stringify(input.json) }
          : {}),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    { method, url, json },
  );
}

/** An oral submission written and sent (046 EARS-6/7/9); returns its id. */
export async function sendOralSubmission(
  author: CongressAuthor,
  eventId: string,
  title: string,
): Promise<string> {
  const created = await call(author, "POST", "/v1/me/congress-submissions", {
    eventId,
    kind: "oral",
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = (created.body as { id: string }).id;
  const saved = await call(author, "PATCH", `/v1/me/congress-submissions/${id}`, {
    title,
    authors: [
      {
        surname: "Иванова",
        firstName: "Мария",
        patronymic: "Петровна",
        workplace: "ГКБ №1",
        presenting: true,
      },
    ],
    body: {
      goal: "Разобрать показания к операции.",
      summary: "Краткое содержание доклада.",
    },
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const sent = await call(author, "POST", `/v1/me/congress-submissions/${id}/send`, {
    acceptedConsents: [CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE],
  });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  return id;
}

/**
 * The author withdraws a submission the committee has taken up (046 EARS-12:
 * `in_review` → `withdrawn`; a `submitted` one while its kind is open goes back
 * to `draft` instead).
 */
export async function withdrawSubmission(
  author: CongressAuthor,
  id: string,
): Promise<void> {
  const res = await call(
    author,
    "POST",
    `/v1/me/congress-submissions/${id}/withdraw`,
    { expectedStatus: "in_review" },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/**
 * The author's cabinet section of the event — the read the section renders
 * (`GET /v1/me/congress-submissions?event=`, 046 EARS-4/11) — narrowed to one
 * submission.
 */
export async function authorSectionSubmission(
  author: CongressAuthor,
  eventId: string,
  id: string,
): Promise<{
  status: string;
  committeeComment: string | null;
  revisionDueAt: string | null;
}> {
  const res = await call(
    author,
    "GET",
    `/v1/me/congress-submissions?event=${eventId}`,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const found = (
    res.body as {
      submissions: {
        id: string;
        status: string;
        committeeComment: string | null;
        revisionDueAt: string | null;
      }[];
    }
  ).submissions.find((s) => s.id === id);
  expect(found, `submission ${id} in the author's section`).toBeTruthy();
  return found!;
}
