import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Put,
} from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import {
  type CongressIntakeSettings,
  CongressIntakeSettingsRequestSchema,
  CongressIntakeSettingsSchema,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import { CongressIntakeSettingsService } from "./congress-intake-settings.service.js";

/** Body of the intake-settings save (046 EARS-2, EARS-3). */
export class CongressIntakeSettingsRequestDto extends createZodDto(
  CongressIntakeSettingsRequestSchema,
) {}

/** The intake settings of one event (046 EARS-1, EARS-2). */
export class CongressIntakeSettingsDto extends createZodDto(
  CongressIntakeSettingsSchema,
) {}

/**
 * 046 EARS-1…EARS-3 (#2432) — the platform administrator's congress intake
 * settings per event, `GET` / `PUT /v1/admin/events/:id/congress-intake-settings`.
 *
 * Lives in the congress module rather than on the 007 events surface: the
 * settings are the congress intake's own platform data, read by the cabinet
 * and the send check that land in this module next (046 S2), so the storage,
 * its rules and its admin route stay together.
 *
 * `platform_admin` only, role fast-path (EARS-2: only the platform
 * administrator reaches this screen and its endpoints). The write revalidates
 * live (#1304 default-deny for a new admin mutation); the 010 triggers
 * attribute its ledger rows to the acting administrator.
 */
@Controller({ path: "admin/events", version: "1" })
export class CongressIntakeSettingsAdminController {
  // Explicit @Inject tokens — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(CongressIntakeSettingsService)
    private readonly settings: CongressIntakeSettingsService,
  ) {}

  /**
   * 200 with the event's settings, or the product defaults with
   * `configured: false` while it has none; 404 for an unknown event.
   */
  @Get(":id/congress-intake-settings")
  @ApiOkResponse({ type: CongressIntakeSettingsDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "low-stakes",
    tests: ["EARS-2"],
  })
  async read(@Param("id") id: string): Promise<CongressIntakeSettings> {
    return this.settings.read(id);
  }

  /**
   * Create-or-replace the event's settings. 200 with the saved settings; 400 for
   * an opening day without a last day, a last day before the opening day, a
   * limit that is not a positive integer or an age limit outside 18…99; 404 for
   * an unknown event.
   */
  @Put(":id/congress-intake-settings")
  @HttpCode(200)
  @ApiOkResponse({ type: CongressIntakeSettingsDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // A `platform_admin` authoring write — no AuthAuditLog emission; its trail
    // is the 010 universal-edit-audit rows of the two settings tables.
    audit: "low-stakes",
    // #1304 default-deny: a brand-new admin mutation revalidates live.
    revalidate: "live",
    tests: ["EARS-1", "EARS-2", "EARS-3"],
  })
  async save(
    @Param("id") id: string,
    @Body() dto: CongressIntakeSettingsRequestDto,
  ): Promise<CongressIntakeSettings> {
    return this.settings.save(id, dto);
  }
}
