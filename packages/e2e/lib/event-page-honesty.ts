import type { Page } from "@playwright/test";

/**
 * 020 EARS-19 (wave-3 gate rows 38, 40, #2072 PR 3.3) — the honest-state sweep
 * both storefronts' event-page specs run against every seeded state: the page
 * renders content, a skeleton, an honest statement or a Russian error, never
 *
 * - a «скоро» marker (the hero's lifecycle word «Скоро» is the approved status
 *   plate and is outside the swept region),
 * - an empty labelled box (a `section` whose text is only its heading),
 * - a disabled or dead control (`[disabled]`, `aria-disabled`, an anchor with
 *   no real `href`),
 * - a Pul statement (a balance, shortfall, advance or accrual — LD-7; the
 *   event's Pul COST in the conditions row is configuration and is allowed).
 *
 * Returns the violations as readable strings so the spec asserts `[]` and a
 * failure names what it found. Pure DOM reads — no `expect` here, so the module
 * is safe to import outside a Playwright run.
 */
export async function eventPageHonestyFindings(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const findings: string[] = [];
    const regions = ["event-page-open-part", "event-page-aside"]
      .map((id) => document.querySelector(`[data-testid="${id}"]`))
      .filter((node): node is Element => node !== null);
    if (regions.length === 0) findings.push("no event-page regions rendered");
    for (const region of regions) {
      const id = region.getAttribute("data-testid");
      const text = region.textContent ?? "";
      if (/скоро/iu.test(text)) findings.push(`${id}: a «скоро» marker`);
      if (/баланс|не хватает|аванс|начисл/iu.test(text)) {
        findings.push(`${id}: a Pul ledger statement`);
      }
      for (const control of region.querySelectorAll(
        '[disabled], [aria-disabled="true"]',
      )) {
        findings.push(
          `${id}: a disabled control «${control.textContent?.trim()}»`,
        );
      }
      for (const anchor of region.querySelectorAll("a")) {
        const href = anchor.getAttribute("href")?.trim() ?? "";
        if (href === "" || href === "#" || /^javascript:/iu.test(href)) {
          findings.push(`${id}: a dead link «${anchor.textContent?.trim()}»`);
        }
      }
      for (const section of region.querySelectorAll("section")) {
        const heading = section.firstElementChild?.textContent?.trim() ?? "";
        const body = section.textContent?.trim() ?? "";
        if (body.length <= heading.length) {
          findings.push(`${id}: an empty labelled box «${heading}»`);
        }
      }
    }
    return findings;
  });
}

/**
 * 020 EARS-9 / F-020-3 Б (wave-3 gate row 35) — a sold-out PURE OFFLINE event
 * states «мест нет» and offers nothing to act on: no participation control in
 * the sign-up column, no hybrid tab to switch to, and no waiting list in any
 * wording. Same contract as {@link eventPageHonestyFindings}: pure DOM reads,
 * the violations returned as readable strings.
 */
export async function offlineSoldOutFindings(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const findings: string[] = [];
    const aside = document.querySelector('[data-testid="event-page-aside"]');
    const text = document.body.textContent ?? "";
    if (!/Мест нет/u.test(aside?.textContent ?? "")) {
      findings.push("the sign-up card does not state «Мест нет»");
    }
    const controls = aside?.querySelectorAll("a, button").length ?? 0;
    if (controls > 0) {
      findings.push(`${controls} participation control(s) in the sign-up card`);
    }
    if (document.querySelector('[data-testid="event-format-tabs"]')) {
      findings.push("a format tab on a pure offline event");
    }
    if (/лист ожидания|очеред|ожидани|уведомить|сообщим/iu.test(text)) {
      findings.push("a waiting-list affordance");
    }
    return findings;
  });
}
