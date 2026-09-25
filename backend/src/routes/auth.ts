import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import { validateBody } from '../validation/request.js';
import * as schemas from '../validation/auth.js';
import { HttpError } from '../middleware/errors.js';
import { authenticate, identity } from '../middleware/auth.js';
import { audit, generateToken, hashPassword, hashToken, issueSession, revokeSessions, transaction, verifyPassword } from '../services/security.js';
export const authRouter = Router();
const invalid = () => new HttpError(401,'Invalid credentials');
const dummyHash = hashPassword('unavailable dummy password for timing');
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.LOGIN_RATE_LIMIT_MAX, standardHeaders: 'draft-8', legacyHeaders: false, message: { error:'Too many attempts' } });
authRouter.post('/login',loginLimiter,validateBody(schemas.login),async (req,res) => {
  const input = schemas.login.parse(req.body);
  const result = await transaction(async client => {
    const found = await client.query<{id:string;password_hash:string|null;active:boolean;role:'admin'|'manager'|'worker'}>('SELECT id,password_hash,active,role FROM users WHERE organization_id=$1 AND lower(email)=$2 FOR UPDATE',[input.organizationId,input.email]);
    const user = found.rows[0];
    const valid = await verifyPassword(user?.password_hash ?? await dummyHash,input.password);
    if (!user || !valid || !user.active || !user.password_hash) {
      const org = await client.query('SELECT id FROM organizations WHERE id=$1',[input.organizationId]);
      if (org.rowCount) await audit(client,input.organizationId,'login.failure',null,null,'user',null);
      return null;
    }
    const device = await client.query<{user_id:string;revoked_at:Date|null}>('SELECT user_id,revoked_at FROM devices WHERE id=$1 FOR UPDATE',[input.deviceId]);
    if (device.rows.length && (device.rows[0]?.user_id !== user.id || device.rows[0]?.revoked_at)) {
      await audit(client,input.organizationId,'login.failure',user.id,null,'device',null);
      return null;
    }
    if (!device.rows.length) {
      await client.query('INSERT INTO devices(id,organization_id,user_id,label,last_seen_at) VALUES($1,$2,$3,$4,now())',[input.deviceId,input.organizationId,user.id,input.deviceLabel ?? null]);
      await audit(client,input.organizationId,'device.registered',user.id,input.deviceId,'device',input.deviceId);
    } else await client.query('UPDATE devices SET last_seen_at=now(),updated_at=now() WHERE id=$1',[input.deviceId]);
    const tokens = await issueSession(client,{ userId:user.id,organizationId:input.organizationId,role:user.role,deviceId:input.deviceId });
    await audit(client,input.organizationId,'login.success',user.id,input.deviceId,'session',tokens.sessionId);
    return { ...tokens, user:{ id:user.id,organizationId:input.organizationId,role:user.role },deviceId:input.deviceId };
  });
  if (!result) throw invalid();
  res.json(result);
});
authRouter.post('/refresh',validateBody(schemas.refresh),async (req,res) => {
  const { refreshToken } = schemas.refresh.parse(req.body);
  const result = await transaction(async client => {
    const found = await client.query<{id:string;organization_id:string;session_id:string;consumed_at:Date|null;revoked_at:Date|null;expires_at:Date;user_id:string;device_id:string;session_revoked:Date|null;session_expires:Date;active:boolean;device_revoked:Date|null}>(`SELECT r.id,r.organization_id,r.session_id,r.consumed_at,r.revoked_at,r.expires_at,s.user_id,s.device_id,s.revoked_at AS session_revoked,s.expires_at AS session_expires,u.active,d.revoked_at AS device_revoked FROM refresh_credentials r JOIN sessions s ON s.id=r.session_id JOIN users u ON u.id=s.user_id JOIN devices d ON d.id=s.device_id WHERE r.token_hash=$1 FOR UPDATE OF r,s`,[hashToken(refreshToken)]);
    const row = found.rows[0];
    if (!row) return null;
    if (row.consumed_at) {
      await client.query('UPDATE sessions SET revoked_at=now(),updated_at=now() WHERE id=$1 AND revoked_at IS NULL',[row.session_id]);
      await audit(client,row.organization_id,'refresh.reuse',row.user_id,row.device_id,'session',row.session_id);
      return null;
    }
    if (row.revoked_at || row.expires_at.getTime() <= Date.now() || row.session_revoked || row.session_expires.getTime() <= Date.now() || !row.active || row.device_revoked) return null;
    const accessToken = generateToken(), nextRefresh = generateToken(), expiresAt = new Date(Date.now()+15*60*1000);
    await client.query('UPDATE refresh_credentials SET consumed_at=now() WHERE id=$1',[row.id]);
    await client.query('INSERT INTO refresh_credentials(id,organization_id,session_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5)',[randomUUID(),row.organization_id,row.session_id,hashToken(nextRefresh),row.session_expires]);
    await client.query('UPDATE sessions SET access_hash=$1,access_expires_at=$2,updated_at=now() WHERE id=$3',[hashToken(accessToken),expiresAt,row.session_id]);
    await audit(client,row.organization_id,'refresh.success',row.user_id,row.device_id,'session',row.session_id);
    return { accessToken,refreshToken:nextRefresh,tokenType:'Bearer',expiresIn:900,refreshExpiresAt:row.session_expires.toISOString(),sessionId:row.session_id };
  });
  if (!result) throw invalid();
  res.json(result);
});
authRouter.post('/logout',authenticate,async (_req,res) => {
  const ctx=identity(res);
  await transaction(async client => { await client.query('UPDATE sessions SET revoked_at=now(),updated_at=now() WHERE id=$1',[ctx.sessionId]); await audit(client,ctx.organizationId,'logout',ctx.userId,ctx.deviceId,'session',ctx.sessionId); });
  res.sendStatus(204);
});
authRouter.post('/logout-all',authenticate,async (_req,res) => {
  const ctx=identity(res);
  await transaction(async client => { await revokeSessions(client,ctx.organizationId,ctx.userId); await audit(client,ctx.organizationId,'sessions.revoked_all',ctx.userId,ctx.deviceId,'user',ctx.userId); });
  res.sendStatus(204);
});
authRouter.post('/change-password',authenticate,validateBody(schemas.changePassword),async (req,res) => {
  const ctx=identity(res), input=schemas.changePassword.parse(req.body);
  await transaction(async client => {
    const found=await client.query<{password_hash:string|null}>('SELECT password_hash FROM users WHERE id=$1 AND organization_id=$2 FOR UPDATE',[ctx.userId,ctx.organizationId]);
    const hash=found.rows[0]?.password_hash;
    if (!hash || !await verifyPassword(hash,input.currentPassword)) throw invalid();
    await client.query('UPDATE users SET password_hash=$1,password_changed_at=now(),updated_at=now() WHERE id=$2',[await hashPassword(input.newPassword),ctx.userId]);
    await revokeSessions(client,ctx.organizationId,ctx.userId,ctx.sessionId);
    await audit(client,ctx.organizationId,'password.changed',ctx.userId,ctx.deviceId,'user',ctx.userId);
  });
  res.sendStatus(204);
});
