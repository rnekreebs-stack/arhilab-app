# Stage 4: conflict API and legacy import boundary

Stage 4 is in progress. The legacy import implementation below is local and requires PostgreSQL integration and GitHub CI verification before deployment. Production Android 0.6.2 remains unchanged.

## Conflicts

An admin-only Stage 3 stale mutation records an immutable client proposal and allowlisted server snapshot in `sync_conflicts` in the same transaction as its sync operation. Its per-operation result includes `conflictId`. An identical retry returns the recorded result as a duplicate, with the same conflict ID. No business row or change-feed entry is written for a conflict.

All routes require a current Stage 2 admin identity, active device, and completed initial password change:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/sync/conflicts?status=open&entityType=project&entityId=UUID&limit=50&offset=0` | Tenant-scoped list, ordered by `created_at,id`; limit 1–100 |
| GET | `/api/v1/sync/conflicts/:id` | Both snapshots and resolution history; another tenant receives 404 |
| POST | `/api/v1/sync/conflicts/:id/resolve` | Explicit admin resolution |

Resolution body: `{"type":"keep_server|apply_client|manual_merge","expectedRevision":N,"payload":{...}}`. `payload` is required for `manual_merge` and forbidden for the other types. The server checks current revision under organization and conflict row locks. `apply_client` uses the recorded client proposal; `manual_merge` uses the Stage 3 entity validator and reference policy. Each modifying resolution allocates a fresh revision and one change-feed entry. `keep_server` acknowledges the current state without creating a duplicate change. A stale revision returns 409 `resolution_stale`; a second resolution returns 409 `already_resolved`. The conflict remains queryable and the decision is logged to `audit_logs` without its payload.

## What Android 0.6.2 actually exports

`MainActivity.fullBackupContent()` creates `Arhilab-2`, `schemaVersion:2`, with `projects`, `catalog`, `team`, `users` and optional `settings`. `backupContent()` creates the older `Arhilab-1`. The portable full backup is encrypted by `BackupCrypto`; local `data.enc` uses Android Keystore. Backup passwords and local user hashes must never be sent to the backend. A trusted conversion tool would decrypt locally, and send only a bounded, validated business package.

Each legacy project is a construction object with `name`, `address`, `client`, `status`, `assigned`, delivery/discount/cost fields and nested `lines`, `materials`, `tasks`, `payments`, `notes`, `photos`, `estimatePhotos` and purchases. The Stage 3 `project` contains only `name`; Stage 3 estimates, items, payments and tasks do not retain many legacy fields. In particular Android payments have `amount`, `kind`, `date`, `paid`, `planDate`, `actualDate` but no currency; the backend requires a three-letter currency. Android task statuses are Russian strings with progress, while Stage 3 has three status values. Android estimate lines include prices, costs, coefficients and catalog kit data absent from Stage 3 estimate items.

| Legacy 0.6.2 item | Present backend entity | Unresolved data or decision |
|---|---|---|
| Project/construction object | `project` | Whether Object is distinct; address, client, status, costs, discounts, assignments and notes |
| Embedded estimate and `lines` | `estimate`, `estimateItem` | Work price, cost, coefficient, catalog/tier references, kit overrides and extra-work approvals |
| Project `materials` | `material` | Project ownership, quantities, prices, costs, source catalog references |
| Project `tasks` | `task` | Progress, responsible name, dates, comments and four legacy statuses |
| Project `payments` | `payment` | Currency absent at source; income/expense, paid amount, dates, notes and type |
| `photos`, `estimatePhotos` | Stage 5 pending | JPEG data and metadata are archived in the restricted legacy snapshot, not synchronized or projected |
| Local `users`, `team` | No automatic identity mapping | Password hashes/session state forbidden; server employees created separately |
| Global `catalog`, `settings` | No automatic import | Catalog/reference ownership and scope need a separate decision |

An importer that copied only Stage 3 fields would silently lose business information. The versioned `ArhilabMigration-1` package preserves validated business data separately from the restricted Stage 3 projection. No existing backup is modified by the backend.

## Legacy import protocol (pending database verification)

A trusted client decrypts `Arhilab-2` outside the backend, removes `users`, `settings`, auth and security material, and submits a structured `ArhilabMigration-1` package with source version `0.6.2`, schema 2, export timestamp, projects and optional catalog/team business data. The server rejects unexpected top-level and project fields and any nested secret-bearing keys. Team entries contain only `id`, `name`, `login` and `role`; they do not create backend users. JPEG photo data is accepted only as bounded data URIs in the legacy archive. Individual JSON requests under `/api/v1/migrations` have an 8 MB limit; oversized source packages require a separate approved transfer design and must not be truncated.

An admin calls `POST /api/v1/migrations/preflight` with the complete package. It reports the SHA-256 canonical package hash, counts, preserved fields, blocking issues and target UUID collisions without changing business rows. `POST /api/v1/migrations` registers an ID and hash, expected project chunk count and the exact source metadata, catalog and team. The caller sends ordered chunks using `PUT /api/v1/migrations/:id/chunks/:index`. A retry with identical content is a duplicate; changed content is rejected. `GET /api/v1/migrations/:id` exposes status and received chunk indexes for resume.

`POST /api/v1/migrations/:id/verify` reassembles and hashes the package, persists the immutable sanitized business archive, records issues, and checks target occupancy and collisions. Payment currency is always a blocking issue because it does not exist in the legacy payment. The admin resolves each payment issue with `POST /api/v1/migrations/:id/issues/:issueId/resolve` and an explicit three-letter `currency`; retries with another value fail. Unrepresentable task status also blocks. `GET /api/v1/migrations/:id/issues` lists issues, while no endpoint exposes the raw legacy archive to a sync client.

`POST /api/v1/migrations/:id/finalize` requires a verified archive, zero unresolved blocking issues and an empty target business dataset. In one organization-locked transaction it inserts deterministic project/estimate/estimate item/material/task/payment projections at revision 1, stable mapping rows, idempotent operation records and their change-feed entries. The archive retains address, client, costs, coefficients, catalog, team, notes and photo bytes. The same finalize request returns a duplicate completion. `POST /api/v1/migrations/:id/cancel` stops a pending import; no business rows exist until finalize. Completed imports cannot be cancelled.

`GET /api/v1/sync/snapshot` takes a PostgreSQL repeatable-read view of the current seven sync entities and organization cursor, with a 1000-entity cap. It includes only the projected business fields, never the legacy archive. It requires an active authenticated device and a completed initial password change.
