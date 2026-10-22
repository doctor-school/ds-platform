import { expect, test } from "@playwright/test";

import { SIGN_IN_HOST, baseUrlFor } from "../hosts.js";

// ADR-0015 §4: the sign-in host is routed on the slot under its own label. The
// container probe answers without an api round trip, so a red here is routing
// (edge / compose), not the api.
test("sign-in host: login-<slot> routes to the login container (/healthz)", async ({
  request,
}) => {
  const res = await request.get(
    `${baseUrlFor(SIGN_IN_HOST)}${SIGN_IN_HOST.healthPath}`,
  );
  expect(res.status()).toBe(200);
  expect((await res.text()).trim()).toBe("ok");
});

// ADR-0015 §4 req 2: the same host's BFF never forwards the internal API prefix.
test("sign-in host: the internal API prefix is not forwarded (ADR-0015 §4 req 2)", async ({
  request,
}) => {
  const res = await request.get(
    `${baseUrlFor(SIGN_IN_HOST)}/v1/internal/probe`,
    { maxRedirects: 0 },
  );
  expect(res.status()).toBe(404);
});
