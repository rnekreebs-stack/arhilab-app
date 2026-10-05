exports.up = (pgm) => pgm.sql('ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;');
exports.down = (pgm) => pgm.sql('ALTER TABLE users DROP COLUMN must_change_password;');
