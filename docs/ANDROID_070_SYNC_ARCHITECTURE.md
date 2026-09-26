# Android 0.7.0 local-first sync boundary

Production Android 0.6.2 is unchanged. Its encrypted local database, PhotoStore, backup and local authentication remain the authority for offline access. Server authentication controls remote synchronization only. A 0.7.0 adapter will translate local changes into Stage 3/4/5 operations without putting networking inside existing UI screens.

## Modules

- **Local repository and adapter:** reads/writes the current encrypted local model. A local write and its durable outbound operation must commit together. Legacy project fields that the seven Stage 3 entities cannot represent remain in the immutable Stage 4 archive until an explicit mapping exists.
- **Durable business queue:** persists operation UUID, idempotency key, base revision, payload, attempt count and retry time. A conflict stays recorded while independent operations continue.
- **Durable file queue:** persists the local photo/document UUID, encrypted local file reference, hash, byte count, type, intent key, remote ID, retry time and status. The PhotoStore file remains accessible while offline; no server login is needed to view local data.
- **Transport:** bootstrap snapshot, push, pull, conflict queries, refresh, file intent/upload/finalize/download. Tokens are supplied by the platform credential store and are never written into a queue file.
- **Coordinator:** `Sync now` checks connectivity/auth, takes an initial consistent snapshot if needed, pushes queued business mutations, uploads queued files, pulls until the cursor catches up, then returns a summary. Business push precedes file intent so a referenced project is present on the server. Storage failure does not stop other business operations.

`backend/src/sync/client/local-first.ts` implements the transport-independent coordinator, a durable JSON test adapter and an atomic verified cache helper. `http-transport.ts` implements the Stage 3/5 wire protocol. The production Android adapter should implement `SyncStore` with encrypted local persistence and the existing PhotoStore; do not write unencrypted sensitive local business data using the JSON test adapter. Wiring to Android lifecycle/UI is deferred until the isolated adapter can be introduced without a 0.6.2 rewrite.

## State and recovery

The summary contains online status, pending business operations, pending uploads, conflicts, last success, last error category and one of `offline`, `idle`, `syncing`, `pending_changes`, `retry_wait`, `conflict`, `auth_required`, `error`. Upload jobs use `waiting_for_network`, `uploading`, `uploaded`, `failed`, `completed`. The UI should show short human-readable states, never stack traces.

On restart, an interrupted uploading job returns to waiting, retaining the same UUID and idempotency key. A lost intent response retries that key. A lost finalize response retries finalize against the same remote ID; the server responds as a duplicate. Network or storage errors schedule bounded exponential retry. HTTP 401 attempts one token refresh; failure moves to `auth_required` without deleting queues or local data. Conflicts remain isolated. Trigger sync on foreground, restored connectivity, explicit user action and limited background work; avoid persistent aggressive polling.

Another device receives metadata in pull or snapshot and downloads bytes separately. It checks the advertised SHA-256 before atomically replacing its local cache entry. A failed or partial download never becomes a valid cached photo. Tombstones stop using local cache entries; server object garbage collection is deferred. Stage 4 legacy JPEGs can be uploaded one at a time by an admin; local copies and the immutable archive are preserved during transition.
