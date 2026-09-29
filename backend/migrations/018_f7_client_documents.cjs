exports.up = pgm => pgm.sql(`
  CREATE TABLE client_document_sequences (
    organization_id uuid NOT NULL REFERENCES organizations(id),
    document_type text NOT NULL,
    document_year integer NOT NULL,
    last_number integer NOT NULL CHECK (last_number > 0),
    PRIMARY KEY (organization_id,document_type,document_year)
  );
  CREATE TABLE client_documents (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    estimate_id uuid NOT NULL,
    document_type text NOT NULL CHECK (document_type IN ('COMMERCIAL_OFFER','DETAILED_ESTIMATE','SUMMARY_ESTIMATE')),
    document_number text NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
    snapshot jsonb NOT NULL,
    display_settings jsonb NOT NULL,
    idempotency_key uuid NOT NULL,
    created_by uuid NOT NULL,
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    finalized_at timestamptz,
    deleted_at timestamptz,
    UNIQUE (organization_id,id),
    UNIQUE (organization_id,document_number),
    UNIQUE (organization_id,estimate_id,document_type,version),
    UNIQUE (organization_id,idempotency_key),
    FOREIGN KEY (organization_id,project_id,estimate_id) REFERENCES estimates(organization_id,project_id,id),
    FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id)
  );
  CREATE INDEX client_documents_estimate_idx ON client_documents(organization_id,project_id,estimate_id,created_at DESC);
`);
exports.down = pgm => pgm.sql('DROP TABLE client_documents,client_document_sequences;');
