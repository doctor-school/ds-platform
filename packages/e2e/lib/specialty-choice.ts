import { expect, type Page } from "@playwright/test";

/**
 * The guest `ChooseSpecialty` command, issued in-page on the storefront origin
 * so the api's `__Host-ds_specialty` cookie lands in this browser exactly as the
 * home catalog's choice would (017 EARS-6). The specialty is resolved through
 * the book search by its golden name, never typed as an id.
 *
 * `path` is any storefront page the command is issued from (absolute or
 * relative to the page's base URL).
 */
export async function chooseGuestSpecialty(
  page: Page,
  path: string,
  name: string,
): Promise<void> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  const chosen = await page.evaluate(async (wanted: string) => {
    const search = await fetch(
      `/v1/public/specialties/search?q=${encodeURIComponent(wanted)}`,
    );
    if (!search.ok) return `search ${search.status}`;
    const { entries } = (await search.json()) as {
      entries: { id: string; name: string }[];
    };
    const entry = entries.find((candidate) => candidate.name === wanted);
    if (!entry) return `no book entry named ${wanted}`;
    const choice = await fetch("/v1/public/specialty-choice", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ specialty: entry.id }),
    });
    if (!choice.ok) return `choose ${choice.status}`;
    const body = (await choice.json()) as {
      specialty: { name: string } | null;
    };
    return body.specialty?.name ?? "nothing remembered";
  }, name);
  expect(chosen, "the guest choice is remembered").toBe(name);
}
