exports.up = pgm => pgm.sql(`
  CREATE TABLE migration_sessions (
    id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), initiated_by_user_id uuid NOT NULL,
    source_device_id uuid NOT NULL, source_format text NOT NULL CHECK (source_format='Arhilab-2'),
    source_app_version text NOT NULL, source_schema_version integer NOT NULL CHECK (source_schema_version=2),
    package_hash char(64) NOT NULL, expected_chunks integer NOT NULL CHECK (expected_chunks BETWEEN 1 AND 100),
    status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','validated','importing','verification_failed','ready_to_finalize','completed','cancelled','failed')),
    counts jsonb NOT NULL DEFAULT '{}'::jsonb, blocking_issue_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    verified_at timestamptz, finalized_at timestamptz,
    UNIQUE (organization_id,id), UNIQUE (organization_id,package_hash),
    FOREIGN KEY (organization_id,initiated_by_user_id) REFERENCES users(organization_id,id),
    FOREIGN KEY (organization_id,source_device_id) REFERENCES devices(organization_id,id)
  );
  CREATE TABLE migration_chunks (
    session_id uuid NOT NULL REFERENCES migration_sessions(id), chunk_index integer NOT NULL CHECK (chunk_index>=0),
    content_hash char(64) NOT NULL, projects jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id,chunk_index)
  );
  CREATE TABLE migration_legacy_snapshots (
    session_id uuid PRIMARY KEY REFERENCES migration_sessions(id), organization_id uuid NOT NULL,
    source_format text NOT NULL, source_app_version text NOT NULL, source_schema_version integer NOT NULL,
    package_hash char(64) NOT NULL, business_snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (organization_id,session_id) REFERENCES migration_sessions(organization_id,id)
  );
  CREATE FUNCTION prevent_legacy_snapshot_update() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION 'Legacy snapshot is immutable'; END; $$;
  CREATE TRIGGER legacy_snapshot_immutable BEFORE UPDATE OR DELETE ON migration_legacy_snapshots FOR EACH ROW EXECUTE FUNCTION prevent_legacy_snapshot_update();
  CREATE TABLE migration_issues (
    id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES migration_sessions(id),
    severity text NOT NULL CHECK (severity IN ('warning','blocking')),
    code text NOT NULL, legacy_entity_type text NOT NULL, legacy_entity_id uuid,
    field text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb,
    resolved_at timestamptz, resolution jsonb,
    UNIQUE (session_id,code,legacy_entity_type,legacy_entity_id,field)
  );
  CREATE INDEX migration_issues_open ON migration_issues(session_id,severity) WHERE resolved_at IS NULL;
  CREATE TABLE migration_entity_mappings (
    session_id uuid NOT NULL REFERENCES migration_sessions(id), legacy_entity_type text NOT NULL,
    legacy_entity_id uuid NOT NULL, target_entity_type text NOT NULL, target_entity_id uuid NOT NULL,
    mapping_status text NOT NULL CHECK (mapping_status IN ('proposed','imported')),
    imported_revision bigint, created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id,legacy_entity_type,legacy_entity_id),
    UNIQUE (session_id,target_entity_type,target_entity_id)
  );
`);
exports.down = pgm => pgm.sql(`
  DROP TABLE migration_entity_mappings, migration_issues, migration_legacy_snapshots, migration_chunks, migration_sessions;
  DROP FUNCTION prevent_legacy_snapshot_update();
`);
