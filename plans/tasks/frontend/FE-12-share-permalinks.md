# FE-12 · Share & permalinks

| | |
|---|---|
| **Milestone** | M3 |
| **Estimate** | 1.5 days |
| **Depends on** | BE-12 (share + revoke endpoints), FE-02 §3 (`?step=` sync), FE-04 §2 (client) |
| **Blocks** | — |
| **Covers** | M3-F07 |
| **Spec** | §5.2, §8.6, §14, FR-18 |

## Checklist

- [ ] **Share** button in the header → `POST /visualizations/{id}/share` → copy link dialog with expiry date (90 days)
- [ ] Option "open at current step" → append `?step=N`
- [ ] Owner can revoke (BE-12 revoke endpoint); confirm dialog
- [ ] Permalink route `/viz/{id}?step=42`: player only (no IDE), loads via `GET /visualizations/{id}`
- [ ] Out-of-range `step` clamps to the last step
- [ ] `404` / `410` → "This link was revoked or has expired"
- [ ] **Open in new tab** in the header uses the permalink
- [ ] `viz_open` with entry point `permalink`; `viz_share` event

## Done when

A shared link opens at the right step, and shows the expired screen after revoke.
