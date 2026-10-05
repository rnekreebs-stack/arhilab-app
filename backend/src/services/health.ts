import type { Pool } from 'pg';
export async function checkDatabase(db: Pick<Pool, 'query'>): Promise<boolean> {
  try {
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
