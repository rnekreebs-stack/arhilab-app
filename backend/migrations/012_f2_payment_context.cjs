exports.up = pgm => {
  pgm.sql(`
    ALTER TABLE estimates ADD COLUMN currency char(3);
    ALTER TABLE estimates ADD CONSTRAINT estimates_currency_iso CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');
    ALTER TABLE estimates ADD CONSTRAINT estimates_project_identity UNIQUE (organization_id, project_id, id);
    ALTER TABLE payments ADD COLUMN estimate_id uuid;
    ALTER TABLE payments ADD COLUMN payment_kind text;
    ALTER TABLE payments ADD COLUMN paid_amount numeric(18,2);
    ALTER TABLE payments ADD COLUMN business_date date;
    ALTER TABLE payments ADD COLUMN plan_date date;
    ALTER TABLE payments ADD COLUMN actual_date date;
    ALTER TABLE payments ADD COLUMN comment text;
    ALTER TABLE payments ADD COLUMN payment_type text;
    ALTER TABLE payments ADD CONSTRAINT payments_estimate_project_fk
      FOREIGN KEY (organization_id, project_id, estimate_id)
      REFERENCES estimates (organization_id, project_id, id);
    ALTER TABLE payments ADD CONSTRAINT payments_kind_check
      CHECK (payment_kind IS NULL OR payment_kind IN ('income', 'expense'));
    ALTER TABLE payments ADD CONSTRAINT payments_paid_range
      CHECK (paid_amount IS NULL OR (paid_amount >= 0 AND paid_amount <= amount));
    ALTER TABLE payments ADD CONSTRAINT payments_comment_length CHECK (comment IS NULL OR length(comment) <= 1000);
    CREATE INDEX payments_estimate_active_idx ON payments (organization_id, estimate_id, business_date DESC)
      WHERE deleted_at IS NULL AND estimate_id IS NOT NULL;
  `);
};
exports.down = pgm => {
  pgm.sql(`
    DROP INDEX payments_estimate_active_idx;
    ALTER TABLE payments DROP CONSTRAINT payments_comment_length;
    ALTER TABLE payments DROP CONSTRAINT payments_paid_range;
    ALTER TABLE payments DROP CONSTRAINT payments_kind_check;
    ALTER TABLE payments DROP CONSTRAINT payments_estimate_project_fk;
    ALTER TABLE payments DROP COLUMN payment_type, DROP COLUMN comment, DROP COLUMN actual_date,
      DROP COLUMN plan_date, DROP COLUMN business_date, DROP COLUMN paid_amount,
      DROP COLUMN payment_kind, DROP COLUMN estimate_id;
    ALTER TABLE estimates DROP CONSTRAINT estimates_project_identity;
    ALTER TABLE estimates DROP CONSTRAINT estimates_currency_iso;
    ALTER TABLE estimates DROP COLUMN currency;
  `);
};
