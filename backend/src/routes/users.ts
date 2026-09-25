import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { pool } from '../database/pool.js';
import { adminOnly, authenticate, identity, validateId } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { audit, hashPassword, revokeSessions, transaction } from '../services/security.js';
import { validateBody } from '../validation/request.js';
import * as schemas from '../validation/auth.js';
export const usersRouter = Router();
usersRouter.use(authenticate,adminOnly);
usersRouter.get('/',async (req,res) => {
  const ctx=identity(res), q=schemas.page.parse(req.query);
  const rows=await pool.query('SELECT id,email,display_name AS "displayName",role,active,created_at AS "createdAt" FROM users WHERE organization_id=$1 ORDER BY created_at,id LIMIT $2 OFFSET $3',[ctx.organizationId,q.limit,q.offset]);
  res.json({ users:rows.rows });
});
usersRouter.get('/:id',validateId,async (req,res) => {
  const ctx=identity(res), rows=await pool.query('SELECT id,email,display_name AS "displayName",role,active FROM users WHERE id=$1 AND organization_id=$2',[req.params.id,ctx.organizationId]);
  if (!rows.rows[0]) throw new HttpError(404,'Not found');
  res.json(rows.rows[0]);
});
usersRouter.post('/',validateBody(schemas.createUser),async (req,res) => {
  const ctx=identity(res), input=schemas.createUser.parse(req.body), id=randomUUID(), passwordHash=await hashPassword(input.password);
  await transaction(async client => {
    const exists=await client.query('SELECT id FROM users WHERE organization_id=$1 AND lower(email)=$2',[ctx.organizationId,input.email]);
    if (exists.rowCount) throw new HttpError(409,'Email already exists');
    await client.query('INSERT INTO users(id,organization_id,email,display_name,role,password_hash,must_change_password) VALUES($1,$2,$3,$4,$5,$6,true)',[id,ctx.organizationId,input.email,input.displayName,input.role,passwordHash]);
    await audit(client,ctx.organizationId,'employee.created',ctx.userId,ctx.deviceId,'user',id,{role:input.role});
  });
  res.status(201).json({id,email:input.email,displayName:input.displayName,role:input.role,active:true,mustChangePassword:true});
});
usersRouter.patch('/:id',validateId,validateBody(schemas.updateUser),async (req,res) => {
  const ctx=identity(res), targetId=String(req.params.id), input=schemas.updateUser.parse(req.body);
  const user=await transaction(async client => {
    await client.query('SELECT id FROM organizations WHERE id=$1 FOR NO KEY UPDATE',[ctx.organizationId]);
    const found=await client.query<{id:string;role:string;active:boolean;display_name:string;email:string}>('SELECT id,role,active,display_name,email FROM users WHERE id=$1 AND organization_id=$2 FOR NO KEY UPDATE',[targetId,ctx.organizationId]);
    const row=found.rows[0]; if (!row) throw new HttpError(404,'Not found');
    const role=input.role ?? row.role, active=input.active ?? row.active;
    if (row.active && row.role === 'admin' && (!active || role !== 'admin')) {
      const count=await client.query<{count:string}>("SELECT count(*)::text AS count FROM users WHERE organization_id=$1 AND role='admin' AND active",[ctx.organizationId]);
      if (Number(count.rows[0]?.count) <= 1) throw new HttpError(409,'Last active admin');
    }
    await client.query('UPDATE users SET display_name=$1,role=$2,active=$3,updated_at=now() WHERE id=$4',[input.displayName ?? row.display_name,role,active,targetId]);
    if (!active || role !== row.role) await revokeSessions(client,ctx.organizationId,targetId);
    if (role !== row.role) await audit(client,ctx.organizationId,'employee.role_changed',ctx.userId,ctx.deviceId,'user',targetId,{from:row.role,to:role});
    if (active !== row.active) await audit(client,ctx.organizationId,active?'employee.activated':'employee.deactivated',ctx.userId,ctx.deviceId,'user',targetId);
    return {id:row.id,email:row.email,displayName:input.displayName ?? row.display_name,role,active};
  });
  res.json(user);
});
usersRouter.post('/:id/revoke-sessions',validateId,async (req,res) => {
  const ctx=identity(res), targetId=String(req.params.id);
  await transaction(async client => {
    const found=await client.query('SELECT id FROM users WHERE id=$1 AND organization_id=$2',[targetId,ctx.organizationId]);
    if (!found.rowCount) throw new HttpError(404,'Not found');
    await revokeSessions(client,ctx.organizationId,targetId);
    await audit(client,ctx.organizationId,'sessions.revoked_all',ctx.userId,ctx.deviceId,'user',targetId);
  });
  res.sendStatus(204);
});
usersRouter.get('/:id/devices',validateId,async (req,res) => {
  const ctx=identity(res);
  const found=await pool.query('SELECT id FROM users WHERE id=$1 AND organization_id=$2',[req.params.id,ctx.organizationId]);
  if (!found.rowCount) throw new HttpError(404,'Not found');
  const rows=await pool.query('SELECT id,label,created_at AS "createdAt",last_seen_at AS "lastSeenAt",revoked_at AS "revokedAt" FROM devices WHERE organization_id=$1 AND user_id=$2 ORDER BY created_at,id',[ctx.organizationId,req.params.id]);
  res.json({devices:rows.rows});
});
