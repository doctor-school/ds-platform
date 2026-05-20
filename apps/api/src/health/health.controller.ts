import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@ds/schemas';

@Controller({ path: 'health', version: '1' })
export class HealthController {
  @Get()
  get(): HealthResponse {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
