import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../database/pool.js';
import { authenticate, adminOnly, identity, validateId } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { assertCurrentAdmin, audit, transaction } from '../services/security.js';
import { validateBody } from '../validation/request.js';
import { parsePayload, specification, type EntityType } from './registry.js';
import { applyResolution } from './service.js';

type ConflictRow={id:string;organization_id:string;entity_type:string;entity_id:string;source_device_id:string;source_user_id:string;source_sync_operation_id:string;base_revision:string;server_revision_at_conflict:string;client_operation_type:'create'|'update'|'delete';client_proposal:Record<string,unknown>;server_snapshot:Record<string,unknown>;status:'open'|'resolved';created_at:Date;resolved_at:Date|null;resolved_by_user_id:string|null;resolution_type:string|null;resolution_resulting_revision:string|null};
const listing=z.strictObject({status:z.enum(['open','resolved']).optional(),entityType:z.string().max(50).optional(),entityId:z.uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).default(0)});
const resolution=z.strictObject({type:z.enum(['keep_server','apply_client','manual_merge']),expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),payload:z.unknown().optional()});
const dto=(c:ConflictRow)=>({id:c.id,entityType:c.entity_type,entityId:c.entity_id,sourceDeviceId:c.source_device_id,sourceUserId:c.source_user_id,operationId:c.source_sync_operation_id,baseRevision:Number(c.base_revision),serverRevisionAtConflict:Number(c.server_revision_at_conflict),clientOperationType:c.client_operation_type,clientProposal:c.client_proposal,serverSnapshot:c.server_snapshot,status:c.status,createdAt:c.created_at.toISOString(),resolvedAt:c.resolved_at?.toISOString()??null,resolvedByUserId:c.resolved_by_user_id,resolutionType:c.resolution_type,resultingRevision:c.resolution_resulting_revision===null?null:Number(c.resolution_resulting_revision)});
export const conflictsRouter=Router();
conflictsRouter.use(authenticate,adminOnly);
conflictsRouter.get('/',async(req,res)=>{
  const ctx=identity(res),q=listing.parse(req.query);
  const rows=await pool.query<ConflictRow>(`SELECT * FROM sync_conflicts WHERE organization_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR entity_type=$3) AND ($4::uuid IS NULL OR entity_id=$4) ORDER BY created_at,id LIMIT $5 OFFSET $6`,[ctx.organizationId,q.status??null,q.entityType??null,q.entityId??null,q.limit,q.offset]);
  res.json({conflicts:rows.rows.map(dto),limit:q.limit,offset:q.offset});
});
conflictsRouter.get('/:id',validateId,async(req,res)=>{
  const ctx=identity(res),rows=await pool.query<ConflictRow>('SELECT * FROM sync_conflicts WHERE organization_id=$1 AND id=$2',[ctx.organizationId,req.params.id]);
  if(!rows.rows[0]) throw new HttpError(404,'Not found');
  res.json(dto(rows.rows[0]));
});
conflictsRouter.post('/:id/resolve',validateId,validateBody(resolution),async(req,res)=>{
  const ctx=identity(res),input=resolution.parse(req.body);
  const result=await transaction(async client=>{
    await client.query('SELECT id FROM organizations WHERE id=$1 FOR NO KEY UPDATE',[ctx.organizationId]);
    await assertCurrentAdmin(client,ctx);
    const rows=await client.query<ConflictRow>('SELECT * FROM sync_conflicts WHERE organization_id=$1 AND id=$2 FOR UPDATE',[ctx.organizationId,req.params.id]);
    const c=rows.rows[0];if(!c) throw new HttpError(404,'Not found');
    if(c.status!=='open') throw new HttpError(409,'Conflict already resolved','already_resolved');
    const spec=specification(c.entity_type);if(!spec) throw new HttpError(400,'Unsupported entity','unsupported_entity');
    const current=await client.query<{revision:string;deleted_at:Date|null}>(`SELECT revision,deleted_at FROM ${spec.table} WHERE id=$1 AND organization_id=$2 FOR NO KEY UPDATE`,[c.entity_id,ctx.organizationId]);
    if(!current.rows[0]||Number(current.rows[0].revision)!==input.expectedRevision) throw new HttpError(409,'Resolution stale','resolution_stale');
    if(input.type==='apply_client' && input.payload!==undefined || input.type==='keep_server' && input.payload!==undefined) throw new HttpError(400,'Unexpected payload');
    let resultingRevision:number|null=null;
    if(input.type!=='keep_server') {
      const kind=input.type==='apply_client' && c.client_operation_type==='delete'?'delete':'update';
      const payload=input.type==='apply_client'?c.client_proposal:input.payload;
      const parsed=parsePayload(c.entity_type as EntityType,kind,payload);
      if(!parsed) throw new HttpError(400,'Invalid resolution payload','invalid_payload');
      if(current.rows[0].deleted_at) throw new HttpError(409,'Deleted entity cannot be resurrected','resolution_stale');
      resultingRevision=await applyResolution(client,ctx,c.entity_type,c.entity_id,kind,parsed,input.expectedRevision) ?? null;
    }
    await client.query(`UPDATE sync_conflicts SET status='resolved',resolved_at=now(),resolved_by_user_id=$1,resolution_type=$2,resolution_resulting_revision=$3 WHERE id=$4`,[ctx.userId,input.type,resultingRevision,c.id]);
    await audit(client,ctx.organizationId,'conflict.resolved',ctx.userId,ctx.deviceId,'sync_conflict',c.id,{resolutionType:input.type,entityType:c.entity_type,entityId:c.entity_id});
    return {id:c.id,status:'resolved',resolutionType:input.type,resultingRevision};
  });
  res.json(result);
});
