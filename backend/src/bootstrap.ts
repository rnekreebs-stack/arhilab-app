import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hashPassword, transaction } from './services/security.js';
import { pool } from './database/pool.js';
const input=z.object({ BOOTSTRAP_ORGANIZATION_NAME:z.string().trim().min(1),BOOTSTRAP_ADMIN_EMAIL:z.email(),BOOTSTRAP_ADMIN_PASSWORD:z.string().min(12).max(128) }).parse(process.env);
const hash=await hashPassword(input.BOOTSTRAP_ADMIN_PASSWORD);
try {
const organizationId=await transaction(async client => {
  await client.query('SELECT pg_advisory_xact_lock($1)',[172907]);
  const found=await client.query<{id:string}>('SELECT id FROM organizations WHERE name=$1 FOR UPDATE',[input.BOOTSTRAP_ORGANIZATION_NAME]);
  if ((found.rowCount ?? 0) > 1) throw Error('Ambiguous organization name; bootstrap refused');
  const orgId=found.rows[0]?.id ?? randomUUID(),userId=randomUUID();
  if (found.rowCount) {
    const users=await client.query('SELECT id FROM users WHERE organization_id=$1 LIMIT 1',[orgId]);
    if (users.rowCount) throw Error('Organization already has users; bootstrap refused');
  } else await client.query('INSERT INTO organizations(id,name) VALUES($1,$2)',[orgId,input.BOOTSTRAP_ORGANIZATION_NAME]);
  await client.query('INSERT INTO users(id,organization_id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)',[userId,orgId,input.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(),'Administrator','admin',hash]);
  return orgId;
});
console.log(`Organization initialized: ${organizationId}`);
} finally { await pool.end(); }
