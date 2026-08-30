import {
  expect,
  test,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";
import { bootstrapAdminSession } from "./support/admin-session";
import { totpCode } from "./support/totp";

const ORIGIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3200";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);
const REPLACEMENT_PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function signInAsAdmin(page: Page): Promise<void> {
  const { email, password } = await bootstrapAdminSession(ORIGIN);
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/mfa\/enroll/, { timeout: 20_000 });
  const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
  await page
    .getByTestId("mfa-enroll-form")
    .getByRole("textbox")
    .fill(totpCode(secret));
  await page.waitForURL(/\/events/, { timeout: 20_000 });
}

interface MediaCase {
  resource: "projects" | "experts" | "partners";
  inputId: "cover" | "photo" | "logo";
  previewAlt: string;
  errorTestId: string;
  submitTestId: string;
  slugTestId: string;
  storageErrorText: string;
}

function isEntityMutation(
  request: Pick<Request, "method" | "url">,
  resource: MediaCase["resource"],
): boolean {
  return (
    request.method() === "PATCH" &&
    new URL(request.url()).pathname.startsWith(`/v1/admin/${resource}/`)
  );
}

function expectMultipartFilePart(
  request: Pick<Request, "headers" | "postDataBuffer">,
  expectedPart: MediaCase["inputId"],
): void {
  expect(request.headers()["content-type"]).toContain("multipart/form-data");
  const body = request.postDataBuffer();
  expect(body).not.toBeNull();
  const wire = body!.toString("latin1");
  const fileParts = [
    ...wire.matchAll(
      /Content-Disposition: form-data; name="([^"]+)"; filename=/g,
    ),
  ].map((match) => match[1]);
  expect(fileParts).toEqual([expectedPart]);
  expect(wire).toContain('Content-Disposition: form-data; name="payload"');
}

function storedObjectIdentity(src: string): string {
  const url = new URL(src, ORIGIN);
  return `${url.host}${url.pathname}`;
}

async function expectNoStorageReferenceAuthoring(
  page: Page,
  slugTestId: string,
): Promise<void> {
  await expect(page.getByTestId(slugTestId)).toHaveCount(0);
  await expect(
    page.locator(
      'input[name*="ref" i], input[id*="ref" i], input[name*="storage" i], input[id*="storage" i]',
    ),
  ).toHaveCount(0);
}

async function driveMediaLifecycle(
  page: Page,
  media: MediaCase,
): Promise<void> {
  await expectNoStorageReferenceAuthoring(page, media.slugTestId);

  let invalidMutations = 0;
  const countInvalidMutation = (request: Request) => {
    if (isEntityMutation(request, media.resource)) invalidMutations += 1;
  };
  page.on("request", countInvalidMutation);
  await page.setInputFiles(`#${media.inputId}`, {
    name: "служебная-записка.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByTestId(media.errorTestId)).toBeVisible();
  await page.getByTestId(media.submitTestId).click();
  await page.waitForTimeout(100);
  expect(invalidMutations).toBe(0);
  page.off("request", countInvalidMutation);

  await page.setInputFiles(`#${media.inputId}`, {
    name: "изображение.png",
    mimeType: "image/png",
    buffer: PNG_1x1,
  });
  await expect(page.getByAltText(media.previewAlt)).toBeVisible();
  const uploadRequestPromise = page.waitForRequest((request) =>
    isEntityMutation(request, media.resource),
  );
  await page.getByTestId(media.submitTestId).click();
  const uploadRequest = await uploadRequestPromise;
  expectMultipartFilePart(uploadRequest, media.inputId);
  await expect(page.getByTestId("update-saved")).toBeVisible();
  await page.reload();
  const storedPreview = page.getByAltText(media.previewAlt);
  await expect(storedPreview).toBeVisible();
  const firstStoredSrc = await storedPreview.getAttribute("src");
  expect(firstStoredSrc).toBeTruthy();

  await page.setInputFiles(`#${media.inputId}`, {
    name: "изображение-замена.png",
    mimeType: "image/png",
    buffer: REPLACEMENT_PNG_1x1,
  });
  expect(REPLACEMENT_PNG_1x1.equals(PNG_1x1)).toBe(false);

  let storageFailureInjected = false;
  const storageFailure = async (route: Route) => {
    if (
      storageFailureInjected ||
      !isEntityMutation(route.request(), media.resource)
    ) {
      await route.fallback();
      return;
    }
    storageFailureInjected = true;
    await route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Service Unavailable",
        status: 503,
        errorCode: "MEDIA_STORAGE_UNAVAILABLE",
        traceId: `ears-21-${media.inputId}`,
      }),
    });
  };
  await page.route(`**/v1/admin/${media.resource}/**`, storageFailure);
  const failedReplaceRequestPromise = page.waitForRequest((request) =>
    isEntityMutation(request, media.resource),
  );
  await page.getByTestId(media.submitTestId).click();
  const failedReplaceRequest = await failedReplaceRequestPromise;
  expectMultipartFilePart(failedReplaceRequest, media.inputId);
  await expect(page.getByTestId("update-error")).toContainText(
    media.storageErrorText,
  );
  await expect(page.getByTestId(media.submitTestId)).toBeEnabled();
  await expect(page.getByAltText(media.previewAlt)).toBeVisible();
  expect(storageFailureInjected).toBe(true);
  await page.unroute(`**/v1/admin/${media.resource}/**`, storageFailure);

  const retryRequestPromise = page.waitForRequest((request) =>
    isEntityMutation(request, media.resource),
  );
  await page.getByTestId(media.submitTestId).click();
  const retryRequest = await retryRequestPromise;
  expectMultipartFilePart(retryRequest, media.inputId);
  await expect(page.getByTestId("update-saved")).toBeVisible();
  await page.reload();
  await expect(storedPreview).toBeVisible();
  const secondStoredSrc = await storedPreview.getAttribute("src");
  expect(secondStoredSrc).toBeTruthy();
  expect(storedObjectIdentity(secondStoredSrc!)).not.toBe(
    storedObjectIdentity(firstStoredSrc!),
  );

  await page.getByRole("button", { name: "убрать" }).click();
  await expect(page.getByAltText(media.previewAlt)).toHaveCount(0);
  const clearRequestPromise = page.waitForRequest((request) =>
    isEntityMutation(request, media.resource),
  );
  await page.getByTestId(media.submitTestId).click();
  const clearRequest = await clearRequestPromise;
  expect(clearRequest.headers()["content-type"]).toContain("application/json");
  expect(clearRequest.postDataJSON()).toMatchObject({ mediaAction: "clear" });
  await expect(page.getByTestId("update-saved")).toBeVisible();
  await page.reload();
  await expect(page.getByAltText(media.previewAlt)).toHaveCount(0);
  await expectNoStorageReferenceAuthoring(page, media.slugTestId);
}

test.describe.configure({ mode: "serial" });

test.describe("012 EARS-21 — reversible taxonomy entity media", () => {
  test("EARS-21: Project cover uploads, replaces and removes without storage-reference authoring", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/projects/create");
    await page
      .getByTestId("project-title")
      .fill(`Школа доказательной кардиологии ${Date.now()}`);
    await page
      .getByTestId("project-description")
      .fill("Практическая образовательная программа для врачей-кардиологов.");
    await expectNoStorageReferenceAuthoring(page, "project-slug");
    await page.getByTestId("submit-project").click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    await driveMediaLifecycle(page, {
      resource: "projects",
      inputId: "cover",
      previewAlt: "Обложка проекта",
      errorTestId: "project-cover-error",
      submitTestId: "submit-project",
      slugTestId: "project-slug",
      storageErrorText: "Хранилище файлов временно недоступно",
    });
  });

  test("EARS-21: Expert photo uploads, replaces and removes without storage-reference authoring", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/experts/create");
    await expect(
      page.getByRole("combobox", { name: "Пользователь" }),
    ).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId("expert-family-name").fill(`Соколова-${Date.now()}`);
    await page.getByTestId("expert-given-name").fill("Анна");
    await page.getByTestId("expert-patronymic").fill("Михайловна");
    await expectNoStorageReferenceAuthoring(page, "expert-slug");
    await page.getByTestId("submit-expert").click();
    await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    await driveMediaLifecycle(page, {
      resource: "experts",
      inputId: "photo",
      previewAlt: "Фото эксперта",
      errorTestId: "expert-photo-error",
      submitTestId: "submit-expert",
      slugTestId: "expert-slug",
      storageErrorText: "Хранилище файлов временно недоступно",
    });
  });

  test("EARS-21: Partner logo uploads, replaces and removes without storage-reference authoring", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/partners/create");
    await page
      .getByTestId("partner-title")
      .fill(`Фонд развития медицинского образования ${Date.now()}`);
    await page
      .getByTestId("partner-website-url")
      .fill("https://education.example.ru");
    await expectNoStorageReferenceAuthoring(page, "partner-slug");
    await page.getByTestId("submit-partner").click();
    await page.waitForURL(/\/partners\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    await driveMediaLifecycle(page, {
      resource: "partners",
      inputId: "logo",
      previewAlt: "Логотип партнёра",
      errorTestId: "partner-logo-error",
      submitTestId: "submit-partner",
      slugTestId: "partner-slug",
      storageErrorText: "Хранилище файлов временно недоступно",
    });
  });
});

const RENDER_MATRIX = [
  {
    name: "desktop light",
    viewport: { width: 1440, height: 900 },
    colorScheme: "light" as const,
  },
  {
    name: "desktop dark",
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark" as const,
  },
  {
    name: "mobile light",
    viewport: { width: 390, height: 844 },
    colorScheme: "light" as const,
  },
  {
    name: "mobile dark",
    viewport: { width: 390, height: 844 },
    colorScheme: "dark" as const,
  },
];

for (const variant of RENDER_MATRIX) {
  test.describe(`012 EARS-21 — ${variant.name}`, () => {
    test.use({
      viewport: variant.viewport,
      colorScheme: variant.colorScheme,
    });

    test(`EARS-21: all entity media controls render in ${variant.name}`, async ({
      page,
    }) => {
      await signInAsAdmin(page);
      for (const media of [
        { path: "/projects/create", inputId: "cover", label: "Обложка" },
        { path: "/experts/create", inputId: "photo", label: "Фото" },
        { path: "/partners/create", inputId: "logo", label: "Логотип" },
      ]) {
        await page.goto(media.path);
        await expect(
          page.getByText(media.label, { exact: true }),
        ).toBeVisible();
        await expect(page.locator(`#${media.inputId}`)).toHaveCount(1);
      }
    });
  });
}
