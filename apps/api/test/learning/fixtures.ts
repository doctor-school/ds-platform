import { randomUUID } from "node:crypto";
import type pg from "pg";

// 024 — raw-SQL fixtures for the learning e2e suites: the taxonomy rows a
// school needs (direction, leading expert, project), a doctor user and one
// draft school → course → module → lesson → step chain. Every slug carries a
// per-run suffix so suites never collide on the shared stand.

export interface LearningFixture {
  suffix: string;
  directionId: string;
  expertId: string;
  projectId: string;
  userId: string;
  userSub: string;
}

export async function seedTaxonomy(pool: pg.Pool): Promise<LearningFixture> {
  const suffix = randomUUID().slice(0, 8);
  const one = async (sql: string, params: unknown[]): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(sql, params);
    return rows[0]!.id;
  };
  const directionId = await one(
    "INSERT INTO directions (slug, title, status, first_published_at) VALUES ($1, $2, 'published', now()) RETURNING id",
    [`learn-dir-${suffix}`, `Кардиология ${suffix}`],
  );
  const expertId = await one(
    "INSERT INTO experts (slug, family_name, given_name, status, first_published_at) VALUES ($1, 'Учебная', $2, 'published', now()) RETURNING id",
    [`learn-exp-${suffix}`, `Анна ${suffix}`],
  );
  const projectId = await one(
    "INSERT INTO projects (slug, stage, title, description, default_audience, status, first_published_at) VALUES ($1, 'running', $2, 'Курс', 'doctors', 'published', now()) RETURNING id",
    [`learn-prj-${suffix}`, `Курс ${suffix}`],
  );
  const userSub = `learn-sub-${suffix}`;
  const userId = await one(
    "INSERT INTO users (zitadel_sub, email) VALUES ($1, $2) RETURNING id",
    [userSub, `${userSub}@example.test`],
  );
  return { suffix, directionId, expertId, projectId, userId, userSub };
}

/** One draft school → course → module → lesson → video step; returns the ids. */
export async function seedStructure(
  pool: pg.Pool,
  f: LearningFixture,
): Promise<{ schoolId: string; courseId: string; moduleId: string; lessonId: string; stepId: string }> {
  const one = async (sql: string, params: unknown[]): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(sql, params);
    return rows[0]!.id;
  };
  const schoolId = await one(
    "INSERT INTO learning_schools (direction_id, lead_expert_id, project_id, slug, title) VALUES ($1, $2, $3, $4, 'Школа') RETURNING id",
    [f.directionId, f.expertId, f.projectId, `learn-school-${f.suffix}`],
  );
  const courseId = await one(
    "INSERT INTO learning_courses (school_id, project_id, slug, title) VALUES ($1, $2, $3, 'Курс') RETURNING id",
    [schoolId, f.projectId, `learn-course-${f.suffix}`],
  );
  const moduleId = await one(
    "INSERT INTO learning_modules (course_id, position, title) VALUES ($1, 1, 'Модуль') RETURNING id",
    [courseId],
  );
  const lessonId = await one(
    "INSERT INTO learning_lessons (module_id, project_id, position, title) VALUES ($1, $2, 1, 'Урок') RETURNING id",
    [moduleId, f.projectId],
  );
  const stepId = await one(
    "INSERT INTO learning_steps (lesson_id, position, type, title, duration_min, payload) VALUES ($1, 1, 'video', 'Видео', 5, '{}'::jsonb) RETURNING id",
    [lessonId],
  );
  return { schoolId, courseId, moduleId, lessonId, stepId };
}
