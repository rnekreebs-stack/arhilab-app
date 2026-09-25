import { createHash, randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type { PoolClient } from 'pg';
import { pool } from '../database/pool.js';
export const ACCESS_MS = 15 * 60 * 1000;
export const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const generateToken = () => randomBytes(32).toString('base64url');
export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = async (hash: string, password: string) => argon2.verify(hash, password);
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export type Identity = { userId: string; organizationId: string; role: 'admin'|'manager'|'worker'; deviceId: string; sessionId: string; mustChangePassword: boolean };
export async function audit(client: PoolClient, organizationId: string, action: string, actorId: string | null, deviceId: string | null, targetType: string, targetId: string | null, metadata: Record<string, string> = {}) {
  await client.query('INSERT INTO audit_logs(id,organization_id,user_id,device_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(),organizationId,actorId,deviceId,action,targetType,targetId,JSON.stringify(metadata)]);
}
export async function issueSession(client: PoolClient, identity: Pick<Identity,'userId'|'organizationId'|'deviceId'>) {
  const sessionId = randomUUID(), accessToken = generateToken(), refreshToken = generateToken();
  const accessExpiresAt = new Date(Date.now() + ACCESS_MS), refreshExpiresAt = new Date(Date.now() + REFRESH_MS);
  await client.query('INSERT INTO sessions(id,organization_id,user_id,device_id,access_hash,access_expires_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [sessionId,identity.organizationId,identity.userId,identity.deviceId,hashToken(accessToken),accessExpiresAt,refreshExpiresAt]);
  await client.query('INSERT INTO refresh_credentials(id,organization_id,session_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5)', [randomUUID(),identity.organizationId,sessionId,hashToken(refreshToken),refreshExpiresAt]);
  return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: ACCESS_MS / 1000, refreshExpiresAt: refreshExpiresAt.toISOString(), sessionId };
}
export async function revokeSessions(client: PoolClient, organizationId: string, userId: string, exceptSessionId?: string) {
  await client.query('UPDATE sessions SET revoked_at=now(),updated_at=now() WHERE organization_id=$1 AND user_id=$2 AND revoked_at IS NULL AND id <> $3', [organizationId,userId,exceptSessionId ?? '00000000-0000-0000-0000-000000000000']);
}
