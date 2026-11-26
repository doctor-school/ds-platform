import { randomUUID } from "node:crypto";
import { signInAsAdmin } from "@ds/e2e/admin-events";
import { expect, test, type Page } from "@playwright/test";
import { PARTNERSHIP_CONSENT_VERSION_TAG } from "@ds/schemas";

/**
 * 033 EARS-13 — the «Заявки» list keeps a guest's contact inside its column.
 *
 * A partnership guest's contact is an email or a Telegram handle with no
 * spaces, up to 254 characters (`PARTNERSHIP_CONTACT_MAX`). The list renders it
 * in «Заявитель»; before the fix an unbroken 64-character local part could not
 * break anywhere, so
 *   - at 390px the record card widened past the viewport and the PAGE scrolled
 *     sideways (slot drive at d9b7a6b: scrollWidth 627 against 390), and
 *   - at 1440px the first line ran out of the «Заявитель» cell into «Тема /
 *     компания».
 *
 * The row is created through the real public intake
 * (`POST /v1/public/applications/partnership`, through the admin's `/v1`
 * proxy). CI boots the api with bot protection off; on a stage slot the
 * operator exports the box test token as `E2E_CAPTCHA_TEST_TOKEN` and it rides
 * as `x-smartcaptcha-token`. Every run sends a fresh contact so the row is the
 * newest and therefore on the first page of the newest-first queue.
 *
 * The assertions are measured geometry of the rendered TEXT (the line boxes of
 * its range), not class strings: an inline element's box follows its text past
 * the cell, so "the text's right edge is inside the cell / the card" IS "the
 * contact stays in its column".
 */
const NARROW = { width: 390, height: 844 };
const WIDE = { width: 1440, height: 900 };

/** A valid 253-character address: a 64-character local part, three 60-character labels. */
function longContact(): string {
  const local = `p${randomUUID().replaceAll("-", "")}`.padEnd(64, "x");
  const domain = ["a", "b", "c"].map((c) => c.repeat(60)).join(".");
  return `${local}@${domain}.test`;
}

async function submitPartnership(page: Page, contact: string): Promise<string> {
  const token = process.env.E2E_CAPTCHA_TEST_TOKEN;
  const res = await page.request.post("/v1/public/applications/partnership", {
    headers: {
      "idempotency-key": randomUUID(),
      ...(token ? { "x-smartcaptcha-token": token } : {}),
    },
    data: {
      name: "Анна Петрова",
      companyOrClinic: "Клиника «Здоровье»",
      contact,
      role: "Партнёр",
      consentVersion: PARTNERSHIP_CONSENT_VERSION_TAG,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

interface ContactGeometry {
  /** documentElement scrollWidth − clientWidth; > 0 is a page side-scroll. */
  pageOverflow: number;
  /** Right edge of the contact's rendered text. */
  textRight: number;
  /** Right edge of the box that must hold it (the table cell, or the card). */
  boxRight: number;
}

/** Measures the visible copy of `contact` (the list renders a table AND cards). */
async function contactGeometry(
  page: Page,
  contact: string,
  container: "td" | "card",
): Promise<ContactGeometry> {
  return page.evaluate(
    ({ contact, container }) => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.textContent?.trim() !== contact) continue;
        const el = n.parentElement!;
        if (!el.getClientRects().length) continue; // the other layout's copy
        const range = document.createRange();
        range.selectNodeContents(n);
        const textRight = Math.max(
          ...[...range.getClientRects()].map((r) => r.right),
        );
        const box =
          container === "td"
            ? el.closest("td")
            : el.closest('[data-clickable="true"]');
        if (!box) throw new Error(`no ${container} around the contact`);
        const doc = document.documentElement;
        return {
          pageOverflow: doc.scrollWidth - doc.clientWidth,
          textRight,
          boxRight: box.getBoundingClientRect().right,
        };
      }
      throw new Error("the contact is not rendered");
    },
    { contact, container },
  );
}

test.describe("033 EARS-13 «Заявки» list — a long unbroken contact", () => {
  test("EARS-13: the contact wraps inside «Заявитель» at 1440 and inside its card at 390, with no page side-scroll", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    await signInAsAdmin(page);
    const contact = longContact();
    const id = await submitPartnership(page, contact);

    await page.goto("/applications");
    const table = page.getByTestId("applications-table");
    await expect(
      table.locator(`[data-testid="row-${id}"]:visible`).first(),
    ).toBeVisible();

    const wide = await contactGeometry(page, contact, "td");
    expect
      .soft(wide.pageOverflow, "page side-scroll at 1440")
      .toBeLessThanOrEqual(0);
    expect
      .soft(
        wide.textRight,
        `contact runs out of «Заявитель» at 1440 (text ${wide.textRight} vs cell ${wide.boxRight})`,
      )
      .toBeLessThanOrEqual(wide.boxRight);

    await page.setViewportSize(NARROW);
    await expect(
      table.locator(`[data-testid="row-${id}"]:visible`).first(),
    ).toBeVisible();
    const narrow = await contactGeometry(page, contact, "card");
    expect
      .soft(narrow.pageOverflow, "page side-scroll at 390")
      .toBeLessThanOrEqual(0);
    expect
      .soft(
        narrow.textRight,
        `contact runs out of its card at 390 (text ${narrow.textRight} vs card ${narrow.boxRight})`,
      )
      .toBeLessThanOrEqual(narrow.boxRight);
  });
});
