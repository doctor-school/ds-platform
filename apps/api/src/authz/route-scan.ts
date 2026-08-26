/**
 * Route-scan mode — the completeness gate's declaration that it is building the
 * module graph to ENUMERATE ROUTES, not to serve traffic.
 *
 * `scanRealRouteSet` boots the real `AppModule` on purpose (spec §6.1: the gate
 * must observe the route set that actually serves, not an AST parse), with
 * placeholder credentials, and never touches the database — the pg pool connects
 * lazily and route discovery issues no query. A module whose lifecycle hook DOES
 * issue a query (017's specialty-book seed) would turn that boot into a database
 * dependency and make a BLOCK-severity CI gate require a live Postgres.
 *
 * So the gate says what it is, once, here — and a bootstrap step that belongs to
 * a serving process skips itself. This is the same contract the gate's existing
 * `DATABASE_URL` / pepper / signing-secret placeholders express: satisfy
 * construction, perform no real work.
 *
 * It is deliberately NOT re-exported from `authz/index.ts`: it must stay
 * importable by feature modules without pulling the gate (which imports
 * `AppModule` and would cycle).
 */
export const ROUTE_SCAN_ENV = "DS_AUTHZ_ROUTE_SCAN";

/** Whether this process is the completeness gate's route scan. */
export function isRouteScan(): boolean {
  return process.env[ROUTE_SCAN_ENV] === "1";
}
