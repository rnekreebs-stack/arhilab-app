#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Use a disposable PostgreSQL test database}"
check_stage() { node --import tsx scripts/check-migration-stage.ts "$1"; }
./node_modules/.bin/node-pg-migrate up 1 --migrations-dir migrations --check-order
check_stage 1
./node_modules/.bin/node-pg-migrate up 1 --migrations-dir migrations --check-order
check_stage 2
./node_modules/.bin/node-pg-migrate up 1 --migrations-dir migrations --check-order
check_stage 3
./node_modules/.bin/node-pg-migrate up 1 --migrations-dir migrations --check-order
check_stage 4
./node_modules/.bin/node-pg-migrate up 1 --migrations-dir migrations --check-order
check_stage 5
./node_modules/.bin/node-pg-migrate up 1 --migrations-dir migrations --check-order
check_stage 6
./node_modules/.bin/node-pg-migrate up 1 --migrations-dir migrations --check-order
check_stage 7
./node_modules/.bin/node-pg-migrate up 1 --migrations-dir migrations --check-order
check_stage 8
./node_modules/.bin/node-pg-migrate up 1 --migrations-dir migrations --check-order
check_stage 9
./node_modules/.bin/node-pg-migrate up 1 --migrations-dir migrations --check-order
check_stage 10
./node_modules/.bin/node-pg-migrate up 1 --migrations-dir migrations --check-order
check_stage 11
./node_modules/.bin/node-pg-migrate up 1 --migrations-dir migrations --check-order
check_stage 12
./node_modules/.bin/node-pg-migrate up 1 --migrations-dir migrations --check-order
check_stage 13
./node_modules/.bin/node-pg-migrate up 1 --migrations-dir migrations --check-order
check_stage 14
./node_modules/.bin/node-pg-migrate up 1 --migrations-dir migrations --check-order
check_stage 15
./node_modules/.bin/node-pg-migrate up 1 --migrations-dir migrations --check-order
check_stage 16
./node_modules/.bin/node-pg-migrate up 1 --migrations-dir migrations --check-order
check_stage 17
node --import tsx scripts/verify-schema.ts
npm run migrate:up
npm run migrate:down
check_stage 16
npm run migrate:up
check_stage 17
npm run migrate:down
check_stage 16
npm run migrate:down
check_stage 15
npm run migrate:up
check_stage 17
npm run migrate:down
check_stage 16
npm run migrate:down
check_stage 15
npm run migrate:down
check_stage 14
npm run migrate:down
check_stage 13
npm run migrate:down
check_stage 12
npm run migrate:down
check_stage 11
npm run migrate:down
check_stage 10
npm run migrate:down
check_stage 9
npm run migrate:down
check_stage 8
npm run migrate:down
check_stage 7
npm run migrate:down
check_stage 6
npm run migrate:down
check_stage 5
npm run migrate:down
check_stage 4
npm run migrate:down
check_stage 3
npm run migrate:down
check_stage 2
npm run migrate:down
check_stage 1
npm run migrate:down
check_stage 0
npm run migrate:up
check_stage 17
node --import tsx scripts/verify-schema.ts
