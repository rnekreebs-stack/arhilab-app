import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonical } from '../sync/canonical.js';

const uuid=z.uuid();
const label=z.string().min(1).max(250);
const optionalText=z.string().max(5000).optional();
const nonnegative=z.number().finite().min(0).max(1e12);
const unsafeKey=/^(?:__proto__|constructor|prototype|users|settings|credentials|password|passwordhash|hash|salt|sessionhash|session|accesstoken|refreshtoken|token|secret|privatekey|databaseurl|cloud|backup)$/i;
function businessTree(value:unknown,depth=0):boolean {
  if(depth>8) return false;
  if(value===null || typeof value==='boolean') return true;
  if(typeof value==='number') return Number.isFinite(value);
  if(typeof value==='string') return (value.length<=5000 || /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value) && value.length<=6000000) && !value.startsWith('-----BEGIN ');
  if(Array.isArray(value)) return value.length<=500 && value.every(v=>businessTree(v,depth+1));
  if(typeof value==='object') {
    const entries=Object.entries(value);
    return entries.length<=100 && entries.every(([key,v])=>key.length<=100 && !unsafeKey.test(key) && businessTree(v,depth+1));
  }
  return false;
}
const businessJson=z.unknown().refine(v=>businessTree(v),{message:'Unsafe legacy business data'});
const photo=z.strictObject({id:uuid,name:optionalText,purchaseRef:optionalText,type:optionalText,date:optionalText,
  data:z.string().regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/).max(6000000)});
const line=z.strictObject({id:uuid,name:label,qty:nonnegative,coef:nonnegative,price:nonnegative,
  cost:nonnegative.optional(),unit:optionalText,materialCost:nonnegative.optional(),materialPrice:nonnegative.optional(),
  materialTier:optionalText,autoMaterial:z.boolean().optional(),extra:z.boolean().optional(),extraStatus:optionalText,
  createdBy:optionalText,createdAt:z.number().int().nonnegative().optional(),approvedBy:optionalText}).catchall(businessJson);
const material=z.strictObject({id:uuid,name:label,qty:nonnegative,cost:nonnegative.optional(),price:nonnegative.optional(),unit:optionalText,sku:optionalText}).catchall(businessJson);
const task=z.strictObject({id:uuid,name:label,done:z.boolean().optional(),progress:z.number().int().min(0).max(100).optional(),
  status:label,planDate:optionalText,actualDate:optionalText,responsible:optionalText,comment:optionalText}).catchall(businessJson);
const payment=z.strictObject({id:uuid,amount:nonnegative,kind:z.enum(['income','expense']),date:label,note:optionalText,
  type:optionalText,planDate:optionalText,actualDate:optionalText,paid:nonnegative.optional()}).catchall(businessJson);
const note=z.strictObject({text:z.string().max(5000),author:optionalText,date:optionalText});
export const legacyProject=z.strictObject({id:uuid,name:label,address:optionalText,client:optionalText,status:optionalText,assigned:uuid.or(z.literal('')).optional(),
  delivery:nonnegative.optional(),discount:nonnegative.optional(),deliveryCost:nonnegative.optional(),overhead:nonnegative.optional(),otherCost:nonnegative.optional(),
  materialMarkup:z.number().int().min(0).max(100).optional(),lines:z.array(line).max(200),materials:z.array(material).max(200),
  tasks:z.array(task).max(200),payments:z.array(payment).max(200),notes:z.array(note).max(200),
  photos:z.array(photo).max(200),estimatePhotos:z.array(photo).max(200).optional(),purchases:businessJson.optional()});
export const packageSchema=z.strictObject({
  format:z.literal('ArhilabMigration-1'),sourceFormat:z.literal('Arhilab-2'),sourceAppVersion:z.literal('0.6.2'),
  sourceSchemaVersion:z.literal(2),exportedAt:z.iso.datetime(),projects:z.array(legacyProject).max(500),
  catalog:businessJson.optional(),team:z.array(z.strictObject({id:uuid,name:label,login:z.string().max(250),role:z.enum(['admin','manager','worker'])})).max(200).optional(),
}).refine(v=>businessTree(v),{message:'Unsafe legacy business data'});
export type LegacyPackage=z.infer<typeof packageSchema>;
export type LegacyProject=z.infer<typeof legacyProject>;
export type MigrationIssue={severity:'warning'|'blocking';code:string;legacyEntityType:string;legacyEntityId:string|null;field:string;details:Record<string,string>};
const issue=(severity:MigrationIssue['severity'],code:string,kind:string,id:string|null,field:string):MigrationIssue=>({severity,code,legacyEntityType:kind,legacyEntityId:id,field,details:{}});
export const packageHash=(value:LegacyPackage)=>createHash('sha256').update(canonical(value)).digest('hex');
export function inspectPackage(value:LegacyPackage) {
  const issues:MigrationIssue[]=[],seen=new Set<string>();
  const counts={projects:value.projects.length,estimates:0,estimateItems:0,materials:0,tasks:0,payments:0,photos:0};
  for(const project of value.projects) {
    if(seen.has(project.id)) issues.push(issue('blocking','duplicate_source_id','project',project.id,'id'));
    seen.add(project.id);
    const preserved=['address','client','status','assigned','delivery','discount','deliveryCost','overhead','otherCost','materialMarkup','notes','purchases'];
    for(const field of preserved) if(project[field as keyof LegacyProject]!==undefined && (field!=='notes'||project.notes.length))
      issues.push(issue('warning','preserved_legacy_only','project',project.id,field));
    if(project.lines.length) counts.estimates++;
    counts.estimateItems+=project.lines.length;counts.materials+=project.materials.length;
    counts.tasks+=project.tasks.length;counts.payments+=project.payments.length;
    counts.photos+=project.photos.length+(project.estimatePhotos?.length??0);
    for(const [kind,rows] of [['estimateItem',project.lines],['material',project.materials],['task',project.tasks],['payment',project.payments],['photo',[...project.photos,...(project.estimatePhotos??[])]]] as const) {
      for(const row of rows) {
        if(seen.has(row.id)) issues.push(issue('blocking','duplicate_source_id',kind,row.id,'id'));
        seen.add(row.id);
        if(kind==='payment') issues.push(issue('blocking','payment_currency_required','payment',row.id,'currency'));
        if(kind==='payment' && 'amount' in row && !/^\d{1,16}(\.\d{1,2})?$/.test(String(row.amount))) issues.push(issue('blocking','invalid_money_precision','payment',row.id,'amount'));
        if(kind==='payment') for(const field of ['kind','paid','date','planDate','actualDate','note','type']) if(field in row) issues.push(issue('warning','preserved_legacy_only','payment',row.id,field));
        if(kind==='task' && 'status' in row && typeof row.status==='string' && !['Не начато','В работе','Завершено'].includes(row.status)) issues.push(issue('blocking','unsupported_task_status','task',row.id,'status'));
        if(kind==='estimateItem' && 'qty' in row && !/^\d{1,14}(\.\d{1,4})?$/.test(String(row.qty)))
          issues.push(issue('blocking','invalid_quantity_precision',kind,row.id,'qty'));
        if(kind==='estimateItem') for(const field of ['coef','price','cost','materialCost','materialPrice','materialTier','extra','extraStatus'])
          if(field in row) issues.push(issue('warning','preserved_legacy_only',kind,row.id,field));
        const mapped=kind==='estimateItem'?['id','name','qty','unit']:kind==='material'?['id','name','unit']:kind==='task'?['id','name','status']:kind==='payment'?['id','amount']:['id','name','purchaseRef','type'];
        for(const field of Object.keys(row)) if(!mapped.includes(field) && kind!=='payment' && (kind!=='estimateItem'||!['coef','price','cost','materialCost','materialPrice','materialTier','extra','extraStatus'].includes(field)))
          issues.push(issue('warning','preserved_legacy_only',kind,row.id,field));
      }
    }
    if(project.photos.length || project.estimatePhotos?.length) issues.push(issue('warning','photos_pending_stage5','project',project.id,'photos'));
  }
  if(value.catalog!==undefined) issues.push(issue('warning','preserved_legacy_only','catalog',null,'catalog'));
  if(value.team?.length) issues.push(issue('warning','legacy_users_not_auth','team',null,'team'));
  return {counts,issues,blocking:issues.filter(x=>x.severity==='blocking').length};
}
