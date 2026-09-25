import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGINS: z.string().default(''),
  BODY_LIMIT: z.string().regex(/^\d+(b|kb|mb)$/i).default('1mb'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  BACKEND_VERSION: z.string().default('0.7.0-dev.1'),
});
export type Config = z.infer<typeof schema>;
export function parseConfig(input: NodeJS.ProcessEnv): Config {
  return schema.parse(input);
}
export const config = parseConfig(process.env);
