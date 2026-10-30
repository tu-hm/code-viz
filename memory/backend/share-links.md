# Share links: their own row, kept apart from the owner's

Decided 2026-10-24, with BE-12 (spec v1.14, §8.6).

**Decision:** A share link is a `visualizations` row with `shared = TRUE`, owned by the sharer, and the owner's row points at it through `share_id` (`Store.Share` and `Store.Unshare` in `adapters/mysql/store.go`). Three choices hold the product rules up:

1. Every query that finds "the caller's visualization" by ID adds `shared = FALSE`: `OwnedVisualizationTrace` (delete) and `LockOwnedShareID` (revoke), and `app.Visualizations.Share` checks `v.Shared`. A link can't be deleted, shared or revoked through its own ID, only through the owner's.
2. `Share` sets the owner's `expires_at` and the link's to the same value in one transaction. A repeated share returns the owner's `expires_at` as the link's.
3. Sharing copies `t7/` to `t90/` and never deletes the `t7/` objects; the cleanup deletes both prefixes of a `t90` trace.

**Why:** The link has the sharer as `subject`, so without point 1 `DELETE /visualizations/{link}` would detach it (it would read `canceled` for everyone instead of `404`), and sharing a link would make a link of a link. Point 2 lets a repeat share answer from one read of the owner's row, and keeps both rows expiring in the same cleanup pass, so `share_id` never points at a deleted row while the owner's row lives. Point 3: chunk URLs signed before the share stay valid for 15 minutes; deleting `t7/` at share time would break a viewer loading the same trace at that moment.

**How to apply:** A new "owned" lookup by ID adds `shared = FALSE`. Changing either expiry alone needs `Share`'s idempotent path to read the link's own row. Moving or deleting objects at share time needs another answer for URLs signed before it.
