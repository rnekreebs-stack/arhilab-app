import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../database/pool.js';
import { HttpError } from '../middleware/errors.js';
import { assertCurrentAdmin, transaction, type Identity } from '../services/security.js';
import { parsePayload, specification, type EntityType } from './registry.js';
import type { SyncOperation } from './validation.js';

export type SyncResult = {
  operationId:string;
  status:'applied'|'duplicate'|'conflict'|'rejected';
  errorClass?:'validation'|'authorization'|'conflict'|'unsupported';
  code?:string;
  resultingRevision?:number;
  currentRevision?:number;
  sequence?:string;
  originalStatus?:string;
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj=value as Record<string,unknown>;
    return `{${Object.keys(obj).sort().map(key=>`${JSON.stringify(key)}:${canonical(obj[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function requestHash(op: SyncOperation) { return createHash('sha256').update(canonical(op)).digest('hex'); }
const rejected=(op:SyncOperation,errorClass:NonNullable<SyncResult['errorClass']>,code:string):SyncResult=>({operationId:op.operationId,status:'rejected',errorClass,code});
const conflict=(op:SyncOperation,currentRevision:number):SyncResult=>({operationId:op.operationId,status:'conflict',errorClass:'conflict',code:'stale_revision',currentRevision});

async function referencesValid(client:PoolClient,org:string,payload:Record<string,unknown>) {
  for (const [key,table] of [['projectId','projects'],['estimateId','estimates'],['assigneeId','users']] as const) {
    const id=payload[key]; if (id === undefined || id === null) continue;
    const where=table==='users'?' AND active':' AND deleted_at IS NULL';
    const check=await client.query(`SELECT id FROM ${table} WHERE organization_id=$1 AND id=$2${where}`,[org,id]);
    if (!check.rowCount) return false;
  }
  return true;
}
function snapshot(row:Record<string,unknown>,fields:Record<string,string>) {
  const state:Record<string,unknown>={id:row.id,revision:Number(row.revision),deletedAt:row.deleted_at};
  for (const [name,column] of Object.entries(fields)) state[name]=row[column];
  return state;
}
async function mutation(client:PoolClient,ctx:Identity,op:SyncOperation):Promise<{result:SyncResult;state?:Record<string,unknown>;table?:string}> {
  const spec=specification(op.entityType);
  if (!spec) return {result:rejected(op,'unsupported','unsupported_entity')};
  if (!['create','update','delete'].includes(op.operationType)) return {result:rejected(op,'unsupported','unsupported_operation')};
  const payload=parsePayload(op.entityType as EntityType,op.operationType,op.payload);
  if (!payload) return {result:rejected(op,'validation','invalid_payload')};
  if (!await referencesValid(client,ctx.organizationId,payload)) return {result:rejected(op,'validation','invalid_reference')};
  const found=await client.query<Record<string,unknown>>(`SELECT * FROM ${spec.table} WHERE id=$1 FOR NO KEY UPDATE`,[op.entityId]);
  const current=found.rows[0];
  if (current && current.organization_id !== ctx.organizationId) return {result:rejected(op,'authorization','entity_not_available')};
  if (op.operationType==='create') {
    if (current) return {result:conflict(op,Number(current.revision))};
    if (op.baseRevision!==0) return {result:conflict(op,0)};
    const entries=Object.entries(payload).map(([name,value])=>[spec.fields[name],value] as const);
    const columns=['id','organization_id','revision',...entries.map(([column])=>column)];
    const values=[op.entityId,ctx.organizationId,1,...entries.map(([,value])=>value)];
    const insert=await client.query<Record<string,unknown>>(`INSERT INTO ${spec.table} (${columns.join(',')}) VALUES (${values.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT (id) DO NOTHING RETURNING *`,values);
    if (!insert.rows[0]) return {result:rejected(op,'authorization','entity_not_available')};
    return {result:{operationId:op.operationId,status:'applied',resultingRevision:1},state:snapshot(insert.rows[0],spec.fields),table:spec.table};
  }
  if (!current) return {result:rejected(op,'authorization','entity_not_available')};
  if (Number(current.revision)!==op.baseRevision) return {result:conflict(op,Number(current.revision))};
  if (current.deleted_at) return {result:rejected(op,'conflict','already_deleted')};
  const entries=Object.entries(payload).map(([name,value])=>[spec.fields[name],value] as const);
  const assignments=entries.map(([column],i)=>`${column}=$${i+1}`);
  assignments.push('revision=revision+1','updated_at=now()');
  if (op.operationType==='delete') assignments.push('deleted_at=now()');
  const values=[...entries.map(([,value])=>value),op.entityId,ctx.organizationId,op.baseRevision];
  const result=await client.query<Record<string,unknown>>(`UPDATE ${spec.table} SET ${assignments.join(',')} WHERE id=$${entries.length+1} AND organization_id=$${entries.length+2} AND revision=$${entries.length+3} AND deleted_at IS NULL RETURNING *`,values);
  const updated=result.rows[0];
  if (!updated) throw new Error('Serialized sync mutation unexpectedly changed');
  const revision=Number(updated.revision);
  return {result:{operationId:op.operationId,status:'applied',resultingRevision:revision},state:snapshot(updated,spec.fields),table:spec.table};
}
export async function applyOperation(ctx:Identity,op:SyncOperation):Promise<SyncResult> {
  return transaction(async client=>{
    // The organization lock serializes commits and cursor allocation, including duplicate requests.
    await client.query('SELECT id FROM organizations WHERE id=$1 FOR NO KEY UPDATE',[ctx.organizationId]);
    await assertCurrentAdmin(client,ctx);
    const hash=requestHash(op);
    const existing=await client.query<{id:string;request_hash:string|null;result:SyncResult|null}>('SELECT id,request_hash,result FROM sync_operations WHERE organization_id=$1 AND idempotency_key=$2',[ctx.organizationId,op.idempotencyKey]);
    const previous=existing.rows[0];
    if (previous) {
      if (previous.request_hash!==hash || previous.id!==op.operationId || !previous.result) return rejected(op,'conflict','idempotency_key_reused_with_different_request');
      await client.query('UPDATE sync_operations SET attempts=attempts+1,updated_at=now() WHERE id=$1',[previous.id]);
      return {...previous.result,status:'duplicate',originalStatus:previous.result.status};
    }
    const reusedId=await client.query('SELECT id FROM sync_operations WHERE id=$1',[op.operationId]);
    if (reusedId.rowCount) return rejected(op,'conflict','operation_id_reused');
    const {result,state}=await mutation(client,ctx,op);
    await client.query(`INSERT INTO sync_operations(id,organization_id,device_id,entity_type,entity_id,operation_type,base_revision,resulting_revision,status,idempotency_key,attempts,occurred_at,request_hash,result,conflict_metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14)`,[
      op.operationId,ctx.organizationId,ctx.deviceId,op.entityType,op.entityId,op.operationType,op.baseRevision,
      result.resultingRevision ?? null,result.status==='rejected'?'failed':result.status,op.idempotencyKey,op.occurredAt,hash,
      JSON.stringify(result),result.status==='conflict'?JSON.stringify({clientBaseRevision:op.baseRevision,serverCurrentRevision:result.currentRevision}):null,
    ]);
    if (result.status!=='applied' || !state) return result;
    const cursor=await client.query<{sync_cursor:string}>('UPDATE organizations SET sync_cursor=sync_cursor+1 WHERE id=$1 RETURNING sync_cursor',[ctx.organizationId]);
    const sequence=cursor.rows[0]?.sync_cursor;
    if (!sequence) throw new Error('Missing sync cursor');
    await client.query(`INSERT INTO sync_changes(organization_id,sequence,entity_type,entity_id,revision,operation_type,snapshot,source_device_id,sync_operation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[ctx.organizationId,sequence,op.entityType,op.entityId,result.resultingRevision,op.operationType,JSON.stringify(state),ctx.deviceId,op.operationId]);
    result.sequence=sequence;
    await client.query('UPDATE sync_operations SET change_sequence=$1,result=$2,updated_at=now() WHERE id=$3',[sequence,JSON.stringify(result),op.operationId]);
    return result;
  });
}
export async function pullChanges(ctx:Identity,cursor:string,limit:number) {
  const org=await pool.query<{sync_cursor:string}>('SELECT sync_cursor FROM organizations WHERE id=$1',[ctx.organizationId]);
  if (BigInt(cursor)>BigInt(org.rows[0]?.sync_cursor ?? '0')) throw new HttpError(400,'Invalid cursor');
  const changes=await pool.query<{sequence:string;entity_type:string;entity_id:string;revision:string;operation_type:string;snapshot:Record<string,unknown>;source_device_id:string;sync_operation_id:string;changed_at:Date}>(`SELECT sequence,entity_type,entity_id,revision,operation_type,snapshot,source_device_id,sync_operation_id,changed_at FROM sync_changes WHERE organization_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3`,[ctx.organizationId,cursor,limit+1]);
  const hasMore=changes.rows.length>limit;
  const page=changes.rows.slice(0,limit);
  return {changes:page.map(row=>({sequence:row.sequence,entityType:row.entity_type,entityId:row.entity_id,revision:Number(row.revision),operationType:row.operation_type,snapshot:row.snapshot,sourceDeviceId:row.source_device_id,operationId:row.sync_operation_id,changedAt:row.changed_at.toISOString()})),nextCursor:page.at(-1)?.sequence ?? cursor,hasMore};
}
