import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { isAbsolute } from "node:path";

import { expect, request, type APIRequestContext } from "@playwright/test";
import { Pool, type QueryResultRow } from "pg";

export type Expert = {
  id: string;
  slug: string;
  linkId: string;
  status: "published" | "draft" | "retired";
  position: number;
  role: string;
  name: string;
};
export type Speaker = {
  source: "expert";
  expertId: string;
  expertSlug: string;
  name: string;
  credentials: string;
  photoUrl: null;
  role: string;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is required for the owned Expert fixture`);
  return value;
}

export function standOperation(op: string): void {
  const file = required("E2E_CANONICAL_EXPERT_LOG");
  if (!isAbsolute(file)) throw new Error("Expert stand log must be absolute");
  appendFileSync(
    file,
    JSON.stringify({ at: new Date().toISOString(), op }) + "\n",
  );
}

export class CanonicalExpertFixture {
  readonly eventId = randomUUID();
  readonly slug = `canonical-expert-${randomUUID()}`;
  readonly experts: Expert[] = [
    {
      status: "published",
      position: 12,
      role: "Спикер",
      name: "Резолвер Борис",
    },
    { status: "published", position: 9, role: "Спикер", name: "Резолвер Анна" },
    {
      status: "published",
      position: 0,
      role: "Модератор",
      name: "Резолвер Анна",
    },
    { status: "draft", position: 4, role: "Эксперт", name: "Резолвер Анна" },
    { status: "retired", position: 6, role: "Эксперт", name: "Резолвер Анна" },
  ].map((plan) => ({
    ...plan,
    status: plan.status as Expert["status"],
    id: randomUUID(),
    slug: `canonical-expert-person-${randomUUID()}`,
    linkId: randomUUID(),
  }));
  readonly expected: Speaker[] = this.experts
    .filter((expert) => expert.status === "published")
    .sort((a, b) => a.position - b.position || a.linkId.localeCompare(b.linkId))
    .map((expert) => ({
      source: "expert",
      expertId: expert.id,
      expertSlug: expert.slug,
      name: expert.name,
      credentials: "к.м.н.",
      photoUrl: null,
      role: expert.role,
    }));
  private pool?: Pool;
  private api?: APIRequestContext;
  private committed = false;

  async start(): Promise<void> {
    if (process.env.E2E_CANONICAL_EXPERT_FIXTURE !== "owned")
      throw new Error("Explicit owned Expert fixture opt-in is required");
    const origin = new URL(required("E2E_API_URL"));
    if (
      origin.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      throw new Error("Expert fixture requires a loopback HTTP API origin");
    const database = required("E2E_CANONICAL_EXPERT_DATABASE");
    if (!["ds_admin_e2e", "ds_dev_2068_l_resolver"].includes(database))
      throw new Error(
        "Expert fixture database is outside this disposable contour",
      );
    const connection = new URL(required("DATABASE_URL"));
    if (decodeURIComponent(connection.pathname.slice(1)) !== database)
      throw new Error(
        "Expert fixture connection and expected database disagree",
      );

    standOperation(
      "SELECT current_database() for exact disposable Expert fixture target",
    );
    this.pool = new Pool({ connectionString: connection.toString(), max: 1 });
    const actual = await this.query<{ name: string }>(
      "SELECT current_database() name",
    );
    expect(actual.rows[0]?.name).toBe(database);
    this.api = await request.newContext({
      baseURL: origin.origin,
      storageState: { cookies: [], origins: [] },
    });
    const missing = await this.get(`/v1/public/events/${this.slug}/speakers`);
    expect(missing.status()).toBe(404);
    expect((await missing.json()).errorCode).toBe("RESOURCE_NOT_FOUND");

    standOperation("BEGIN own Expert fixture transaction");
    await this.query("BEGIN");
    try {
      standOperation("INSERT exact owned event with the migrated club kind");
      await this.query(
        "INSERT INTO events(id,slug,title,school,starts_at,duration_min,state,kind_id,audience) VALUES($1,$2,$3,$4,now()+interval '7 days',60,'published',$5,'experts')",
        [
          this.eventId,
          this.slug,
          "Канонические эксперты",
          "Тестовая школа",
          "00460046-0000-4000-8000-000000000004",
        ],
      );
      for (const expert of this.experts) {
        standOperation(
          "INSERT exact owned Expert and active sparse-position relation",
        );
        await this.query(
          "INSERT INTO experts(id,slug,family_name,given_name,credentials,professional_role,status,first_published_at,deleted_at) VALUES($1,$2,'Резолвер',$3,'к.м.н.','Кардиолог',$4,$5,$6)",
          [
            expert.id,
            expert.slug,
            expert.name === "Резолвер Борис" ? "Борис" : "Анна",
            expert.status,
            expert.status === "draft" ? null : new Date(),
            expert.status === "retired" ? new Date() : null,
          ],
        );
        await this.query(
          "INSERT INTO event_experts(id,event_id,expert_id,role,position,status) VALUES($1,$2,$3,$4,$5,'active')",
          [
            expert.linkId,
            this.eventId,
            expert.id,
            expert.role,
            expert.position,
          ],
        );
      }
      standOperation("COMMIT owned Expert fixture");
      await this.query("COMMIT");
      this.committed = true;
    } catch (error) {
      standOperation("ROLLBACK own uncommitted Expert fixture only");
      await this.query("ROLLBACK");
      throw error;
    }
    standOperation("SELECT complete authored Expert relation state");
    const authored = await this.query(
      "SELECT ee.id,ee.expert_id,ee.position,ee.status link_status,x.status expert_status FROM event_experts ee JOIN experts x ON x.id=ee.expert_id WHERE ee.event_id=$1 ORDER BY ee.position,ee.id",
      [this.eventId],
    );
    expect(authored.rows).toEqual(
      [...this.experts]
        .sort((a, b) => a.position - b.position)
        .map((expert) => ({
          id: expert.linkId,
          expert_id: expert.id,
          position: expert.position,
          link_status: "active",
          expert_status: expert.status,
        })),
    );
  }

  private async query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ) {
    if (!this.pool) throw new Error("Owned Expert database is not initialized");
    standOperation("SQL " + sql);
    return this.pool.query<R>(sql, values);
  }

  async get(path: string) {
    if (!this.api)
      throw new Error("Owned Expert API context is not initialized");
    standOperation(`GET ${path}`);
    const response = await this.api.get(path);
    expect(
      (await this.api.storageState()).cookies.map((cookie) => cookie.name),
    ).toEqual([]);
    return response;
  }

  async cutover(): Promise<void> {
    if (!this.pool) throw new Error("Owned Expert database is not initialized");
    standOperation("SELECT withdrawn speaker and migration source tables");
    const result = await this.query(
      "SELECT to_regclass('public.event_speakers') legacy,to_regclass('public.speaker_migration_cutover') phase,to_regclass('public.speaker_migration_reviews') reviews",
    );
    expect(result.rows).toEqual([{ legacy: null, phase: null, reviews: null }]);
  }

  async close(): Promise<void> {
    try {
      if (this.committed && this.pool) {
        standOperation(
          "DELETE only exact owned Expert fixture relations event and Experts by retained IDs and slugs",
        );
        await this.query("BEGIN");
        try {
          await this.query(
            "DELETE FROM event_experts WHERE event_id=$1 AND id=ANY($2::uuid[])",
            [this.eventId, this.experts.map((expert) => expert.linkId)],
          );
          const event = await this.query(
            "DELETE FROM events WHERE id=$1 AND slug=$2 RETURNING id",
            [this.eventId, this.slug],
          );
          expect(event.rowCount).toBe(1);
          for (const expert of this.experts) {
            const removed = await this.query(
              "DELETE FROM experts WHERE id=$1 AND slug=$2 RETURNING id",
              [expert.id, expert.slug],
            );
            expect(removed.rowCount).toBe(1);
          }
          await this.query("COMMIT");
        } catch (error) {
          await this.query("ROLLBACK");
          throw error;
        }
      }
    } finally {
      await this.api?.dispose();
      await this.pool?.end();
    }
  }
}
