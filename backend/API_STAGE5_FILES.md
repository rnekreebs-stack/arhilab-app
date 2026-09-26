# Stage 5 file storage and sync contract

## Boundary and deployment

Files use the existing `photos` and `documents` tables extended by migration 008. Bytes never enter PostgreSQL or `/api/v1/sync/push`, `/pull`, or `/snapshot`. The server constructs a key from validated tenant, project, kind and file UUID; filenames are display metadata only. A private S3-compatible bucket is required for production (`STORAGE_PROVIDER=s3`); set `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, and optionally `STORAGE_ENDPOINT` for a private S3-compatible service. The backend uses the AWS SDK with path-style access for custom endpoints. Keep credentials outside Git and disable public bucket/object ACLs. Development/CI can use a persistent filesystem volume (`STORAGE_PROVIDER=filesystem`, `STORAGE_ROOT`). `/api/v1/health` reports database health; `/api/v1/health/storage` reports bucket or filesystem readiness independently.

The API performs bounded backend uploads instead of presigned URLs. This keeps tenant checks, signatures, hash verification and short retry paths inside one authenticated request. A presigned URL would require provider-specific policy enforcement and a separate completion verification; it is not necessary for the configured limits. File requests use `application/octet-stream`, with `MAX_PHOTO_BYTES` (default 5,000,000) and `MAX_DOCUMENT_BYTES` (default 15,000,000). JSON intent bodies remain under the general body limit. There is no batch upload endpoint.

## Admin upload flow

All endpoints require a current Stage 2 access token, active user/device and completed initial password change. Only admin may create, upload, finalize or delete; manager and worker may read available metadata and bytes. Upload grants for other roles remain an explicit product decision.

1. `POST /api/v1/files/photos/intents` or `/documents/intents` with `{projectId,filename,mimeType,byteSize,sha256,idempotencyKey}`. `sha256` is lowercase hex; the key is a stable 16–100 character client value. The project must be live in the caller's organization. A repeat with identical attributes returns the same file ID and `duplicate:true`; a changed request with the same key returns 409.
2. `PUT /api/v1/files/{photos|documents}/{id}/content` with raw bytes. The server checks the exact byte count, SHA-256 and content signature. Supported photos are JPEG, PNG, WebP. Supported documents are PDF. Invalid or partial content cannot become available. A retry of identical bytes remains safe.
3. `POST /api/v1/files/{photos|documents}/{id}/finalize` confirms object metadata in storage and publishes **one** revision-1 `photo` or `document` create event. An identical retry returns `duplicate:true` without another revision or change.

States are `pending -> uploaded -> available -> deleted`. Storage reconciliation may mark a stale unfinalized intent `failed`; uploading valid bytes can resume it. A temporary storage outage returns 503 and leaves business push/pull independent. Lost storage or DB responses retry with the same intent key and file ID; server-generated object keys are deterministic per file ID. The file remains invisible to sync clients until available. A 48-hour default intent age is configurable as `FILE_INTENT_TTL_HOURS`.

`GET /api/v1/files/{kind}/{id}` returns metadata scoped to the organization. `GET /api/v1/files/{kind}/{id}/content` downloads verified bytes from private storage with `nosniff`, `private, no-store`, sanitized RFC 5987 filename and no permanent public URL. `DELETE /api/v1/files/{kind}/{id}` is an admin-only tombstone: one revision increment and one delete event. It does not immediately erase the object. Another tenant receives 404 for every file lookup. `GET /api/v1/files/quota` counts available files and bytes by kind for the organization.

The ordinary Stage 3 pull feed carries only file ID, project ID, display filename, MIME, size, SHA-256, status, revision and deletion timestamp. The repeatable-read snapshot includes available files and tombstones; it excludes pending intents and all legacy archive bytes. Direct `sync/push` for `photo` and `document` is rejected with `file_api_required`.

## Cleanup and legacy photos

`node --import tsx scripts/cleanup-file-objects.ts` is a **dry run** by default. `--apply` requires an operator decision. It rechecks organization and file rows under locks, and considers only pending/uploaded/failed objects older than the configured intent TTL or tombstoned objects older than 30 days. Available objects are never collected. It records `file.cleanup` in audit without bytes or storage credentials. A missing object is safe to retry; deterministic keys let the next upload reconcile a pending state.

`POST /api/v1/files/legacy/{completedMigrationSessionId}/{legacyPhotoId}` is admin-only. It migrates one JPEG from the immutable Stage 4 sanitized archive into private storage, using the original photo UUID and a deterministic object key. The pending metadata record commits before object upload so a storage/DB failure can be reconciled by retrying the same ID. It refuses unavailable projects and incompatible collisions. Repeating a completed request returns the same metadata without creating a second change. No bulk migration is required, and the raw Stage 4 archive is never returned by ordinary sync endpoints. Android's encrypted local PhotoStore and backups remain intact.

`GET /api/v1/files/legacy/{completedMigrationSessionId}/status` is admin-only and returns IDs with `legacy_local_only`, `pending_upload`, `available`, or `deleted` state, without image bytes. It supports gradual migration progress and recovery.

## Operational and security notes

Store only trusted photo/document types; content signatures are checked in addition to MIME and filename. Object versions are immutable after `available`; replacement requires a new file ID. Downloads verify SHA-256 again. Administrative deletion and legacy upload are audited without content. The existing request logger records route/status/request ID, not file bodies or credentials. The server bounds uploads in memory by its configured size limit, so configure that limit within available instance memory. Sync and file storage readiness are separate for diagnosis.
