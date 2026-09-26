import { randomUUID } from 'node:crypto';
import express,{ Router } from 'express';
import type { PoolClient } from 'pg';
import { pool } from '../database/pool.js';
import { config } from '../config/env.js';
import { authenticate,identity } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { audit,assertCurrentAdmin,transaction,type Identity } from '../services/security.js';
import { validateBody } from '../validation/request.js';
import { storage,fileKey } from './storage.js';
import { intentSchema,kindOf,displayFilename,validSize,validType,digest,type FileKind } from './validation.js';
import { transition,type FileState } from './state.js';
import { packageSchema } from '../migration/package.js';

type FileRow={id:string;organization_id:string;project_id:string;storage_key:string;revision:string;original_filename:string;
  mime_type:string;byte_size:string;content_sha256:string;status:FileState;
  idempotency_key:string;created_by:string;source_device_id:string;created_at:Date;uploaded_at:Date|null;deleted_at:Date|null};
function kind(req:express.Request):FileKind {const value=kindOf(String(req.params.kind));if(!value) throw new HttpError(404,'Not found');return value;}
function fileId(req:express.Request) {const value=String(req.params.id);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new HttpError(400,'Invalid file ID');return value;}
function present(row:FileRow) {return {id:row.id,projectId:row.project_id,filename:row.original_filename,mimeType:row.mime_type,
  byteSize:Number(row.byte_size),sha256:row.content_sha256,status:row.status,revision:Number(row.revision),
  createdAt:row.created_at.toISOString(),uploadedAt:row.uploaded_at?.toISOString()??null,deletedAt:row.deleted_at?.toISOString()??null};}
function feed(row:FileRow) {return {id:row.id,projectId:row.project_id,filename:row.original_filename,mimeType:row.mime_type,
  byteSize:Number(row.byte_size),sha256:row.content_sha256,status:row.status,revision:Number(row.revision),deletedAt:row.deleted_at};}
async function getFile(client:PoolClient,table:FileKind,ctx:Identity,id:string,lock=false) {
  const r=await client.query<FileRow>(`SELECT * FROM ${table} WHERE organization_id=$1 AND id=$2 ${lock?'FOR UPDATE':''}`,[ctx.organizationId,id]);
  if(!r.rows[0]||!r.rows[0].idempotency_key) throw new HttpError(404,'Not found');return r.rows[0];
}
async function writeChange(client:PoolClient,ctx:Identity,table:FileKind,row:FileRow,operation:'create'|'delete') {
  const opId=randomUUID(),type=table==='photos'?'photo':'document';
  const sequence=(await client.query<{sync_cursor:string}>('UPDATE organizations SET sync_cursor=sync_cursor+1 WHERE id=$1 RETURNING sync_cursor',[ctx.organizationId])).rows[0]?.sync_cursor;
  if(!sequence) throw Error('Missing sync cursor');
  const result={operationId:opId,status:'applied',resultingRevision:Number(row.revision),sequence};
  await client.query(`INSERT INTO sync_operations(id,organization_id,device_id,entity_type,entity_id,operation_type,base_revision,resulting_revision,status,idempotency_key,attempts,occurred_at,request_hash,result,change_sequence)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'applied',$9,1,now(),$10,$11,$12)`,[opId,ctx.organizationId,ctx.deviceId,type,row.id,operation,Number(row.revision)-1,Number(row.revision),opId,'0'.repeat(64),JSON.stringify(result),sequence]);
  await client.query(`INSERT INTO sync_changes(organization_id,sequence,entity_type,entity_id,revision,operation_type,snapshot,source_device_id,sync_operation_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[ctx.organizationId,sequence,type,row.id,row.revision,operation,JSON.stringify(feed(row)),ctx.deviceId,opId]);
}
async function authorizedWrite(client:PoolClient,ctx:Identity) {
  await client.query('SELECT id FROM organizations WHERE id=$1 FOR NO KEY UPDATE',[ctx.organizationId]);
  await assertCurrentAdmin(client,ctx);
}
export const filesRouter=Router();
filesRouter.use(authenticate,(_req,res,next)=>res.locals.identity?.mustChangePassword?next(new HttpError(403,'Password change required')):next());
filesRouter.post('/:kind/intents',validateBody(intentSchema),async(req,res)=>{
  const ctx=identity(res),table=kind(req),body=intentSchema.parse(req.body);
  if(ctx.role!=='admin') throw new HttpError(403,'Forbidden');
  if(!validSize(table,body.byteSize) || (table==='documents'?body.mimeType!=='application/pdf':!body.mimeType.startsWith('image/')))
    throw new HttpError(400,'Unsupported file or size','invalid_file');
  const filename=displayFilename(body.filename);
  const result=await transaction(async client=>{
    await authorizedWrite(client,ctx);
    const previous=await client.query<FileRow>(`SELECT * FROM ${table} WHERE organization_id=$1 AND idempotency_key=$2`,[ctx.organizationId,body.idempotencyKey]);
    if(previous.rows[0]) {
      const p=previous.rows[0];
      if(p.project_id!==body.projectId||p.original_filename!==filename||p.mime_type!==body.mimeType||Number(p.byte_size)!==body.byteSize||p.content_sha256!==body.sha256)
        throw new HttpError(409,'Idempotency key reused','intent_mismatch');
      return {file:present(p),duplicate:true};
    }
    const project=await client.query('SELECT 1 FROM projects WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL',[ctx.organizationId,body.projectId]);
    if(!project.rowCount) throw new HttpError(404,'Not found');
    const id=randomUUID(),key=fileKey(ctx.organizationId,body.projectId,table,id);
    const row=await client.query<FileRow>(`INSERT INTO ${table}(id,organization_id,project_id,storage_key,original_filename,mime_type,byte_size,content_sha256,status,created_by,source_device_id,idempotency_key)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11) RETURNING *`,[id,ctx.organizationId,body.projectId,key,filename,body.mimeType,body.byteSize,body.sha256,ctx.userId,ctx.deviceId,body.idempotencyKey]);
    return {file:present(row.rows[0]!),duplicate:false};
  });
  res.status(result.duplicate?200:201).json(result);
});
filesRouter.get('/quota',async(_req,res)=>{
  const ctx=identity(res);
  const [photos,documents]=await Promise.all((['photos','documents'] as const).map(table=>pool.query<{count:string;bytes:string}>(
    `SELECT count(*) FILTER (WHERE status='available') AS count,coalesce(sum(byte_size) FILTER (WHERE status='available'),0) AS bytes FROM ${table} WHERE organization_id=$1`,[ctx.organizationId])));
  res.json({photos:{count:Number(photos?.rows[0]?.count),bytes:Number(photos?.rows[0]?.bytes)},documents:{count:Number(documents?.rows[0]?.count),bytes:Number(documents?.rows[0]?.bytes)}});
});
filesRouter.post('/legacy/:sessionId/:photoId',async(req,res)=>{
  const ctx=identity(res),sessionId=String(req.params.sessionId),photoId=String(req.params.photoId);
  if(ctx.role!=='admin') throw new HttpError(403,'Forbidden');
  if(!/^[0-9a-f-]{36}$/.test(sessionId)||!/^[0-9a-f-]{36}$/.test(photoId)) throw new HttpError(400,'Invalid ID');
  const result=await transaction(async client=>{
    await authorizedWrite(client,ctx);
    const archive=await client.query<{business_snapshot:unknown}>(`SELECT l.business_snapshot FROM migration_legacy_snapshots l
      JOIN migration_sessions s ON s.id=l.session_id AND s.organization_id=l.organization_id
      WHERE l.organization_id=$1 AND l.session_id=$2 AND s.status='completed'`,[ctx.organizationId,sessionId]);
    if(!archive.rows[0]) throw new HttpError(404,'Not found');
    const pkg=packageSchema.parse(archive.rows[0].business_snapshot);
    const matching=pkg.projects.flatMap(project=>[...project.photos,...(project.estimatePhotos??[])]
      .filter(photo=>photo.id===photoId).map(photo=>({project,photo})));
    if(matching.length!==1) throw new HttpError(404,'Not found');
    const {project,photo}=matching[0]!,bytes=Buffer.from(matching[0]!.photo.data.slice('data:image/jpeg;base64,'.length),'base64');
    if(!validSize('photos',bytes.length)||!validType('photos','image/jpeg',bytes)) throw new HttpError(409,'Legacy photo requires manual review','invalid_legacy_photo');
    const sha256=digest(bytes),key=fileKey(ctx.organizationId,project.id,'photos',photoId);
    const existing=await client.query<FileRow>('SELECT * FROM photos WHERE id=$1 FOR UPDATE',[photoId]);
    if(existing.rows[0]) {
      const row=existing.rows[0];
      if(row.organization_id!==ctx.organizationId||row.project_id!==project.id||row.content_sha256!==sha256||row.status==='deleted')
        throw new HttpError(409,'Photo identity collision','photo_collision');
      if(row.status==='available') return {file:present(row),duplicate:true};
    } else {
      const active=await client.query('SELECT 1 FROM projects WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL',[ctx.organizationId,project.id]);
      if(!active.rowCount) throw new HttpError(409,'Project is not available','project_unavailable');
      await client.query(`INSERT INTO photos(id,organization_id,project_id,storage_key,original_filename,mime_type,byte_size,content_sha256,status,created_by,source_device_id,idempotency_key)
        VALUES($1,$2,$3,$4,$5,'image/jpeg',$6,$7,'pending',$8,$9,$10)`,[photoId,ctx.organizationId,project.id,key,displayFilename(photo.name??`legacy-${photoId}.jpg`),bytes.length,sha256,ctx.userId,ctx.deviceId,`legacy-${sessionId}-${photoId}`]);
    }
    try {await storage.put(key,bytes,{size:bytes.length,sha256,mime:'image/jpeg'});}
    catch {throw new HttpError(503,'Storage unavailable','storage_unavailable');}
    const updated=await client.query<FileRow>("UPDATE photos SET status='available',revision=1,uploaded_at=now(),available_at=now(),updated_at=now() WHERE id=$1 RETURNING *",[photoId]);
    await writeChange(client,ctx,'photos',updated.rows[0]!,'create');
    await audit(client,ctx.organizationId,'legacy.photo_uploaded',ctx.userId,ctx.deviceId,'photo',photoId,{migrationSessionId:sessionId});
    return {file:present(updated.rows[0]!),duplicate:false};
  });
  res.json(result);
});
filesRouter.get('/:kind/:id',async(req,res)=>{
  const ctx=identity(res),table=kind(req),r=await pool.connect();try {const row=await getFile(r,table,ctx,fileId(req));
    if(row.status!=='available'&&ctx.role!=='admin') throw new HttpError(404,'Not found');res.json(present(row));
  } finally {r.release();}
});
filesRouter.put('/:kind/:id/content',express.raw({type:'application/octet-stream',limit:Math.max(config.MAX_PHOTO_BYTES,config.MAX_DOCUMENT_BYTES)+'b'}),async(req,res)=>{
  const ctx=identity(res),table=kind(req),id=fileId(req);
  if(ctx.role!=='admin') throw new HttpError(403,'Forbidden');
  if(!Buffer.isBuffer(req.body)) throw new HttpError(415,'Expected application/octet-stream','invalid_content_type');
  const bytes:Buffer=req.body;
  const result=await transaction(async client=>{
    await authorizedWrite(client,ctx);const row=await getFile(client,table,ctx,id,true);
    if(row.status==='deleted'||row.status==='available') throw new HttpError(409,'Upload closed','upload_closed');
    if(!validSize(table,bytes.length)||bytes.length!==Number(row.byte_size)) throw new HttpError(409,'Byte size mismatch','size_mismatch');
    if(digest(bytes)!==row.content_sha256) throw new HttpError(409,'SHA-256 mismatch','hash_mismatch');
    if(!validType(table,row.mime_type,bytes)) throw new HttpError(415,'File signature mismatch','type_mismatch');
    if(row.status==='uploaded') {
      const current=await storage.head(row.storage_key);
      if(current?.sha256===row.content_sha256&&current.size===bytes.length) return {status:'uploaded',duplicate:true};
    }
    try {await storage.put(row.storage_key,bytes,{size:bytes.length,sha256:row.content_sha256,mime:row.mime_type});}
    catch {throw new HttpError(503,'Storage unavailable','storage_unavailable');}
    await client.query(`UPDATE ${table} SET status=$2,uploaded_at=now(),updated_at=now() WHERE id=$1`,[id,row.status==='uploaded'?'uploaded':transition(row.status,'uploaded')]);
    return {status:'uploaded',duplicate:false};
  });
  res.json(result);
});
filesRouter.post('/:kind/:id/finalize',async(req,res)=>{
  const ctx=identity(res),table=kind(req),id=fileId(req);
  if(ctx.role!=='admin') throw new HttpError(403,'Forbidden');
  const result=await transaction(async client=>{
    await authorizedWrite(client,ctx);const row=await getFile(client,table,ctx,id,true);
    if(row.status==='available') return {file:present(row),duplicate:true};
    if(row.status!=='uploaded') throw new HttpError(409,'Upload required','upload_required');
    let head;try {head=await storage.head(row.storage_key);} catch {throw new HttpError(503,'Storage unavailable','storage_unavailable');}
    if(!head||head.size!==Number(row.byte_size)||head.sha256!==row.content_sha256||head.mime!==row.mime_type)
      throw new HttpError(409,'Object integrity check failed','object_mismatch');
    const updated=await client.query<FileRow>(`UPDATE ${table} SET status=$2,revision=1,available_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,[id,transition(row.status,'available')]);
    await writeChange(client,ctx,table,updated.rows[0]!,'create');
    return {file:present(updated.rows[0]!),duplicate:false};
  });
  res.json(result);
});
filesRouter.get('/:kind/:id/content',async(req,res)=>{
  const ctx=identity(res),table=kind(req),client=await pool.connect();
  let row:FileRow;try {row=await getFile(client,table,ctx,fileId(req));} finally {client.release();}
  if(row.status!=='available'||row.deleted_at) throw new HttpError(404,'Not found');
  let bytes;try {bytes=await storage.get(row.storage_key,Number(row.byte_size));} catch {throw new HttpError(503,'Storage unavailable','storage_unavailable');}
  if(bytes.length!==Number(row.byte_size)||digest(bytes)!==row.content_sha256) throw new HttpError(503,'Object integrity check failed','object_corrupt');
  res.set('Content-Type',row.mime_type).set('Content-Disposition',`attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(row.original_filename)}`)
    .set('Cache-Control','private, no-store').set('X-Content-Type-Options','nosniff').send(bytes);
});
filesRouter.delete('/:kind/:id',async(req,res)=>{
  const ctx=identity(res),table=kind(req),id=fileId(req);
  if(ctx.role!=='admin') throw new HttpError(403,'Forbidden');
  const result=await transaction(async client=>{
    await authorizedWrite(client,ctx);const row=await getFile(client,table,ctx,id,true);
    if(row.status==='deleted') return {file:present(row),duplicate:true};
    if(row.status!=='available') throw new HttpError(409,'File not available','file_not_available');
    const updated=await client.query<FileRow>(`UPDATE ${table} SET status=$2,deleted_at=now(),revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,[id,transition(row.status,'deleted')]);
    await writeChange(client,ctx,table,updated.rows[0]!,'delete');
    await audit(client,ctx.organizationId,'file.deleted',ctx.userId,ctx.deviceId,table==='photos'?'photo':'document',id);
    return {file:present(updated.rows[0]!),duplicate:false};
  });
  res.json(result);
});
