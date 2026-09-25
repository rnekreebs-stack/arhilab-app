import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'pg';
import { config } from './config/env.js';
import { pool } from './database/pool.js';
import { requestContext } from './middleware/request.js';
import { errorHandler, notFound, rateLimitResponse } from './middleware/errors.js';
import { checkDatabase } from './services/health.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { devicesRouter } from './routes/devices.js';
import { syncRouter } from './sync/routes.js';
import { conflictsRouter } from './sync/conflicts.js';

export function createApp(db: Pick<Pool, 'query'> = pool) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(requestContext);
  app.use(helmet());
  const origins = config.CORS_ORIGINS.split(',').map(v => v.trim()).filter(Boolean);
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || origins.includes(origin)) }));
  app.use(rateLimit({ windowMs: config.RATE_LIMIT_WINDOW_MS, limit: config.RATE_LIMIT_MAX, standardHeaders: 'draft-8', legacyHeaders: false, handler:rateLimitResponse }));
  app.use(express.json({ limit: config.BODY_LIMIT, strict: true }));
  app.get('/api/v1/health', async (_req, res) => {
    const connected = await checkDatabase(db);
    res.status(connected ? 200 : 503).json({ status: connected ? 'ok' : 'unavailable', apiVersion: 'v1', backendVersion: config.BACKEND_VERSION, database: connected ? 'connected' : 'unavailable', timestamp: new Date().toISOString() });
  });
  app.use('/api/v1/auth',authRouter);
  app.use('/api/v1/users',usersRouter);
  app.use('/api/v1/devices',devicesRouter);
  app.use('/api/v1/sync',syncRouter);
  app.use('/api/v1/sync/conflicts',conflictsRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
