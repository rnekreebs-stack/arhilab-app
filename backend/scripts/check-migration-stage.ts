import assert from 'node:assert/strict';
import { pool } from '../src/database/pool.js';

const stage = Number(process.argv[2]);
if (!Number.isInteger(stage) || stage < 0 || stage > 14) throw Error('Invalid migration stage');
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
  ['estimates.work_markup_percent','COLUMN',9],
  ['estimates.delivery_amount','COLUMN',10],['estimates.discount_amount','COLUMN',10],
  ['estimate_items.item_kind','COLUMN',10],['estimate_items.unit_price','COLUMN',10],
  ['estimate_items.coefficient','COLUMN',10],['estimate_items.material_price','COLUMN',10],
  ['projects.address','COLUMN',10],['projects.client_name','COLUMN',10],
  ['estimates.private_fields','COLUMN',11],['estimate_items.private_fields','COLUMN',11],
  ['estimates.currency','COLUMN',12],['payments.estimate_id','COLUMN',12],
  ['payments.payment_kind','COLUMN',12],['payments.paid_amount','COLUMN',12],
  ['payments.business_date','COLUMN',12],['payments.plan_date','COLUMN',12],
  ['payments.actual_date','COLUMN',12],['payments.comment','COLUMN',12],
  ['payments.payment_type','COLUMN',12],['payments_estimate_active_idx','INDEX',12],
  ['expenses','TABLE',13],['expenses.estimate_id','COLUMN',13],
  ['expenses_project_active_idx','INDEX',13],['expenses_estimate_active_idx','INDEX',13],
  ['stages.estimate_id','COLUMN',14],['estimate_items.stage_id','COLUMN',14],
  ['progress_entries','TABLE',14],['progress_entries.historical_stage_id','COLUMN',14],
  ['stages_estimate_active_idx','INDEX',14],['progress_entries_item_active_idx','INDEX',14],
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
