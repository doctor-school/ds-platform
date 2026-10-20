import { expect, test } from "@playwright/test";

// A deliberately FAILING fixture for `reporters/summary.test.ts`: every channel a
// console reporter could leak through carries a secret-shaped value or a URL.
const SECRET = "s3cret-AbCdEf0123456789";

test.describe("leak probe", () => {
  // Playwright requires a destructuring first argument; this test uses no fixture.
  // eslint-disable-next-line no-empty-pattern
  test("fails with a secret in its error", async ({}, testInfo) => {
    console.log(
      `stdout carries ${SECRET} and https://api-main.stage.doctor.school/v1/health`,
    );
    console.error(`stderr carries ${SECRET}`);
    await testInfo.attach("body", { body: `response body ${SECRET}` });
    expect(`https://stage:${SECRET}@api-main.stage.doctor.school`).toBe(
      "never",
    );
  });

  test("passes", () => {
    expect(1).toBe(1);
  });
});
