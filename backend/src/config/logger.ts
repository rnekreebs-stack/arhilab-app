import pino from 'pino';
import { config } from './env.js';
export const logger = pino({ level: config.LOG_LEVEL, redact: {
  paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.accessToken', '*.refreshToken', '*.privateKey', 'config.DATABASE_URL'],
  censor: '[REDACTED]',
} });
