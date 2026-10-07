import type { Page, Response } from "@playwright/test";

export interface CapturedResponse {
  response: Response;
  /** The body, read the moment the response arrived. */
  body: string;
}

/**
 * Waits for the page's next POST to `pathname` and reads its body at once.
 * Playwright drops a response body as soon as the page navigates away from it,
 * and auth doors navigate (the app redirects on success; later steps open
 * other pages), so a body asserted in a later step must be captured here
 * (#2683). Register the capture before triggering the request.
 */
export function captureResponse(
  page: Page,
  pathname: string,
): Promise<CapturedResponse> {
  return page
    .waitForResponse(
      (response) =>
        new URL(response.url()).pathname === pathname &&
        response.request().method() === "POST",
    )
    .then(async (response) => ({ response, body: await response.text() }));
}
