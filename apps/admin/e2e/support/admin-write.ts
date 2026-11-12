import { expect, type Page } from "@playwright/test";

export interface Written {
  id: string;
  slug?: string;
  version: number;
}

/**
 * One admin API write from the signed-in admin page: the CSRF double-submit,
 * a fresh `Idempotency-Key` and, for an edit or a lifecycle call, `If-Match`.
 * A `coverBase64` sends the multipart shape (payload + cover parts).
 */
export async function adminWrite(
  page: Page,
  input: {
    path: string;
    payload?: unknown;
    version?: number;
    coverBase64?: string;
  },
): Promise<Written> {
  const result = await page.evaluate(
    async ({ path, payload, version, coverBase64 }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((pair) => pair.startsWith("__Host-ds_admin_csrf="))
          ?.split("=")[1] ?? "";
      const headers: Record<string, string> = {
        accept: "application/json",
        "x-ds-admin-csrf": decodeURIComponent(csrf),
        "idempotency-key": crypto.randomUUID(),
      };
      if (version !== undefined) headers["if-match"] = `W/"${version}"`;
      let body: BodyInit | undefined;
      if (coverBase64) {
        const form = new FormData();
        form.append("payload", JSON.stringify(payload));
        const bytes = Uint8Array.from(atob(coverBase64), (c) =>
          c.charCodeAt(0),
        );
        form.append(
          "cover",
          new Blob([bytes], { type: "image/png" }),
          "cover.png",
        );
        body = form;
      } else if (payload !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(payload);
      }
      const res = await fetch(path, {
        method: "POST",
        credentials: "include",
        headers,
        body,
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    input,
  );
  expect(
    result.status,
    `${input.path} → ${JSON.stringify(result.json)}`,
  ).toBeLessThan(300);
  return result.json as Written;
}

/** Create, then publish at the created version (048 EARS-1/EARS-4). */
export async function publishedMaterial(
  page: Page,
  payload: Record<string, unknown>,
  coverBase64?: string,
): Promise<Written> {
  const created = await adminWrite(page, {
    path: "/v1/admin/materials",
    payload,
    coverBase64,
  });
  await adminWrite(page, {
    path: `/v1/admin/materials/${created.id}/publish`,
    version: created.version,
  });
  return created;
}

/** The page never scrolls sideways (048 EARS-18). */
export async function expectNoPageSideScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, `${page.url()} side-scrolls by ${overflow}px`).toBe(0);
}
