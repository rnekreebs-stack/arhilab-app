import { createHash,randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { pool } from '../database/pool.js';
import { authenticate,adminOnly,identity,validateId } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { assertCurrentAdmin,audit,transaction,type Identity } from '../services/security.js';
import { validateBody } from '../validation/request.js';
import { canonical } from '../sync/canonical.js';
import { packageSchema,legacyProject,inspectPackage,packageHash,type LegacyPackage,type MigrationIssue } from './package.js';
import { projection,importProjection,targetHasData,collidingIds } from './projection.js';

const create=z.strictObject({id:z.uuid(),packageHash:z.string().regex(/^[0-9a-f]{64}$/),expectedChunks:z.number().int().min(1).max(100),
  sourceFormat:z.literal('Arhilab-2'),sourceAppVersion:z.literal('0.6.2'),sourceSchemaVersion:z.literal(2),exportedAt:z.iso.datetime(),
  catalog:packageSchema.shape.catalog,team:packageSchema.shape.team});
const chunk=z.strictObject({projects:z.array(legacyProject).max(50)});
const currency=z.strictObject({currency:z.string().regex(/^[A-Z]{3}$/)});
type Session={id:string;organization_id:string;source_format:'Arhilab-2';source_app_version:'0.6.2';source_schema_version:2;package_hash:string;expected_chunks:number;status:string;counts:Record<string,unknown>;blocking_issue_count:number;verified_at:Date|null;finalized_at:Date|null};
type Issue={id:string;session_id:string;severity:string;code:string;legacy_entity_type:string;legacy_entity_id:string|null;field:string;resolved_at:Date|null;resolution:{currency:string}|null};
const sha=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
async function locked(client:PoolClient,ctx:Identity,id:string) {
  await client.query('SELECT id FROM organizations WHERE id=$1 FOR NO KEY UPDATE',[ctx.organizationId]);
  await assertCurrentAdmin(client,ctx);
  const r=await client.query<Session>('SELECT * FROM migration_sessions WHERE organization_id=$1 AND id=$2 FOR UPDATE',[ctx.organizationId,id]);
  if(!r.rows[0]) throw new HttpError(404,'Not found');
  return r.rows[0];
}
async function assembled(client:PoolClient,s:Session) {
  const rows=await client.query<{chunk_index:number;projects:LegacyPackage['projects']}>('SELECT chunk_index,projects FROM migration_chunks WHERE session_id=$1 ORDER BY chunk_index',[s.id]);
  if(rows.rows.length!==s.expected_chunks || rows.rows.some((r,i)=>r.chunk_index!==i)) throw new HttpError(409,'Missing chunks','missing_chunks');
  const pkg=packageSchema.parse({format:'ArhilabMigration-1',sourceFormat:s.source_format,sourceAppVersion:s.source_app_version,
    sourceSchemaVersion:s.source_schema_version,exportedAt:s.counts.exportedAt,
    ...(s.counts.catalog===undefined?{}:{catalog:s.counts.catalog}),...(s.counts.team===undefined?{}:{team:s.counts.team}),
    projects:rows.rows.flatMap(r=>r.projects)});
  if(packageHash(pkg)!==s.package_hash) throw new HttpError(409,'Package hash mismatch','package_hash_mismatch');
  return pkg;
}
async function saveIssues(client:PoolClient,id:string,issues:MigrationIssue[]) {
  for(const item of issues) await client.query('INSERT INTO migration_issues(id,session_id,severity,code,legacy_entity_type,legacy_entity_id,field,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
    [randomUUID(),id,item.severity,item.code,item.legacyEntityType,item.legacyEntityId,item.field,JSON.stringify(item.details)]);
}
export const migrationRouter=Router();
migrationRouter.use(authenticate,adminOnly);
migrationRouter.post('/preflight',validateBody(packageSchema),async(req,res)=>{
  const ctx=identity(res),pkg=packageSchema.parse(req.body),result=inspectPackage(pkg),client=await pool.connect();
  try {
    if(await targetHasData(client,ctx.organizationId)) result.issues.push({severity:'blocking',code:'target_not_empty',legacyEntityType:'organization',legacyEntityId:null,field:'projects',details:{}});
    for(const id of await collidingIds(client,projection(pkg,new Map()))) result.issues.push({severity:'blocking',code:'target_uuid_collision',legacyEntityType:'entity',legacyEntityId:id,field:'id',details:{}});
  } finally {client.release();}
  res.json({valid:!result.issues.some(i=>i.severity==='blocking'),packageHash:packageHash(pkg),counts:result.counts,issues:result.issues});
});
migrationRouter.post('/',validateBody(create),async(req,res)=>{
  const ctx=identity(res),input=create.parse(req.body);
  const result=await transaction(async client=>{
    await client.query('SELECT id FROM organizations WHERE id=$1 FOR NO KEY UPDATE',[ctx.organizationId]);await assertCurrentAdmin(client,ctx);
    const found=await client.query<Session>('SELECT * FROM migration_sessions WHERE organization_id=$1 AND package_hash=$2',[ctx.organizationId,input.packageHash]);
    if(found.rows[0]) {
      if(found.rows[0].id!==input.id || found.rows[0].expected_chunks!==input.expectedChunks ||
        found.rows[0].counts.exportedAt!==input.exportedAt || sha(found.rows[0].counts.catalog??null)!==sha(input.catalog??null) || sha(found.rows[0].counts.team??null)!==sha(input.team??null))
        throw new HttpError(409,'Package already registered','package_already_registered');
      return {id:input.id,status:found.rows[0].status,duplicate:true};
    }
    const existingId=await client.query('SELECT 1 FROM migration_sessions WHERE id=$1',[input.id]);
    if(existingId.rowCount) throw new HttpError(409,'Migration ID already registered','migration_id_reused');
    await client.query(`INSERT INTO migration_sessions(id,organization_id,initiated_by_user_id,source_device_id,source_format,source_app_version,source_schema_version,package_hash,expected_chunks,counts)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[input.id,ctx.organizationId,ctx.userId,ctx.deviceId,input.sourceFormat,input.sourceAppVersion,input.sourceSchemaVersion,input.packageHash,input.expectedChunks,JSON.stringify({exportedAt:input.exportedAt,catalog:input.catalog,team:input.team})]);
    await audit(client,ctx.organizationId,'migration.created',ctx.userId,ctx.deviceId,'migration_session',input.id);
    return {id:input.id,status:'created'};
  });
  res.status(201).json(result);
});
migrationRouter.get('/:id',validateId,async(req,res)=>{
  const ctx=identity(res),r=await pool.query<Session>('SELECT * FROM migration_sessions WHERE organization_id=$1 AND id=$2',[ctx.organizationId,req.params.id]);
  const s=r.rows[0];if(!s) throw new HttpError(404,'Not found');
  const chunks=await pool.query<{chunk_index:number}>('SELECT chunk_index FROM migration_chunks WHERE session_id=$1 ORDER BY chunk_index',[s.id]);
  res.json({id:s.id,status:s.status,packageHash:s.package_hash,expectedChunks:s.expected_chunks,receivedChunks:chunks.rows.map(x=>x.chunk_index),counts:s.counts,blockingIssueCount:s.blocking_issue_count,verifiedAt:s.verified_at?.toISOString()??null,finalizedAt:s.finalized_at?.toISOString()??null});
});
migrationRouter.put('/:id/chunks/:index',validateId,validateBody(chunk),async(req,res)=>{
  const ctx=identity(res),projects=chunk.parse(req.body).projects,index=Number(req.params.index);
  if(!Number.isInteger(index)||index<0) throw new HttpError(400,'Invalid chunk index');
  const hash=sha(projects);
  const result=await transaction(async client=>{
    const s=await locked(client,ctx,String(req.params.id));
    if(['cancelled','completed','ready_to_finalize'].includes(s.status)) throw new HttpError(409,'Migration closed','migration_closed');
    if(index>=s.expected_chunks) throw new HttpError(400,'Chunk index outside package');
    const existing=await client.query<{content_hash:string}>('SELECT content_hash FROM migration_chunks WHERE session_id=$1 AND chunk_index=$2',[s.id,index]);
    if(existing.rows[0]) {
      if(existing.rows[0].content_hash!==hash) throw new HttpError(409,'Chunk hash mismatch','chunk_hash_mismatch');
      return {index,status:'duplicate',hash};
    }
    await client.query('INSERT INTO migration_chunks(session_id,chunk_index,content_hash,projects) VALUES($1,$2,$3,$4)',[s.id,index,hash,JSON.stringify(projects)]);
    await client.query("UPDATE migration_sessions SET status='importing',updated_at=now() WHERE id=$1",[s.id]);
    return {index,status:'accepted',hash};
  });
  res.json(result);
});
migrationRouter.get('/:id/issues',validateId,async(req,res)=>{
  const ctx=identity(res),s=await pool.query('SELECT 1 FROM migration_sessions WHERE organization_id=$1 AND id=$2',[ctx.organizationId,req.params.id]);
  if(!s.rowCount) throw new HttpError(404,'Not found');
  const r=await pool.query<Issue>('SELECT * FROM migration_issues WHERE session_id=$1 ORDER BY severity,code,legacy_entity_id,id',[req.params.id]);
  res.json({issues:r.rows.map(i=>({id:i.id,severity:i.severity,code:i.code,legacyEntityId:i.legacy_entity_id,field:i.field,resolvedAt:i.resolved_at?.toISOString()??null,resolution:i.resolution}))});
});
migrationRouter.post('/:id/issues/:issueId/resolve',validateId,validateBody(currency),async(req,res)=>{
  const ctx=identity(res),input=currency.parse(req.body),issueId=z.uuid().parse(req.params.issueId);
  const result=await transaction(async client=>{
    const s=await locked(client,ctx,String(req.params.id));
    if(['completed','cancelled'].includes(s.status)) throw new HttpError(409,'Migration closed','migration_closed');
    const r=await client.query<Issue>('SELECT * FROM migration_issues WHERE session_id=$1 AND id=$2 FOR UPDATE',[s.id,issueId]);
    const i=r.rows[0];if(!i) throw new HttpError(404,'Not found');
    if(i.code!=='payment_currency_required') throw new HttpError(400,'Unsupported issue resolution','unsupported_issue_resolution');
    if(i.resolved_at) {
      if(i.resolution?.currency!==input.currency) throw new HttpError(409,'Issue resolved differently','issue_already_resolved');
      return {id:i.id,status:'duplicate',currency:input.currency};
    }
    await client.query('UPDATE migration_issues SET resolved_at=now(),resolution=$1 WHERE id=$2',[JSON.stringify(input),i.id]);
    await audit(client,ctx.organizationId,'migration.issue_resolved',ctx.userId,ctx.deviceId,'migration_issue',i.id,{code:i.code,currency:input.currency});
    return {id:i.id,status:'resolved',currency:input.currency};
  });
  res.json(result);
});
migrationRouter.post('/:id/verify',validateId,async(req,res)=>{
  const ctx=identity(res);
  const report=await transaction(async client=>{
    const s=await locked(client,ctx,String(req.params.id));
    if(['completed','cancelled'].includes(s.status)) throw new HttpError(409,'Migration closed','migration_closed');
    const pkg=await assembled(client,s),checked=inspectPackage(pkg);
    const archived=await client.query('SELECT 1 FROM migration_legacy_snapshots WHERE session_id=$1',[s.id]);
    if(!archived.rowCount) {
      await client.query(`INSERT INTO migration_legacy_snapshots(session_id,organization_id,source_format,source_app_version,source_schema_version,package_hash,business_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[s.id,ctx.organizationId,s.source_format,s.source_app_version,s.source_schema_version,s.package_hash,JSON.stringify(pkg)]);
      await saveIssues(client,s.id,checked.issues);
      if(await targetHasData(client,ctx.organizationId)) await saveIssues(client,s.id,[{severity:'blocking',code:'target_not_empty',legacyEntityType:'organization',legacyEntityId:null,field:'projects',details:{}}]);
      for(const id of await collidingIds(client,projection(pkg,new Map())))
        await saveIssues(client,s.id,[{severity:'blocking',code:'target_uuid_collision',legacyEntityType:'entity',legacyEntityId:id,field:'id',details:{}}]);
    }
    const issues=await client.query<Issue>('SELECT * FROM migration_issues WHERE session_id=$1',[s.id]);
    const currencies=new Map(issues.rows.filter(i=>i.code==='payment_currency_required'&&i.resolution?.currency).map(i=>[i.legacy_entity_id!,i.resolution!.currency]));
    const collisions=await collidingIds(client,projection(pkg,currencies));
    for(const id of collisions.filter(id=>!issues.rows.some(i=>i.code==='target_uuid_collision'&&i.legacy_entity_id===id)))
      await saveIssues(client,s.id,[{severity:'blocking',code:'target_uuid_collision',legacyEntityType:'entity',legacyEntityId:id,field:'id',details:{}}]);
    const blocking=(await client.query<{count:string}>("SELECT count(*) FROM migration_issues WHERE session_id=$1 AND severity='blocking' AND resolved_at IS NULL",[s.id])).rows[0]?.count??'0';
    const status=Number(blocking)?'verification_failed':'ready_to_finalize';
    await client.query('UPDATE migration_sessions SET status=$1,counts=$2,blocking_issue_count=$3,verified_at=now(),updated_at=now() WHERE id=$4',[status,JSON.stringify({...s.counts,...checked.counts}),blocking,s.id]);
    await audit(client,ctx.organizationId,blocking?'migration.verification_failed':'migration.verified',ctx.userId,ctx.deviceId,'migration_session',s.id,{blocking:String(blocking)});
    return {id:s.id,status,counts:checked.counts,blockingIssueCount:blocking,packageHash:s.package_hash};
  });
  res.json(report);
});
migrationRouter.post('/:id/finalize',validateId,async(req,res)=>{
  const ctx=identity(res);
  const result=await transaction(async client=>{
    const s=await locked(client,ctx,String(req.params.id));
    if(s.status==='completed') return {id:s.id,status:'completed',duplicate:true};
    if(s.status!=='ready_to_finalize'||s.blocking_issue_count) throw new HttpError(409,'Verification required','cannot_finalize');
    const stored=await client.query<{business_snapshot:unknown}>('SELECT business_snapshot FROM migration_legacy_snapshots WHERE session_id=$1',[s.id]);
    const pkg=packageSchema.parse(stored.rows[0]?.business_snapshot);
    if(packageHash(pkg)!==s.package_hash) throw new HttpError(409,'Snapshot mismatch','snapshot_mismatch');
    const issues=await client.query<Issue>('SELECT * FROM migration_issues WHERE session_id=$1',[s.id]);
    if(issues.rows.some(i=>i.severity==='blocking'&&!i.resolved_at)) throw new HttpError(409,'Unresolved issue','cannot_finalize');
    const currencies=new Map(issues.rows.filter(i=>i.code==='payment_currency_required'&&i.resolution?.currency).map(i=>[i.legacy_entity_id!,i.resolution!.currency]));
    const items=projection(pkg,currencies);
    if(await targetHasData(client,ctx.organizationId)||(await collidingIds(client,items)).length) throw new HttpError(409,'Target changed','target_collision');
    await importProjection(client,ctx,s.id,items);
    await client.query("UPDATE migration_sessions SET status='completed',finalized_at=now(),updated_at=now() WHERE id=$1",[s.id]);
    await audit(client,ctx.organizationId,'migration.finalized',ctx.userId,ctx.deviceId,'migration_session',s.id,{entities:String(items.length)});
    return {id:s.id,status:'completed',imported:items.length};
  });
  res.json(result);
});
migrationRouter.post('/:id/cancel',validateId,async(req,res)=>{
  const ctx=identity(res);
  const result=await transaction(async client=>{
    const s=await locked(client,ctx,String(req.params.id));
    if(s.status==='completed') throw new HttpError(409,'Completed migration cannot be cancelled','migration_completed');
    if(s.status==='cancelled') return {id:s.id,status:'cancelled',duplicate:true};
    // Chunks are staged; no business rows exist before explicit finalization.
    await client.query('DELETE FROM migration_chunks WHERE session_id=$1',[s.id]);
    await client.query("UPDATE migration_sessions SET status='cancelled',updated_at=now() WHERE id=$1",[s.id]);
    await audit(client,ctx.organizationId,'migration.cancelled',ctx.userId,ctx.deviceId,'migration_session',s.id);
    return {id:s.id,status:'cancelled'};
  });
  res.json(result);
});
