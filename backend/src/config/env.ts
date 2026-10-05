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
  STORAGE_PROVIDER: z.enum(['filesystem','s3']).default('filesystem'),
  STORAGE_ROOT: z.string().min(1).default('/tmp/arhilab-objects'),
  STORAGE_ENDPOINT: z.url().optional(),
  STORAGE_BUCKET: z.string().min(1).optional(),
  STORAGE_REGION: z.string().min(1).default('us-east-1'),
  STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  MAX_PHOTO_BYTES: z.coerce.number().int().min(1).max(20000000).default(5000000),
  MAX_DOCUMENT_BYTES: z.coerce.number().int().min(1).max(50000000).default(15000000),
  FILE_INTENT_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(48),
});
export type Config = z.infer<typeof schema>;
export function parseConfig(input: NodeJS.ProcessEnv): Config {
  const parsed=schema.parse(input);
  if (parsed.STORAGE_PROVIDER==='s3' && (!parsed.STORAGE_BUCKET || !parsed.STORAGE_ACCESS_KEY_ID || !parsed.STORAGE_SECRET_ACCESS_KEY))
    throw new Error('S3 storage bucket and credentials are required');
  if (parsed.NODE_ENV==='production' && parsed.STORAGE_PROVIDER!=='s3') throw new Error('Production requires S3-compatible storage');
  return parsed;
}
export const config = parseConfig(process.env);
