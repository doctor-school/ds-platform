import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const ORIGIN = "http://127.0.0.1:3211";
const SESSION = "__Host-ds_session";
const GUEST_CHOICE = "__Host-ds_specialty";
const CARDIOLOGY = "00000000-0000-4000-8000-000000000001";
const NEUROLOGY = "00000000-0000-4000-8000-000000000002";

async function authenticateWithGuestChoice(
  context: BrowserContext,
  session: string,
  specialty: string,
) {
  await context.addCookies([
    {
      name: SESSION,
      value: session,
      url: ORIGIN,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
    {
      name: GUEST_CHOICE,
      value: specialty,
      url: ORIGIN,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
}

async function expectGuestCookieGone(context: BrowserContext) {
  const cookies = await context.cookies(ORIGIN);
  expect(
    cookies.find((cookie) => cookie.name === GUEST_CHOICE),
  ).toBeUndefined();
}

async function expectOpenCatalog(page: Page) {
  await expect(page.getByTestId("specialty-catalog")).toHaveAttribute(
    "data-state",
    "open",
  );
}

test.describe("017 EARS-6: durable guest-choice consumption", () => {
  test("EARS-6.23: adoption clears before sign-out and cannot leak into a second empty profile", async ({
    context,
    page,
  }) => {
    await authenticateWithGuestChoice(
      context,
      "profile-empty-adopt",
      NEUROLOGY,
    );
    await page.goto("/");

    await expect(page.getByTestId("specialty-chosen")).toHaveText("Неврология");
    await expectGuestCookieGone(context);

    await context.clearCookies();
    await page.reload();
    await expectOpenCatalog(page);

    await context.addCookies([
      {
        name: SESSION,
        value: "profile-empty-second",
        url: ORIGIN,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    await page.reload();
    await expectOpenCatalog(page);
    const state = await page.request.get(
      "/v1/__test/profile?session=profile-empty-second",
    );
    await expect(state).toBeOK();
    expect(await state.json()).toEqual({ specialty: null });
  });

  test("EARS-6.24: profile-wins discard clears before guest fallback can revive it", async ({
    context,
    page,
  }) => {
    await authenticateWithGuestChoice(context, "profile-existing", NEUROLOGY);
    await page.goto("/");

    await expect(page.getByTestId("specialty-chosen")).toHaveText(
      "Кардиология",
    );
    await expectGuestCookieGone(context);

    await context.clearCookies();
    await page.reload();
    await expectOpenCatalog(page);
    const existing = await page.request.get(
      "/v1/__test/profile?session=profile-existing",
    );
    expect(await existing.json()).toEqual({
      specialty: expect.objectContaining({ id: CARDIOLOGY }),
    });
  });
});
