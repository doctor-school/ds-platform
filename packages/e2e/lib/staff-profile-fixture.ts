import { appendFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";

export type StaffProfileRoles = readonly (
  "platform_admin" | "event-registrar" | "doctor_guest"
)[];
const ownedEmail = /^staff-profile-3256-[0-9a-f-]{36}@example\.test$/;
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Staff-profile fixture requires ${name}`);
  return value;
}

/** 003 EARS-27 amendment #2456: scoped role fixture, never role provisioning. */
export async function setOwnedStaffProfileRoles(
  email: string,
  sub: string,
  previous: StaffProfileRoles,
  roles: StaffProfileRoles,
): Promise<void> {
  const issuer = required("IDP_ISSUER").replace(/\/$/, "");
  if (
    process.env.E2E_STAFF_ROLE_FIXTURE !== "true" ||
    required("E2E_STAFF_FIXTURE_ISSUER").replace(/\/$/, "") !== issuer ||
    new URL(issuer).hostname === "id.doctor.school" ||
    !ownedEmail.test(email) ||
    !sub
  ) {
    throw new Error(
      "Staff-profile fixture refused an unowned or unpinned target",
    );
  }
  const log = required("E2E_STAFF_FIXTURE_LOG");
  const projectId = required("IDP_PROJECT_ID");
  const headers = {
    authorization: `Bearer ${required("IDP_SERVICE_TOKEN")}`,
    "content-type": "application/json",
  };
  const request = async (path: string, body: unknown, method = "POST") => {
    await appendFile(
      log,
      JSON.stringify({
        at: new Date().toISOString(),
        operation: "owned-staff-grant",
        method,
        phase: "started",
      }) + "\n",
    );
    const response = await fetch(`${issuer}/management/v1/${path}`, {
      method,
      headers,
      body: JSON.stringify(body),
    });
    await appendFile(
      log,
      JSON.stringify({
        at: new Date().toISOString(),
        operation: "owned-staff-grant",
        method,
        phase: "completed",
        httpStatus: response.status,
        ok: response.ok,
      }) + "\n",
    );
    if (!response.ok)
      throw new Error(
        `Owned staff fixture management request failed: HTTP ${response.status}`,
      );
    return response;
  };
  type User = { id: string; human?: { email?: { email?: string } } };
  const users = (await (
    await request("users/_search", {
      queries: [{ emailQuery: { emailAddress: email } }],
    })
  ).json()) as { result?: User[] };
  const matching =
    users.result?.filter(
      (user) => user.id === sub && user.human?.email?.email === email,
    ) ?? [];
  if (matching.length !== 1)
    throw new Error("Owned staff fixture subject/email mismatch");
  type Grant = { id: string; projectId?: string; roleKeys?: string[] };
  let grant: Grant | undefined;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (attempt) await pause(500);
    const grants = (await (
      await request("users/grants/_search", {
        queries: [{ userIdQuery: { userId: sub } }],
      })
    ).json()) as { result?: Grant[] };
    const matches =
      grants.result?.filter((item) => item.projectId === projectId) ?? [];
    if (matches.length > 1)
      throw new Error("Owned staff fixture found ambiguous project grants");
    grant = matches[0];
    if (grant) break;
  }
  if (
    !grant ||
    JSON.stringify([...(grant.roleKeys ?? [])].sort()) !==
      JSON.stringify([...previous].sort())
  )
    throw new Error("Owned staff fixture refused an unexpected existing grant");
  await request(
    `users/${encodeURIComponent(sub)}/grants/${encodeURIComponent(grant.id)}`,
    { roleKeys: [...roles] },
    "PUT",
  );
  await pause(2500);
}
