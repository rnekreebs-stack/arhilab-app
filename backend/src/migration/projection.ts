import type { PoolClient } from 'pg';
import type { Identity } from '../services/security.js';
import { stableId } from './identity.js';
import type { LegacyPackage } from './package.js';

type Item={kind:string;sourceId:string;type:string;targetId:string;payload:Record<string,unknown>};
export function projection(pkg:LegacyPackage,currencies:Map<string,string>):Item[] {
  const items:Item[]=[];
  for(const p of pkg.projects) {
    items.push({kind:'project',sourceId:p.id,type:'project',targetId:p.id,payload:{name:p.name}});
    const estimateId=stableId('estimate',p.id);
    if(p.lines.length) items.push({kind:'estimate',sourceId:p.id,type:'estimate',targetId:estimateId,payload:{projectId:p.id,name:p.name}});
    for(const row of p.lines) items.push({kind:'estimateItem',sourceId:row.id,type:'estimateItem',targetId:row.id,payload:{estimateId,title:row.name,quantity:String(row.qty),...(row.unit?{unit:row.unit}:{})}});
    for(const row of p.materials) items.push({kind:'material',sourceId:row.id,type:'material',targetId:row.id,payload:{name:row.name,...(row.unit?{unit:row.unit}:{})}});
    for(const row of p.tasks) if(['Не начато','В работе','Завершено'].includes(row.status)) items.push({kind:'task',sourceId:row.id,type:'task',targetId:row.id,payload:{projectId:p.id,title:row.name,status:row.status==='Завершено'?'done':row.status==='В работе'?'in_progress':'open'}});
    for(const row of p.payments) {
      const currency=currencies.get(row.id);
      if(currency) items.push({kind:'payment',sourceId:row.id,type:'payment',targetId:row.id,payload:{projectId:p.id,amount:String(row.amount),currency}});
    }
  }
  return items;
}
const tables:Record<string,{table:string;fields:Record<string,string>}>= {
  project:{table:'projects',fields:{name:'name'}},estimate:{table:'estimates',fields:{projectId:'project_id',name:'name'}},
  estimateItem:{table:'estimate_items',fields:{estimateId:'estimate_id',title:'title',quantity:'quantity',unit:'unit'}},
  material:{table:'materials',fields:{name:'name',unit:'unit'}},
  task:{table:'tasks',fields:{projectId:'project_id',title:'title',status:'status'}},
  payment:{table:'payments',fields:{projectId:'project_id',amount:'amount',currency:'currency'}},
};
export async function importProjection(client:PoolClient,ctx:Identity,sessionId:string,items:Item[]) {
  const existing=await client.query('SELECT 1 FROM projects WHERE organization_id=$1 LIMIT 1',[ctx.organizationId]);
  if(existing.rowCount) throw Error('Target organization is not empty');
  for(const item of items) {
    const spec=tables[item.type];if(!spec) throw Error('Unsupported projection');
    const entries=Object.entries(item.payload).map(([field,value])=>[spec.fields[field],value] as const);
    if(entries.some(([field])=>!field)) throw Error('Unsupported projection field');
    const fields=['id','organization_id','revision',...entries.map(([field])=>field)];
    const values=[item.targetId,ctx.organizationId,1,...entries.map(([,value])=>value)];
    await client.query(`INSERT INTO ${spec.table}(${fields.join(',')}) VALUES(${values.map((_,i)=>'$'+(i+1)).join(',')})`,values);
    await client.query('INSERT INTO migration_entity_mappings(session_id,legacy_entity_type,legacy_entity_id,target_entity_type,target_entity_id,mapping_status,imported_revision) VALUES($1,$2,$3,$4,$5,$6,1)',[sessionId,item.kind,item.sourceId,item.type,item.targetId,'imported']);
    const opId=stableId(sessionId,item.type+item.targetId);
    await client.query(`INSERT INTO sync_operations(id,organization_id,device_id,entity_type,entity_id,operation_type,base_revision,resulting_revision,status,idempotency_key,attempts,occurred_at,request_hash,result)
      VALUES($1,$2,$3,$4,$5,'create',0,1,'applied',$6,1,now(),$7,$8)`,[opId,ctx.organizationId,ctx.deviceId,item.type,item.targetId,opId,'0'.repeat(64),JSON.stringify({status:'applied',operationId:opId,resultingRevision:1})]);
    const seq=await client.query<{sync_cursor:string}>('UPDATE organizations SET sync_cursor=sync_cursor+1 WHERE id=$1 RETURNING sync_cursor',[ctx.organizationId]);
    const sequence=seq.rows[0]?.sync_cursor;
    const snapshot={id:item.targetId,revision:1,deletedAt:null,...item.payload};
    await client.query(`INSERT INTO sync_changes(organization_id,sequence,entity_type,entity_id,revision,operation_type,snapshot,source_device_id,sync_operation_id)
      VALUES($1,$2,$3,$4,1,'create',$5,$6,$7)`,[ctx.organizationId,sequence,item.type,item.targetId,JSON.stringify(snapshot),ctx.deviceId,opId]);
    await client.query('UPDATE sync_operations SET change_sequence=$1,result=$2 WHERE id=$3',[sequence,JSON.stringify({status:'applied',operationId:opId,resultingRevision:1,sequence}),opId]);
  }
}
export async function targetHasData(client:PoolClient,org:string) {
  const r=await client.query<{occupied:boolean}>(`SELECT EXISTS(SELECT 1 FROM projects WHERE organization_id=$1) OR EXISTS(SELECT 1 FROM materials WHERE organization_id=$1) OR EXISTS(SELECT 1 FROM tasks WHERE organization_id=$1) AS occupied`,[org]);
  return Boolean(r.rows[0]?.occupied);
}
export async function collidingIds(client:PoolClient,items:Item[]) {
  const conflicts:string[]=[];
  for(const item of items) {
    const spec=tables[item.type];if(!spec) continue;
    const r=await client.query(`SELECT 1 FROM ${spec.table} WHERE id=$1`,[item.targetId]);
    if(r.rowCount) conflicts.push(item.targetId);
  }
  return conflicts;
}
