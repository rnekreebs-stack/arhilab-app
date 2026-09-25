import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'pg';
import { config } from './config/env.js';
import { pool } from './database/pool.js';
import { requestContext } from './middleware/request.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { checkDatabase } from './services/health.js';

export function createApp(db: Pick<Pool, 'query'> = pool) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(requestContext);
  app.use(helmet());
  const origins = config.CORS_ORIGINS.split(',').map(v => v.trim()).filter(Boolean);
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || origins.includes(origin)) }));
  app.use(rateLimit({ windowMs: config.RATE_LIMIT_WINDOW_MS, limit: config.RATE_LIMIT_MAX, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use(express.json({ limit: config.BODY_LIMIT, strict: true }));
  app.get('/api/v1/health', async (_req, res) => {
    const connected = await checkDatabase(db);
    res.status(connected ? 200 : 503).json({ status: connected ? 'ok' : 'unavailable', apiVersion: 'v1', backendVersion: config.BACKEND_VERSION, database: connected ? 'connected' : 'unavailable', timestamp: new Date().toISOString() });
  });
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
