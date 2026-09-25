import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';
export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export const notFound: RequestHandler = (_req, _res, next) => next(new HttpError(404, 'Not found'));
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const parserStatus = error instanceof Error && 'status' in error && typeof error.status === 'number' && error.status >= 400 && error.status < 500 ? error.status : 500;
  const status = error instanceof ZodError ? 400 : error instanceof HttpError ? error.status : parserStatus;
  const requestId: string = String(res.locals.requestId);
  if (status >= 500) logger.error({ errorType: error instanceof Error ? error.name : 'Unknown', requestId }, 'Request failed');
  const message = status === 500 ? 'Internal server error' : error instanceof HttpError ? error.message : 'Invalid request';
  const errorClass = status === 401 || status === 403 ? 'authorization' : status === 429 || status >= 500 ? 'retryable' : 'validation';
  res.status(status).json({ error: message, errorClass, requestId });
};
