#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Use a disposable PostgreSQL test database}"
./node_modules/.bin/node-pg-migrate up 1 --migrations-dir migrations --check-order
node --import tsx -e "import('pg').then(async ({default:pg})=>{const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();try{const r=await c.query(\"SELECT to_regclass('public.users') AS users, to_regclass('public.sessions') AS sessions\");if(!r.rows[0].users || r.rows[0].sessions)throw Error('Stage 1 baseline missing')}finally{await c.end()}})"
npm run migrate:up
node --import tsx scripts/verify-schema.ts
npm run migrate:up
npm run migrate:down
node --import tsx -e "import('pg').then(async ({default:pg})=>{const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();try{const r=await c.query(\"SELECT to_regclass('public.sync_changes') AS feed, to_regclass('public.sessions') AS sessions\");if(r.rows[0].feed || !r.rows[0].sessions)throw Error('Stage 3 rollback failed')}finally{await c.end()}})"
npm run migrate:down
node --import tsx -e "import('pg').then(async ({default:pg})=>{const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();try{const r=await c.query(\"SELECT to_regclass('public.users') AS users, to_regclass('public.sessions') AS sessions\");if(!r.rows[0].users || r.rows[0].sessions)throw Error('Stage 2 rollback failed')}finally{await c.end()}})"
npm run migrate:down
node --import tsx -e "import('pg').then(async ({default:pg})=>{const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();try{const r=await c.query(\"SELECT to_regclass('public.organizations') AS name\");if(r.rows[0].name)throw Error('Rollback failed')}finally{await c.end()}})"
npm run migrate:up
node --import tsx scripts/verify-schema.ts
