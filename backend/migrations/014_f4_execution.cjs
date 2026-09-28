exports.up = pgm => pgm.sql(`
  ALTER TABLE stages ADD COLUMN estimate_id uuid, ADD COLUMN description text NOT NULL DEFAULT '';
  ALTER TABLE stages ADD CONSTRAINT stages_description_length CHECK (length(description)<=1000);
  ALTER TABLE estimates ADD CONSTRAINT estimates_org_project_id_unique UNIQUE (organization_id,project_id,id);
  ALTER TABLE stages ADD CONSTRAINT stages_estimate_owner
    FOREIGN KEY (organization_id,project_id,estimate_id) REFERENCES estimates(organization_id,project_id,id);
  CREATE INDEX stages_estimate_active_idx ON stages(organization_id,estimate_id,position,id)
    WHERE deleted_at IS NULL AND estimate_id IS NOT NULL;

  ALTER TABLE estimate_items ADD COLUMN stage_id uuid;
  ALTER TABLE estimate_items ADD CONSTRAINT estimate_items_org_estimate_id_unique UNIQUE (organization_id,estimate_id,id);
  ALTER TABLE stages ADD CONSTRAINT stages_org_estimate_id_unique UNIQUE (organization_id,estimate_id,id);
  ALTER TABLE estimate_items ADD CONSTRAINT estimate_items_stage_owner
    FOREIGN KEY (organization_id,estimate_id,stage_id) REFERENCES stages(organization_id,estimate_id,id);

  CREATE TABLE progress_entries (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    estimate_id uuid NOT NULL,
    estimate_item_id uuid NOT NULL,
    historical_stage_id uuid,
    quantity numeric(18,4) NOT NULL CHECK (quantity>0),
    business_date date NOT NULL,
    note text NOT NULL DEFAULT '' CHECK (length(note)<=1000),
    created_by uuid NOT NULL,
    revision bigint NOT NULL DEFAULT 0 CHECK (revision>=0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (organization_id,id),
    FOREIGN KEY (organization_id,project_id,estimate_id) REFERENCES estimates(organization_id,project_id,id),
    FOREIGN KEY (organization_id,estimate_id,estimate_item_id) REFERENCES estimate_items(organization_id,estimate_id,id),
    FOREIGN KEY (organization_id,estimate_id,historical_stage_id) REFERENCES stages(organization_id,estimate_id,id),
    FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id)
  );
  CREATE INDEX progress_entries_item_active_idx ON progress_entries(organization_id,estimate_item_id,business_date,id)
    WHERE deleted_at IS NULL;
`);

exports.down = pgm => pgm.sql(`
  DROP TABLE progress_entries;
  ALTER TABLE estimate_items DROP CONSTRAINT estimate_items_stage_owner,
    DROP CONSTRAINT estimate_items_org_estimate_id_unique, DROP COLUMN stage_id;
  ALTER TABLE stages DROP CONSTRAINT stages_org_estimate_id_unique,
    DROP CONSTRAINT stages_estimate_owner, DROP CONSTRAINT stages_description_length,
    DROP COLUMN estimate_id, DROP COLUMN description;
  ALTER TABLE estimates DROP CONSTRAINT estimates_org_project_id_unique;
`);
