/**
 * The shared event-storefront unit's MODEL entry: the completion-on-return
 * decision rule (005 EARS-2) that both storefronts project through their own
 * {@link ReturnHost}.
 *
 * The browser transport that carries the command itself (`registerForEvent`,
 * `RegistrationError`) is the `./client` entry, the progressive-enhancement
 * control is `./ui`, and the server-side read plus the no-JS form action are
 * `./server` — one entry per layer, so a host (and a host's test) can address
 * exactly the layer it projects.
 */
export {
  type ReturnHost,
  completeReturnTarget,
  currentReturnTarget,
} from "./client/registration-resume";
