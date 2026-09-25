import type { RequestHandler } from 'express';
import { pool } from '../database/pool.js';
import { HttpError } from './errors.js';
import { hashToken, type Identity } from '../services/security.js';
import { uuid } from '../validation/auth.js';
declare module 'express-serve-static-core' { interface Locals { identity?: Identity } }
export const authenticate: RequestHandler = async (req,res,next) => {
  try {
    const match = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(req.get('authorization') ?? '');
    if (!match?.[1]) throw new HttpError(401,'Unauthorized');
    const rows = await pool.query<{ user_id:string;organization_id:string;role:Identity['role'];device_id:string;session_id:string }>(`SELECT s.user_id,s.organization_id,u.role,s.device_id,s.id AS session_id FROM sessions s JOIN users u ON u.id=s.user_id AND u.organization_id=s.organization_id JOIN devices d ON d.id=s.device_id AND d.organization_id=s.organization_id WHERE s.access_hash=$1 AND s.access_expires_at>now() AND s.expires_at>now() AND s.revoked_at IS NULL AND u.active AND d.revoked_at IS NULL`,[hashToken(match[1])]);
    const row = rows.rows[0];
    if (!row) throw new HttpError(401,'Unauthorized');
    res.locals.identity = { userId:row.user_id,organizationId:row.organization_id,role:row.role,deviceId:row.device_id,sessionId:row.session_id };
    next();
  } catch(error) { next(error); }
};
export const adminOnly: RequestHandler = (_req,res,next) => res.locals.identity?.role === 'admin' ? next() : next(new HttpError(403,'Forbidden'));
export function identity(res: {locals: {identity?: Identity}}): Identity {
  if (!res.locals.identity) throw new HttpError(401,'Unauthorized');
  return res.locals.identity;
}
export const validateId: RequestHandler = (req,_res,next) => uuid.safeParse(req.params.id).success ? next() : next(new HttpError(400,'Invalid ID'));
