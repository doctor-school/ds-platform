import assert from "node:assert/strict";
import test from "node:test";
import { grantProjectRole } from "./zitadel.mjs";

test("provision grants doctor_guest through Zitadel AuthorizationService v2", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new globalThis.Response(JSON.stringify({ id: "authorization-1" }), {
      status: 200,
    });
  };

  await grantProjectRole(
    {
      issuer: "http://idp.example.test",
      token: "service-token",
      orgId: "org-1",
      projectId: "project-1",
    },
    "user-1",
    "doctor_guest",
    fetchImpl,
  );

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "http://idp.example.test/zitadel.authorization.v2.AuthorizationService/CreateAuthorization",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    userId: "user-1",
    projectId: "project-1",
    organizationId: "org-1",
    roleKeys: ["doctor_guest"],
  });
  assert.equal(calls[0].init.headers.authorization, "Bearer service-token");
});

test("provision role grant is idempotent on Zitadel ALREADY_EXISTS", async () => {
  await assert.doesNotReject(() =>
    grantProjectRole(
      {
        issuer: "http://idp.example.test",
        token: "service-token",
        orgId: "org-1",
        projectId: "project-1",
      },
      "user-1",
      "doctor_guest",
      async () => new globalThis.Response(null, { status: 409 }),
    ),
  );
});

test("provision role grant fails closed without the Zitadel project id", async () => {
  await assert.rejects(
    () =>
      grantProjectRole(
        {
          issuer: "http://idp.example.test",
          token: "service-token",
          orgId: "org-1",
          projectId: "",
        },
        "user-1",
        "doctor_guest",
      ),
    /LOADTEST_IDP_PROJECT_ID/,
  );
});
