import { randomUUID } from 'node:crypto';
import { pool } from '../src/database/pool.js';
const tables = ['organizations','users','devices','projects','estimates','estimate_items','materials','stages','payments','tasks','photos','documents','sync_operations','audit_logs'];
tables.push('sessions','refresh_credentials','sync_changes');
try {
  const result = await pool.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)", [tables]);
  if (result.rows.length !== tables.length) throw new Error(`Expected ${tables.length} entity tables, got ${result.rows.length}`);
  const constraints = await pool.query<{constraint_name:string}>("SELECT constraint_name FROM information_schema.table_constraints WHERE table_name='refresh_credentials' AND constraint_type='FOREIGN KEY'");
  if (!constraints.rowCount) throw new Error('Refresh session foreign key missing');
  const indexes = await pool.query<{indexname:string}>("SELECT indexname FROM pg_indexes WHERE tablename='users' AND indexname='users_organization_email_ci'");
  if (!indexes.rowCount) throw new Error('Tenant email unique index missing');
  const feed=await pool.query("SELECT 1 FROM pg_indexes WHERE tablename='sync_changes' AND indexname='sync_changes_pkey'");
  if (!feed.rowCount) throw new Error('Scoped cursor index missing');
  const cursor=await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='organizations' AND column_name='sync_cursor'");
  if (!cursor.rowCount) throw new Error('Organization sync cursor missing');
  const markup=await pool.query<{column_default:string|null;is_nullable:string}>("SELECT column_default,is_nullable FROM information_schema.columns WHERE table_name='estimates' AND column_name='work_markup_percent'");
  if(markup.rows[0]?.is_nullable!=='NO'||!markup.rows[0]?.column_default?.includes('0')) throw new Error('Estimate work markup must default to zero');
  const range=await pool.query("SELECT 1 FROM pg_constraint WHERE conrelid='estimates'::regclass AND conname='estimates_work_markup_range'");
  if(!range.rowCount) throw new Error('Estimate work markup range constraint missing');
  const financials=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='estimates' AND column_name IN ('delivery_amount','discount_amount')");
  if(financials.rowCount!==2) throw new Error('Estimate delivery and discount missing');
  const restricted=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name IN ('estimates','estimate_items') AND column_name='private_fields'");
  if(restricted.rowCount!==2) throw new Error('Admin-only estimate fields missing');
  const a = randomUUID(), b = randomUUID(), project = randomUUID();
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO organizations(id,name) VALUES ($1,$2),($3,$4)', [a,'A',b,'B']);
    await client.query('INSERT INTO projects(id,organization_id,name) VALUES ($1,$2,$3)', [project,a,'Project']);
    const estimate=randomUUID();
    const created=await client.query<{work_markup_percent:string}>('INSERT INTO estimates(id,organization_id,project_id,name) VALUES ($1,$2,$3,$4) RETURNING work_markup_percent',[estimate,a,project,'Legacy']);
    if(created.rows[0]?.work_markup_percent!=='0.00') throw new Error('Legacy estimate markup changed');
    let blocked = false;
    try { await client.query('INSERT INTO estimates(id,organization_id,project_id,name) VALUES ($1,$2,$3,$4)', [randomUUID(),b,project,'Cross tenant']); }
    catch { blocked = true; }
    if (!blocked) throw new Error('Cross organization relationship was accepted');
  } finally { await client.query('ROLLBACK'); client.release(); }
  console.log('Schema tables and organization isolation verified');
} finally { await pool.end(); }
