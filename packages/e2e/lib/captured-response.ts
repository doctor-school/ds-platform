import type { APIResponse, Page, Response, Route } from "@playwright/test";

export interface CapturedResponse {
  response: Response;
  /** The body, read the moment the response arrived. */
  body: string;
}

/**
 * Waits for the page's next POST to `pathname` and keeps its body.
 * Playwright drops a response body as soon as the page navigates away from it,
 * and auth doors navigate (the app redirects on success; later steps open
 * other pages), so a body asserted in a later step must be captured here
 * (#2683). Register the capture before triggering the request.
 *
 * On the sign-in host (ADR-0015 §4, #3172) a successful step answers
 * `{ status: "redirect", url }` and the form navigates in the same task, so
 * even an immediate `response.text()` loses that race. The body is therefore
 * read where it cannot be lost: a one-shot route forwards the request
 * unchanged (`route.fetch`), keeps the body, and fulfils the page with that
 * very response — status, headers and `Set-Cookie` included. The `Response`
 * the page saw is still returned, so `request()` / `status()` read as before.
 *
 * Its HEADER reads, however, are the fetched response's: a response the page
 * received through `route.fulfill` reports no `Set-Cookie` to
 * `headerValue("set-cookie")` (Chromium exposes it only for network-received
 * responses, though the browser still stores the cookie), which would turn
 * every «minted / cleared / no session cookie» check on a captured command into
 * a vacuous one. The returned `response` therefore answers `headerValue`,
 * `headerValues`, `headersArray`, `allHeaders` and `headers` from the very
 * response the page was fulfilled with.
 */
export function captureResponse(
  page: Page,
  pathname: string,
): Promise<CapturedResponse> {
  // A capture of a POST another caller is already capturing on this page (a
  // step around a shared helper that captures too) is that same capture: a
  // second one-shot route would shadow the first and leave it unresolved.
  const pending = pendingCaptures.get(page) ?? new Map();
  pendingCaptures.set(page, pending);
  const shared = pending.get(pathname);
  if (shared) return shared;
  const capture = startCapture(page, pathname);
  pending.set(pathname, capture);
  const settle = () => {
    if (pending.get(pathname) === capture) pending.delete(pathname);
  };
  capture.then(settle, settle);
  return capture;
}

const pendingCaptures = new WeakMap<
  Page,
  Map<string, Promise<CapturedResponse>>
>();

function startCapture(
  page: Page,
  pathname: string,
): Promise<CapturedResponse> {
  const matches = (url: URL) => url.pathname === pathname;
  let resolveFetched: (fetched: APIResponse) => void = () => undefined;
  const fetchedResponse = new Promise<APIResponse>((resolve) => {
    resolveFetched = resolve;
  });
  // One shot: the pathnames captured here are POST-only commands, so the first
  // request to one IS the POST being captured.
  const handler = async (route: Route) => {
    const fetched = await route.fetch();
    // Read before fulfilling: the body must be kept whatever the page does next.
    await fetched.body();
    resolveFetched(fetched);
    await route.fulfill({ response: fetched });
  };
  const routed = page.route(matches, handler, { times: 1 });
  const response = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === pathname &&
      candidate.request().method() === "POST",
  );
  return routed.then(async () => {
    const fetched = await fetchedResponse;
    return {
      response: withFetchedHeaders(await response, fetched),
      body: await fetched.text(),
    };
  });
}

/** The page's `Response`, its header reads answered by the fulfilled `fetched`. */
function withFetchedHeaders(response: Response, fetched: APIResponse): Response {
  const headers = fetched.headersArray();
  const values = (name: string) =>
    headers
      .filter((header) => header.name.toLowerCase() === name.toLowerCase())
      .map((header) => header.value);
  const value = (name: string) => {
    const found = values(name);
    if (found.length === 0) return null;
    return found.join(name.toLowerCase() === "set-cookie" ? "\n" : ", ");
  };
  return new Proxy(response, {
    get(target, property) {
      switch (property) {
        case "headerValue":
          return async (name: string) => value(name);
        case "headerValues":
          return async (name: string) => values(name);
        case "headersArray":
          return async () => headers.map((header) => ({ ...header }));
        case "allHeaders":
        case "headers": {
          const all: Record<string, string> = {};
          for (const { name } of headers)
            all[name.toLowerCase()] = value(name) ?? "";
          return property === "headers" ? () => all : async () => all;
        }
        default: {
          const member: unknown = Reflect.get(target, property, target);
          return typeof member === "function" ? member.bind(target) : member;
        }
      }
    },
  });
}

/** What a {@link sendHostCommandFromForm} probe really put on the wire. */
export interface SentHostCommand extends CapturedResponse {
  /** The JSON body the API received (the probe's command + the form fields). */
  sent: string;
  /** The request headers the API received. */
  sentHeaders: Record<string, string>;
}

/**
 * A BFF contract probe on the sign-in host (#3172): sends `command` to the
 * host API `pathname` AS the door's own form post. A host command is only
 * accepted with the form-post fields of the door's auth request — `authRequest`
 * and the `csrf` bound to its form-state cookie (003 EARS-69/70) — and the
 * `csrf` never reaches the DOM. So the door's real submit (`submit`) is
 * intercepted once and its body REPLACED by `command` plus those two fields
 * from the door's own post; `headers` overrides request headers (`null`
 * removes one). The API's answer reaches the page unchanged, and the returned
 * `sent` / `sentHeaders` are what the API received — the page's `Request`
 * still shows the form's original body, so evidence reads `sent`.
 */
export async function sendHostCommandFromForm(
  page: Page,
  pathname: string,
  command: Record<string, unknown>,
  submit: () => Promise<void>,
  headers: Record<string, string | null> = {},
): Promise<SentHostCommand> {
  let resolveSent: (value: {
    fetched: APIResponse;
    sent: string;
    sentHeaders: Record<string, string>;
  }) => void = () => undefined;
  const sentPromise = new Promise<{
    fetched: APIResponse;
    sent: string;
    sentHeaders: Record<string, string>;
  }>((resolve) => {
    resolveSent = resolve;
  });
  const handler = async (route: Route) => {
    const original = route.request().postDataJSON() as Record<string, unknown>;
    const sent = JSON.stringify({
      ...command,
      authRequest: original.authRequest,
      csrf: original.csrf,
    });
    const sentHeaders: Record<string, string> = {
      ...(await route.request().allHeaders()),
    };
    // The body is replaced: its length is the new body's, set by the fetch.
    delete sentHeaders["content-length"];
    for (const [name, value] of Object.entries(headers)) {
      if (value === null) delete sentHeaders[name.toLowerCase()];
      else sentHeaders[name.toLowerCase()] = value;
    }
    const fetched = await route.fetch({ postData: sent, headers: sentHeaders });
    await fetched.body();
    resolveSent({ fetched, sent, sentHeaders });
    await route.fulfill({ response: fetched });
  };
  await page.route(
    (url: URL) => url.pathname === pathname,
    handler,
    { times: 1 },
  );
  const response = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === pathname &&
      candidate.request().method() === "POST",
  );
  await submit();
  const { fetched, sent, sentHeaders } = await sentPromise;
  return {
    response: withFetchedHeaders(await response, fetched),
    body: await fetched.text(),
    sent,
    sentHeaders,
  };
}
