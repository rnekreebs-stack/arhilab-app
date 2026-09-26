import assert from 'node:assert/strict';
import { pool } from '../src/database/pool.js';

const stage = Number(process.argv[2]);
if (!Number.isInteger(stage) || stage < 0 || stage > 8) throw Error('Invalid migration stage');
const requirements = [
  ['organizations','TABLE',1],['users','TABLE',1],['sync_operations','TABLE',1],
  ['sessions','TABLE',2],['refresh_credentials','TABLE',2],
  ['users.password_hash','COLUMN',2],['users.active','COLUMN',2],
  ['users_organization_email_ci','INDEX',2],['sessions_user_active','INDEX',2],['refresh_session','INDEX',2],
  ['users.must_change_password','COLUMN',3],
  ['sync_changes','TABLE',4],['organizations.sync_cursor','COLUMN',4],
  ['sync_operations.request_hash','COLUMN',4],['sync_operations.result','COLUMN',4],
  ['sync_operations.change_sequence','COLUMN',4],['sync_changes_entity','INDEX',4],
  ['sync_changes_pkey','INDEX',4],['sync_changes_organization_id_sync_operation_id_key','INDEX',4],
  ['sync_conflicts','TABLE',5],['sync_conflicts_listing','INDEX',5],['sync_conflicts_entity','INDEX',5],
  ['migration_sessions','TABLE',7],['migration_chunks','TABLE',7],['migration_legacy_snapshots','TABLE',7],
  ['migration_issues','TABLE',7],['migration_entity_mappings','TABLE',7],
  ['photos.content_sha256','COLUMN',8],['photos.status','COLUMN',8],['photos.idempotency_key','COLUMN',8],
  ['documents.content_sha256','COLUMN',8],['documents.status','COLUMN',8],['documents.idempotency_key','COLUMN',8],
  ['photos_org_intent','INDEX',8],['documents_org_intent','INDEX',8],
] as const;
try {
  for (const [name,kind,fromStage] of requirements) {
    const [table,column] = name.split('.');
    const query = kind === 'TABLE'
      ? "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1"
      : kind === 'COLUMN'
        ? "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2"
        : "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1";
    const result = await pool.query(query,kind === 'COLUMN' ? [table,column] : [name]);
    assert.equal(Boolean(result.rowCount),stage >= fromStage,`${name}: expected ${stage >= fromStage} at migration ${stage}`);
  }
  if (stage >= 4) {
    const constraints=await pool.query("SELECT conname FROM pg_constraint WHERE conrelid='sync_changes'::regclass AND contype='f'");
    assert.ok(constraints.rows.length >= 3,'Stage 3 change feed tenant and operation references');
  }
  if (stage >= 5) {
    const constraints=await pool.query("SELECT 1 FROM pg_constraint WHERE conrelid='sync_conflicts'::regclass AND contype='f'");
    assert.ok(constraints.rows.length>=4,'Conflict foreign keys missing');
  }
  const immutable=await pool.query("SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.sync_conflicts') AND tgname='sync_conflicts_immutable'");
  assert.equal(Boolean(immutable.rowCount),stage>=6,'Immutable conflict trigger mismatch');
  const legacy=await pool.query("SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.migration_legacy_snapshots') AND tgname='legacy_snapshot_immutable'");
  assert.equal(Boolean(legacy.rowCount),stage>=7,'Immutable legacy snapshot trigger mismatch');
  console.log(`Migration stage ${stage} schema verified`);
} finally { await pool.end(); }
