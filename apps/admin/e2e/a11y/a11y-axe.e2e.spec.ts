import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PROJECT_DESCRIPTION_MAX } from "@ds/schemas";
import { bootstrapAdminSession } from "../support/admin-session";
import { selectRelationshipCombobox } from "../support/relationship-combobox";
import { totpCode } from "../support/totp";

/**
 * 007 EARS-11 — axe-core WCAG 2 A/AA scan of the admin event surface (the runtime
 * twin of the CI `playwright-axe` BLOCK gate, which scans the DS primitives via
 * the showcase; this retargets it onto the admin composition). Scanned in the
 * light theme — the only theme the wave-1 admin renders (no toggle, see THEMES).
 * Dev-stand-gated like the BDD suite — it provisions a real platform_admin
 * session. The settled token fact it guards: text on `bg-card` uses card-safe AA
 * tokens (`text-primary-action`), never `text-primary`.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
// The wave-1 admin app is LIGHT-ONLY: it wires no theme toggle, so `<html>` never
// gets `.dark` and the operator only ever sees the light theme — the only
// reachable state to scan here. The DS dark-theme tokens are already covered by
// the showcase `playwright-axe` BLOCK gate (both themes). A dark admin theme is a
// wave-2 affordance (add the toggle → re-enable `"dark"` here).
const THEMES = ["light"] as const;
const ORIGIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3200";

/**
 * Sign a freshly provisioned `platform_admin` all the way INTO admin.
 *
 * Since 011 that is two steps, not one: primary auth issues no session, and the
 * forced TOTP enrollment (EARS-4) is the only door onward. The helper therefore
 * walks the real gate — password, then the first code derived from the secret the
 * enrollment screen rendered — so the scanned event surfaces are reached the way
 * an operator reaches them, not through a back door that would let a broken gate
 * pass unnoticed.
 */
async function loginAsAdmin(page: Page): Promise<string> {
  const { email, password } = await bootstrapAdminSession(ORIGIN);
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await page.waitForTimeout(2500);
    await page.goto("/login");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByTestId("login-submit").click();
    try {
      await page.waitForURL(/\/mfa\/enroll/, { timeout: 8000 });
    } catch {
      /* role not yet projected — retry */
      continue;
    }
    const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
    await page
      .getByTestId("mfa-enroll-form")
      .getByRole("textbox")
      .fill(totpCode(secret));
    await page.waitForURL(/\/events/, { timeout: 20_000 });
    return password;
  }
  throw new Error("admin login did not reach /events for the axe scan");
}

async function createEventForScan(page: Page): Promise<string> {
  await page.goto("/events/create");
  await page.locator("#title").fill("Axe-скан мероприятие");
  await page.locator("#school").fill("Кардиология");
  await page.locator("#startsAtMsk").fill("2026-07-17T19:00");
  await page.locator("#durationMin").fill("90");
  await page.getByTestId("program-pdf").setInputFiles({
    name: "program.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF"),
  });
  await page.getByTestId("submit-event").click();
  await page.waitForURL(/\/events\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

/** A draft Expert with the structured identity required by 012 EARS-20. */
async function createExpertForScan(
  page: Page,
  familyName: string,
  givenName: string,
  patronymic: string,
): Promise<string> {
  await page.goto("/experts/create");
  await page.locator("#familyName").fill(familyName);
  await page.locator("#givenName").fill(givenName);
  await page.locator("#patronymic").fill(patronymic);
  await page.getByTestId("submit-expert").click();
  await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

/**
 * A curated direction, created through the real authoring screen.
 *
 * The taxonomy scans below need a direction that EXISTS: a link row (a
 * direction↔specialty pair, a direction↔direction edge) and an event's topic
 * panel all render their populated states only against one, and an empty list is
 * a different a11y surface from a populated one.
 */
async function createDirectionForScan(page: Page): Promise<string> {
  const title = `Axe-скан направление ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await page.goto("/directions/create");
  await page.getByTestId("direction-form").waitFor({ state: "visible" });
  await page.getByTestId("direction-title").fill(title);
  await page.getByTestId("submit-direction").click();
  await page.waitForURL(/\/directions\/[0-9a-f-]{36}$/);
  await page.getByTestId("direction-heading").waitFor({ state: "visible" });
  return title;
}

/**
 * Block until nothing on the page is still ANIMATING, so axe samples a settled
 * state rather than a frame of a transition.
 *
 * Why this belongs in every scan and is a root fix, not a mask. The DS controls
 * carry `transition-all`, and a filled `Button` fades through `disabled:opacity-40`
 * (`primitives/button.tsx` — RAISED_MOTION) whenever it flips `disabled → enabled`;
 * the Radix `Dialog` likewise fades its content in. axe EXEMPTS a disabled control
 * from `color-contrast`, so the first frames in which the rule applies at all are
 * the mid-fade ones — where a 40%-alpha `bg-primary-action` under white copy
 * genuinely misses AA. Every state this file scans right after an interaction
 * (the picker the moment a selection enables the submit, the impact dialog the
 * moment its loaded preview enables the confirm) lands inside exactly that window,
 * which is why the violation appeared only in full-suite ordering and never in
 * isolation. The settled controls are the certified `bg-primary-action` /
 * `text-primary-foreground` pair the showcase gate already holds at AA. CSS
 * transitions surface as `Animation` objects, so this waits on the real end
 * condition instead of a fixed sleep; an intentionally looping animation is
 * treated as settled, since it never ends.
 */
async function settle(page: Page) {
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every(
          (a) =>
            a.playState !== "running" ||
            a.effect?.getTiming().iterations === Infinity,
        ),
    undefined,
    { timeout: 5000 },
  );
}

async function scan(page: Page, theme: (typeof THEMES)[number]) {
  await page.locator("main, form, body").first().waitFor({ state: "visible" });
  await settle(page);
  // Light is the only reachable admin theme (see THEMES) — ensure no stray `.dark`.
  void theme;
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target).flat(),
  }));
  expect(summary, `axe violations on ${page.url()} (${theme})`).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test.describe("007 EARS-11 axe-core a11y scan of the admin event surface", () => {
  test("the login screen passes WCAG 2 A/AA (light)", async ({ page }) => {
    await page.goto("/login");
    for (const theme of THEMES) await scan(page, theme);
  });

  // The 011 MFA screens' scan lives in `mfa-a11y.e2e.spec.ts`, with the i18n half
  // of EARS-12 it fails together with — this file is the 007 event surface.

  test("the event list + create + edit surfaces pass WCAG 2 A/AA (light)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/events");
    for (const theme of THEMES) await scan(page, theme);

    const id = await createEventForScan(page);
    await page.goto("/events/create");
    for (const theme of THEMES) await scan(page, theme);

    await page.goto(`/events/${id}`);
    await page.getByTestId("event-form").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });

  // 012 EARS-1 (#1283) — the taxonomy surfaces added by the project vertical: the
  // shared admin list shell (search box, state select, retired toggle, pagination)
  // and the tabbed detail with the character counter and the media dropzone. They
  // introduce four control classes the event surfaces never had, so they get their
  // own scan rather than inheriting a green from the event pages.
  test("the project list + create + detail surfaces pass WCAG 2 A/AA (light)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/projects");
    await page.getByTestId("projects-filters").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    await page.goto("/projects/create");
    await page.getByTestId("project-form").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // The OVER-LIMIT counter is its own colour state (destructive small text), so
    // it is scanned explicitly rather than inherited from the resting form: the
    // showcase `playwright-axe` gate caught a real `color-contrast` failure there,
    // and a suite that only ever renders the muted counter would not have.
    await page
      .locator("#description")
      .fill("х".repeat(PROJECT_DESCRIPTION_MAX + 5));
    await expect(
      page.getByText("превышено на", { exact: false }),
    ).toBeVisible();
    for (const theme of THEMES) await scan(page, theme);

    // A real created row, so the detail scan covers the tab bar, the populated
    // counter and the dropzone's filled state — not just an empty form.
    await page.locator("#title").fill(`Axe-скан проект ${Date.now()}`);
    await page.locator("#description").fill("");
    await page.locator("#description").fill("Описание для скана доступности.");
    await page.getByTestId("submit-project").click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
    await page.getByTestId("project-form").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });

  // 012 EARS-20 (#1606) — the expert vertical. It reuses the shared list shell and
  // the dropzone the project scan already covers, but it adds one control class no
  // other admin surface renders: the initials AVATAR (a `primary-action` fill with
  // `primary-foreground` text, carrying an `aria-label` as its only accessible
  // name). A contrast or naming regression there would pass every existing scan,
  // so the expert surfaces get their own.
  test("the expert list + create + detail surfaces pass WCAG 2 A/AA (light)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/experts");
    await page.getByTestId("experts-filters").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    await page.goto("/experts/create");
    await page.getByTestId("expert-form").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // A real created row, so the detail scan covers the tab bar, the populated
    // counters and — the point of this test — the rendered initials avatar.
    await page.locator("#familyName").fill(`Аксёнов-${Date.now()}`);
    await page.locator("#givenName").fill("Пётр");
    await page.locator("#patronymic").fill("Ильич");
    await page.locator("#professionalRole").fill("Кардиолог");
    await page.locator("#bio").fill("Биография для скана доступности.");
    await page.getByTestId("submit-expert").click();
    await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/);
    await page.getByTestId("expert-form").waitFor({ state: "visible" });
    await page.getByTestId("expert-initials").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });

  // 012 EARS-4 (#1286) — the partner vertical. It introduces no new element CLASS
  // (no initials avatar, no character counter), but it does introduce two resting
  // states no other admin surface renders: a media dropzone with NO fallback
  // affordance behind it (an empty logo slot stays empty, §5.2), and a URL field
  // whose reject state is a `pattern` message rather than a length one. Both are
  // colour/naming states an existing green certifies nothing about, so the partner
  // surfaces are enumerated the way the project (#1283) and expert (#1284) scans
  // are rather than inheriting theirs.
  test("the partner list + create + detail surfaces pass WCAG 2 A/AA (light)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/partners");
    await page.getByTestId("partners-filters").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    await page.goto("/partners/create");
    await page.getByTestId("partner-form").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // The REJECTED website field — a destructive inline message plus the field's
    // invalid border, its own colour state and its own accessible-name wiring.
    await page.getByTestId("partner-website-url").fill("example.com");
    await page.getByTestId("submit-partner").click();
    await expect(page.getByTestId("partner-form")).toBeVisible();
    for (const theme of THEMES) await scan(page, theme);

    // A real created row, so the detail scan covers the tab bar and the dropzone's
    // EMPTY slot — the state that has no avatar behind it.
    await page.getByTestId("partner-website-url").fill("https://example.com");
    await page
      .getByTestId("partner-title")
      .fill(`Axe-скан партнёр ${Date.now()}`);
    await page.getByTestId("submit-partner").click();
    await page.waitForURL(/\/partners\/[0-9a-f-]{36}$/);
    await page.getByTestId("partner-form").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });

  // 014 EARS-1/EARS-2 (#1339) — the «Записи» tab and the modal element class it
  // introduces. The OPEN modal is scanned explicitly, not just the tab behind it:
  // a dialog is a different a11y surface from the page (its own name, its own
  // description, a focus trap and a scrim over everything else), and a suite that
  // only ever scanned the closed trigger would certify nothing about it.
  test("the recordings tab and its modal confirmation pass WCAG 2 A/AA (light)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const id = await createEventForScan(page);

    await page.goto(`/events/${id}`);
    await page.getByTestId("tab-recordings").click();
    await page.getByTestId("recordings-panel").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // The attach `Dialog` — a form inside a modal, with the walk-away × affordance.
    await page.getByTestId("recording-attach-edited").click();
    await page
      .getByTestId("recording-attach-edited-form")
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
    await page.keyboard.press("Escape");

    // A row plus its `AlertDialog` confirmation — the must-be-answered variant,
    // whose action pair is the raised-button contract on the card surface.
    await page.getByTestId("recording-attach-edited").click();
    await page
      .getByTestId("recording-attach-edited-provider")
      .selectOption("rutube");
    await page
      .getByTestId("recording-attach-edited-embed-ref")
      .fill("a1b2c3d4e5f60718293a4b5c6d7e8f90");
    await page.getByTestId("recording-attach-edited-submit").click();
    await page
      .getByTestId("recording-status-edited")
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    await page.getByTestId("recording-edited-retire").click();
    await page.getByRole("alertdialog").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });

  // 012 EARS-7 (#1289) — the «Эксперты» tab of the event detail. It reuses the
  // recordings tab's modal classes but adds three states no scanned surface holds:
  // a searchable `Combobox` whose query lives inside its open panel, a link
  // row whose two `Badge`s carry status and legacy-match state as colour-plus-text,
  // and a form REJECTED inside an open modal — an invalid control and its message
  // living under a focus trap, which the closed-dialog scans certify nothing about.
  test("the event↔expert link tab, its dialog and its confirmations pass WCAG 2 A/AA (light)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const eventId = await createEventForScan(page);
    const familyName = `Аксёнов-${Date.now()}`;
    const givenName = "Пётр";
    const patronymic = "Ильич";
    const expertName = `${familyName} ${givenName} ${patronymic}`;
    await createExpertForScan(page, familyName, givenName, patronymic);

    // The EMPTY tab first — «пока не привязан ни один эксперт» plus the retired
    // toggle is a resting state a populated panel would hide.
    await page.goto(`/events/${eventId}`);
    await page.getByTestId("tab-experts").click();
    await page.getByTestId("event-experts-panel").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // The add `Dialog` — the searchable combobox, two text boxes and their hints.
    await page.getByTestId("event-expert-add").click();
    await page
      .getByTestId("event-expert-add-form")
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // The REJECTED form, still inside the modal.
    await page.getByTestId("event-expert-add-position").fill("не число");
    await page.getByTestId("event-expert-add-submit").click();
    await expect(page.getByTestId("event-expert-add-form")).toBeVisible();
    for (const theme of THEMES) await scan(page, theme);

    // A real link, so the row's badges and its action pair are scanned as state,
    // not as an empty-list placeholder.
    await selectRelationshipCombobox(
      page,
      "event-expert-combobox",
      familyName,
      expertName,
    );
    await page.getByTestId("event-expert-add-role").fill("Модератор");
    await page.getByTestId("event-expert-add-position").fill("1");
    await page.getByTestId("event-expert-add-submit").click();
    await page
      .getByTestId("event-experts-active")
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // The retire `AlertDialog` — the must-be-answered variant on this surface.
    await page
      .locator('[data-testid^="event-expert-"][data-testid$="-retire"]')
      .click();
    await page.getByRole("alertdialog").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });

  // 012 EARS-6 (#1288) — the event↔project relationship editor. It introduces one
  // element class no other admin surface renders: the §3.1 preview→confirm
  // `Dialog`, whose body is a LIST of affected rows, each carrying two `Badge`s
  // (kind + status) — a naming/contrast surface the recordings `AlertDialog`
  // (a sentence and an action pair, no list) certifies nothing about. Its resting
  // searchable `Combobox` plus its «no options» hint, its danger
  // command `Alert` and the read-only project-side view are enumerated for the
  // same reason the partner (#1286) scan enumerates its own states.
  test("the event-project relationship editor and its impact dialog pass WCAG 2 A/AA (light)", async ({
    page,
  }) => {
    await loginAsAdmin(page);

    const stamp = Date.now();
    const projects: { title: string; url: string }[] = [];
    for (const suffix of ["A", "B"]) {
      await page.goto("/projects/create");
      await page.getByTestId("project-form").waitFor({ state: "visible" });
      await page.locator("#title").fill(`Axe-скан связи ${suffix} ${stamp}`);
      await page.locator("#description").fill("Описание для скана связей.");
      await page.getByTestId("submit-project").click();
      await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
      projects.push({
        title: `Axe-скан связи ${suffix} ${stamp}`,
        url: page.url(),
      });
    }
    const eventId = await createEventForScan(page);

    // The RESTING tab: the empty list, the picker and the no-delete note.
    await page.goto(`/events/${eventId}`);
    await page.getByTestId("tab-projects").click();
    await page
      .getByTestId("event-projects-panel")
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // The picker NARROWED to one match and holding a selection — the state whose
    // accessible naming and selected value a resting empty control cannot show.
    await selectRelationshipCombobox(
      page,
      "event-project-link-combobox",
      projects[0].title,
      projects[0].title,
    );
    for (const theme of THEMES) await scan(page, theme);

    // A real linked row: the title/slug pair plus the status `Badge` and the
    // transition trigger, on the success-`Alert` surface.
    await page.getByTestId("event-project-link-submit").click();
    await page
      .getByTestId("event-projects-notice")
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // The OPEN impact dialog, on its LOADED preview — the point of this test. The
    // scan waits for the affected list rather than the dialog shell, so it never
    // certifies the loading placeholder in place of the rows.
    await page
      .locator('[data-testid^="event-project-retire-"]')
      .first()
      .click();
    await page
      .locator('[data-testid$="-impact"]')
      .first()
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
    await page.keyboard.press("Escape");

    // The REFUSED command — a danger `Alert` above the picker. The 409 is stubbed
    // at the transport because reaching it for real needs a second operator racing
    // this tab (`taxonomy-event-projects.spec.ts` drives that arc end-to-end); what
    // is under scan here is the rendered refusal's colour and naming, and the
    // stubbed envelope is byte-identical to the API's.
    await page.route("**/v1/admin/event-projects", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 409,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "Conflict",
          status: 409,
          errorCode: "RELATIONSHIP_CONFLICT",
          traceId: "axe-scan",
        }),
      });
    });
    await selectRelationshipCombobox(
      page,
      "event-project-link-combobox",
      projects[1].title,
      projects[1].title,
    );
    await page.getByTestId("event-project-link-submit").click();
    await page
      .getByTestId("event-projects-command-error")
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
    await page.unroute("**/v1/admin/event-projects");

    // The retired section revealed by the `Switch` — its own resting state.
    // The DS `Switch` input is `sr-only` behind its painted track: a user clicks
    // the wrapping label, and `.check()` on the input is intercepted by the track.
    await page
      .getByTestId("event-projects-show-retired")
      .locator("xpath=ancestor::label[1]")
      .click();
    await page
      .getByTestId("event-projects-retired")
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // The project side: the same list and authoring form from the reverse endpoint.
    await page.goto(projects[0].url);
    await page.getByTestId("tab-events").click();
    await page
      .getByTestId("event-projects-panel")
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });

  // ── 012 EARS-3 / 017 EARS-16…19 — the taxonomy surfaces (#1647) ─────────
  // These four routes shipped with a browser FLOW spec each and no axe scan at
  // all: `taxonomy-{directions,direction-specialties,direction-adjacency,
  // specialties}.spec.ts` drive the behaviour, and behaviour green certifies
  // nothing about contrast, accessible naming or landmark structure. They are
  // enumerated here for the same reason the partner (#1286) and event↔project
  // (#1288) scans are: each renders a state no already-scanned surface holds —
  // the block-tier list bar with its applied-filter chip, a native `select` pair
  // as the only authoring control, the explaining KIND combobox with its open
  // panel, and a deliberately read-only book with no create affordance.
  //
  // «event-topics» gets no test of its own on purpose: it is not a route. The
  // topics surface is the `tab-topics` panel of `/events/[id]`
  // (`taxonomy-event-topics.spec.ts`), so it is scanned as a tab state of the
  // event detail — scanning a URL that does not exist would certify nothing.

  test("the direction list + create + rejected + detail surfaces pass WCAG 2 A/AA (light)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/directions");
    await page.getByTestId("directions-filters").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    await page.goto("/directions/create");
    await page.getByTestId("direction-form").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // The REJECTED form — a destructive inline message plus the field's invalid
    // border, its own colour state and its own accessible-name wiring. The
    // client refuses an over-long title without a round-trip (EARS-16), so this
    // state is reachable with no server dependency.
    await page.getByTestId("direction-title").fill("х".repeat(121));
    await page.getByTestId("submit-direction").click();
    await expect(
      page.getByText("Слишком длинное значение", { exact: false }),
    ).toBeVisible();
    for (const theme of THEMES) await scan(page, theme);

    // A real created row, so the detail scan covers the tab bar and the status
    // badge rather than an empty form.
    await page
      .getByTestId("direction-title")
      .fill(`Axe-скан направление ${Date.now()}`);
    await page.getByTestId("submit-direction").click();
    await page.waitForURL(/\/directions\/[0-9a-f-]{36}$/);
    await page.getByTestId("direction-heading").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // The list holding an APPLIED search — the removable «Выбрано:» chip is a
    // colour-plus-text state the resting bar does not render.
    await page.getByTestId("back-to-list").click();
    await page.waitForURL(/\/directions$/);
    await page.getByRole("searchbox", { name: "Поиск" }).fill("Axe-скан");
    await expect(page.getByText("Выбрано:", { exact: false })).toBeVisible();
    for (const theme of THEMES) await scan(page, theme);
  });

  test("the direction↔specialty list + create + detail surfaces pass WCAG 2 A/AA (light)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const directionTitle = await createDirectionForScan(page);

    await page.goto("/direction-specialties");
    await page
      .getByTestId("direction-specialties-filters")
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    await page.goto("/direction-specialties/create");
    await page
      .getByTestId("submit-direction-specialty")
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // BOTH selects rejected at once — two inline messages under two native
    // controls, the state an operator meets before they have chosen anything.
    await page.getByTestId("submit-direction-specialty").click();
    await expect(
      page.getByText("Выберите направление из списка.", { exact: false }),
    ).toBeVisible();
    for (const theme of THEMES) await scan(page, theme);

    // A real link, so the detail scan covers the resolved pair and its status
    // badge. The specialty is picked positionally: the nomenclature is the
    // seed's to decide, and naming one here would assert the seed, not the screen.
    await page
      .getByTestId("direction-specialty-direction")
      .selectOption({ label: directionTitle });
    await page
      .getByTestId("direction-specialty-specialty")
      .selectOption({ index: 1 });
    await page.getByTestId("submit-direction-specialty").click();
    await page.waitForURL(/\/direction-specialties\/[0-9a-f-]{36}$/);
    await page
      .getByTestId("direction-specialty-status")
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });

  test("the direction-adjacency list, its kind combobox and its detail pass WCAG 2 A/AA (light)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const source = await createDirectionForScan(page);
    const target = await createDirectionForScan(page);

    await page.goto("/direction-adjacency");
    await page
      .getByTestId("direction-adjacency-filters")
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    await page.goto("/direction-adjacency/create");
    await page
      .getByTestId("submit-direction-adjacency")
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // The OPEN kind panel — the point of this test. «Вид связи» is a combobox
    // rather than a native select precisely because each member carries an
    // explanation, so the panel is a listbox of two-line options with its own
    // naming and its own contrast; a closed trigger certifies none of it.
    await page
      .getByTestId("direction-adjacency-direction")
      .selectOption({ label: source });
    await page
      .getByTestId("direction-adjacency-adjacent")
      .selectOption({ label: source });
    await page.locator("#kind").click();
    await expect(
      page.getByText("Более узкая область внутри направления", {
        exact: false,
      }),
    ).toBeVisible();
    for (const theme of THEMES) await scan(page, theme);
    await page
      .getByRole("option", { name: "Смежное направление", exact: false })
      .click();

    // The REFUSED self-edge — a server-refused command rendered as an inline
    // danger message, a different surface from the client-side reject above.
    await page.getByTestId("submit-direction-adjacency").click();
    await expect(
      page.getByText("Направление не бывает смежным самому себе", {
        exact: false,
      }),
    ).toBeVisible();
    for (const theme of THEMES) await scan(page, theme);

    await page
      .getByTestId("direction-adjacency-adjacent")
      .selectOption({ label: target });
    await page.getByTestId("submit-direction-adjacency").click();
    await page.waitForURL(/\/direction-adjacency\/[0-9a-f-]{36}$/);
    await page
      .getByTestId("direction-adjacency-status")
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });

  test("the specialty book passes WCAG 2 A/AA (light)", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/specialties");
    await page.getByTestId("specialties-table").waitFor({ state: "visible" });
    // The book's own notice is part of what is scanned: it is the surface that
    // TELLS the operator the nomenclature is read-only, so its contrast and its
    // reading order are the whole affordance.
    await page.getByTestId("specialties-notice").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });

  test("the event topics tab passes WCAG 2 A/AA (light)", async ({ page }) => {
    await loginAsAdmin(page);
    const id = await createEventForScan(page);

    await page.goto(`/events/${id}`);
    await page.getByTestId("tab-topics").click();
    await page.getByTestId("event-topics-panel").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });
});
