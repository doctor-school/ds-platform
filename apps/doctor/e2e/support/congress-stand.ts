import { randomUUID } from "node:crypto";
import {
  expect,
  request as playwrightRequest,
  type Page,
} from "@playwright/test";
import pg from "pg";

/**
 * 046 (#2433) — the live-stand fixtures the «Мои заявки на Конгресс» tier
 * (`congress-submissions.spec.ts`, `a11y/congress-axe.e2e.spec.ts`) stands on.
 *
 * What goes through the product and what goes through the database:
 *
 * - **Accounts** are provisioned through the doctor host's own commands
 *   (register → the Mailpit confirmation code → confirm), and every sign-in in
 *   the tier is a real one — the V-15 guest leg through the login door's
 *   emailed-code form, the rest through the same-origin BFF `POST
 *   /v1/auth/login` issued from the page (`doctor-session.ts` explains why
 *   in-page).
 * - **The congress event, its intake settings and the registration** are rows
 *   written on the stand database (`DATABASE_URL` — the branch database). The
 *   intake settings screen is the S1 admin surface and the registration is the
 *   044 sign-up on the congress site; neither is the subject here, and the api
 *   e2e (`apps/api/test/congress/submissions-author.e2e-spec.ts`) seeds the same
 *   rows the same way.
 * - **Closing the oral window** is the same settings-row write the platform
 *   administrator's screen performs; **a committee status** (`needs_revision`
 *   with its `revision_due_at`) is written on the row because the committee's
 *   status route is S5 (046-design «Revision deadline»: «written from S5»).
 *   Every author action — create, autosave, send, take back, withdraw — runs
 *   through the UI under test.
 *
 * Each run creates its OWN event starting a year out, so it is the congress
 * event the section resolves («settings present, latest start»), and removes
 * nothing: the branch database is the tier's scratch space.
 */

const DOCTOR_URL = (process.env.E2E_DOCTOR_URL ?? "").replace(/\/$/, "");
const MAILPIT_BASE = (process.env.MAILPIT_URL ?? "").replace(/\/$/, "");
/** Stable tails of the BFF code-email subjects (`apps/api/src/mailer/code-emails.ts`). */
const VERIFY_SUBJECT = "код подтверждения Doctor.School";
const LOGIN_SUBJECT = "код для входа в Doctor.School";
const DAY = 86_400_000;

export const REGISTRATION_URL = "https://orthobio.ru/registration";

export interface CongressDoctor {
  readonly email: string;
  readonly password: string;
}

async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("the congress tier needs DATABASE_URL");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * The newest code email of `subject` to `email` delivered after `afterMs` —
 * polled, because SMTP delivery is async after the BFF's 2xx.
 */
export async function mailedCode(
  email: string,
  subject: "verify" | "login",
  afterMs: number,
): Promise<string> {
  const tail = subject === "verify" ? VERIFY_SUBJECT : LOGIN_SUBJECT;
  for (let attempt = 0; attempt < 40; attempt++) {
    const res = await fetch(
      `${MAILPIT_BASE}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    if (res.ok) {
      const data = (await res.json()) as {
        messages?: Array<{ Created?: string; Subject?: string }>;
      };
      const hit = (data.messages ?? []).find(
        (m) =>
          m.Created &&
          Date.parse(m.Created) >= afterMs - 1_000 &&
          (m.Subject ?? "").includes(tail),
      );
      // The branded subject leads with the code (#869).
      const code = hit?.Subject?.match(/^([A-Za-z0-9]{4,12})\s+—/)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no «${tail}» email reached Mailpit for ${email}`);
}

/** A confirmed doctor account, through the doctor host's own commands. */
export async function provisionDoctor(tag: string): Promise<CongressDoctor> {
  const email = `e2e-2433-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@ds.test`;
  const password = `Doc-${Date.now()}-aA1!`;
  const api = await playwrightRequest.newContext({ baseURL: DOCTOR_URL });
  try {
    const sentAt = Date.now();
    const reg = await api.post("/v1/storefront/doctor/register", {
      data: {
        email,
        password,
        medicalWorkerDeclaration: true,
        consent: [{ purpose: "partner-data-sharing", version: "v1" }],
      },
    });
    expect(reg.ok(), `register — ${reg.status()}: ${await reg.text()}`).toBe(true);
    const code = await mailedCode(email, "verify", sentAt);
    const confirm = await api.post("/v1/auth/verify", {
      data: { email, code },
    });
    expect(confirm.ok(), `confirm — ${confirm.status()}: ${await confirm.text()}`).toBe(true);
  } finally {
    await api.dispose();
  }
  return { email, password };
}

/**
 * Sign `page` in through the same-origin BFF, leaving it on the doctor origin
 * (the in-page call keeps the session fingerprint of the navigations after it).
 */
export async function signInInPage(page: Page, doctor: CongressDoctor): Promise<void> {
  await page.goto(`${DOCTOR_URL}/`, { waitUntil: "domcontentloaded" });
  const outcome = await page.evaluate(
    async ([identifier, password]) => {
      const response = await fetch("/v1/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      return { status: response.status, body: await response.text() };
    },
    [doctor.email, doctor.password] as const,
  );
  expect(outcome.status, `in-page sign-in — ${outcome.body}`).toBe(200);
}

/** A congress event with its intake settings; the oral window open for a month. */
export async function createCongressEvent(): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  await withDb(async (db) => {
    await db.query(
      `INSERT INTO events
         (id, slug, title, school, starts_at, duration_min, description,
          specialties, partner_ref, program_pdf_ref, state, participation_format)
       VALUES ($1, $2, 'Конгресс ортобиологии', 'Конгресс', $3, 480,
               'Ежегодный конгресс.', $4, 'sponsor:congress', NULL, 'published',
               'offline')`,
      [id, `congress-2433-${id.slice(0, 8)}`, new Date(now + 365 * DAY), ["cardiology"]],
    );
    await db.query(
      `INSERT INTO congress_submission_settings (event_id, registration_url)
       VALUES ($1, $2)`,
      [id, REGISTRATION_URL],
    );
    await db.query(
      `INSERT INTO congress_submission_kind_settings
         (event_id, kind, opens_at, closes_at, submit_limit)
       VALUES ($1, 'oral', $2, $3, NULL)`,
      [id, new Date(now - DAY), new Date(now + 30 * DAY)],
    );
  });
  return id;
}

/** The 044 registration of `doctor` for the event, with its name answers. */
export async function registerForCongress(
  doctor: CongressDoctor,
  eventId: string,
): Promise<void> {
  await withDb(async (db) => {
    const result = await db.query(
      `INSERT INTO registrations (user_id, event_id, answers)
       SELECT u.id, $2, $3 FROM users u WHERE u.email = $1`,
      [
        doctor.email,
        eventId,
        {
          surname: "Иванова",
          firstName: "Мария",
          patronymic: "Петровна",
          workplace: "ГКБ № 1, Москва",
        },
      ],
    );
    expect(result.rowCount, `no users row for ${doctor.email}`).toBe(1);
  });
}

/**
 * 046 EARS-18…20 — the platform administrator opens the poster intake for a
 * month with an age limit of `maxAgeYears` (the settings-row write). The event
 * starts in a year, so the age rule counts on that day.
 */
export async function openPosterIntake(eventId: string, maxAgeYears: number): Promise<void> {
  const now = Date.now();
  await withDb((db) =>
    db.query(
      `INSERT INTO congress_submission_kind_settings
         (event_id, kind, opens_at, closes_at, submit_limit, max_age_years)
       VALUES ($1, 'poster', $2, $3, NULL, $4)
       ON CONFLICT (event_id, kind) DO UPDATE
         SET opens_at = EXCLUDED.opens_at, closes_at = EXCLUDED.closes_at,
             max_age_years = EXCLUDED.max_age_years`,
      [eventId, new Date(now - DAY), new Date(now + 30 * DAY), maxAgeYears],
    ),
  );
}

/** The platform administrator closes the oral intake (the settings-row write). */
export async function closeOralIntake(eventId: string): Promise<void> {
  const now = Date.now();
  await withDb((db) =>
    db.query(
      `UPDATE congress_submission_kind_settings
          SET opens_at = $2, closes_at = $3
        WHERE event_id = $1 AND kind = 'oral'`,
      [eventId, new Date(now - 2 * DAY), new Date(now - 60_000)],
    ),
  );
}

/**
 * A sent oral talk titled `title`, made by the signed-in author through the
 * section's own API (create → autosave → send with the consent) — the setup
 * of a list the V-15 revision leg then reads. `page` must be signed in.
 */
export async function sendTalkThroughApi(
  page: Page,
  eventId: string,
  title: string,
): Promise<void> {
  const outcome = await page.evaluate(
    async ([event, talkTitle]) => {
      const base = "/v1/me/congress-submissions";
      const json = { "content-type": "application/json" };
      const created = await fetch(base, {
        method: "POST",
        credentials: "include",
        headers: json,
        body: JSON.stringify({ eventId: event, kind: "oral" }),
      });
      if (created.status !== 201) return `create ${created.status}: ${await created.text()}`;
      const { id } = (await created.json()) as { id: string };
      const saved = await fetch(`${base}/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: json,
        body: JSON.stringify({
          title: talkTitle,
          authors: [
            {
              surname: "Иванова",
              firstName: "Мария",
              workplace: "ГКБ № 1, Москва",
              presenting: true,
            },
          ],
          body: { goal: "Разобрать показания.", summary: "Краткое содержание." },
        }),
      });
      if (saved.status !== 200) return `autosave ${saved.status}: ${await saved.text()}`;
      const sent = await fetch(`${base}/${id}/send`, {
        method: "POST",
        credentials: "include",
        headers: json,
        body: JSON.stringify({
          acceptedConsents: ["congress-submission-personal-data"],
        }),
      });
      return sent.ok ? "ok" : `send ${sent.status}: ${await sent.text()}`;
    },
    [eventId, title] as const,
  );
  expect(outcome, `sending «${title}» through the section API`).toBe("ok");
}

/**
 * The committee returns a sent talk for revision (S5 writes this; the section
 * only reads it): `needs_revision`, the comment, and the submission's own
 * revision deadline `dueInMs` from now (negative = already expired).
 */
export async function returnForRevision(
  eventId: string,
  title: string,
  comment: string,
  dueInMs: number,
): Promise<void> {
  await withDb(async (db) => {
    const result = await db.query(
      `UPDATE congress_submissions
          SET status = 'needs_revision', committee_comment = $3,
              revision_due_at = $4, status_changed_at = now()
        WHERE event_id = $1 AND title = $2 AND status = 'submitted'`,
      [eventId, title, comment, new Date(Date.now() + dueInMs)],
    );
    expect(result.rowCount, `no submitted «${title}» to return`).toBe(1);
  });
}
