import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();

Given("the alpha page is open", async () => {});

When(
  "I press {string}",
  async () => {},
);

Then(/^I see (\d+) items$/, async () => {});
