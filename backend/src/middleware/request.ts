import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { logger } from '../config/logger.js';
export const requestContext: RequestHandler = (req, res, next) => {
  const requestId = randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  const start = performance.now();
  res.on('finish', () => {
    logger.info({ requestId, route: req.path, method: req.method, status: res.statusCode, durationMs: Math.round(performance.now() - start) }, 'HTTP request');
  });
  next();
};
