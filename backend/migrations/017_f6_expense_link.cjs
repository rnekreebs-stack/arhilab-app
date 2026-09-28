exports.up = pgm => pgm.sql(`
  ALTER TABLE expenses ADD COLUMN procurement_request_id uuid;
  ALTER TABLE procurement_requests ADD CONSTRAINT procurement_requests_org_project_id_unique
    UNIQUE (organization_id,project_id,id);
  ALTER TABLE expenses ADD CONSTRAINT expenses_procurement_request_owner
    FOREIGN KEY (organization_id,project_id,procurement_request_id)
    REFERENCES procurement_requests(organization_id,project_id,id);
  CREATE INDEX expenses_procurement_request_idx
    ON expenses(organization_id,procurement_request_id,id)
    WHERE deleted_at IS NULL AND procurement_request_id IS NOT NULL;
`);
exports.down = pgm => pgm.sql(`
  DROP INDEX expenses_procurement_request_idx;
  ALTER TABLE expenses DROP CONSTRAINT expenses_procurement_request_owner,
    DROP COLUMN procurement_request_id;
  ALTER TABLE procurement_requests DROP CONSTRAINT procurement_requests_org_project_id_unique;
`);
