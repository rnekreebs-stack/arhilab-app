# Arhilab Смета backend — архитектурный фундамент 0.7.0

Stage 5 adds private photo/document storage and metadata sync. See [file API and storage contract](API_STAGE5_FILES.md) and [local-first client architecture](../docs/ANDROID_070_SYNC_ARCHITECTURE.md). Development Compose persists file objects in a named volume; production requires S3-compatible private storage. Android 0.6.2 remains unchanged.

Этот каталог изолирован от Android-приложения 0.6.2. На Этапе 1 Android не вызывает API, пользовательские данные не передаются на сервер, локальная авторизация, backup/restore и offline-режим не изменяются.

## Стек

- Node.js 22 LTS;
- TypeScript 5.9;
- Express 5 REST API;
- PostgreSQL 17;
- `node-pg-migrate` для версионированных миграций;
- Zod для централизованной проверки конфигурации и входных данных;
- Pino для структурированного JSON-логирования;
- Docker / Docker Compose для локальной среды.

API начинается с `/api/v1`. Единственный публичный endpoint Этапа 1 — `GET /api/v1/health`.

## Структура

```text
backend/
├── migrations/          PostgreSQL migrations
├── scripts/             проверка схемы и development seed
├── src/
│   ├── config/          environment и безопасное логирование
│   ├── controllers/     HTTP controllers
│   ├── database/        PostgreSQL pool
│   ├── middleware/      request ID, security, validation, errors
│   ├── models/          будущие доменные контракты
│   ├── repositories/    граница доступа к данным
│   ├── routes/v1/       versioned routes
│   ├── services/        application services
│   └── validation/      общие schemas
└── tests/               unit и integration tests
```

Первая миграция создаёт UUID-модели `Organization`, `User`, `Device`, `Project`, `Estimate`, `EstimateItem`, `Material`, `Stage`, `Payment`, `Task`, `Photo`, `Document`, `SyncOperation` и `AuditLog`. Синхронизация и авторизация намеренно не реализованы.

## Окружения

Поддерживаются `development`, `test`, `staging`, `production`. Конфигурация поступает только через environment variables.

1. Скопировать `.env.example` в локальный `.env` (для Docker Compose использовать порт базы `5433`).
2. Заменить демонстрационные значения локальными.
3. Никогда не коммитить `.env` или credentials.

Обязательная переменная: `DATABASE_URL`. Остальные названия и безопасные примеры перечислены в `.env.example`.

## Локальный запуск через Docker

```bash
cd backend
docker compose up -d db
npm ci
export DATABASE_URL=postgresql://arhilab:local-development-only@localhost:5433/arhilab
npm run migrate:up
docker compose up -d --build api
curl http://localhost:3000/api/v1/health
```

Остановка:

```bash
docker compose down
```

Том PostgreSQL сохраняется. Для полностью чистой development-базы можно вручную выполнить `docker compose down -v`; эта команда удаляет только локальный Docker volume данного compose-проекта.

## Запуск без Docker

Требуются Node.js 22 и доступный PostgreSQL 17:

```bash
cd backend
npm ci
npm run migrate:up
npm run dev
```

## Миграции

Схема меняется только файлами в `migrations/`.

```bash
npm run migrate:up
npm run migrate:down
npm run migrate:test
```

`migrate:test` выполняет цикл `up → проверка таблиц → down → проверка rollback → up → повторная проверка` на test database.

Опциональный development seed создаёт организацию с именем из `BOOTSTRAP_ORGANIZATION_NAME` и случайным UUID. Код приложения не зависит от конкретного ID:

```bash
npm run seed:dev
```

## Проверки

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run migrate:test
npm run test:integration
npm run build
```

GitHub Actions дополнительно собирает Docker image, запускает API с PostgreSQL и проверяет health endpoint.

Для локальных миграций с Docker Compose задайте `DATABASE_URL=postgresql://arhilab:local-development-only@localhost:5433/arhilab`. Для `migrate:test` используйте отдельную одноразовую тестовую базу: проверка выполняет `down` всех миграций.

В план отдельного Android/financial этапа внесена наценка на работы: процент и сумма, быстрые значения 0/5/10/15/20/25/30%, итог клиенту, чистая прибыль и маржинальность, независимо от наценки материалов. Старым сметам потребуется `workMarkup = 0`, клиентское КП не должно показывать внутреннюю себестоимость и наценку. На Этапе 1 это не реализуется.

## Health endpoint

`GET /api/v1/health` возвращает только эксплуатационные сведения:

```json
{
  "status": "ok",
  "apiVersion": "v1",
  "backendVersion": "0.7.0-dev.1",
  "database": "connected",
  "timestamp": "2026-09-25T00:00:00.000Z"
}
```

Credentials, connection strings и секреты в ответ не входят.

## Безопасность Этапа 1

- Helmet security headers;
- allowlist CORS;
- ограничение размера JSON body;
- инфраструктура rate limiting;
- request ID;
- единый JSON error handler без production stack trace;
- структурированные логи с редактированием секретных полей;
- централизованные Zod schemas.

Полноценная аутентификация, refresh tokens, роли в runtime и device authorization относятся к следующим этапам.

## Stage 2 — authentication and employees

Stage 2 adds `002_authentication.cjs` over the original Stage 1 migration: Argon2id password hashes, active employees, sessions with short-lived opaque access tokens and separate rotated refresh credentials. SHA-256 digests of 256-bit random tokens are stored; bearer and refresh plaintext never enter the database. Access lasts 15 minutes; a refresh family ends 30 days after login, without sliding expiration. Every protected request checks current session, user role/activity and device state in PostgreSQL, allowing immediate revocation. Reuse of an already rotated refresh token revokes its session. Each refresh runs in a transaction with row locks.

`users` is the employee entity. Admin can create/list/update employees, set `admin`/`manager`/`worker` roles, deactivate users, list and revoke devices, and revoke a user's sessions. Manager and worker cannot administer these resources. Tenant scope comes from the verified session. The last active admin is protected under an organization row lock. New accounts get a temporary password directly from the admin over TLS and must change it before using admin endpoints; there is no plaintext delivery or simulated email reset. Users change their own password with the current one, invalidating all other sessions while retaining their current session. A revoked device cannot reuse its UUID for login; a future client must register a new random UUID.

### First admin bootstrap

After migrations and `npm run build`, pass `BOOTSTRAP_ORGANIZATION_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` (12–128 characters) and `DATABASE_URL` securely to `npm run bootstrap:admin`. No default credentials exist. The command creates a new organization or adds the first user to an existing empty organization with that exact name. It refuses ambiguity or any existing users and serializes bootstrap in PostgreSQL. Supply credentials through your secret manager or a protected environment, not a shell history or repository. For Compose, with the service running and migrations applied, run `docker compose run --rm -e BOOTSTRAP_ORGANIZATION_NAME -e BOOTSTRAP_ADMIN_EMAIL -e BOOTSTRAP_ADMIN_PASSWORD api npm run bootstrap:admin` with the variables supplied securely in your terminal environment. Avoid creating a development seed organization with duplicate names.

### API and limitations

[Stage 2 API contract](API_STAGE2.md) describes requests, responses, error codes and token handling. Login has a separate per-instance IP limiter (`LOGIN_RATE_LIMIT_MAX`, default 10 attempts per 15 minutes); general API rate limiting remains active. Production with multiple replicas needs shared rate limiting or enforcement at the edge. TLS is required for any nonlocal API deployment. Configure `CORS_ORIGINS` for allowed browser origins. The refresh token is a bearer secret and should be stored securely by a future client; Stage 2 does not connect Android or migrate its existing users. Audit logs record action, actor, target and safe metadata without credentials.

Migration tests first apply Stage 1 alone, verify it, apply Stage 2 migrations 002 and 003, test the expanded schema, roll Stage 2 back to Stage 1, roll back Stage 1 and reapply all migrations. Run against a disposable PostgreSQL 17 database using `npm run migrate:test`. `npm run test:integration` tests the real database. CI also checks Docker build and Compose health. The Android 0.6.2 workflow remains separate.

Open architecture question before Stage 3: Is `Project` the construction object, or should `Project` and `Object` be distinct entities? No `objects` table has been added. Work markup remains deferred to a separate financial/Android stage.

## Stage 3 — isolated offline-first sync foundation

Implemented: authenticated `/api/v1/sync/push` and `/api/v1/sync/pull`, seven allowlisted business entities, client-generated UUID identity, per-entity revisions, durable idempotency results, structured conflicts, tombstones, per-organization commit-ordered cursor and append-only `sync_changes`. Admin writes; admin/manager/worker can pull. Batch operations execute in order with separate transactions. A disposable file-backed client simulator and retry helper test offline queuing, lost-response replay and conflict preservation. See [Stage 3 sync API contract](API_STAGE3_SYNC.md).

Migration `004_sync_foundation.cjs` applies over Stage 1 and Stage 2 without editing older migrations. `npm run migrate:test` exercises upgrade, schema and rollback on PostgreSQL 17. Applied operations, change feed and tombstones are retained.

Not implemented in the Stage 3 foundation: conflict decisions or UI, initial upload/migration of Android 0.6.2 data, production phone integration, photo/object storage, detailed manager/worker write permissions or retention/compaction. A future Android client must atomically store local entity changes and its queue; this stage does not modify it. The legacy encrypted-vault server remains independent.

## Stage 4 — in progress

The backend persists stale-write conflicts and exposes admin-only inspection and explicit resolution with both versions preserved, revision checks, audit records and change-feed updates. [Stage 4 contract and import analysis](API_STAGE4_MIGRATION.md) records the actual Android 0.6.2 backup format and the unresolved lossless mapping. Initial upload, migration sessions and snapshot/bootstrap remain unavailable pending a safe mapping decision. Production Android, its encrypted backup and the legacy server have not changed.
