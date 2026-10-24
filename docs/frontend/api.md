# API integration

How the browser talks to the backend: five endpoints under `/api/v1`, plus trace chunks that the browser downloads straight from object storage. Read this before you write the API client (FE-04), the run states (FE-05) or permalink loading (FE-12).

- **The contract is [`backend/api/openapi.yaml`](../../backend/api/openapi.yaml)**, with the trace format in [`backend/schema/trace.v1.schema.json`](../../backend/schema/trace.v1.schema.json). Where this doc and the contract disagree, the contract wins; fix this doc.
- **Types are generated.** `pnpm gen` writes `apps/ide/src/gen/api.ts` (request and response types, `paths` and `components`) and `packages/player/src/gen/trace.ts` (the trace). Import them; never copy a contract type by hand (T3, D14).
- **The why** is in the spec: §8 (API), §9 (trace format), §11 (limits), §19.9 (trace format v1.1 and later).

Every response shown below was captured from a local `make dev` run on 24 Oct 2026, with long URLs shortened.

## Setup

| Mode | How | API base |
|---|---|---|
| Mock (default) | `pnpm dev`. MSW answers every endpoint from the contract's examples. Pick a case with `?scenario=` ([web README](../../web/README.md#mock-api)) | — |
| Local backend | `make images` once, then `make dev` in `backend/`. Then `VITE_USE_MSW=false pnpm dev` in `web/` | `http://localhost:8080/api/v1` |

`VITE_API_BASE_URL` sets the base; `config.apiBaseUrl` in `apps/ide/src/config.ts` reads it.

**CORS.** The API answers browser calls only from the origins in `CORS_ORIGINS` (`http://localhost:5173` in dev). It allows the request headers `Content-Type` and `Idempotency-Key` and the methods `GET`, `POST` and `DELETE`, and exposes `Location`, `Retry-After` and `X-Request-ID`. Any other custom header fails the preflight. The bucket that serves chunks allows the same origins; `make seed` sets that up, so rerun it after you change `CORS_ORIGINS`.

## Endpoints

| Method and path | What it does | Built |
|---|---|---|
| `GET /languages` | Languages the visualizer supports and what each can do | Yes |
| `POST /visualizations` | Start a visualization, or attach to an identical trace | Yes |
| `GET /visualizations/{id}?wait=&since=` | Status, with long-polling; the trace manifest once completed | Yes |
| `DELETE /visualizations/{id}` | Cancel, or detach from a shared trace | Yes |
| `POST /visualizations/{id}/share` | Permalink, and 90-day retention | No: `404` until BE-12 |

Every body is JSON in UTF-8. There is no sign-in yet: every caller is anonymous and is told apart by its IP address (an IPv4 address, or an IPv6 /64).

## The flow

1. `GET /languages` when the IDE loads. Show **Visualize** only for a language that is listed.
2. On **Visualize**, make one UUID for the click and `POST /visualizations` with it as `Idempotency-Key`.
3. Open the visualizer in its loading state with the `201` body. The status can already be final: an identical trace that finished earlier comes back `completed`, at once.
4. While the status isn't final, `GET /visualizations/{id}?wait=20&since=<version>`. The server holds each request until the visualization changes or 20 seconds pass.
5. On `completed`, download `trace.chunks[]` from their signed URLs, check each one's `sha256`, and hand the steps to the player. `loadTrace` in `@viz/player` does this step.
6. On **Cancel**, **Close**, or a new **Visualize**, stop polling and `DELETE /visualizations/{id}`.

```ts
import type { components } from './gen/api.ts'

type Visualization = components['schemas']['Visualization']

const final = ['completed', 'failed', 'canceled']

// key: one crypto.randomUUID() per Visualize click, reused when that click's POST is retried
async function visualize(body: components['schemas']['CreateVisualizationRequest'], key: string, signal: AbortSignal) {
  let v: Visualization = await call('POST', '/visualizations', { body, key, signal })
  while (!final.includes(v.status)) {
    v = await call('GET', `/visualizations/${v.id}?wait=20&since=${v.version}`, { signal })
  }
  return v
}
```

`call` stands for your client: `openapi-fetch` with TanStack Query in FE-04. It throws the error envelope as a typed error and retries per [Errors](#errors).

## `GET /languages`

```http
GET /api/v1/languages
```

```http
HTTP/1.1 200 OK
Cache-Control: max-age=300
Content-Type: application/json
```

```json
{
  "languages": [
    {
      "id": "python3",
      "displayName": "Python 3.12",
      "editorMode": "python",
      "visualize": {
        "enabled": true,
        "capabilities": {
          "returnValues": true,
          "pointers": false,
          "exceptions": true,
          "startAtLines": true,
          "captureRanges": true
        },
        "limits": { "maxSteps": 1000, "maxStepsCeiling": 5000 }
      }
    }
  ]
}
```

| Field | Use it for |
|---|---|
| `id` | `language` in `POST /visualizations` |
| `displayName` | The picker and the visualizer title |
| `editorMode` | The editor's language mode (`python`, `c_cpp`) |
| `visualize.capabilities.startAtLines` | Show **Start tracing from line…** (§5.6) |
| `visualize.capabilities.captureRanges` | Let the user ask for index ranges of long sequences (§19.4.2) |
| `visualize.capabilities.pointers` | Pointer values (`t: "ptr"`) can appear in the trace |
| `visualize.capabilities.returnValues`, `exceptions` | Return values and exception steps can appear in the trace |
| `visualize.limits.maxSteps` | Default for `options.maxSteps` |
| `visualize.limits.maxStepsCeiling` | Highest `options.maxSteps` the server accepts |

Only enabled languages are listed. C++ (`cpp17-gcc`) is in the contract's example but not in the response yet, because its manifest is disabled. Cache the list for 5 minutes, as `Cache-Control` says.

## `POST /visualizations`

```http
POST /api/v1/visualizations
Content-Type: application/json
Idempotency-Key: 7d3c1c3e-5a1e-4c55-9d7c-2f0e0b1a9e11
```

```json
{
  "language": "python3",
  "source": "def sq(x):\n    return x * x\n\na = [1, 2]\nb = a\nprint(sq(5))\n",
  "stdin": "",
  "options": { "maxSteps": 1000, "startAtLines": [] },
  "context": { "problemCode": null, "client": "ide-web/0.1.0" }
}
```

### Headers

| Header | Required | Meaning |
|---|---|---|
| `Content-Type: application/json` | Yes | Anything else, `text/plain` included, is `400 invalid_request`. A JSON content type makes the browser send a CORS preflight, so another site can't spend your user's quota |
| `Idempotency-Key` | No, but send it | A UUID. A repeat of the key from the same caller within 24 h returns the visualization the first request created, in its current state, whatever the body says, and doesn't count against the quota. A key that isn't a UUID is `400` |

Make one key per **Visualize** click, and reuse it when you retry that click's POST after a network error or a `503`. A new click gets a new key.

### Body

| Field | Required | Meaning |
|---|---|---|
| `language` | Yes | An `id` from `GET /languages` |
| `source` | Yes | The program. At most 64 KB (UTF-8 bytes) |
| `stdin` | Yes | Standard input; `""` for none. At most 64 KB |
| `options.maxSteps` | Yes | 1 to `maxStepsCeiling`. Use `limits.maxSteps` as the default |
| `options.startAtLines` | Yes | Lines, from 1, where tracing starts: nothing is recorded until one of them first runs. `[]` records from the start |
| `options.captureRanges` | No | `{ "<variable>": [[first, last], …] }`: index ranges, from 0, to record in long sequences (§19.4.2). At most 4 KB as JSON |
| `options.showInternals` | No | `true` also records the tracer's hidden helper variables. Default `false` |
| `options.safetyChecks` | No | `false` builds without the language's safety checks (D21, §19.6). Default `true`. Python has none, so `false` is a `400` there |
| `context.problemCode` | Yes | The problem page the visualizer was opened from, or `null` |
| `context.client` | Yes | Client name and version, such as `ide-web/0.1.0` |

Check the source and stdin sizes in the browser before you send, so the user sees the limit without a round trip. The server checks them again.

### Response

```http
HTTP/1.1 201 Created
Location: /api/v1/visualizations/viz_0eb85cf4e688ba80e8435f9f8f3eae1a
X-Request-Id: req_ae07cc9866c187d9
```

```json
{
  "id": "viz_0eb85cf4e688ba80e8435f9f8f3eae1a",
  "status": "queued",
  "version": 0,
  "language": "python3",
  "createdAt": "2026-10-24T15:28:56.598221Z"
}
```

- Every success is `201`, with the same body `GET` returns. Read the `id` from the body. `Location` is a path on the API host, not on the app's.
- **Identical requests share one trace.** The same language, source, stdin and options give the same trace, so a second POST is often `completed` at once. Each POST still gets its own `viz_` ID. Options that trace the same count as the same: `startAtLines` in any order, `showInternals: false` or left out.
- **Two at a time.** A caller can have two visualizations queued or running. A third POST detaches the oldest queued one, which from then on reads `canceled`.
- A runtime error in the user's program doesn't fail the visualization. It completes, and the error is in the trace.

Errors: `400`, `413`, `422`, `429`, `503`, `500`; see [Errors](#errors).

## `GET /visualizations/{id}`

| Query | Meaning |
|---|---|
| `wait` | 0 to 20 seconds. Hold the request while the status isn't final and `version` is still at most `since` |
| `since` | The last `version` you saw. Without it, `wait` is ignored and the request returns at once |

The server returns as soon as the version passes `since`, or when `wait` runs out, with `200` and the current state either way. A timeout isn't an error; send the next request with the version you got. When vizd shuts down it ends held requests early with their current state, so the loop goes on as before.

`version` goes up on every change of status or progress. Compare versions; don't read meaning into the numbers.

### Fields by status

| `status` | What happened | Fields set besides `id`, `status`, `version`, `language`, `createdAt` | Show (§5.6) |
|---|---|---|---|
| `queued` | Waiting for a worker | — | Loading: Queued |
| `building` | Compiling, or checking the Python source | — | Loading: Building |
| `tracing` | Running and recording | `progress.steps`, the steps recorded so far | Loading: Tracing (N steps so far) |
| `completed` | The trace is ready | `expiresAt`, `trace`, and `build` for a language with a build step | The player |
| `failed` | It couldn't be traced | `failure`, and `build` when the build failed | Build error, or "Something went wrong" |
| `canceled` | Detached by `DELETE`, or bumped by a third POST | — | Nothing: the user closed it or started another run |

`failure.stage` is `build` or `trace`. `failure.kind`:

| `kind` | Meaning | Show |
|---|---|---|
| `compile_error` | The build failed: a C++ compile error, a Python syntax error, or the build timed out | `build.diagnostics`, each linking to its line in the editor |
| `unsupported_module` | The program imports a module the visualizer doesn't allow, such as `numpy` | "numpy isn't supported in the visualizer. Use Run instead." (§5.6). The diagnostic names the module and its line |
| `sandbox_error`, `internal_error` | Our failure, not the program's. A new POST of the same program runs it again | "Something went wrong on our side" (§5.6) |

### Completed

```json
{
  "id": "viz_0eb85cf4e688ba80e8435f9f8f3eae1a",
  "status": "completed",
  "version": 3,
  "language": "python3",
  "createdAt": "2026-10-24T15:28:56.598221Z",
  "expiresAt": "2026-10-31T15:28:56.598221Z",
  "build": { "ok": true, "durationMs": 47, "diagnostics": [] },
  "trace": {
    "header": {
      "version": "1.2",
      "id": "trc_2d698cd33e3a9ed6f0c845209313a395",
      "language": { "id": "python3", "runtime": "CPython 3.12.15", "adapter": "py-settrace/0.3.0" },
      "source": { "file": "main.py", "lineCount": 6 },
      "options": { "maxSteps": 1000, "startAtLines": [] },
      "summary": {
        "stepCount": 7,
        "truncated": false,
        "truncation": null,
        "exit": { "kind": "normal", "code": 0, "signal": null, "message": null },
        "lineHits": { "1": 1, "2": 1, "4": 1, "5": 1, "6": 1 },
        "lineHitsSource": "counter"
      },
      "encoding": { "mode": "delta", "keyframeInterval": 50 }
    },
    "chunks": [
      {
        "index": 0,
        "fromStep": 0,
        "toStep": 6,
        "sizeBytes": 517,
        "sha256": "7f50ce423d64f094cbcc3726805433390ed672d961397623eec7fad0dee80e71",
        "url": "http://127.0.0.1:8333/viz-traces/t7/trc_2d698cd33e3a9ed6f0c845209313a395/chunk-0000.json.gz?X-Amz-Algorithm=…&X-Amz-Signature=…"
      }
    ],
    "urlsExpireAt": "2026-10-24T15:44:03.431772Z"
  }
}
```

`trace.header` is the whole trace document except `steps`; see [Reading the trace](#reading-the-trace). `trace.tail` is set when the program printed more after the last recorded step; see [Downloading the trace](#downloading-the-trace).

### Failed build

```json
{
  "id": "viz_cdbf0d0da258b6d48bcc7fd8acbf6408",
  "status": "failed",
  "version": 2,
  "language": "python3",
  "createdAt": "2026-10-24T15:29:54.64918Z",
  "failure": { "stage": "build", "kind": "unsupported_module" },
  "build": {
    "ok": false,
    "durationMs": 29,
    "diagnostics": [
      { "line": 1, "column": 1, "severity": "error", "message": "numpy isn't supported in the visualizer" }
    ],
    "raw": "main.py:1:1: error: numpy isn't supported in the visualizer\n"
  }
}
```

`diagnostics` has the errors and warnings that point into the user's file, with `line` and `column` from 1. `raw` is the compiler's output as printed, up to 64 KB; it is `"Build timed out"` when the build ran out of time. Show `raw` as a fallback when `diagnostics` is empty.

Errors: `400` (`wait` outside 0–20, or a negative `since`), `404` (unknown ID, or one that isn't a `viz_` ID), `410` (past retention), `503` (the server holds too many long-polls, or the database is down), `500`.

## `DELETE /visualizations/{id}`

Returns `204` with no body, every time, so calling it twice is fine. After it, `GET` returns the visualization as `canceled` with no other fields, until it expires. The trace job stops only if no other visualization still waits on the same trace.

Only the caller that created the visualization can delete it. Anyone else gets `404`, as for an unknown ID.

## `POST /visualizations/{id}/share`

Not built: it returns `404 not_found` until BE-12. When it lands, it returns `{ "url": "…", "expiresAt": "…" }`, extends the trace's retention to 90 days, and returns the same link when called again (§8.6, FE-12).

## Errors

Every error has the same body (§8.7):

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Daily quota used up. Try again after midnight UTC.",
    "retryAfterSec": 31864,
    "requestId": "req_9c1e2f0a7b3d4e65"
  }
}
```

| `code` | HTTP | When | Retry? | Show |
|---|---|---|---|---|
| `invalid_request` | 400 | Malformed JSON, wrong `Content-Type`, invalid options, bad `wait` or `since`, an `Idempotency-Key` that isn't a UUID | No | A client bug: log `message` |
| `payload_too_large` | 413 | Source or stdin over 64 KB | No | The limit. FE-04 checks sizes before sending, so this is rare |
| `unsupported_language` | 422 | Unknown language, or visualize disabled for it | No | Hide **Visualize** for that language (FE-04) |
| `rate_limited` | 429 | Daily quota used up: 100 a day per anonymous caller, reset at midnight UTC | After `Retry-After` | A message with the wait time (FE-05) |
| `capacity` | 503 | Queue full, too many held long-polls, or the database down | After `Retry-After` (5 s), with backoff | "Visualizer is busy, try again in a few seconds" and **Retry** (§5.6) |
| `not_found` | 404 | No such visualization, no such route, or deleting someone else's | No | The not-found state (FE-05); for a permalink, FE-12's expired screen |
| `expired` | 410 | The trace is past its 7-day retention | No | The expired state (FE-05); for a permalink, FE-12's expired screen |
| `internal_error` | 500 | The server failed | No | "Something went wrong on our side", the request ID and a Report link (§5.6) |

- **Branch on `code`, never on `message`.** For `invalid_request`, `payload_too_large` and `unsupported_language`, `message` is written for a developer and names what was wrong, such as `source is 70000 bytes, over the 64 KB limit: payload too large`. Log it, and show your own text. For the other codes `message` is fixed text you may show as is.
- **`Retry-After`** (seconds) comes as a header and as `retryAfterSec` on every `429` and `503`. Wait at least that long. Retry a POST with the same `Idempotency-Key`; resume a long-poll with the last `version` you saw.
- **Network errors** (the API restarting, a dropped connection) aren't in the envelope. Retry with backoff, as for `503`.
- **`X-Request-ID`** is on every response, and matches `requestId`. Show it with internal errors and put it in bug reports; it is how the server's logs are searched.

## Downloading the trace

Chunks come straight from object storage (or a CDN), never from the API:

- **One chunk is a JSON array of steps**, gzip-compressed, starting with a keyframe. Fetch `chunks[]` in `index` order and concatenate them; step `i` sits at position `i`.
- **Check `sha256` before you use a chunk.** It is the hash of the JSON with gzip removed. Storage serves chunks with `Content-Encoding: gzip`, so `fetch` usually hands you the unzipped JSON already; if the bytes still start with the gzip magic (`1f 8b`), unzip them yourself first.
- **URLs expire at `urlsExpireAt`**, 15 minutes after the response. Every `GET /visualizations/{id}` signs fresh ones, so call it again before you fetch a chunk after that time. Don't send cookies or an `Authorization` header with a chunk request; the signature in the URL is the access.
- **Chunks never change.** Storage serves them with `Cache-Control: private, max-age=86400, immutable`, so the browser caches them.
- **`trace.tail`** (`sizeBytes`, `sha256`, `url`) is set when the program printed more after the last recorded step: past the step limit, or anything at all in a trace with no steps, such as when no start line ran. It is gzipped text, stdout then stderr, checked like a chunk and signed with the same expiry. Show it after the recorded output, marked as not traced (§19.9.5).

`loadTrace(source)` from `@viz/player` does the chunk part: download, gzip, `sha256`, refreshing expired URLs through a callback, the version check and the order check. Give it `{ manifest: v.trace, refresh }`, where `refresh` GETs the visualization again and returns its `trace`. It throws errors named `NetworkError`, `ChecksumError` or `VersionError`. It doesn't fetch `trace.tail` yet.

## Reading the trace

The trace types are in `packages/player/src/gen/trace.ts`. The fields the UI most often reads:

| Field | Meaning |
|---|---|
| `header.version` | Trace format version, `1.x`. Read any `1.x`; refuse another major version (§9.7) |
| `header.summary.stepCount` | Steps recorded |
| `header.summary.exit.kind` | How the program ended: `normal`, `exception`, `signal`, `timeout`, `memory_limit`, `step_limit`, `output_limit` or `internal_error`. `message` holds the exception text, such as `IndexError: list index out of range` |
| `header.summary.truncated`, `truncation` | Recording stopped early: `{ "reason": "step_limit" \| "time_limit" \| "size_limit", "atLine": 10 }`. Show the banner; never truncate silently (§5.6) |
| `header.summary.untracedTail` | After a step limit: whether the program then finished (`completed`), how it exited, and how much it printed |
| `header.summary.lineHits` | Times each line ran in the whole run, past the step limit too (§19.9.3) |
| `header.options` | The options the trace was made with, after the server normalized them |
| `header.encoding.keyframeInterval` | Every step whose `i` is a multiple of it is a keyframe |

A step (§9.2) is a keyframe or a delta. A keyframe holds every frame and every reachable heap object. A delta holds only the frames and objects that are new or changed, whole, and lists the IDs that went away in `removedObjects`. To rebuild step `k`, start from the nearest keyframe at or before it and apply each delta in order. The player's engine already does this.

Values (`t`) and heap object kinds (`kind`) are open sets: a newer trace can carry one this build doesn't know. Draw an unknown `kind` as an `opaque` card and an unknown `t` as plain text (T2, §9.7); `loadTrace` already turns unknown kinds into `opaque`. The full field reference is spec §9 and §19.9; the [fixtures](../../web/README.md#fixtures) show real traces for each view.

A runtime error doesn't fail the visualization: it ends with `exit.kind: "exception"` (or `signal` in C++), and the step that raised it has `event: "exception"` and an `error` object.

## Limits the UI should know

| Limit | Value | When it's hit |
|---|---|---|
| Source | 64 KB | `413 payload_too_large` |
| Stdin | 64 KB | `413 payload_too_large` |
| `maxSteps` | Default 1,000, at most 5,000 (from `GET /languages`) | Above the ceiling: `400`. Reached while running: `truncation.reason: "step_limit"` |
| `captureRanges` | 4 KB as JSON | `400 invalid_request` |
| `wait` | 20 s | `400 invalid_request` |
| Active visualizations | 2 queued or running per caller | A third detaches the oldest queued one, which reads `canceled` |
| Daily quota | 100 per anonymous caller per UTC day | `429 rate_limited` until midnight UTC |
| Chunk URLs | 15 minutes | Storage refuses the URL; GET the visualization again |
| Retention | 7 days | `410 expired` |

Spec §11 has the full list, including the ones only the trace shows (wall time, memory, items per container, string length).

## Not built yet

- **Share links** (`POST …/share`, FE-12): `404` until BE-12.
- **C++ through the API**: the tracer works, but the manifest is disabled, so `GET /languages` leaves it out and a POST gets `422`.
- **Sign-in**: every caller is anonymous. The signed-in quota (1,000 a day) waits for it.
- **The per-IP rate limit** (30 creates a minute, `429`) is a reverse proxy rule, not part of vizd, so you won't hit it locally.
