import { pool } from '../src/database/pool.js';
import { cleanupOldObjects } from '../src/files/cleanup.js';
const args=process.argv.slice(2);
if(args.length>1||args.some(x=>x!=='--apply')) throw Error('Usage: node --import tsx scripts/cleanup-file-objects.ts [--apply]');
try {const result=await cleanupOldObjects(args.includes('--apply'));
  console.log(JSON.stringify({mode:args.includes('--apply')?'apply':'dry-run',eligible:result.eligible.length,removed:result.removed.length}));
} finally {await pool.end();}
