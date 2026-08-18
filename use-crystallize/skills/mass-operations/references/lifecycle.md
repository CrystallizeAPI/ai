# Lifecycle: upload, run, monitor

Verified against runner and Core API behaviour as of 2026-08-18.

## Contents

- [CLI path](#cli-path)
- [Raw API path](#raw-api-path)
- [What the runner does with your file](#what-the-runner-does-with-your-file)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)
- [Browser CORS](#browser-cors)

## CLI path

Recommended for anything production-facing. The CLI validates locally against the same schema the
server enforces, so schema problems surface **with per-field detail** before upload — the server throws
that detail away (see Troubleshooting).

```
crystallize mass-operation dump-content-model <tenant> <file>
```
Generates a starter file containing the tenant's current shapes and pieces. Use this to ground shape
identifiers and component IDs instead of guessing them.

```
crystallize mass-operation run <tenant> <file>
```
Validates → requests presigned upload → pushes the file → creates the bulk task with `autoStart` →
waits for completion while tailing logs.

```
crystallize mass-operation execute-mutations <tenant> <file> [image-mapping-file]
```
Runs client-side GraphQL mutations alongside mass operations, for steps the runner doesn't cover.

All commands support `--no-interactive` for CI and reuse stored credentials. `--legacy-spec` converts
an old Spec File into a mass operation file.

The CLI lives in `CrystallizeAPI/tools` — a different repo, so these command signatures are **not**
verified against the runner source and may drift. `crystallize mass-operation --help` is authoritative.

## Raw API path

### Endpoints and auth

| Endpoint | URL | Auth |
| --- | --- | --- |
| Core API | `https://api.crystallize.com/@{tenant}` | Headers below |
| File upload | Returned in `generatePresignedUploadRequest.url` | Presigned — no auth needed |

```
Content-Type: application/json
X-Crystallize-Access-Token-Id: <your-token-id>
X-Crystallize-Access-Token-Secret: <your-token-secret>
```

### 1. Request a presigned upload

```graphql
mutation GeneratePresignedUpload($filename: String!, $contentType: String!) {
  generatePresignedUploadRequest(
    input: {
      type: MASS_OPERATIONS
      filename: $filename
      contentType: $contentType
    }
  ) {
    ... on PresignedUploadRequest {
      url
      fields { name value }
    }
    ... on BasicError { error errorName }
  }
}
```

`MASS_OPERATIONS` routes to a dedicated bucket, separate from `MEDIA` and `STATIC`. Presigned URLs are
short-lived — upload immediately.

### 2. Upload the file

Multipart form POST. **Order matters: all presigned fields first, the file last.**

```typescript
async function uploadToPresignedUrl(
  presignedUrl: string,
  fields: Array<{ name: string; value: string }>,
  fileContent: string
): Promise<void> {
  const formData = new FormData();

  // Add all presigned fields first (order matters!)
  for (const field of fields) {
    formData.append(field.name, field.value);
  }

  // Add the file last
  const blob = new Blob([fileContent], { type: 'application/json' });
  formData.append('file', blob);

  const response = await fetch(presignedUrl, { method: 'POST', body: formData });
  if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
}

// The storage key is inside `fields` — there is no top-level `key`
const storageKey = fields.find(f => f.name === 'key')?.value;
```

Equivalent with curl:

```bash
curl -X POST "$PRESIGNED_URL" \
  -F "key=$KEY" \
  -F "bucket=$BUCKET" \
  -F "X-Amz-Algorithm=$ALGORITHM" \
  -F "X-Amz-Credential=$CREDENTIAL" \
  -F "X-Amz-Date=$DATE" \
  -F "X-Amz-Security-Token=$TOKEN" \
  -F "Policy=$POLICY" \
  -F "X-Amz-Signature=$SIGNATURE" \
  -F "file=@operations.json"
```

### 3. Register the bulk task

```graphql
mutation CreateMassOperationBulkTask($key: String!, $autoStart: Boolean) {
  createMassOperationBulkTask(input: { key: $key, autoStart: $autoStart }) {
    ... on BulkTaskMassOperation { id status }
    ... on BasicError { error errorName }
  }
}
```

`autoStart: true` dispatches the runner immediately. Omit it, or set false, to start later.

### 4. Start it (only if `autoStart` wasn't true)

```graphql
mutation StartMassOperationBulkTask($id: ID!) {
  startMassOperationBulkTask(id: $id) {
    ... on BulkTaskMassOperation { id status }
    ... on BasicError { error errorName }
  }
}
```

Note: this resolver reads the task **before** dispatching it, so the `status` in the response is the
pre-start value (`pending`). Poll `bulkTask` for the real state.

Both mutations are flagged `EXPERIMENTAL: the full feature set is not yet complete.` in the schema.

## What the runner does with your file

Worth knowing when a task behaves oddly:

1. A task is only picked up while its status is `pending`. Anything else is ignored outright.
2. The file is fetched from S3 and parsed with `OperationsSchema.safeParse`. On failure the worker logs
   each issue to **its own** logs and throws `Invalid Operation File`.
3. `enrichPriceVariantTiers` re-attaches `tierType`/`tiers` that the schema stripped from
   `priceVariants` (see `intents.md`).
4. An empty `operations` array stops the task as `error` with cause
   `No operations retrieved from spec file`.
5. Files above a configured size threshold are not run in the worker at all — the worker broadcasts a
   spawn request and a standalone task runs them. Behaviour is identical; only the execution host
   differs.
6. Operations then run **strictly sequentially** in array order. Queued image uploads for each operation
   run concurrently (up to 10) and are awaited before the next operation starts.

## Monitoring

### Task status

```graphql
query GetBulkTaskStatus($id: ID!) {
  bulkTask(id: $id) {
    ... on BulkTaskMassOperation {
      id
      status
      info { error errorName stack }
    }
    ... on BasicError { error errorName }
  }
}
```

Also available: `bulkTasks(filter: { type: massOperation })`.

Lifecycle: **`pending → started → complete | error`**. The status enum is exactly
`{pending, started, complete, error}` — there is **no `running` state**, despite what the public docs
say.

| Status | Meaning |
| --- | --- |
| `pending` | Created but not started. Only a `pending` task will be picked up |
| `started` | The operation loop is running |
| `complete` | The loop finished. **Individual operations may still have failed** |
| `error` | The task aborted — check `info` |

`complete` means "the runner reached the end of the array", not "everything worked".

### Per-operation logs

```graphql
query OperationLogs($id: ID!, $first: Int) {
  operationLogs(filter: { operationId: $id }, first: $first) {
    edges {
      node { status statusCode message input output }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

`operationId` is the **bulk task id**. It's a paginated connection, so page through it — a large import
will not return every log in one call. The filter also accepts two fields the docs don't mention:
`status` (`success` | `partial` | `failure`) and `operationTypeStartsWith`. Filtering on
`status: failure` is the fastest triage.

Each entry stores the original input payload, the command executed, the result, a `status`
(`success` / `partial` / `failure`), and a `statusCode`.

| status | statusCode | When |
| --- | --- | --- |
| `success` | `200` | Command executed without throwing |
| `partial` | `206` | `item/publish` only — some items failed, or zero succeeded |
| `failure` | `500` | The command threw, or the converter failed to build it |

Those are the only three the runner emits. The underlying DTO permits `201/400/401/403/404/502/503/504`
too, but nothing writes them.

**Check these even when the task says `complete`.** Operation-level failures are logged and the runner
moves on to the next operation — there is no implicit rollback.

**An operation with no log entry was skipped, not lost.** Some converters return no command (an already
registered image, an unresolvable delete, a root-node path set) and the runner writes nothing at all
for those. See `intents.md` § "Silent skips".

Image uploads appear as their own entries with `input.intent = "image/upload"`, separate from the
operation whose `{{ upload ... }}` queued them.

### Error example

```json
{
  "bulkTask": {
    "id": "abc123",
    "status": "error",
    "info": {
      "error": "Invalid Operation File",
      "errorName": "Error",
      "stack": "Error: Invalid Operation File\n    at OperationsFetcherService.fetch..."
    }
  }
}
```

Schema violations and unparseable JSON mark the whole task `error` and no operation runs — unlike a
runtime failure on a single operation, which is logged and stepped over.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Invalid Operation File`, no detail | Server logs per-field zod issues to its own logger, not to `info` | Parse locally with `OperationsSchema`, or run via the CLI |
| Task `error`: `No converter found for intent item/unpublish` | `item/unpublish` is unimplemented in the runner | Remove it; use the Core API `unpublishItem` mutation |
| Task `error`: `TypeError: Invalid Version: 1` | `version` is `1`, `1.0` or `*` — valid per the regex, invalid per semver | Use `"1.0.0"` |
| Task `error`: `No operations retrieved from spec file` | Empty `operations` array, or an unreadable/empty upload | Check the file actually uploaded |
| Task stuck in `pending` | `autoStart: false` and never started | Call `startMassOperationBulkTask` |
| Re-run created duplicate products/folders | Item `upsert` without `itemId` or `resourceIdentifier` always creates | Add a `resourceIdentifier` to every item upsert |
| Re-run created duplicate orders/contracts | `order/upsert` and `subscription-contract/upsert` only dedupe on a real `id` | Track ids, or accept non-idempotence |
| `ResourceIdentifier is not implemented yet` | That intent doesn't support it | See `intents.md` § "Where `resourceIdentifier` actually works" |
| Operation missing entirely from `operationLogs` | Converter returned no command | See `intents.md` § "Silent skips" |
| A field literally contains `{{ myRef.id }}` | Template render threw; the renderer returns the raw string | Fix the reference; check the intent's real `_ref` output |
| Reference resolves to an object, not an ID | Running at `version: "0.0.1"` | Use `"1.0.0"`, where upserts are normalised flat |
| `fetch*` returned pre-update data | Fetch cache isn't invalidated by that intent | Use an uncached helper (`*ByResourceIdentifier`, `fetchProductVariantBySku`) |
| Variant `topicIds` didn't apply | Stripped by the schema, not re-attached by the runner | Assign variant topics via another API |
| Component content saved but wrong | `item/updateComponent/item` runs with content validation disabled | Verify component IDs against `dump-content-model` |
| `400 Bad Request` on mutations | Missing union type fragments | Add `... on BulkTaskMassOperation` and `... on BasicError` |
| `Failed to fetch` on upload | Browser CORS restriction | Upload server-side or proxy the S3 request |
| `key` is undefined | Looking for a top-level `key` | Read it from the fields array: `fields.find(f => f.name === 'key').value` |
| Task `error` with no message | Not querying `info` | Add `info { error errorName stack }` to the `bulkTask` query |
| `Invalid component ID …` | Component doesn't exist on that shape | Re-check against `dump-content-model` output |

## Browser CORS

The S3 bucket may block cross-origin requests from a browser. Options, in order of preference:

1. **Use the CLI** — recommended for production migrations
2. **Server-side proxy** — route uploads through your backend
3. **Dev proxy** — Vite/webpack dev server

```javascript
export default defineConfig({
  server: {
    proxy: {
      '/api/s3-upload': {
        target: 'https://crystallize-mass-operations-production.s3.eu-central-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/s3-upload/, ''),
      },
    },
  },
});
```
