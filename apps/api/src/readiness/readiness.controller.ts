import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { ReadinessService } from "./readiness.service.js";
import { ReadinessResponseDto } from "./readiness.dto.js";
import { Authz, Public } from "../authz/index.js";

@Controller({ path: "ready", version: "1" })
export class ReadinessController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get()
  @Public()
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-1", "EARS-2"],
  })
  async get(): Promise<ReadinessResponseDto> {
    const body = await this.readiness.check();
    if (body.status === "down") {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }
}
