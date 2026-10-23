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

- [ ] `POST /visualizations/{id}/share` handler (only the owner can share)
- [ ] Server-side copy of all chunks (and `tail.txt.gz`) from `t7/` to `t90/`
- [ ] Update `traces.storage_prefix = 't90'` and extend `expires_at` to 90 days
- [ ] Mark the visualization `shared`; return `{url, expiresAt}`
- [ ] Calling it again returns the same link (idempotent)
- [ ] Shared visualizations readable by other users (and anonymous) via `GET`
- [ ] Permalink GET response cached for 60 s (§7.8 "permalink goes viral")
- [ ] **Revoke**: add the endpoint to OpenAPI (e.g. `DELETE /visualizations/{id}/share`), regenerate types
- [ ] After revoke, other users get `404`; owner still sees it
- [ ] Contract tests for share, re-share, revoke

## Done when

A shared link opens for another user and stops working after it's revoked.
