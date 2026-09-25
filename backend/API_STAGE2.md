# Arhilab 0.7.0 Stage 2 API contract

Base URL: `/api/v1`. JSON bodies only. Errors: `{ "error": "...", "requestId": "..." }`. All UUIDs use canonical UUID format. Protected calls send `Authorization: Bearer <accessToken>`. Never send a token in URL. Server derives organization, role, user, device and session from its database; request bodies cannot override them.

| Method | Path | Access | Request | Success | Errors |
|---|---|---|---|---|---|
| GET | `/health` | Public | None | `200` connected, `503` unavailable | `503` |
| POST | `/auth/login` | Public; separate IP rate limit | `{organizationId,email,password,deviceId,deviceLabel?}` | `200` token response | `400`, `401`, `429` |
| POST | `/auth/refresh` | Public, refresh credential | `{refreshToken}` | `200` rotated token response | `400`, `401` |
| POST | `/auth/logout` | Bearer | None | `204` | `401` |
| POST | `/auth/logout-all` | Bearer | None | `204` | `401` |
| POST | `/auth/change-password` | Bearer | `{currentPassword,newPassword}` | `204` | `400`, `401` |
| GET | `/users?limit=50&offset=0` | Admin | None | `200 {users:[{id,email,displayName,role,active,createdAt}]}` | `401`, `403` |
| GET | `/users/:id` | Admin | None | `200 {id,email,displayName,role,active}` | `400`, `401`, `403`, `404` |
| POST | `/users` | Admin | `{email,displayName,role,password}` | `201 {id,email,displayName,role,active}` | `400`, `401`, `403`, `409` |
| PATCH | `/users/:id` | Admin | `{displayName?,role?,active?}` at least one | `200` public user | `400`, `401`, `403`, `404`, `409` |
| POST | `/users/:id/revoke-sessions` | Admin | None | `204` | `400`, `401`, `403`, `404` |
| GET | `/users/:id/devices` | Admin | None | `200 {devices:[{id,label,createdAt,lastSeenAt,revokedAt}]}` | `400`, `401`, `403`, `404` |
| POST | `/devices/:id/revoke` | Admin | None | `204` | `400`, `401`, `403`, `404` |

Token response: `{accessToken,refreshToken,tokenType:"Bearer",expiresIn:900,refreshExpiresAt,sessionId}`. Login also returns `{user:{id,organizationId,role},deviceId}`. `deviceId` is a randomly generated UUID persisted by a future client; a revoked ID cannot log in again. Generate a new ID after device revocation. `organizationId` on login selects the account namespace and does not establish authorization without a matching password and active user. Other endpoint bodies reject `organizationId` and unrecognized fields.

Access and refresh are independent cryptographically random opaque 256-bit tokens; only SHA-256 digests are stored. Access validity is checked against the session, user and device on *every* request. Access expires after 15 minutes; refresh expires at the original session expiry after 30 days. Refresh rotation replaces the access token and marks the old refresh credential consumed. Reuse of a consumed credential revokes its entire session, including the newly issued token. Concurrent refresh requests serialize on database row locks; one can succeed before reuse revokes the session. Clients must serialize refresh per session. Logout and revoke operations immediately invalidate access and refresh for affected sessions. Repeating logout with an invalidated access token returns `401` without changing state.

Employee creation requires an admin supplied initial password over TLS; the API never returns it. No email or SMS reset exists. Password change requires the old password and invalidates other sessions; the current session remains valid. Admin cannot read password hashes. The last active admin cannot be demoted or deactivated. Manager and worker have no admin endpoints in Stage 2.

`401` means missing/invalid identity or generic invalid credentials; `403` means authenticated but forbidden; `404` masks cross-organization resources. Tokens and passwords never appear in error messages or audit metadata. Use HTTPS at any public deployment; configure reverse proxy and CORS allowlist. The in-process login rate limit is per API instance, so production deployments with multiple replicas require a shared rate-limit store or edge enforcement.
