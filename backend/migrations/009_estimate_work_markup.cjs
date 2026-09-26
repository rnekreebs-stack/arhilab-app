exports.up = pgm => pgm.sql(`
  ALTER TABLE estimates ADD COLUMN work_markup_percent numeric(5,2) NOT NULL DEFAULT 0
    CONSTRAINT estimates_work_markup_range CHECK (work_markup_percent BETWEEN 0 AND 100);
`);
exports.down = pgm => pgm.sql(`
  ALTER TABLE estimates DROP COLUMN work_markup_percent;
`);
