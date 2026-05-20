import { createZodDto } from 'nestjs-zod';
import { HealthResponseSchema } from '@ds/schemas';

export class HealthResponseDto extends createZodDto(HealthResponseSchema) {}
