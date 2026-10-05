exports.up = pgm => pgm.sql(`
  ALTER TABLE estimates ADD COLUMN private_fields jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(private_fields)='object');
  ALTER TABLE estimate_items ADD COLUMN private_fields jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(private_fields)='object');
`);
exports.down = pgm => pgm.sql(`
  ALTER TABLE estimate_items DROP COLUMN private_fields;
  ALTER TABLE estimates DROP COLUMN private_fields;
`);
