import { ENTRY_REFUSAL_COPY } from "@ds/auth-flow/copy";
import {
  expectUnavailableStorefrontEntry,
  stageEntryUnavailableOrigin,
} from "@ds/e2e/storefront-entry";
import { test } from "@playwright/test";

const fixtureOrigin = stageEntryUnavailableOrigin(
  "academy",
  process.env.E2E_PORTAL_URL,
  process.env.E2E_PORTAL_ENTRY_UNAVAILABLE_LOOPBACK,
);

test("003 EARS-72: the academy door answers an unavailable transaction at the same URL with retry and a way out", async ({
  page,
}) => {
  test.skip(
    fixtureOrigin === undefined,
    "requires the stage storefront fixture",
  );
  await expectUnavailableStorefrontEntry(
    page,
    fixtureOrigin!,
    ENTRY_REFUSAL_COPY,
  );
});
