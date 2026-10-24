# A visualize run: create, long-poll, cancel

Decided 2026-10-24.

**Decision:** The click POSTs through a TanStack mutation and keeps that call's promise on the run (`useRun` in `apps/ide/src/visualize.ts`). The long-poll is one query whose `queryFn` loops `GET ?wait=20&since=` and writes each answer to the cache with `setQueryData`; a retry restarts the loop from the cached version. Cancel and Close delete only a run that isn't final.

**Why:**

- Close can come before the `201`. The create's promise settles once, so Close waits for it and deletes what it made. A POST started from an effect runs twice under Strict Mode. A create kept as a query is POSTed again on window focus after it fails.
- `refetchInterval` can't say "poll again as soon as the last answer arrives": `0` turns it off, and `1` ticks every millisecond through each 20 s hold. A one-shot `queryFn` would retry from the version it started with, not the last one seen.
- `DELETE` turns even a completed visualization `canceled` (§8.5), so closing a finished trace would break its chunk URL refresh and a later share (FE-12).

**How to apply:** A create retries network errors only, with the same `Idempotency-Key`; `429` and `503` on create go to FE-05's screens, not to a silent retry. The poll retries network errors and `502`–`504` with `Retry-After`. `ide.test.tsx` fails if the loop stops resuming from the cache, or if Close deletes a completed run.
