exports.up = pgm => pgm.sql(`
  CREATE TABLE procurement_requests (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    estimate_id uuid,
    stage_id uuid,
    estimate_item_id uuid,
    catalog_sku text CHECK (catalog_sku IS NULL OR length(catalog_sku) BETWEEN 1 AND 100),
    title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 250),
    unit text NOT NULL CHECK (length(trim(unit)) BETWEEN 1 AND 50),
    requested_quantity numeric(18,4) NOT NULL CHECK (requested_quantity > 0),
    status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','ordered','partially_received','received','cancelled')),
    needed_by_date date,
    assignee_id uuid,
    note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
    created_by uuid NOT NULL,
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (organization_id,id),
    FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,id),
    FOREIGN KEY (organization_id,project_id,estimate_id) REFERENCES estimates(organization_id,project_id,id),
    FOREIGN KEY (organization_id,estimate_id,stage_id) REFERENCES stages(organization_id,estimate_id,id),
    FOREIGN KEY (organization_id,estimate_id,estimate_item_id) REFERENCES estimate_items(organization_id,estimate_id,id),
    FOREIGN KEY (organization_id,assignee_id) REFERENCES users(organization_id,id),
    FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id),
    CHECK (estimate_id IS NOT NULL OR (stage_id IS NULL AND estimate_item_id IS NULL))
  );
  CREATE INDEX procurement_requests_project_active_idx ON procurement_requests(organization_id,project_id,needed_by_date,id) WHERE deleted_at IS NULL;
  CREATE INDEX procurement_requests_assignee_active_idx ON procurement_requests(organization_id,assignee_id,needed_by_date,id) WHERE deleted_at IS NULL;
  CREATE TABLE procurement_receipts (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    request_id uuid NOT NULL,
    quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
    business_date date NOT NULL,
    note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
    created_by uuid NOT NULL,
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,id),
    FOREIGN KEY (organization_id,request_id) REFERENCES procurement_requests(organization_id,id),
    FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id)
  );
  CREATE INDEX procurement_receipts_request_active_idx ON procurement_receipts(organization_id,request_id,business_date,id) WHERE deleted_at IS NULL;
`);
exports.down = pgm => pgm.sql(`
  DROP TABLE procurement_receipts;
  DROP TABLE procurement_requests;
`);
