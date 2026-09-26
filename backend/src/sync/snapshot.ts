import { pool } from '../database/pool.js';
import { HttpError } from '../middleware/errors.js';
import type { Identity } from '../services/security.js';
import { entityTypes,specification } from './registry.js';

export async function snapshotForBootstrap(ctx:Identity,afterCursorRead?:()=>Promise<void>) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const org=await client.query<{sync_cursor:string}>('SELECT sync_cursor FROM organizations WHERE id=$1',[ctx.organizationId]);
    if(afterCursorRead) await afterCursorRead();
    const entities:Array<{entityType:string;entityId:string;revision:number;snapshot:Record<string,unknown>}>=[];
    for(const type of entityTypes) {
      const spec=specification(type);
      if(!spec) continue;
      const rows=await client.query<Record<string,unknown>>(`SELECT * FROM ${spec.table} WHERE organization_id=$1 ORDER BY id LIMIT $2`,[ctx.organizationId,1001-entities.length]);
      for(const row of rows.rows) {
        const value:Record<string,unknown>={id:row.id,revision:Number(row.revision),deletedAt:row.deleted_at};
        for(const [field,column] of Object.entries(spec.fields)) value[field]=row[column];
        entities.push({entityType:type,entityId:String(row.id),revision:Number(row.revision),snapshot:value});
      }
      if(entities.length>1000) throw new HttpError(413,'Snapshot exceeds page limit','snapshot_too_large');
    }
    await client.query('COMMIT');
    return {cursor:org.rows[0]?.sync_cursor??'0',entities};
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
}
