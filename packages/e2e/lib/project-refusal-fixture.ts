import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { connection } from "./public-readonly-fixture.js";
import { feedEntryLog } from "./feed-entry.js";

export async function createProjectRefusalFixture() {
  const db = await connection(3826);
  const organisations = [
    { id: randomUUID(), title: "Фарма Плюс", role: "Инвестор" },
    { id: randomUUID(), title: "ЦИТО", role: "Клиническая площадка" },
  ];
  const project = randomUUID();
  const expert = randomUUID();
  const curator = randomUUID();
  const results = [randomUUID(), randomUUID()];
  const query = db.query;
  const cleanup = async () => {
    try {
      await query("DELETE FROM project_results WHERE project_id=$1", [project]);
      await query("DELETE FROM project_experts WHERE id=$1 AND project_id=$2", [
        curator,
        project,
      ]);
      await query("DELETE FROM projects WHERE id=$1", [project]);
      await query("DELETE FROM experts WHERE id=$1", [expert]);
      const ids = organisations.map((o) => o.id);
      await query(
        "DELETE FROM organisation_role_assignments WHERE organisation_id=ANY($1::uuid[])",
        [ids],
      );
      await query("DELETE FROM organisations WHERE id=ANY($1::uuid[])", [ids]);
      const remaining = (
        await query(
          "SELECT (SELECT count(*) FROM projects WHERE id=$1)+(SELECT count(*) FROM experts WHERE id=$2)+(SELECT count(*) FROM organisations WHERE id=ANY($3::uuid[])) AS count",
          [project, expert, ids],
        )
      ).rows[0];
      expect(Number(remaining.count)).toBe(0);
      feedEntryLog({
        command: "removed exact project-refusal fixture and verified absence",
        project,
        expert,
        curator,
        organisations: ids,
      });
    } finally {
      await db.close();
    }
  };
  feedEntryLog({
    command: "reserved exact owned project-refusal fixture before mutation",
    project,
    expert,
    curator,
    results,
    organisations,
  });
  try {
    for (const org of organisations) {
      const roles = (
        await query(
          "SELECT id,title,status FROM organisation_roles WHERE title=$1 AND status='active'",
          [org.role],
        )
      ).rows;
      expect(roles).toHaveLength(1);
      await query(
        "INSERT INTO organisations (id,slug,title,status,first_published_at) VALUES ($1,$2,$3,'published',now())",
        [org.id, `refusal-${org.id}`, org.title],
      );
      await query(
        "INSERT INTO organisation_role_assignments (organisation_id,role_id) VALUES ($1,$2)",
        [org.id, roles[0].id],
      );
    }
    return {
      query,
      project,
      expert,
      curator,
      results,
      organisations,
      cleanup,
      async createProject(title: string, withResults: boolean) {
        await query(
          "INSERT INTO experts (id,slug,family_name,given_name,professional_role,status,first_published_at) VALUES ($1,$2,'Куратор','Проекта','Врач','published',now())",
          [expert, `refusal-${expert}`],
        );
        await query(
          "INSERT INTO projects (id,slug,title,description,stage,default_audience,status) VALUES ($1,$2,$3,'Описание проекта для проверки отказа.','running','experts','draft')",
          [project, `refusal-${project}`, title],
        );
        await query(
          "INSERT INTO project_experts (id,project_id,expert_id,role,status) VALUES ($1,$2,$3,'curator','active')",
          [curator, project, expert],
        );
        if (withResults) {
          const kinds = (
            await query(
              "SELECT id,title FROM project_output_kinds WHERE title=ANY($1::text[]) AND status='active' ORDER BY title",
              [["Школа", "Конгресс"]],
            )
          ).rows;
          expect(kinds).toHaveLength(2);
          for (const [position, id] of results.entries())
            await query(
              "INSERT INTO project_results (id,project_id,output_kind_id,position,title) VALUES ($1,$2,$3,$4,$5)",
              [
                id,
                project,
                kinds[position].id,
                position,
                `Результат ${position + 1}`,
              ],
            );
        }
        return (
          await query(
            "SELECT id,title,description,status,version FROM projects WHERE id=$1",
            [project],
          )
        ).rows[0];
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
