exports.up = pgm => {
  pgm.sql(`
    CREATE TABLE expenses (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      project_id uuid NOT NULL,
      estimate_id uuid,
      category text NOT NULL CHECK (category IN ('materials','labor','subcontractor','delivery','equipment','other')),
      amount numeric(18,2) NOT NULL CHECK (amount > 0),
      currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      business_date date NOT NULL,
      description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 250),
      note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
      revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      UNIQUE (organization_id,id),
      FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,id),
      FOREIGN KEY (organization_id,project_id,estimate_id) REFERENCES estimates(organization_id,project_id,id)
    );
    CREATE INDEX expenses_project_active_idx ON expenses (organization_id,project_id,business_date DESC,id)
      WHERE deleted_at IS NULL;
    CREATE INDEX expenses_estimate_active_idx ON expenses (organization_id,estimate_id,business_date DESC,id)
      WHERE deleted_at IS NULL AND estimate_id IS NOT NULL;
  `);
};
exports.down = pgm => { pgm.sql('DROP TABLE expenses;'); };
