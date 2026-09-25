import { z } from 'zod';

const uuid = z.uuid();
const text = z.string().trim().min(1).max(250);
const money = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/);
const quantity = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/);
const position = z.number().int().min(0).max(1000000);
const specs = {
  project: { table:'projects', fields:{name:'name'}, create:z.strictObject({name:text}) },
  estimate: { table:'estimates', fields:{projectId:'project_id',name:'name'}, create:z.strictObject({projectId:uuid,name:text}) },
  estimateItem: { table:'estimate_items', fields:{estimateId:'estimate_id',title:'title',quantity:'quantity',unit:'unit'}, create:z.strictObject({estimateId:uuid,title:text,quantity,unit:z.string().trim().max(50).nullable().optional()}) },
  material: { table:'materials', fields:{name:'name',unit:'unit'}, create:z.strictObject({name:text,unit:z.string().trim().max(50).nullable().optional()}) },
  stage: { table:'stages', fields:{projectId:'project_id',name:'name',position:'position'}, create:z.strictObject({projectId:uuid,name:text,position}) },
  payment: { table:'payments', fields:{projectId:'project_id',amount:'amount',currency:'currency',paidAt:'paid_at'}, create:z.strictObject({projectId:uuid,amount:money,currency:z.string().regex(/^[A-Z]{3}$/),paidAt:z.iso.datetime().nullable().optional()}) },
  task: { table:'tasks', fields:{projectId:'project_id',assigneeId:'assignee_id',title:'title',status:'status'}, create:z.strictObject({projectId:uuid,assigneeId:uuid.nullable().optional(),title:text,status:z.enum(['open','in_progress','done'])}) },
} as const;
export type EntityType = keyof typeof specs;
export const entityTypes = Object.keys(specs) as EntityType[];
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
