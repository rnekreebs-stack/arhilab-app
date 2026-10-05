# Stage 3 sync contract

Stage 3 is an isolated backend foundation. Android 0.6.2, its local database and the legacy server are not connected or migrated. Stage 4 will decide conflicts and initial upload.

## Authorization and entity model

Both endpoints require Stage 2 `Authorization: Bearer <accessToken>` from an active session and device. Refresh credentials are used only at `/auth/refresh`. Admin may push; admin, manager and worker may pull. An initial password must be changed first. The backend derives organization, user and source device from the session. Body fields such as `organizationId`, `revision`, `deletedAt` or other unknown fields are rejected.

Every synchronized business ID is a stable client-generated UUID, never replaced by the server. All seven entities belong to an organization and have a server revision and `deleted_at` tombstone. Decimal amounts/quantities are strings to avoid JSON float rounding.

| `entityType` | Create payload | Mutable update fields |
|---|---|---|
| `project` | `name` | `name` |
| `estimate` | `projectId`, `name` | Same |
| `estimateItem` | `estimateId`, `title`, `quantity`, optional `unit` | Same |
| `material` | `name`, optional `unit` | Same |
| `stage` | `projectId`, `name`, integer `position` | Same |
| `payment` | `projectId`, `amount`, three-letter `currency`, optional `paidAt` | Same |
| `task` | `projectId`, `title`, `status` (`open`, `in_progress`, `done`), optional `assigneeId` | Same |

References must resolve in the same organization. Users, devices, sessions, audit logs, photos and documents are outside this sync queue. Stage 1 rows do not automatically appear in the change feed; their initial upload belongs to Stage 4.

## Push

`POST /api/v1/sync/push` accepts `{"operations":[...]}` with 1–50 items. Each item has `operationId` and `idempotencyKey` (UUID), `entityType`, `entityId` (UUID), `operationType` (`create`, `update`, `delete`), numeric `baseRevision`, entity-specific `payload`, and ISO `occurredAt`. Create uses base 0; update/delete use the current server revision. Delete requires `{}`. Update requires a nonempty allowlisted payload. Body limit defaults to 1 MB; general rate limit defaults to 120 requests/minute per process.

```json
{"operations":[{"operationId":"edb4dbed-05f1-4878-819e-92946867b3a5","idempotencyKey":"43844b4d-9a4f-4b36-a889-20872cf46746","entityType":"project","entityId":"ea87186c-59be-4eaa-9a68-30ba11ddc340","operationType":"create","baseRevision":0,"payload":{"name":"Site"},"occurredAt":"2026-09-25T20:00:00.000Z"}]}
```

A valid envelope returns HTTP 200 and ordered `results[]`. Each item commits in its own transaction, in array order. Successful `applied` returns server `resultingRevision` and decimal-string `sequence`. Replayed identical operations return `duplicate`, `originalStatus` and recorded fields without another mutation. A stale base returns `conflict`, `errorClass:"conflict"`, `code:"stale_revision"`, `currentRevision`; it never overwrites the server. Invalid or unsupported items return `rejected` with `errorClass` (`validation`, `authorization`, `conflict`, `unsupported`) and stable `code`. A reused key with different request contents returns `idempotency_key_reused_with_different_request`. Revision starts at 1 and increments by one on each successful mutation, including tombstone delete.

A lost batch response may follow earlier committed items; retry the same IDs/keys for *all* items. 400 invalid envelope, 401 invalid access, 403 forbidden, 413 oversized body, 429 rate limit and 5xx errors carry stable `code`, `errorClass` and request ID. Authorization failures require login on 401 and are permanent on 403; 429 and 5xx are retryable. The English error message is not the retry contract.

## Pull

`GET /api/v1/sync/pull?cursor=0&limit=50` accepts server-issued decimal cursor (`0` initially), limit 1–100. Response: `{"changes":[],"nextCursor":"0","hasMore":false}`. Changes contain decimal-string `sequence`, entity type/ID, revision, operation type, allowlisted snapshot with `deletedAt`, source device ID, operation ID and server `changedAt`. The organization's transactional counter allocates cursor values in commit order. The feed includes the caller's own device writes. Follow `nextCursor` while `hasMore`; persist the cursor only after applying the page locally. A delete remains as a tombstone. Client timestamps never determine the cursor.

## Durable offline client contract

Each future queue item stores operation ID/key, entity type/ID, operation, base revision, payload, creation time, attempt count, next attempt time and state (`pending`, `sending`, `retry`, `applied`, `conflict`, `permanent_failure`). A *single local transaction* must persist the visible entity change and queue insertion before any network request. On restart, `sending` becomes `retry` without changing IDs/keys. Success updates local server revision; conflict preserves local data until Stage 4. Retry network failures/timeouts, 5xx and 429 with capped exponential backoff, jitter and bounded `Retry-After`. 401 requires authentication; validation/forbidden/unsupported are permanent; conflicts are not automatically retried. The isolated test helper persists both local state and queue atomically with fsync/rename; production Android is unchanged.

Operations, change feed and tombstones have no automatic destructive retention. Before Stage 4, decide whether `Project` and construction `Object` are distinct, manager/worker granular writes, conflict UX, initial 0.6.2 migration and safe retention/compaction for long-offline devices.
