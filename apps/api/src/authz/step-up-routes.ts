import { Inject, Injectable } from "@nestjs/common";
import { DiscoveryService, Reflector } from "@nestjs/core";
import { collectAuthzRowsFrom } from "./authz.discovery.js";

/**
 * 047 EARS-8 — the set of routes that declare `@Authz({ stepUp: true })`, as
 * `"<METHOD> <route>"` (the endpoint-authz matrix's own key, e.g.
 * `"POST /v1/admin/staff-access/grants"`).
 *
 * `POST /v1/admin/auth/mfa/reverify` accepts an `endpoint` only when it is in
 * this set, so an `auth.step_up.*` row can only ever name a real step-up route.
 * The set is read from the ONE `@Authz` registry the matrix, `AuthzGuard` and
 * `AdminAuthorityGuard` read — never a second hand-kept list — and computed once,
 * on first use, after every controller is instantiated.
 */
@Injectable()
export class StepUpRoutes {
  private routes: ReadonlySet<string> | undefined;

  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  has(endpoint: string): boolean {
    this.routes ??= new Set(
      collectAuthzRowsFrom(this.discovery, this.reflector)
        .rows.filter((row) => row.meta.stepUp === true)
        .map((row) => row.endpoint),
    );
    return this.routes.has(endpoint);
  }
}
