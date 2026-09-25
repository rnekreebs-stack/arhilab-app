exports.up = (pgm) => pgm.sql(`
  ALTER TABLE users ADD COLUMN password_hash text, ADD COLUMN active boolean NOT NULL DEFAULT true, ADD COLUMN password_changed_at timestamptz;
  CREATE UNIQUE INDEX users_organization_email_ci ON users (organization_id, lower(email)) WHERE email IS NOT NULL;
  CREATE TABLE sessions (
    id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL, device_id uuid NOT NULL,
    access_hash char(64) NOT NULL UNIQUE, access_expires_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL, revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id,id),
    FOREIGN KEY (organization_id,user_id) REFERENCES users(organization_id,id),
    FOREIGN KEY (organization_id,device_id) REFERENCES devices(organization_id,id)
  );
  CREATE INDEX sessions_user_active ON sessions (organization_id,user_id) WHERE revoked_at IS NULL;
  CREATE INDEX sessions_device_active ON sessions (organization_id,device_id) WHERE revoked_at IS NULL;
  CREATE TABLE refresh_credentials (
    id uuid PRIMARY KEY, organization_id uuid NOT NULL, session_id uuid NOT NULL,
    token_hash char(64) NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL, consumed_at timestamptz, revoked_at timestamptz,
    FOREIGN KEY (organization_id,session_id) REFERENCES sessions(organization_id,id)
  );
  CREATE INDEX refresh_session ON refresh_credentials (organization_id,session_id);
`);
exports.down = (pgm) => pgm.sql(`
  DROP TABLE refresh_credentials, sessions;
  DROP INDEX users_organization_email_ci;
  ALTER TABLE users DROP COLUMN password_hash, DROP COLUMN active, DROP COLUMN password_changed_at;
`);
