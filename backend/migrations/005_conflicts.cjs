exports.up = pgm => pgm.sql(`
  CREATE TABLE sync_conflicts (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id),
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    source_device_id uuid NOT NULL,
    source_user_id uuid NOT NULL,
    source_sync_operation_id uuid NOT NULL,
    base_revision bigint NOT NULL,
    server_revision_at_conflict bigint NOT NULL,
    client_operation_type text NOT NULL CHECK (client_operation_type IN ('create','update','delete')),
    client_proposal jsonb NOT NULL,
    server_snapshot jsonb NOT NULL,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    resolved_by_user_id uuid,
    resolution_type text CHECK (resolution_type IN ('keep_server','apply_client','manual_merge')),
    resolution_resulting_revision bigint,
    resolution_metadata jsonb,
    UNIQUE (organization_id,id),
    UNIQUE (organization_id,source_sync_operation_id),
    FOREIGN KEY (organization_id,source_device_id) REFERENCES devices(organization_id,id),
    FOREIGN KEY (organization_id,source_user_id) REFERENCES users(organization_id,id),
    FOREIGN KEY (organization_id,source_sync_operation_id) REFERENCES sync_operations(organization_id,id),
    FOREIGN KEY (organization_id,resolved_by_user_id) REFERENCES users(organization_id,id),
    CHECK ((status='open' AND resolved_at IS NULL AND resolution_type IS NULL AND resolved_by_user_id IS NULL) OR
           (status='resolved' AND resolved_at IS NOT NULL AND resolution_type IS NOT NULL AND resolved_by_user_id IS NOT NULL))
  );
  CREATE INDEX sync_conflicts_listing ON sync_conflicts (organization_id,status,created_at,id);
  CREATE INDEX sync_conflicts_entity ON sync_conflicts (organization_id,entity_type,entity_id);
`);
exports.down = pgm => pgm.sql('DROP TABLE sync_conflicts;');
