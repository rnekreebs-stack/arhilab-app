import { z } from 'zod';

const uuid = z.uuid();
const text = z.string().trim().min(1).max(250);
const money = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/);
const workMarkup = z.string().regex(/^(?:0|[1-9]\d?|100)(?:\.\d{1,2})?$/).refine(value=>Number(value)<=100);
const quantity = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/);
const position = z.number().int().min(0).max(1000000);
const estimatePrivate = z.strictObject({materialMarkup:z.number().int().min(0).max(100).optional(),
  deliveryCost:money.optional(),overhead:money.optional(),otherCost:money.optional(),incompleteLegacy:z.boolean().optional()});
const itemPrivate = z.strictObject({cost:money.optional(),materialCost:money.optional(),
  materialTier:z.enum(['economy','standard','premium']).optional(),materialNote:z.string().max(2000).optional(),
  materials:z.array(z.string().max(250)).max(100).optional(),
  kitOverrides:z.record(z.string().max(250),z.strictObject({sku:z.string().max(250),qty:quantity})).optional()});
const specs = {
  project: { table:'projects', fields:{name:'name',address:'address',client:'client_name',status:'project_status'}, create:z.strictObject({name:text,address:z.string().max(500).optional(),client:z.string().max(500).optional(),status:z.string().max(100).optional()}) },
  estimate: { table:'estimates', fields:{projectId:'project_id',name:'name',workMarkupPercent:'work_markup_percent',delivery:'delivery_amount',discount:'discount_amount',currency:'currency',privateData:'private_fields'}, create:z.strictObject({projectId:uuid,name:text,workMarkupPercent:workMarkup.optional(),delivery:money.optional(),discount:money.optional(),currency:z.string().regex(/^[A-Z]{3}$/).nullable().optional(),privateData:estimatePrivate.optional()}) },
  estimateItem: { table:'estimate_items', fields:{estimateId:'estimate_id',title:'title',quantity:'quantity',unit:'unit',kind:'item_kind',price:'unit_price',coefficient:'coefficient',autoMaterial:'auto_material',materialPrice:'material_price',catalogKey:'catalog_key',extra:'extra',extraStatus:'extra_status',privateData:'private_fields',stageId:'stage_id'}, create:z.strictObject({estimateId:uuid,title:text,quantity,unit:z.string().trim().max(50).nullable().optional(),kind:z.enum(['work','material']).optional(),price:money.optional(),coefficient:quantity.optional(),autoMaterial:z.boolean().optional(),materialPrice:money.optional(),catalogKey:z.string().max(250).nullable().optional(),extra:z.boolean().optional(),extraStatus:z.string().max(100).nullable().optional(),privateData:itemPrivate.optional(),stageId:uuid.nullable().optional()}) },
  material: { table:'materials', fields:{name:'name',unit:'unit'}, create:z.strictObject({name:text,unit:z.string().trim().max(50).nullable().optional()}) },
  stage: { table:'stages', fields:{projectId:'project_id',estimateId:'estimate_id',name:'name',description:'description',position:'position'}, create:z.strictObject({projectId:uuid,estimateId:uuid.optional(),name:text,description:z.string().max(1000).optional(),position}) },
  progressEntry: { table:'progress_entries', fields:{projectId:'project_id',estimateId:'estimate_id',estimateItemId:'estimate_item_id',historicalStageId:'historical_stage_id',quantity:'quantity',businessDate:'business_date',note:'note',createdBy:'created_by'}, create:z.strictObject({projectId:uuid,estimateId:uuid,estimateItemId:uuid,quantity:quantity.refine(value=>Number(value)>0),businessDate:z.iso.date(),note:z.string().max(1000).optional()}) },
  payment: { table:'payments', fields:{projectId:'project_id',estimateId:'estimate_id',amount:'amount',currency:'currency',paidAt:'paid_at',kind:'payment_kind',paidAmount:'paid_amount',businessDate:'business_date',planDate:'plan_date',actualDate:'actual_date',comment:'comment',paymentType:'payment_type'}, create:z.strictObject({projectId:uuid,estimateId:uuid.nullable().optional(),amount:money,currency:z.string().regex(/^[A-Z]{3}$/),paidAt:z.iso.datetime().nullable().optional(),kind:z.enum(['income','expense']).optional(),paidAmount:money.optional(),businessDate:z.iso.date().nullable().optional(),planDate:z.iso.date().nullable().optional(),actualDate:z.iso.date().nullable().optional(),comment:z.string().max(1000).nullable().optional(),paymentType:z.string().max(100).nullable().optional()}) },
  expense: {table:'expenses',fields:{projectId:'project_id',estimateId:'estimate_id',category:'category',amount:'amount',currency:'currency',businessDate:'business_date',description:'description',note:'note'},
    create:z.strictObject({projectId:uuid,estimateId:uuid.nullable().optional(),
      category:z.enum(['materials','labor','subcontractor','delivery','equipment','other']),
      amount:money.refine(value=>/^\d{1,16}(\.\d{1,2})?$/.test(value) && BigInt(value.replace('.',''))>0n),
      currency:z.string().regex(/^[A-Z]{3}$/),businessDate:z.iso.date(),
      description:text,note:z.string().max(1000).optional()})},
  task: { table:'tasks', fields:{projectId:'project_id',estimateId:'estimate_id',stageId:'stage_id',estimateItemId:'estimate_item_id',assigneeId:'assignee_id',title:'title',description:'description',status:'status',priority:'priority',dueDate:'due_date',completedAt:'completed_at',createdBy:'created_by'}, create:z.strictObject({projectId:uuid,estimateId:uuid.nullable().optional(),stageId:uuid.nullable().optional(),estimateItemId:uuid.nullable().optional(),assigneeId:uuid.nullable().optional(),title:text,description:z.string().max(1000).optional(),status:z.enum(['open','in_progress','done']),priority:z.enum(['normal','high','urgent']).optional(),dueDate:z.iso.date().nullable().optional()}) },
  procurementRequest: {table:'procurement_requests',fields:{projectId:'project_id',estimateId:'estimate_id',stageId:'stage_id',estimateItemId:'estimate_item_id',catalogSku:'catalog_sku',title:'title',unit:'unit',requestedQuantity:'requested_quantity',status:'status',neededByDate:'needed_by_date',assigneeId:'assignee_id',note:'note',createdBy:'created_by'},
    create:z.strictObject({projectId:uuid,estimateId:uuid.nullable().optional(),stageId:uuid.nullable().optional(),estimateItemId:uuid.nullable().optional(),catalogSku:z.string().trim().min(1).max(100).nullable().optional(),title:text,unit:z.string().trim().min(1).max(50),requestedQuantity:quantity.refine(v=>Number(v)>0),status:z.enum(['requested','ordered','partially_received','received','cancelled']),neededByDate:z.iso.date().nullable().optional(),assigneeId:uuid.nullable().optional(),note:z.string().max(1000).optional()})},
  procurementReceipt: {table:'procurement_receipts',fields:{projectId:'project_id',requestId:'request_id',quantity:'quantity',businessDate:'business_date',note:'note',createdBy:'created_by'},
    create:z.strictObject({projectId:uuid,requestId:uuid,quantity:quantity.refine(v=>Number(v)>0),businessDate:z.iso.date(),note:z.string().max(1000).optional()})},
  photo: {table:'photos',fields:{projectId:'project_id',filename:'original_filename',mimeType:'mime_type',byteSize:'byte_size',sha256:'content_sha256',status:'status'},create:z.strictObject({projectId:uuid})},
  document: {table:'documents',fields:{projectId:'project_id',filename:'original_filename',mimeType:'mime_type',byteSize:'byte_size',sha256:'content_sha256',status:'status'},create:z.strictObject({projectId:uuid})},
} as const;
export type EntityType = keyof typeof specs;
export const entityTypes = Object.keys(specs) as EntityType[];
export function visibleSnapshot(role:'admin'|'manager'|'worker',snapshot:Record<string,unknown>) {
  if(role==='admin') return snapshot;
  const visible={...snapshot};delete visible.privateData;
  if(role==='worker') for(const field of ['price','materialPrice','coefficient','workMarkupPercent','delivery','discount','currency']) delete visible[field];
  return visible;
}
export function specification(type: string) {
  if (!Object.prototype.hasOwnProperty.call(specs,type)) return null;
  const spec = specs[type as EntityType];
  return { table: spec.table, fields: spec.fields as Record<string,string>, create:spec.create as z.ZodObject<z.ZodRawShape> };
}
export function parsePayload(type: EntityType, operation: string, payload: unknown): Record<string,unknown> | null {
  if (operation === 'delete') {
    return z.strictObject({}).safeParse(payload).success ? {} : null;
  }
  const spec=specification(type);
  if (!spec || (operation !== 'create' && operation !== 'update')) return null;
  const schema=operation==='create' ? spec.create : spec.create.partial().refine(fields=>Object.keys(fields).length>0);
  const result=schema.safeParse(payload);
  return result.success ? result.data : null;
}
