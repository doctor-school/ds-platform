import { expect } from "@playwright/test";
import { createBdd, test as base } from "playwright-bdd";
import { bootCongress, type CongressWorld } from "../lib/congress-originals.js";

export const test = base.extend<{ congress: CongressWorld }>({
  // eslint-disable-next-line no-empty-pattern -- playwright-bdd detects this fixture signature
  congress: async ({}, use) => {
    const world = await bootCongress(test.info().title);
    try {
      await use(world);
    } finally {
      await world.close();
    }
  },
});
const { Given, When, Then } = createBdd(test, { tags: "@feature:044" });
Given(
  'the congress event is published with participationFormat "offline"',
  async ({ congress }) => {
    await congress.background(0);
  },
);
Given(
  "the congress site proxies {string} to the platform API same-origin",
  async ({ congress }, prefix: string) => {
    expect(prefix).toBe("/api");
    await congress.background(1);
  },
);
Given(
  "the site's nginx egress address is listed in TRUSTED_PROXIES",
  async ({ congress }) => {
    await congress.background(2);
  },
);
Given(
  "the intake endpoint is public, carries the bot-protection decorator and is rate limited at 60 submissions per 15 minutes per client address",
  async ({ congress }) => {
    await congress.background(3);
  },
);
Given(
  "the current time is inside the congress registration window",
  async ({ congress }) => {
    await congress.background(4);
  },
);
Given(
  "the personal-data consent page is published, its version being its publication date plus the sha256 of its text",
  async ({ congress }) => {
    await congress.background(5);
  },
);
Given(
  "the current time is before the registration opening instant",
  async ({ congress }) => {
    await congress.window("before");
  },
);
Given(
  "the current time is after the registration closing instant",
  async ({ congress }) => {
    await congress.window("after");
  },
);
Given(
  'no Doctor.School account exists for "names@example.org"',
  async ({ congress }) => {
    await congress.absent("names@example.org");
  },
);
When("a participant submits the sign-up form", async ({ congress }) => {
  await congress.submit();
});
When(
  'a participant submits the sign-up form for "names@example.org" with the surname "  иванова ", the first name "мАРИЯ", the patronymic "  сергеевна" and the workplace "НМИЦ им. В. А. Алмазова"',
  async ({ congress }) => {
    await congress.names(
      "names@example.org",
      "  иванова ",
      "мАРИЯ",
      "  сергеевна",
      "НМИЦ им. В. А. Алмазова",
    );
  },
);
Then(
  "the submission is refused with a machine-readable not-yet-open state carrying the opening instant",
  async ({ congress }) => {
    await congress.refuse("not-yet-open");
  },
);
Then(
  "the submission is refused with a machine-readable closed state",
  async ({ congress }) => {
    await congress.refuse("closed");
  },
);
Then(
  "no account, registration or consent record is created",
  async ({ congress }) => {
    await congress.unchanged();
  },
);
Then("no email is dispatched", async ({ congress }) => {
  await congress.noMail();
});
Then(
  "the refusal is the same for an email that already has an account and one that does not",
  async ({ congress }) => {
    await congress.identical();
  },
);
Then(
  'the registration\'s answers hold the surname "Иванова", the first name "Мария" and the patronymic "Сергеевна"',
  async ({ congress }) => {
    expect((await congress.answers()).answers).toMatchObject({
      surname: "Иванова",
      firstName: "Мария",
      patronymic: "Сергеевна",
    });
  },
);
Then('the account\'s display name is "Иванова Мария"', async ({ congress }) => {
  expect((await congress.answers()).display_name).toBe("Иванова Мария");
});
Then(
  "the workplace is stored exactly as the participant typed it",
  async ({ congress }) => {
    expect((await congress.answers()).answers.workplace).toBe(
      "НМИЦ им. В. А. Алмазова",
    );
  },
);

Given(
  '"known@example.org" is already registered for the congress event',
  async ({ congress }) => {
    await congress.alreadyRegistered();
  },
);
Given(
  "that registration's confirmation-mail outcome is sent",
  async ({ congress }) => {
    await congress.sentOutcome();
  },
);
Given(
  "the published personal-data consent version differs from the one recorded for that registration",
  async ({ congress }) => {
    await congress.republishConsent();
  },
);
When(
  "the same form is submitted again with the same email",
  async ({ congress }) => {
    await congress.repeat();
  },
);
Then("the same generic success response is returned", async ({ congress }) => {
  await congress.sameSuccess();
});
Then("no second account is created", async ({ congress }) => {
  await congress.noSecondAccount();
});
Then(
  "no second registration row exists for that account and event",
  async ({ congress }) => {
    await congress.noSecondRegistration();
  },
);
Then("no second confirmation email is dispatched", async ({ congress }) => {
  await congress.noSecondMail();
});
Then(
  "exactly one further consent record is written, carrying the newly published version",
  async ({ congress }) => {
    await congress.furtherConsent();
  },
);
Given(
  "the congress event is priced above zero Pul in the 025 price list",
  async ({ congress }) => {
    await congress.priceEvent();
  },
);
Given("an existing doctor holds enough Pul for it", async ({ congress }) => {
  await congress.fundDoctor();
});
When(
  "that doctor's email and an unknown email are each submitted",
  async ({ congress }) => {
    await congress.pricedSubmissions();
  },
);
Then("both submissions get the same generic refusal", async ({ congress }) => {
  await congress.sameRefusal();
});
Then(
  "no account, registration, posting or hold is written for either",
  async ({ congress }) => {
    await congress.noPricedWrites();
  },
);

Given(
  'no Doctor.School account exists for "new@example.org"',
  async ({ congress }) => {
    await congress.absent("new@example.org");
  },
);
When(
  'a participant submits the sign-up form with surname, first name, contact phone, "new@example.org", a specialty chosen from the taxonomy, workplace, city, region, no patronymic, a ticked personal-data consent and a valid captcha token',
  async ({ congress }) => {
    await congress.intake.happy();
  },
);
Then(
  'exactly one account is created for "new@example.org" with no credential in the identity provider',
  async ({ congress }) => {
    await congress.intake.account();
  },
);
Then(
  "that account's display name is prefilled from the submitted surname and first name",
  async ({ congress }) => {
    await congress.intake.displayName();
  },
);
Then(
  "exactly one registration row exists for that account and the congress event",
  async ({ congress }) => {
    await congress.intake.registration();
  },
);
Then(
  "the submitted answers are stored on that registration row",
  async ({ congress }) => {
    await congress.intake.answers();
  },
);
Then(
  "the submitted contact phone is not written into the account's phone column",
  async ({ congress }) => {
    await congress.intake.phone();
  },
);
Then(
  "exactly one consent record is written under the congress personal-data purpose with the server-stamped version",
  async ({ congress }) => {
    await congress.intake.consent();
  },
);
Then(
  "no medical-worker-declaration consent record is written",
  async ({ congress }) => {
    await congress.intake.noMedicalConsent();
  },
);
Then(
  "the participant receives the generic success response, which confirms the registration was accepted, states that a confirmation email has been sent to the address given, and states that nothing further is required",
  async ({ congress }) => {
    await congress.intake.accepted();
  },
);
Then(
  "a confirmation email is dispatched naming the event, the created Doctor.School account and code-based sign-in",
  async ({ congress }) => {
    await congress.intake.confirmation();
  },
);
Then(
  "the registration's confirmation-mail outcome is recorded as sent with its timestamp",
  async ({ congress }) => {
    await congress.intake.outcome("sent");
  },
);
Given(
  "the mailer rejects every send attempt after its failover chain",
  async ({ congress }) => {
    congress.intake.failMailer();
  },
);
When(
  "a participant submits the sign-up form with a new email",
  async ({ congress }) => {
    await congress.intake.failedSubmission();
  },
);
Then(
  "the account, the registration and the consent record are committed",
  async ({ congress }) => {
    await congress.intake.committedDespiteFailure();
  },
);
Then(
  "the participant still receives the generic success response",
  async ({ congress }) => {
    await congress.intake.accepted();
  },
);
Then(
  "the registration's confirmation-mail outcome is recorded as failed with its timestamp",
  async ({ congress }) => {
    await congress.intake.outcome("failed");
  },
);
Then("no retry is scheduled", async ({ congress }) => {
  await congress.intake.noScheduledRetry();
});
When(
  "the same participant submits the same form again",
  async ({ congress }) => {
    await congress.intake.resubmit();
  },
);
Then("no duplicate registration is created", async ({ congress }) => {
  await congress.intake.noDuplicate();
});
Then("the confirmation email is dispatched again", async ({ congress }) => {
  await congress.intake.dispatchedAgain();
});
Given(
  "several participants submit from different client addresses through the same site proxy",
  async ({ congress }) => {
    await congress.intake.clients();
  },
);
When(
  "one of them exceeds the per-address submission window",
  async ({ congress }) => {
    await congress.intake.exhaust();
  },
);
Then(
  "only that participant's further submissions are throttled",
  async ({ congress }) => {
    await congress.intake.onlyParticipant();
  },
);
Then(
  "the other participants' submissions are accepted",
  async ({ congress }) => {
    await congress.intake.otherAccepted();
  },
);
