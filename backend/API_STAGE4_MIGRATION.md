# Stage 4: conflict API and legacy import boundary

Stage 4 is in progress. This document describes the implemented conflict API and the source-format decision required before enabling a 0.6.2 initial upload. Production Android 0.6.2 remains unchanged.

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
| `photos`, `estimatePhotos` | Stage 5 pending | Binary excluded; a metadata/pending representation still needs an agreed schema |
| Local `users`, `team` | No automatic identity mapping | Password hashes/session state forbidden; server employees created separately |
| Global `catalog`, `settings` | No automatic import | Catalog/reference ownership and scope need a separate decision |

An importer that copied only Stage 3 fields would silently lose business information. Initial upload and finalization therefore remain disabled until a lossless representation and financial mapping are selected. No existing backup is modified by the conflict API.
