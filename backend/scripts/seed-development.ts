import { randomUUID } from 'node:crypto';
import { pool } from '../src/database/pool.js';
const name = process.env.BOOTSTRAP_ORGANIZATION_NAME;
if (process.env.NODE_ENV === 'production' || !name) throw new Error('Development seed requires BOOTSTRAP_ORGANIZATION_NAME and non-production environment');
try {
  await pool.query('INSERT INTO organizations (id,name) VALUES ($1,$2)', [randomUUID(), name]);
} finally {
  await pool.end();
}
