import { randomUUID } from 'node:crypto';
import { pool } from '../src/database/pool.js';
const tables = ['organizations','users','devices','projects','estimates','estimate_items','materials','stages','payments','tasks','photos','documents','sync_operations','audit_logs'];
try {
  const result = await pool.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)", [tables]);
  if (result.rows.length !== tables.length) throw new Error(`Expected ${tables.length} entity tables, got ${result.rows.length}`);
  const a = randomUUID(), b = randomUUID(), project = randomUUID();
  await pool.query('BEGIN');
  try {
    await pool.query('INSERT INTO organizations(id,name) VALUES ($1,$2),($3,$4)', [a,'A',b,'B']);
    await pool.query('INSERT INTO projects(id,organization_id,name) VALUES ($1,$2,$3)', [project,a,'Project']);
    let blocked = false;
    try { await pool.query('INSERT INTO estimates(id,organization_id,project_id,name) VALUES ($1,$2,$3,$4)', [randomUUID(),b,project,'Cross tenant']); }
    catch { blocked = true; }
    if (!blocked) throw new Error('Cross organization relationship was accepted');
  } finally { await pool.query('ROLLBACK'); }
  console.log('Schema tables and organization isolation verified');
} finally { await pool.end(); }
