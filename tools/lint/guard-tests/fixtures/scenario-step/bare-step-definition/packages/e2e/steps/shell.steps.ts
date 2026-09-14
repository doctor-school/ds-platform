import { createBdd } from "playwright-bdd";

const { Then } = createBdd();

Then("the shell navigates to {string}", async ({ page }, path: string) => {
  await page.waitForURL(path);
});
