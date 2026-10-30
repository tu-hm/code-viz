# BE-12 · Share & permalinks

| | |
|---|---|
| **Milestone** | M3 |
| **Estimate** | 1.5 days |
| **Depends on** | BE-06 (API, `BlobStore` copy) |
| **Blocks** | FE-12 share UI |
| **Covers** | M3-B06 |
| **Spec** | §7.5, §8.6, §12 |

## Checklist

- [x] `POST /visualizations/{id}/share` handler (only the owner can share)
- [x] Server-side copy of all chunks (and `tail.txt.gz`) from `t7/` to `t90/`
- [x] Update `traces.storage_prefix = 't90'` and extend `expires_at` to 90 days
- [x] Mark the visualization `shared`; return `{url, expiresAt}`
- [x] Calling it again returns the same link (idempotent)
- [x] Shared visualizations readable by other users (and anonymous) via `GET`
- [x] Permalink GET response cached for 60 s (§7.8 "permalink goes viral")
- [x] **Revoke**: add the endpoint to OpenAPI (e.g. `DELETE /visualizations/{id}/share`), regenerate types
- [x] After revoke, other users get `404`; owner still sees it
- [x] Contract tests for share, re-share, revoke

## Done when

A shared link opens for another user and stops working after it's revoked.

**Result** (spec v1.14, §7.5, §7.8, §8.6, §12). Two decisions, made on 24 Oct: a share link is its own ID, and only a completed visualization can be shared.

- **The link is a new visualization row** of the same trace, with `shared` set, owned by the same caller and recorded on the owner's row as `share_id` (migration 00009). Since v1.7 the visualization's ID is its read key, so marking that ID shared and then owner-only on revoke would lock out an anonymous owner whose IP changed, and sharing again would revive a link that had leaked. With its own ID, revoke deletes the link row: it answers `404` for everyone, the owner included, while the owner's own ID still reads. Sharing again makes a new link.
- **Share** works for the caller that created the visualization, once it is `completed`; queued, running, failed and canceled get `400 invalid_request`, anyone else and a share link itself `404`. The chunks and tail are copied to `t90/` before the transaction (`BlobStore.Copy`, S3 `CopyObject`), which locks the trace, re-checks it is completed, sets `storage_prefix = 't90'`, and keeps the trace, the owner's row and the link 90 days from the share. A second call finds `share_id` under the lock and returns the same link; eight concurrent calls make one.
- **The `t7/` copies stay** until the cleanup deletes the trace, then both prefixes go. So a chunk URL signed before the share keeps working for its 15 minutes, and the share path has no delete to fail.
- **Cache:** `GET` sends `Cache-Control: public, max-age=60` for a link, which reads the same for every caller, and `no-store` otherwise. A revoked link can open for up to 60 s from a cache.
- **The link** is `VIZ_WEB_ORIGIN/viz/{id}`, a new required setting of the API role.
- **Tests:** `internal/app` (link readable a month on from `t90/`, same link until revoked, new link after, one owner's revoke leaving another's link, the refusal table, concurrency, storage down, cleanup at 90 days), `transport/http` (`TestShareReShareAndRevokeAsTheContractSays`, against the OpenAPI) and `blobstore` (copy keeps body and headers). Checked against `make dev`'s MySQL and SeaweedFS on 24 Oct: share while queued `400`; the link opens from another IP with its chunk from `t90/`; another IP's share and revoke `404`; after the owner's revoke the link is `404` and the owner's own ID `200`; sharing again gives a new link.
- **Not done:** a shared trace that expires and is created again before the nightly cleanup is reset and rerun under `t7/`, which orphans its `t90/` objects. Resets of unshared traces already leave extra chunks the same way.
