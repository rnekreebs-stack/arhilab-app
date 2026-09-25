import { z } from 'zod';
export const operationSchema = z.strictObject({
  operationId:z.uuid(),
  idempotencyKey:z.uuid(),
  entityType:z.string().min(1).max(50),
  entityId:z.uuid(),
  operationType:z.string().min(1).max(20),
  baseRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  payload:z.unknown(),
  occurredAt:z.iso.datetime(),
});
export type SyncOperation = z.infer<typeof operationSchema>;
export const pushSchema=z.strictObject({operations:z.array(operationSchema).min(1).max(50)});
export const pullSchema=z.strictObject({
  cursor:z.string().regex(/^(0|[1-9]\d{0,18})$/).default('0'),
  limit:z.coerce.number().int().min(1).max(100).default(50),
});
