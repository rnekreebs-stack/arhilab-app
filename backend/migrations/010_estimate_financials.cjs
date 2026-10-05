exports.up = pgm => pgm.sql(`
  ALTER TABLE projects ADD COLUMN address text, ADD COLUMN client_name text,
    ADD COLUMN project_status text NOT NULL DEFAULT 'Новый';
  ALTER TABLE estimates
    ADD COLUMN delivery_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (delivery_amount >= 0),
    ADD COLUMN discount_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
  ALTER TABLE estimate_items
    ADD COLUMN item_kind text NOT NULL DEFAULT 'work' CHECK (item_kind IN ('work','material')),
    ADD COLUMN unit_price numeric(18,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
    ADD COLUMN coefficient numeric(18,4) NOT NULL DEFAULT 1 CHECK (coefficient > 0),
    ADD COLUMN auto_material boolean NOT NULL DEFAULT false,
    ADD COLUMN material_price numeric(18,2) NOT NULL DEFAULT 0 CHECK (material_price >= 0),
    ADD COLUMN catalog_key text,
    ADD COLUMN extra boolean NOT NULL DEFAULT false,
    ADD COLUMN extra_status text,
    ADD CONSTRAINT estimate_items_material_only CHECK (item_kind='work' OR (coefficient=1 AND NOT auto_material AND material_price=0 AND NOT extra AND extra_status IS NULL));
`);
exports.down = pgm => pgm.sql(`
  ALTER TABLE estimate_items DROP CONSTRAINT estimate_items_material_only,
    DROP COLUMN item_kind, DROP COLUMN unit_price, DROP COLUMN coefficient,
    DROP COLUMN auto_material, DROP COLUMN material_price, DROP COLUMN catalog_key,
    DROP COLUMN extra, DROP COLUMN extra_status;
  ALTER TABLE estimates DROP COLUMN delivery_amount, DROP COLUMN discount_amount;
  ALTER TABLE projects DROP COLUMN address, DROP COLUMN client_name, DROP COLUMN project_status;
`);
