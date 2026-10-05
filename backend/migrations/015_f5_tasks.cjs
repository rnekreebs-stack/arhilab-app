exports.up = pgm => pgm.sql(`
  ALTER TABLE tasks
    ADD COLUMN description text NOT NULL DEFAULT '' CHECK (length(description)<=1000),
    ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','urgent')),
    ADD COLUMN due_date date,
    ADD COLUMN completed_at timestamptz,
    ADD COLUMN estimate_id uuid,
    ADD COLUMN stage_id uuid,
    ADD COLUMN estimate_item_id uuid,
    ADD COLUMN created_by uuid;
  UPDATE tasks SET completed_at=updated_at WHERE status='done';
  ALTER TABLE tasks ADD CONSTRAINT tasks_status_valid CHECK (status IN ('open','in_progress','done'));
  ALTER TABLE tasks ADD CONSTRAINT tasks_completion_valid CHECK ((status='done')=(completed_at IS NOT NULL));
  ALTER TABLE tasks ADD CONSTRAINT tasks_estimate_owner
    FOREIGN KEY (organization_id,project_id,estimate_id) REFERENCES estimates(organization_id,project_id,id);
  ALTER TABLE tasks ADD CONSTRAINT tasks_stage_owner
    FOREIGN KEY (organization_id,estimate_id,stage_id) REFERENCES stages(organization_id,estimate_id,id);
  ALTER TABLE tasks ADD CONSTRAINT tasks_item_owner
    FOREIGN KEY (organization_id,estimate_id,estimate_item_id) REFERENCES estimate_items(organization_id,estimate_id,id);
  ALTER TABLE tasks ADD CONSTRAINT tasks_created_by_owner
    FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id);
  ALTER TABLE tasks ADD CONSTRAINT tasks_link_requires_estimate CHECK (estimate_id IS NOT NULL OR (stage_id IS NULL AND estimate_item_id IS NULL));
  CREATE INDEX tasks_due_active_idx ON tasks(organization_id,project_id,due_date,priority,id)
    WHERE deleted_at IS NULL;
  CREATE INDEX tasks_assignee_active_idx ON tasks(organization_id,assignee_id,due_date,id)
    WHERE deleted_at IS NULL;
`);

exports.down = pgm => pgm.sql(`
  DROP INDEX tasks_assignee_active_idx;
  DROP INDEX tasks_due_active_idx;
  ALTER TABLE tasks
    DROP CONSTRAINT tasks_link_requires_estimate,
    DROP CONSTRAINT tasks_created_by_owner,
    DROP CONSTRAINT tasks_item_owner,
    DROP CONSTRAINT tasks_stage_owner,
    DROP CONSTRAINT tasks_estimate_owner,
    DROP CONSTRAINT tasks_completion_valid,
    DROP CONSTRAINT tasks_status_valid,
    DROP COLUMN created_by,
    DROP COLUMN estimate_item_id,
    DROP COLUMN stage_id,
    DROP COLUMN estimate_id,
    DROP COLUMN completed_at,
    DROP COLUMN due_date,
    DROP COLUMN priority,
    DROP COLUMN description;
`);
