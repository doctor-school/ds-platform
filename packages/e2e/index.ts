/**
 * `@ds/e2e` public surface — the end-to-end regression contract (C6) of the
 * staging/regression-contour tech spec §6 (Issue #2067). The step definitions
 * (`steps/`) and the derived walks (`derived/`) are Playwright entry points and
 * are NOT re-exported here: importing them outside a Playwright run registers
 * fixtures against no test instance.
 */
export {
  byId,
  itemsFor,
  landingEvidence,
  type Audience,
  type LandingEvidence,
  type NavigationItem,
  type NavigationLanding,
  type NavigationModel,
  type Visitor,
} from "./navigation-model.js";
export {
  HOSTS,
  HOST_IDS,
  HostConfigError,
  baseUrlFor,
  hostById,
  loadNavigationModel,
  type HostConfig,
  type HostId,
} from "./hosts.js";
export {
  routeParams,
  type RouteParamResolver,
  type RouteParamsMap,
  type RoutePattern,
} from "./route-params.js";
