import {randomUUID} from 'node:crypto';
import {Router} from 'express';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {pool} from '../database/pool.js';
import {authenticate,adminOnly,identity} from '../middleware/auth.js';
import {HttpError} from '../middleware/errors.js';
import {audit,assertCurrentAdmin,transaction} from '../services/security.js';
import {projectClient,type EstimateMeta,type EstimateRow,type Settings} from './projection.js';

const uuid=z.uuid();
const settings=z.strictObject({materials:z.enum(['hidden','subtotal','detailed']),showMaterialPrices:z.boolean(),showSections:z.boolean(),
  paymentTerms:z.string().max(2000),timeline:z.string().max(2000),warranty:z.string().max(2000),note:z.string().max(2000),companyDetails:z.string().max(2000)});
const create=z.strictObject({projectId:uuid,estimateId:uuid,type:z.enum(['COMMERCIAL_OFFER','DETAILED_ESTIMATE','SUMMARY_ESTIMATE']),requestId:uuid,settings});
type Row={id:string;organization_id:string;project_id:string;estimate_id:string;document_type:string;document_number:string;version:number;status:string;snapshot:Record<string,unknown>;display_settings:Settings;idempotency_key:string;created_by:string;revision:string;created_at:Date;finalized_at:Date|null};
const present=(r:Row)=>({id:r.id,projectId:r.project_id,estimateId:r.estimate_id,type:r.document_type,number:r.document_number,version:r.version,status:r.status,snapshot:r.snapshot,settings:r.display_settings,revision:Number(r.revision),createdAt:r.created_at,finalizedAt:r.finalized_at});
async function change(client:PoolClient,ctx:ReturnType<typeof identity>,row:Row,action:'create'|'update'){
  const operationId=randomUUID(),sequence=(await client.query<{sync_cursor:string}>('UPDATE organizations SET sync_cursor=sync_cursor+1 WHERE id=$1 RETURNING sync_cursor',[ctx.organizationId])).rows[0]?.sync_cursor;
  if(!sequence)throw Error('Missing cursor');
  const snapshot={...present(row),requestId:row.idempotency_key,createdBy:row.created_by,deletedAt:null};
  const result={operationId,status:'applied',resultingRevision:Number(row.revision),sequence};
  await client.query(`INSERT INTO sync_operations(id,organization_id,device_id,entity_type,entity_id,operation_type,base_revision,resulting_revision,status,idempotency_key,attempts,occurred_at,request_hash,result,change_sequence)
    VALUES($1,$2,$3,'clientDocument',$4,$5,$6,$7,'applied',$1,1,now(),$8,$9,$10)`,[operationId,ctx.organizationId,ctx.deviceId,row.id,action,Number(row.revision)-1,Number(row.revision),'0'.repeat(64),JSON.stringify(result),sequence]);
  await client.query(`INSERT INTO sync_changes(organization_id,sequence,entity_type,entity_id,revision,operation_type,snapshot,source_device_id,sync_operation_id)
    VALUES($1,$2,'clientDocument',$3,$4,$5,$6,$7,$8)`,[ctx.organizationId,sequence,row.id,Number(row.revision),action,JSON.stringify(snapshot),ctx.deviceId,operationId]);
}
export const clientDocumentsRouter=Router();
clientDocumentsRouter.use(authenticate,adminOnly);
clientDocumentsRouter.post('/',async(req,res)=>{
  const input=create.parse(req.body),ctx=identity(res);
  const outcome=await transaction(async client=>{
    await assertCurrentAdmin(client,ctx);
    const found=await client.query<Row>('SELECT * FROM client_documents WHERE organization_id=$1 AND idempotency_key=$2',[ctx.organizationId,input.requestId]);
    if(found.rows[0]){const row=found.rows[0];if(row.estimate_id!==input.estimateId||row.project_id!==input.projectId||row.document_type!==input.type||Object.entries(input.settings).some(([key,value])=>row.display_settings[key as keyof Settings]!==value))throw new HttpError(409,'Request ID reused');return {row,duplicate:true};}
    // Lock estimate across version and number allocation. The row also validates project/org identity.
    const current=await client.query<EstimateMeta>(`SELECT e.name,p.name AS project_name,p.address,p.client_name,e.work_markup_percent::text,e.delivery_amount::text,e.discount_amount::text,e.currency
      FROM estimates e JOIN projects p ON p.id=e.project_id AND p.organization_id=e.organization_id
      WHERE e.organization_id=$1 AND e.project_id=$2 AND e.id=$3 AND e.deleted_at IS NULL AND p.deleted_at IS NULL FOR UPDATE OF e`,[ctx.organizationId,input.projectId,input.estimateId]);
    if(!current.rows[0])throw new HttpError(404,'Estimate not found');
    const items=await client.query<EstimateRow>(`SELECT i.title,i.quantity::text,i.unit,i.unit_price::text,i.coefficient::text,i.item_kind,i.auto_material,i.material_price::text,i.extra,i.extra_status,s.name AS stage_name
      FROM estimate_items i LEFT JOIN stages s ON s.id=i.stage_id AND s.organization_id=i.organization_id
      WHERE i.organization_id=$1 AND i.estimate_id=$2 AND i.deleted_at IS NULL ORDER BY i.created_at,i.id`,[ctx.organizationId,input.estimateId]);
    let snapshot;try{snapshot=projectClient(current.rows[0],items.rows,input.settings);}catch{throw new HttpError(409,'Estimate cannot be projected safely');}
    const v=await client.query<{version:number}>('SELECT coalesce(max(version),0)+1 AS version FROM client_documents WHERE organization_id=$1 AND estimate_id=$2 AND document_type=$3',[ctx.organizationId,input.estimateId,input.type]);
    const year=new Date().getUTCFullYear(),seq=await client.query<{last_number:number}>(`INSERT INTO client_document_sequences(organization_id,document_type,document_year,last_number) VALUES($1,$2,$3,1)
      ON CONFLICT (organization_id,document_type,document_year) DO UPDATE SET last_number=client_document_sequences.last_number+1 RETURNING last_number`,[ctx.organizationId,input.type,year]);
    const prefix=input.type==='COMMERCIAL_OFFER'?'КП':input.type==='DETAILED_ESTIMATE'?'СМ':'КС';
    const number=`${prefix}-${year}-${String(seq.rows[0]!.last_number).padStart(3,'0')}`,id=randomUUID();
    const inserted=await client.query<Row>(`INSERT INTO client_documents(id,organization_id,project_id,estimate_id,document_type,document_number,version,snapshot,display_settings,idempotency_key,created_by,revision)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1) RETURNING *`,[id,ctx.organizationId,input.projectId,input.estimateId,input.type,number,v.rows[0]!.version,JSON.stringify(snapshot),JSON.stringify(input.settings),input.requestId,ctx.userId]);
    await change(client,ctx,inserted.rows[0]!,'create');
    await audit(client,ctx.organizationId,'client_document.created',ctx.userId,ctx.deviceId,'clientDocument',id);
    return {row:inserted.rows[0]!,duplicate:false};
  }).catch((error:unknown)=>{
    if(process.env.NODE_ENV==='test'){
      const failure=error as {code?:string;constraint?:string;message?:string};
      process.stderr.write(`F7 create diagnostic: ${JSON.stringify({code:failure.code,constraint:failure.constraint,message:failure.message})}\n`);
    }
    throw error;
  });
  res.status(outcome.duplicate?200:201).json({document:present(outcome.row),duplicate:outcome.duplicate});
});
clientDocumentsRouter.get('/',async(req,res)=>{
  const ctx=identity(res),projectId=uuid.parse(req.query.projectId),estimateId=uuid.parse(req.query.estimateId),limit=z.coerce.number().int().min(1).max(100).parse(req.query.limit??50);
  const result=await pool.query<Row>(`SELECT d.* FROM client_documents d JOIN estimates e ON e.id=d.estimate_id AND e.organization_id=d.organization_id AND e.project_id=d.project_id
    WHERE d.organization_id=$1 AND d.project_id=$2 AND d.estimate_id=$3 AND d.deleted_at IS NULL AND e.deleted_at IS NULL ORDER BY d.created_at DESC,d.id DESC LIMIT $4`,[ctx.organizationId,projectId,estimateId,limit]);
  res.json({documents:result.rows.map(present)});
});
clientDocumentsRouter.get('/:id',async(req,res)=>{const ctx=identity(res),id=uuid.parse(req.params.id),r=await pool.query<Row>('SELECT * FROM client_documents WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL',[ctx.organizationId,id]);if(!r.rows[0])throw new HttpError(404,'Not found');res.json({document:present(r.rows[0])});});
clientDocumentsRouter.post('/:id/finalize',async(req,res)=>{
  const ctx=identity(res),id=uuid.parse(req.params.id),outcome=await transaction(async client=>{
    await assertCurrentAdmin(client,ctx);
    const found=await client.query<Row>('SELECT * FROM client_documents WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',[ctx.organizationId,id]);
    if(!found.rows[0])throw new HttpError(404,'Not found');
    if(found.rows[0].status==='final')return {row:found.rows[0],duplicate:true};
    const updated=await client.query<Row>("UPDATE client_documents SET status='final',finalized_at=now(),updated_at=now(),revision=revision+1 WHERE id=$1 RETURNING *",[id]);
    await change(client,ctx,updated.rows[0]!,'update');
    await audit(client,ctx.organizationId,'client_document.finalized',ctx.userId,ctx.deviceId,'clientDocument',id);
    return {row:updated.rows[0]!,duplicate:false};
  });res.json({document:present(outcome.row),duplicate:outcome.duplicate});
});
