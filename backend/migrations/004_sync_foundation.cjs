exports.up = (pgm) => pgm.sql(`
  ALTER TABLE organizations ADD COLUMN sync_cursor bigint NOT NULL DEFAULT 0 CHECK (sync_cursor >= 0);
  ALTER TABLE sync_operations ADD COLUMN request_hash char(64), ADD COLUMN result jsonb, ADD COLUMN change_sequence bigint;
  CREATE INDEX sync_operations_entity ON sync_operations (organization_id,entity_type,entity_id);
  CREATE INDEX sync_operations_device ON sync_operations (organization_id,device_id,created_at);
  CREATE TABLE sync_changes (
    organization_id uuid NOT NULL REFERENCES organizations(id),
    sequence bigint NOT NULL CHECK (sequence > 0),
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    operation_type text NOT NULL CHECK (operation_type IN ('create','update','delete')),
    snapshot jsonb NOT NULL,
    source_device_id uuid NOT NULL,
    sync_operation_id uuid NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id,sequence),
    UNIQUE (organization_id,sync_operation_id),
    FOREIGN KEY (organization_id,source_device_id) REFERENCES devices(organization_id,id),
    FOREIGN KEY (organization_id,sync_operation_id) REFERENCES sync_operations(organization_id,id)
  );
  CREATE INDEX sync_changes_entity ON sync_changes (organization_id,entity_type,entity_id,sequence);
`);
exports.down = (pgm) => pgm.sql(`
  DROP TABLE sync_changes;
  DROP INDEX sync_operations_device, sync_operations_entity;
  ALTER TABLE sync_operations DROP COLUMN request_hash, DROP COLUMN result, DROP COLUMN change_sequence;
  ALTER TABLE organizations DROP COLUMN sync_cursor;
`);
