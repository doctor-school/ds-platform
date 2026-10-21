import {
  SignInHostEntryResponseSchema,
  type SignInHostEntryResponse,
} from "@ds/schemas";
import {
  serverApiBase,
  type SignInHostPageDoor,
  type SignInHostRender,
} from "@ds/auth-flow/server";

/**
 * 003 EARS-60 / 66 / 67 / 71 — the sign-in host's one read of the API's entry
 * decision (`GET /v1/sign-in-host/entry`), and the hand-over of a `render`
 * answer from the proxy to the page.
 *
 * The app holds NO client map and no storefront URL: which form renders, and
 * every redirect (Zitadel callback, a stale request's storefront, a direct
 * visit's doctor `/login`), is the API's answer.
 */

/** The page route → door table (every other path is EARS-67's direct visit). */
export const DOOR_ROUTES: Readonly<Record<string, SignInHostPageDoor>> = {
  "/login": "login",
  "/register": "register",
  "/reset": "reset",
  "/verify": "verify",
};

/** The browser facts the API's entry reads (the storefront BFF rewrite's set). */
const FORWARDED = [
  "cookie",
  "user-agent",
  "accept-language",
  "x-forwarded-for",
  "origin",
  "sec-fetch-site",
] as const;

export type EntryRead = {
  answer: SignInHostEntryResponse;
  setCookies: string[];
};

/**
 * Ask the API what this navigation is. `authRequest` absent ⇒ the API's
 * EARS-67 answer for a request naming none. Throws when the API does not
 * answer with its contract — the caller fails closed (no guessed redirect).
 */
export async function readEntry(
  browser: Headers,
  authRequest: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<EntryRead> {
  const headers = new Headers({ accept: "application/json" });
  for (const name of FORWARDED) {
    const value = browser.get(name);
    if (value !== null) headers.set(name, value);
  }
  const query =
    authRequest === null
      ? ""
      : `?authRequest=${encodeURIComponent(authRequest)}`;
  const res = await fetchImpl(
    `${serverApiBase()}/v1/sign-in-host/entry${query}`,
    { headers, cache: "no-store", redirect: "manual" },
  );
  if (!res.ok) throw new Error(`sign-in entry answered ${res.status}`);
  const answer = SignInHostEntryResponseSchema.parse(await res.json());
  return { answer, setCookies: res.headers.getSetCookie() };
}

/**
 * Which door renders: the path's own, except that Zitadel's arrival on
 * `/login` (a cross-site navigation) opens the door the entry chose — the
 * registration for `prompt=create`, the reset or login door an entry intent
 * named. A same-origin hop between doors is the person's own choice.
 */
export function doorFor(
  pathDoor: SignInHostPageDoor,
  render: SignInHostRender,
  secFetchSite: string | null,
): SignInHostPageDoor {
  if (pathDoor !== "login" || secFetchSite === "same-origin") return pathDoor;
  return render.door;
}
