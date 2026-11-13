import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { expect } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import {
  BOT_PROTECTION,
  type BotProtection,
  type BotProtectionResult,
} from "../../src/bot-protection/index.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { signIn, withSignInHost } from "../setup/storefront-harness.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import { registerUniqueFakeUserFixture } from "../setup/fixture-registration.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { seedTaxonomy, type LearningFixture } from "./fixtures.js";

// 024 (#4011) — the learning e2e harness: the real AppModule behind real 003
// doctor sessions and 011 admin sessions (fake IdP), the dev-stand Postgres and
// object store. Every course is built through the admin API, so the suites
// exercise the same writes the admin screens will.

export const PASSWORD = "Aa1!ufficiently-long-pw";
export const DEVICE = { "user-agent": "AdminTest/1.0", "accept-language": "en-US" };
const CONSENT = [{ purpose: "tos", version: "2026-01" }];

export interface Problem {
  status: number;
  errorCode?: string;
  errors?: { path: string; message: string }[];
  nextAt?: string | null;
}

export interface Harness {
  app: NestFastifyApplication;
  pool: pg.Pool;
  fake: FakeIdpClient;
  adminSid: string;
  close(): Promise<void>;
}

export async function bootHarness(): Promise<Harness> {
  const fake = new FakeIdpClient();
  const moduleRef: TestingModule = await withSignInHost(
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDP_CLIENT)
      .useValue(fake)
      .overrideProvider(RATE_LIMIT_THRESHOLDS)
      .useValue(RELAXED_RATE_LIMIT)
      // Hermetic register fixture: bot protection is not under test.
      .overrideProvider(BOT_PROTECTION)
      .useValue({
        verify: (): Promise<BotProtectionResult> =>
          Promise.resolve({ ok: true }),
      } satisfies BotProtection),
  ).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const pool = app.get<pg.Pool>(DRIZZLE_POOL);
  const { email, sub } = await registerUniqueFakeUserFixture({
    app,
    pool,
    fake,
    nextEmail: () => `learn-admin-${randomUUID()}@ds.test`,
    password: PASSWORD,
    consent: CONSENT,
  });
  await fake.grantProjectRole(sub, "platform_admin");
  const { sid } = await establishAdminSession(app, {
    identifier: email,
    password: PASSWORD,
    device: DEVICE,
  });
  return { app, pool, fake, adminSid: sid, close: () => app.close() };
}

/** Register + sign in a doctor: the session cookie header and `users.id`. */
export async function doctor(
  h: Harness,
): Promise<{ headers: Record<string, string>; personId: string }> {
  const email = `learn-doctor-${randomUUID()}@ds.test`;
  const reg = await h.app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: PASSWORD, consent: CONSENT },
  });
  expect(reg.statusCode, reg.payload).toBe(200);
  const cookie = await signIn(h.app, email, PASSWORD, { device: DEVICE });
  const { rows } = await h.pool.query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1",
    [email],
  );
  return {
    headers: { ...DEVICE, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
    personId: rows[0]!.id,
  };
}

export interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
  etag: string | undefined;
}

function reply<T>(res: {
  statusCode: number;
  payload: string;
  headers: Record<string, unknown>;
}): Reply<T> {
  return {
    status: res.statusCode,
    body: (res.payload ? JSON.parse(res.payload) : null) as T,
    etag: res.headers["etag"] as string | undefined,
  };
}

/** An admin call: session + CSRF, a fresh Idempotency-Key unless given. */
export async function admin<T = Record<string, unknown>>(
  h: Harness,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  opts: {
    payload?: unknown;
    ifMatch?: string;
    key?: string | null;
    headers?: Record<string, string>;
    raw?: { body: Buffer; contentType: string };
  } = {},
): Promise<Reply<T>> {
  const headers: Record<string, string> = {
    ...DEVICE,
    ...adminHeaders(h.adminSid),
    ...(opts.raw
      ? { "content-type": opts.raw.contentType }
      : opts.payload === undefined
        ? {}
        : { "content-type": "application/json" }),
    ...(method !== "GET" && opts.key !== null
      ? { "idempotency-key": opts.key ?? randomUUID() }
      : {}),
    ...(opts.ifMatch ? { "if-match": opts.ifMatch } : {}),
    ...(opts.headers ?? {}),
  };
  const res = await h.app.inject({
    method,
    url: `/v1/admin/learning${path}`,
    headers,
    ...(opts.raw
      ? { payload: opts.raw.body }
      : opts.payload !== undefined
        ? { payload: opts.payload as Record<string, unknown> }
        : {}),
  });
  return reply<T>(res);
}

/** A doctor (or guest, with no headers) call under `/v1`. */
export async function call<T = Record<string, unknown>>(
  h: Harness,
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string> = DEVICE,
  payload?: unknown,
): Promise<Reply<T>> {
  const res = await h.app.inject({
    method,
    url: `/v1${url}`,
    headers:
      payload !== undefined
        ? { ...headers, "content-type": "application/json" }
        : headers,
    ...(payload !== undefined
      ? { payload: payload as Record<string, unknown> }
      : {}),
  });
  return reply<T>(res);
}

export function multipartFile(file: {
  field: string;
  filename: string;
  contentType: string;
  body: Buffer;
}): { body: Buffer; contentType: string } {
  const boundary = `----ds4011${Math.random().toString(16).slice(2)}`;
  return {
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
      file.body,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export const VIDEO_SEC = 60;
export const PDF = Buffer.from("%PDF-1.4\n% learning e2e\n");

interface TestQuestion {
  id: string;
  options: { id: string; correct: boolean }[];
}

export interface BuiltCourse {
  f: LearningFixture;
  schoolId: string;
  courseId: string;
  courseSlug: string;
  moduleId: string;
  lessonId: string;
  videoId: string;
  downloadId: string;
  testId: string;
  /** The test's questions with the right answer (admin read). */
  questions: TestQuestion[];
}

/**
 * One whole course through the admin API: school → course → module → lesson
 * with a video (provider source), a download (uploaded file) and the exit
 * test (2 questions); the lesson and course published unless `publish: false`.
 */
export async function buildCourse(
  h: Harness,
  opts: { publish?: boolean } = {},
): Promise<BuiltCourse> {
  const f = await seedTaxonomy(h.pool);
  const ok = <T>(r: Reply<T>, status: number): T => {
    expect(r.status, JSON.stringify(r.body)).toBe(status);
    return r.body;
  };
  const school = ok(
    await admin<{ id: string }>(h, "POST", "/schools", {
      payload: {
        directionId: f.directionId,
        leadExpertId: f.expertId,
        projectId: f.projectId,
        slug: `school-${f.suffix}`,
        title: `Школа ${f.suffix}`,
      },
    }),
    201,
  );
  const courseSlug = `course-${f.suffix}`;
  const course = ok(
    await admin<{ id: string }>(h, "POST", "/courses", {
      payload: {
        schoolId: school.id,
        projectId: f.projectId,
        slug: courseSlug,
        title: `Курс ${f.suffix}`,
      },
    }),
    201,
  );
  const mod = ok(
    await admin<{ id: string }>(h, "POST", "/modules", {
      payload: { courseId: course.id, title: "Модуль 1" },
    }),
    201,
  );
  const lesson = ok(
    await admin<{ id: string }>(h, "POST", "/lessons", {
      payload: { moduleId: mod.id, projectId: f.projectId, title: "Урок 1" },
    }),
    201,
  );
  const video = await admin<{ id: string; version: number }>(h, "POST", "/steps", {
    payload: {
      lessonId: lesson.id,
      type: "video",
      title: "Видео",
      durationMin: 1,
      payload: { durationSec: VIDEO_SEC },
    },
  });
  ok(video, 201);
  ok(
    await admin(h, "PUT", `/steps/${video.body.id}/source`, {
      payload: { provider: "youtube", embedRef: "dQw4w9WgXcQ" },
      ifMatch: video.etag!,
    }),
    200,
  );
  const download = await admin<{ id: string }>(h, "POST", "/steps", {
    payload: {
      lessonId: lesson.id,
      type: "download",
      title: "Памятка",
      durationMin: 2,
      payload: { fileName: "memo.pdf" },
    },
  });
  ok(download, 201);
  ok(
    await admin(h, "PUT", `/steps/${download.body.id}/media`, {
      raw: multipartFile({
        field: "file",
        filename: "memo.pdf",
        contentType: "application/pdf",
        body: PDF,
      }),
      ifMatch: download.etag!,
    }),
    200,
  );
  const test = ok(
    await admin<{ id: string; questions: TestQuestion[] }>(h, "POST", "/steps", {
      payload: {
        lessonId: lesson.id,
        type: "test",
        title: "Итоговый тест",
        durationMin: 3,
        payload: {
          kind: "exit",
          questions: [
            {
              text: "Вопрос 1",
              options: [
                { text: "Верно", correct: true },
                { text: "Неверно", correct: false },
              ],
            },
            {
              text: "Вопрос 2",
              options: [
                { text: "Неверно", correct: false },
                { text: "Верно", correct: true },
              ],
            },
          ],
        },
      },
    }),
    201,
  );
  const built: BuiltCourse = {
    f,
    schoolId: school.id,
    courseId: course.id,
    courseSlug,
    moduleId: mod.id,
    lessonId: lesson.id,
    videoId: video.body.id,
    downloadId: download.body.id,
    testId: test.id,
    questions: test.questions,
  };
  if (opts.publish !== false) await publish(h, built);
  return built;
}

export async function publish(h: Harness, c: BuiltCourse): Promise<void> {
  const lesson = await admin(h, "GET", `/lessons/${c.lessonId}`);
  const pl = await admin(h, "POST", `/lessons/${c.lessonId}/publish`, {
    ifMatch: lesson.etag!,
  });
  expect(pl.status, JSON.stringify(pl.body)).toBe(200);
  const course = await admin(h, "GET", `/courses/${c.courseId}`);
  const pc = await admin(h, "POST", `/courses/${c.courseId}/publish`, {
    ifMatch: course.etag!,
  });
  expect(pc.status, JSON.stringify(pc.body)).toBe(200);
}

/** Set one scope's own rule values (merging over what the layer already has). */
export async function setRules(
  h: Harness,
  kind: string,
  id: string,
  values: Record<string, unknown>,
): Promise<Reply> {
  const current = await admin<{ values: Record<string, unknown> }>(
    h,
    "GET",
    `/rules/${kind}/${id}`,
  );
  expect(current.status).toBe(200);
  return admin(h, "PUT", `/rules/${kind}/${id}`, {
    payload: { values: { ...current.body.values, ...values } },
    ifMatch: current.etag!,
  });
}

/** The right answer to every question of an attempt. */
export function answersFor(
  c: BuiltCourse,
  attempt: { questions: { id: string }[] },
  right = true,
): { questionId: string; optionId: string }[] {
  return attempt.questions.map((q) => {
    const known = c.questions.find((k) => k.id === q.id)!;
    const option = known.options.find((o) => o.correct === right)!;
    return { questionId: q.id, optionId: option.id };
  });
}

export function eventId(): string {
  return `e2e-${randomUUID()}`;
}
