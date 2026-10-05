import { Pool } from 'pg';
import { config } from '../config/env.js';
export const pool = new Pool({ connectionString: config.DATABASE_URL, max: 10, connectionTimeoutMillis: 3000 });
