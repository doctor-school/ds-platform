import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@ds/schemas';
import { Authz, Public } from '../authz/index.js';

@Controller({ path: 'health', version: '1' })
export class HealthController {
  @Get()
  @Public()
  @Authz({ access: 'public', check: 'none', audit: 'none', tests: ['EARS-1'] })
  get(): HealthResponse {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
