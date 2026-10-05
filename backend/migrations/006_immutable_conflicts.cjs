exports.up = pgm => pgm.sql(`
  CREATE FUNCTION protect_conflict_snapshots() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF OLD.status <> 'open' OR
       (to_jsonb(NEW) - 'status' - 'resolved_at' - 'resolved_by_user_id' - 'resolution_type' - 'resolution_resulting_revision' - 'resolution_metadata') IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'resolved_at' - 'resolved_by_user_id' - 'resolution_type' - 'resolution_resulting_revision' - 'resolution_metadata') THEN
      RAISE EXCEPTION 'Conflict source and snapshots are immutable';
    END IF;
    RETURN NEW;
  END; $$;
  CREATE TRIGGER sync_conflicts_immutable BEFORE UPDATE ON sync_conflicts FOR EACH ROW EXECUTE FUNCTION protect_conflict_snapshots();
`);
exports.down = pgm => pgm.sql('DROP TRIGGER sync_conflicts_immutable ON sync_conflicts; DROP FUNCTION protect_conflict_snapshots();');
