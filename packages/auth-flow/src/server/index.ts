/**
 * `@ds/auth-flow/server` - the SERVER half of the shared auth flow (#2027 PR
 * 1.4, wave-1 gate rows 22-31).
 *
 * A separate subpath rather than a separate package: these modules read the
 * incoming request and the process environment, and one of them hands a redirect
 * to Next, so none of them can ride into a browser bundle. `@ds/room/server` and
 * `@ds/events-storefront/server` draw the same line the same way, and that is
 * the repo convention.
 */
export {
  SESSION_COOKIE_NAME,
  fetchSessionClaims,
  forwardedHeaders,
  forwardedSessionFrom,
  hasSessionCookie,
  resolveServerAuth,
  serverApiBase,
  type ForwardedSession,
  type ServerAuth,
} from "./session";
export {
  guardAuthRoute,
  resolveAuthRouteGuard,
  type AuthRouteGuardDecision,
  type AuthRouteGuardInput,
} from "./auth-route-guard";
export { parkReturnTarget } from "./return-target-parking";
export {
  ENTRY_REFUSAL_HEADER,
  entryRefusalRewrite,
  entryRefusalStatus,
  parseRetryAfter,
  readEntryRefusal,
  writeEntryRefusal,
  type EntryRefusal,
  type EntryRefusalReason,
} from "./entry-refusal";
export {
  STOREFRONT_ENTRY_REFUSAL_ROUTE,
  storefrontDoorGate,
} from "./storefront-door-gate";
export {
  OIDC_TX_COOKIE,
  STOREFRONT_CALLBACK_PATH,
  storefrontCallback,
  storefrontEntry,
  type StorefrontEntry,
  type StorefrontEntryRefused,
  type StorefrontOidcDeps,
  type StorefrontOidcHost,
} from "./storefront-oidc";
export {
  CHECK_GUARD_COOKIE,
  GUEST_MARKER_COOKIE,
  GUEST_QUERY_FLAG,
  storefrontSilentCheck,
  type SilentCheckDeps,
  type SilentCheckHost,
  type SilentCheckOutcome,
} from "./silent-check";
export { resolveOwnHandoff } from "./handoff-ownership";
export { isTopLevelNavigation } from "./top-level-navigation";
/**
 * Row 32 / #1987 - the account shape of the LANDING codec. It rides on the
 * server subpath because its only consumers are the hosts' server-side landing
 * resolvers, which decide where a signed-in visitor is sent before paint; the
 * codec itself is pure and framework-free.
 */
export { parseAccountReturnTarget } from "../return-target";
export {
  RETURN_CONTEXT_PARAM,
  isAccountReturnTarget,
  isLandOnlyReturnTarget,
  isRoomReturnTarget,
  readReturnEvent,
  resolveCarriedReturnTarget,
  resolveReturnContext,
  resolveReturnLandingPath,
  resolveReturnTargetPath,
  toReturnContextEvent,
  withReturnContext,
  type ReturnContextEvent,
  type ReturnEventRead,
} from "./return-context";
export {
  NO_SPECIALTY_CHOICE,
  resolveArrivalLanding,
  resolveDirectArrivalLanding,
  resolveRememberedSpecialty,
  type RememberedSpecialty,
  type SpecialtyActor,
  type SpecialtyAwareLanding,
} from "./landing";
export {
  SIGN_IN_HOST_AUTH_REQUEST_PARAM,
  SIGN_IN_HOST_ENTRY_HEADER,
  readSignInHostHandOver,
  signInHostConfig,
  signInHostSearchParams,
  writeSignInHostHandOver,
  type SignInHostHandOver,
  type SignInHostPageDoor,
  type SignInHostRender,
  type SignInHostStorefronts,
} from "./sign-in-host";
