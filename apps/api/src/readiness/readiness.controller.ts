import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { ReadinessService } from "./readiness.service.js";
import { ReadinessResponseDto } from "./readiness.dto.js";

@Controller({ path: "ready", version: "1" })
export class ReadinessController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get()
  async get(): Promise<ReadinessResponseDto> {
    const body = await this.readiness.check();
    if (body.status === "down") {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }
}
