import { pool } from '../database/pool.js';
import { config } from '../config/env.js';
import { storage,type ObjectStorage } from './storage.js';

type Candidate={id:string;organization_id:string;storage_key:string;status:string;updated_at:Date};
export async function cleanupOldObjects(apply=false,objectStore:ObjectStorage=storage,now=new Date()) {
  const removed:Array<{kind:string;id:string}>=[],eligible:Array<{kind:string;id:string}>=[];
  for(const table of ['photos','documents'] as const) {
    const rows=await pool.query<Candidate>(`SELECT id,organization_id,storage_key,status,updated_at FROM ${table}
      WHERE status IN ('pending','uploaded','failed','deleted') ORDER BY organization_id,id`);
    for(const candidate of rows.rows) {
      const ageHours=(now.getTime()-candidate.updated_at.getTime())/3600000;
      const threshold=candidate.status==='deleted'?30*24:config.FILE_INTENT_TTL_HOURS;
      if(ageHours<threshold) continue;
      eligible.push({kind:table,id:candidate.id});
      if(!apply) continue;
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM organizations WHERE id=$1 FOR NO KEY UPDATE',[candidate.organization_id]);
        const current=(await client.query<Candidate>(`SELECT id,organization_id,storage_key,status,updated_at FROM ${table}
          WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[candidate.organization_id,candidate.id])).rows[0];
        if(!current||!['pending','uploaded','failed','deleted'].includes(current.status)||
          (now.getTime()-current.updated_at.getTime())/3600000<(current.status==='deleted'?30*24:config.FILE_INTENT_TTL_HOURS)) {
          await client.query('ROLLBACK');continue;
        }
        await objectStore.delete(current.storage_key);
        if(current.status!=='deleted') await client.query(`UPDATE ${table} SET status='failed',updated_at=now() WHERE id=$1`,[current.id]);
        await client.query(`INSERT INTO audit_logs(id,organization_id,action,entity_type,entity_id,metadata)
          VALUES(gen_random_uuid(),$1,'file.cleanup',$2,$3,$4)`,[current.organization_id,table==='photos'?'photo':'document',current.id,JSON.stringify({previousStatus:current.status})]);
        await client.query('COMMIT');removed.push({kind:table,id:current.id});
      } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
    }
  }
  return {eligible,removed};
}
