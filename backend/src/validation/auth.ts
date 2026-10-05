import { z } from 'zod';
export const password = z.string().min(12).max(128);
export const uuid = z.uuid();
export const login = z.strictObject({ organizationId: uuid, email: z.email().max(254).transform(v => v.toLowerCase()), password: z.string().min(1).max(128), deviceId: uuid, deviceLabel: z.string().trim().min(1).max(100).optional() });
export const refresh = z.strictObject({ refreshToken: z.string().min(30).max(256) });
export const changePassword = z.strictObject({ currentPassword: z.string(), newPassword: password });
export const createUser = z.strictObject({ email: z.email().max(254).transform(v => v.toLowerCase()), displayName: z.string().trim().min(1).max(100), role: z.enum(['admin','manager','worker']), password });
export const updateUser = z.strictObject({ displayName: z.string().trim().min(1).max(100).optional(), role: z.enum(['admin','manager','worker']).optional(), active: z.boolean().optional() }).refine(v => Object.keys(v).length > 0);
export const page = z.strictObject({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) });
