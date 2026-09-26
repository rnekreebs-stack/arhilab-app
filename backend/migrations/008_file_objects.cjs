exports.up = pgm => pgm.sql(`
  ALTER TABLE photos
    ADD COLUMN original_filename text, ADD COLUMN mime_type text, ADD COLUMN byte_size bigint CHECK (byte_size > 0),
    ADD COLUMN content_sha256 char(64) CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    ADD COLUMN status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploaded','available','failed','deleted')),
    ADD COLUMN created_by uuid, ADD COLUMN source_device_id uuid, ADD COLUMN idempotency_key text,
    ADD COLUMN uploaded_at timestamptz, ADD COLUMN available_at timestamptz,
    ADD CONSTRAINT photos_creator_tenant FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id),
    ADD CONSTRAINT photos_device_tenant FOREIGN KEY (organization_id,source_device_id) REFERENCES devices(organization_id,id),
    ADD CONSTRAINT photos_metadata_complete CHECK (idempotency_key IS NULL OR
      (original_filename IS NOT NULL AND mime_type IS NOT NULL AND byte_size IS NOT NULL AND content_sha256 IS NOT NULL AND created_by IS NOT NULL AND source_device_id IS NOT NULL));
  CREATE UNIQUE INDEX photos_org_intent ON photos(organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
  CREATE UNIQUE INDEX photos_storage_key ON photos(storage_key);
  ALTER TABLE documents
    ADD COLUMN original_filename text, ADD COLUMN mime_type text, ADD COLUMN byte_size bigint CHECK (byte_size > 0),
    ADD COLUMN content_sha256 char(64) CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    ADD COLUMN status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploaded','available','failed','deleted')),
    ADD COLUMN created_by uuid, ADD COLUMN source_device_id uuid, ADD COLUMN idempotency_key text,
    ADD COLUMN uploaded_at timestamptz, ADD COLUMN available_at timestamptz,
    ADD CONSTRAINT documents_creator_tenant FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id),
    ADD CONSTRAINT documents_device_tenant FOREIGN KEY (organization_id,source_device_id) REFERENCES devices(organization_id,id),
    ADD CONSTRAINT documents_metadata_complete CHECK (idempotency_key IS NULL OR
      (original_filename IS NOT NULL AND mime_type IS NOT NULL AND byte_size IS NOT NULL AND content_sha256 IS NOT NULL AND created_by IS NOT NULL AND source_device_id IS NOT NULL));
  CREATE UNIQUE INDEX documents_org_intent ON documents(organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
  CREATE UNIQUE INDEX documents_storage_key ON documents(storage_key);
`);
exports.down = pgm => pgm.sql(`
  DROP INDEX photos_org_intent, photos_storage_key, documents_org_intent, documents_storage_key;
  ALTER TABLE photos DROP CONSTRAINT photos_metadata_complete, DROP CONSTRAINT photos_creator_tenant, DROP CONSTRAINT photos_device_tenant,
    DROP COLUMN original_filename, DROP COLUMN mime_type, DROP COLUMN byte_size, DROP COLUMN content_sha256,
    DROP COLUMN status, DROP COLUMN created_by, DROP COLUMN source_device_id, DROP COLUMN idempotency_key,
    DROP COLUMN uploaded_at, DROP COLUMN available_at;
  ALTER TABLE documents DROP CONSTRAINT documents_metadata_complete, DROP CONSTRAINT documents_creator_tenant, DROP CONSTRAINT documents_device_tenant,
    DROP COLUMN original_filename, DROP COLUMN mime_type, DROP COLUMN byte_size, DROP COLUMN content_sha256,
    DROP COLUMN status, DROP COLUMN created_by, DROP COLUMN source_device_id, DROP COLUMN idempotency_key,
    DROP COLUMN uploaded_at, DROP COLUMN available_at;
`);
