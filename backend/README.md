# Arhilab Смета backend — архитектурный фундамент 0.7.0

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

1. Скопировать `.env.example` в локальный `.env`.
2. Заменить демонстрационные значения локальными.
3. Никогда не коммитить `.env` или credentials.

Обязательная переменная: `DATABASE_URL`. Остальные названия и безопасные примеры перечислены в `.env.example`.

## Локальный запуск через Docker

```bash
cd backend
docker compose up -d db
npm ci
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
