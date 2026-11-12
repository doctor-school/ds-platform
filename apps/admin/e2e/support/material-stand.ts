import { appendFileSync } from "node:fs";

import { bootstrapAdminSession, signInAsAdmin } from "@ds/e2e/admin-events";
import { expect, type Page } from "@playwright/test";
import { Pool, type QueryResultRow } from "pg";

import { adminOrigin } from "./fixtures";

/**
 * The 048 BDD contours' stand contract: every write and read of the owned
 * database and every network operation lands in the operation log the CI step
 * uploads, and SQL runs only against an explicitly owned database.
 */
export type Actor = { id: string; zitadel_sub: string };

export function operation(op: string, detail?: unknown): void {
  const file = process.env.E2E_MATERIAL_ADMIN_LOG;
  if (!file)
    throw new Error("E2E_MATERIAL_ADMIN_LOG must name the operation log");
  appendFileSync(
    file,
    JSON.stringify({ at: new Date().toISOString(), op, detail }) + "\n",
  );
}

export async function rows<T extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const database = process.env.E2E_MATERIAL_ADMIN_DATABASE;
  const connection = process.env.DATABASE_URL;
  if (
    !database ||
    !connection ||
    !(
      /^ds_dev_\d+$/u.test(database) ||
      (process.env.CI === "true" && database === "ds_admin_e2e")
    ) ||
    decodeURIComponent(new URL(connection).pathname.slice(1)) !== database
  )
    throw new Error("Material authoring requires an explicitly owned database");
  operation("SQL", { sql, values });
  const pool = new Pool({ connectionString: connection, max: 1 });
  try {
    const binding = await pool.query("SELECT current_database() AS name");
    expect(binding.rows).toEqual([{ name: database }]);
    return (await pool.query<T>(sql, values)).rows;
  } finally {
    await pool.end();
  }
}

export function observe(page: Page): void {
  page.on("request", (request) => {
    const url = new URL(request.url());
    operation(`browser ${request.method()} ${url.origin}${url.pathname}`);
  });
}

/** A fresh platform administrator behind the second factor (011). */
export async function signIn(page: Page): Promise<Actor> {
  const credentials = await bootstrapAdminSession(adminOrigin());
  operation("owned account", { email: credentials.email });
  await signInAsAdmin(page, credentials);
  const actors = await rows<Actor>(
    "SELECT id,zitadel_sub FROM users WHERE email=$1",
    [credentials.email],
  );
  expect(actors).toHaveLength(1);
  expect(actors[0].zitadel_sub).toBeTruthy();
  operation("owned actor", { email: credentials.email, ...actors[0] });
  await expect(page.getByTestId("nav-materials")).toBeVisible();
  return actors[0];
}

/** The 048 Background: the one published expert, authored on the real Admin. */
export async function ensurePublishedExpert(
  page: Page,
  name: string,
): Promise<void> {
  expect(name).toBe("Страхов Михаил Андреевич");
  const existing = await rows<{ id: string; status: string }>(
    "SELECT id,status FROM experts WHERE family_name=$1 AND given_name=$2 AND patronymic=$3",
    ["Страхов", "Михаил", "Андреевич"],
  );
  if (existing.length) {
    expect(existing).toHaveLength(1);
    expect(existing[0].status).toBe("published");
    return;
  }
  await page.goto("/experts/create");
  await page.getByTestId("expert-family-name").fill("Страхов");
  await page.getByTestId("expert-given-name").fill("Михаил");
  await page.getByTestId("expert-patronymic").fill("Андреевич");
  await page.getByTestId("expert-professional-role").fill("Травматолог");
  await page.getByTestId("expert-credentials").fill("К. м. н.");
  await page.getByTestId("expert-affiliation").fill("ЦИТО им. Н. Н. Приорова");
  await page
    .getByTestId("expert-bio")
    .fill("Занимается ортобиологией и обучает врачей.");
  await page.getByTestId("submit-expert").click();
  await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/u);
  operation("owned expert", {
    id: new URL(page.url()).pathname.split("/").pop(),
    name,
  });
  await page.getByTestId("tab-publish").click();
  await page.getByTestId("experts-publish").click();
  await expect(page.getByTestId("expert-status")).toHaveText("Опубликован");
}
