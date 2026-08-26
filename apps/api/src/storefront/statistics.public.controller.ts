import { Controller, Get, Header, Inject } from "@nestjs/common";
import type { ScaleStatistics } from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import { StatisticsService } from "./statistics.service.js";

// 017 EARS-2 / LD-3 (#1480) — the ONE public read behind the four hero scale
// counters.
//
// Same public-surface pattern as the specialty book read: `@Public()` so the
// 003 authentication layer skips the subject requirement, `@Authz` as the SSOT
// the global guard, the completeness gate and the generated matrix all read.
//
// ONE `@Get` and nothing else. The figures are computed (LD-3), so there is no
// mutating verb to authorize — a POST finds no route at all rather than a 403
// that would imply an operator could type a counter in.
//
// `Cache-Control` states the same staleness the projection already accepts, so
// a CDN or a browser does not hold the figures materially longer than the
// server's own window.

@Controller({ path: "public/statistics", version: "1" })
export class StatisticsPublicController {
  // Explicit @Inject token — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(StatisticsService)
    private readonly statistics: StatisticsService,
  ) {}

  /** `GET /v1/public/statistics` — the computed scale figures + `computedAt`. */
  @Get()
  @Public()
  @Header("Cache-Control", "public, max-age=300")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-2"],
  })
  read(): Promise<ScaleStatistics> {
    return this.statistics.read();
  }
}
