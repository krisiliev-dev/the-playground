# ADR-007: Runtime Asset Upload Pipeline

## Status

Accepted

## Date

2026-05-07

## Context

Per [ADR-005](./adr-005-in-browser-admin-console.md), the admin console will let an authenticated operator spawn and edit entities in the live world. Many entity kinds reference *asset bytes* — a Model entity is meaningless without a `.glb` to render, an Audio cue has no payload without an audio file. Today the only way to add new asset bytes is to commit them under `client/public/` and redeploy.

The end goal (per project requirements) is admin authoring without redeploying — including dropping a new audio file in for a confettiBurst sound effect, or uploading a `.glb` for a runtime-spawned model. This ADR captures how those bytes flow from admin to every connected client without restarting the server.

## Decision

**Content-addressed asset upload via authenticated POST, served as static URLs, with a `SceneEvent::AssetAvailable` notification for proactive client cache warming.**

### Upload endpoint

```
POST /api/assets
  Authorization: Bearer <admin-token>
  Content-Type: <inferred-or-supplied>
  Body: <bytes, max 50 MB>

  Response: 201 Created
  {
    "id":   "ast_a1b2c3d4e5",        // content hash (truncated SHA-256)
    "url":  "/assets/ast_a1b2c3d4e5.glb",
    "kind": "model",                 // server-detected from Content-Type / magic bytes
    "size": 348572
  }
```

- **Authentication**: same admin bearer token as the WebSocket admin channel and entity-mutation API. Reuse `auth::is_admin`.
- **Content-addressing**: filename derived from a hash of the bytes. Idempotent (re-uploading the same file is a no-op), tamper-evident, and naturally cache-friendly (immutable URL forever).
- **Size cap**: 50 MB initial. Tunable per-deployment via env var. Enforced server-side; oversized uploads return `413 Payload Too Large` with no partial write.
- **Kind detection**: server inspects MIME / magic bytes to classify `model` (`.glb`, `.gltf`), `audio` (`.mp3`, `.ogg`, `.wav`), `image` (`.png`, `.jpg`, `.webp`), `video` (`.mp4`, `.webm`). Unknown kinds rejected with `415 Unsupported Media Type` until added to the allow-list. New kinds are intentionally a server-side change — keeps the asset taxonomy auditable.

### Storage

Files written to `<ASSETS_DIR>/<id>.<ext>`. `ASSETS_DIR` defaults to `./assets/` next to the binary; production deploys override via env var to a persistent volume. **Never write under `client/public/`** — that path is rebuilt on every deploy and would be wiped.

### Serving

Server registers a `GET /assets/*` route that streams files from `ASSETS_DIR` with appropriate `Content-Type` + `Cache-Control: public, max-age=31536000, immutable` headers (immutable because the URL is content-addressed). No auth required for GET — assets are public-by-URL, like every other static file. Concern about leaks: the `id` is unguessable (10+ hex chars of hash); knowledge of one URL does not imply knowledge of any other.

### Notification

After a successful upload, server broadcasts:

```rust
SceneEvent::AssetAvailable {
  id:   "ast_a1b2c3d4e5",
  url:  "/assets/...",
  kind: "model" | "audio" | "image" | "video",
  size: u64,
}
```

Connected clients can listen via `useSceneEvent('asset_available', ...)` and:
- pre-warm their HTTP cache (issue a HEAD or background fetch) so the asset is ready before any entity references it
- update an "available assets" picker in the admin UI
- track total bytes loaded for diagnostics

The notification is informational only — clients can also lazy-load any asset by URL when an entity references it for the first time. The cache warming is a UX nicety, not a correctness requirement.

### Asset metadata persistence

A single `assets.json` index lives next to the asset directory:

```json
{
  "version": 1,
  "assets": [
    { "id": "ast_a1b2c3d4e5", "kind": "model", "size": 348572, "uploaded_at": "..." },
    ...
  ]
}
```

Updated atomically on each upload (write `.tmp` + rename, mirroring ADR-004's snapshot pattern). Loaded on server boot. Used by:
- `GET /api/assets` — list all available assets (admin-only) for the editor's asset picker
- New-client connect — server replays `SceneEvent::AssetAvailable` for each persisted asset so newly-connected clients can pre-warm

Orphan policy: if an `assets.json` entry has no corresponding file on disk (manual deletion / disk corruption), the entry is dropped on next save. If a file exists with no metadata entry, it's served if requested but not advertised. Manual reconciliation tooling deferred unless this becomes common.

### Garbage collection

For now: **none.** Assets never expire automatically. If admin uploads a file and then deletes the entity that references it, the file stays. This is fine because:
- Storage cost is bounded by admin discipline (and the 50MB-per-upload cap)
- Re-uploading the same content is idempotent (same hash → same file → no waste)
- Entity-references-asset is a soft link; we don't want a dangling-reference race deleting a file an entity is about to reference

A later ADR can add `DELETE /api/assets/:id` for explicit reclamation, with admin warnings if the asset is referenced.

## Rationale

### Why content-addressed naming

- **Idempotent uploads** — admin can re-drag a file without producing duplicates
- **Cache-friendly** — `Cache-Control: immutable` is correct because the URL → bytes mapping is by definition unchangeable
- **Tamper-evident** — if bytes change, ID changes
- **No race-condition concerns** for concurrent uploads of the same content (they all land at the same path)

The cost: filenames are unfriendly to humans. Acceptable because admin tooling abstracts the IDs away — operators see "the cube model" while the system stores `ast_a1b2c3d4e5.glb`.

### Why a separate endpoint, not a WebSocket binary frame

WebSocket binary frames are possible but bad fits for large blobs:
- No HTTP-level caching headers (each upload would be re-streamed to every client every time)
- Backpressure handling is awkward (huge frames can starve other WS messages)
- Can't be `<img src>`, `<audio src>`, or fed to `useGLTF` directly without an extra blob-URL hop

HTTP POST + content-addressed URL is the standard pattern for a reason. The WebSocket carries lightweight messages (notification + entity references); the HTTP layer does the heavy lifting.

### Why no auth on GET

The asset URLs are unguessable (hash-based) and the content is admin-authored — there's nothing more sensitive about it than any other deployed scene asset. Adding GET auth would mean every `<img>`/`<audio>`/`useGLTF` call needs a token interceptor, which is friction with no security gain.

If we ever upload genuinely confidential assets (likely never for a portfolio project), a separate authenticated path (e.g. `/api/private-assets/...`) can land later.

## Consequences

### Positive

- Admin can drop in audio, models, textures, video at runtime — no redeploy.
- Idempotent + cacheable + naturally CDN-friendly (Vercel/etc. can cache `/assets/*` aggressively).
- Asset metadata + advertise-on-connect means newly-joining clients see the same available-assets picker as everyone else.
- Reuses existing admin auth + WebSocket infrastructure; the only new infrastructure is the HTTP endpoint and storage directory.

### Negative

- File storage grows monotonically (no GC). Bounded in practice by admin discipline + size cap; explicit delete is a follow-up.
- 50 MB upload cap is too small for high-poly models or longer videos. Tunable; larger values trade against memory pressure in the upload handler. Streaming uploads (chunked) is the right answer if 50 MB ever feels small.
- No content scanning — admin can upload arbitrary bytes (incl. malicious shaders if we ever support them). Acceptable because admin = trusted operator; a multi-admin world would need scanning.

### Migration

This is purely additive. Nothing existing breaks. Pre-existing static assets under `client/public/` continue to work; this just opens a runtime lane alongside.

## Phasing

1. **Server endpoint** — `POST /api/assets`, `GET /assets/*`, `GET /api/assets`, `assets.json` persistence. Tests for upload/serve/list. ~half a day.
2. **`SceneEvent::AssetAvailable` notification** — server broadcasts on upload + replays on connect. Client subscribes and pre-warms. ~couple hours.
3. **Admin UI integration** — drag-and-drop upload, asset picker in entity inspector. Lands as part of ADR-005 phase 2.

## Open questions deferred

- **CDN edge serving** — when scale demands it, front the `/assets/*` path with a CDN. Vercel does this automatically for `client/public`; the runtime upload directory will need explicit configuration. Not pressing.
- **Per-asset ACL** — currently every uploaded asset is public-by-URL. If a future use case wants "private to this room only," that's a separate ACL ADR.
- **Asset versioning beyond content hash** — content-addressing already handles "is this a new version" implicitly (different bytes → different ID). Named "channels" (e.g. `cursor-model:latest`) are deferred until they're actually wanted.
