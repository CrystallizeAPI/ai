# Lifecycle: upload, run, monitor

Verified against the CLI, runner and Core API behaviour as of 2026-10-29.

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
identifiers and component IDs instead of guessing them. The file is written with `version: "0.0.1"`: change
it to `"1.0.0"` before adding operations. `--no-item-ids` removes references to existing item IDs, and
`--force` overwrites an existing file.

```
crystallize mass-operation validate <file>
```

Checks the file against the schema locally, with no network call, and lists each issue per operation.

```
crystallize mass-operation run <tenant> <file>
```

Validates → requests presigned upload → pushes the file → creates and starts the bulk task → waits for
completion while tailing logs. It only exits on `complete`: a task that ends in `error` keeps it polling
forever, so put a timeout around it in CI.

```
crystallize mass-operation execute-mutations <tenant> <file> [image-mapping-file] [file-mapping-file]
```

Runs client-side GraphQL mutations alongside mass operations, for steps the runner doesn't cover.

`crystallize mass-operation add-operation <file>` appends operation skeletons to a file.

Commands that reach the API support `--no-interactive` for CI, take `--token_id` and `--token_secret`, and
reuse stored credentials. `run --legacy-spec` converts an old Spec File into a mass operation file.

`crystallize mass-operation --help` is authoritative.

## Raw API path

### Endpoints and auth

| Endpoint    | URL                                              | Auth                       |
| ----------- | ------------------------------------------------ | -------------------------- |
| Core API    | `https://api.crystallize.com/@{tenant}`          | Headers below              |
| File upload | Returned in `generatePresignedUploadRequest.url` | Presigned — no auth needed |

```
Content-Type: application/json
X-Crystallize-Access-Token-Id: <your-token-id>
X-Crystallize-Access-Token-Secret: <your-token-secret>
```

### 1. Request a presigned upload

```graphql
mutation GeneratePresignedUpload($filename: String!, $contentType: String!) {
    generatePresignedUploadRequest(type: MASS_OPERATIONS, filename: $filename, contentType: $contentType) {
        ... on PresignedUploadRequest {
            url
            fields {
                name
                value
            }
        }
        ... on BasicError {
            message
            errorName
        }
    }
}
```

`MASS_OPERATIONS` routes to dedicated private storage, separate from `MEDIA` and `STATIC`. Presigned URLs
are short-lived — upload immediately.

On Node, `createBinaryFileManager(client).uploadMassOperationFile(path)` from `@crystallize/js-api-client`
does steps 1 and 2 and returns the key.

### 2. Upload the file

Multipart form POST. **Order matters: all presigned fields first, the file last.** Send every entry of
`fields`, whatever its name: the set varies and the upload is refused if one is missing. Success is `201`.

```typescript
async function uploadToPresignedUrl(
    presignedUrl: string,
    fields: Array<{ name: string; value: string }>,
    fileContent: string,
): Promise<void> {
    const formData = new FormData();

    // Add all presigned fields first (order matters!)
    for (const field of fields) {
        formData.append(field.name, field.value);
    }

    // Add the file last
    const blob = new Blob([fileContent], { type: "application/json" });
    formData.append("file", blob);

    const response = await fetch(presignedUrl, { method: "POST", body: formData });
    if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
}

// The storage key is inside `fields` — there is no top-level `key`
const storageKey = fields.find((f) => f.name === "key")?.value;
```

Equivalent with curl:

```bash
curl -X POST "$PRESIGNED_URL" \
  -F "$FIELD_1_NAME=$FIELD_1_VALUE" \
  -F "$FIELD_2_NAME=$FIELD_2_VALUE" \
  -F "file=@operations.json" # one -F per entry of fields, in order, then the file
```

### 3. Register the bulk task

```graphql
mutation CreateMassOperationBulkTask($key: String!, $autoStart: Boolean) {
    createMassOperationBulkTask(input: { key: $key, autoStart: $autoStart }) {
        ... on BulkTaskMassOperation {
            id
            status
        }
        ... on BasicError {
            message
            errorName
        }
    }
}
```

`autoStart: true` dispatches the runner immediately. Omit it, or set false, to start later.

### 4. Start it (only if `autoStart` wasn't true)

```graphql
mutation StartMassOperationBulkTask($id: ID!) {
    startMassOperationBulkTask(id: $id) {
        ... on BulkTaskMassOperation {
            id
            status
        }
        ... on BasicError {
            message
            errorName
        }
    }
}
```

Note: this resolver reads the task **before** dispatching it, so the `status` in the response is the
pre-start value (`pending`). Poll `bulkTask` for the real state. Starting a task that isn't `pending` is
refused.

Both mutations are flagged `EXPERIMENTAL: the full feature set is not yet complete.` in the schema.

## What the runner does with your file

Worth knowing when a task behaves oddly:

1. A task is only picked up while its status is `pending`. Anything else is ignored outright. A `key`
   that points at a missing or empty file is dropped too, and the task stays `pending` with no error.
2. The runner loads the user who created the task, with their current roles. If that user no longer
   exists or has no role on the tenant, the task stops as `error` with `Cannot run bulk task …`.
3. The file is fetched and parsed with `OperationsSchema.safeParse`. On failure the issues stay in the
   runner's own logs and the task gets `Invalid Operation File`.
4. `tierType`/`tiers` that the schema stripped from `priceVariants` are re-attached from the raw file (see
   `intents.md`).
5. An empty `operations` array stops the task as `error`, with
   `info.cause` set to `No operations retrieved from spec file`.
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
            info
        }
        ... on BasicError {
            message
            errorName
        }
    }
}
```

`info` is a JSON scalar, so select it with no sub-fields. On a runtime error it holds `error`, `errorName`
and `stack`.

Also available: `bulkTasks(filter: { type: massOperation })`.

Lifecycle: **`pending → started → complete | error`**. The status enum is exactly
`{pending, started, complete, error}` — there is **no `running` state**, despite what the public docs
say.

| Status     | Meaning                                                            |
| ---------- | ------------------------------------------------------------------ |
| `pending`  | Created but not started. Only a `pending` task will be picked up   |
| `started`  | The operation loop is running                                      |
| `complete` | The loop finished. **Individual operations may still have failed** |
| `error`    | The task aborted — check `info`                                    |

`complete` means "the runner reached the end of the array", not "everything worked".

### Per-operation logs

```graphql
query OperationLogs($id: ID!, $first: Int) {
    operationLogs(filter: { operationId: $id }, first: $first) {
        ... on OperationLogConnection {
            edges {
                node {
                    status
                    statusCode
                    message
                    input
                    output
                }
            }
            pageInfo {
                hasNextPage
                endCursor
            }
        }
        ... on BasicError {
            message
            errorName
        }
    }
}
```

`operationId` is the **bulk task id**. It's a paginated connection, so page through it — a large import
will not return every log in one call. The filter also accepts two fields the docs don't mention:
`status` (`success` | `partial` | `failure`) and `operationTypeStartsWith`, an intent prefix such as
`product/`. Filtering on `status: failure` is the fastest triage.

Each entry stores the original input payload, the command executed, the result, a `status`
(`success` / `partial` / `failure`), and a `statusCode`. On a failure `message` is generic: the reason is
in `output.error.message`.

| status    | statusCode | When                                                       |
| --------- | ---------- | ---------------------------------------------------------- |
| `success` | `200`      | Command executed without throwing                          |
| `partial` | `206`      | `item/publish` only — some items failed, or zero succeeded |
| `failure` | `500`      | The command threw, or the converter failed to build it     |

Those are the only three the runner emits.

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
            "stack": "Error: Invalid Operation File\n    at ..."
        }
    }
}
```

Schema violations and unparseable JSON mark the whole task `error` and no operation runs — unlike a
runtime failure on a single operation, which is logged and stepped over. For unparseable JSON, `error`
holds the parser's message instead.

## Troubleshooting

| Symptom                                                      | Cause                                                                         | Fix                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `Invalid Operation File`, no detail                          | The per-field issues are not returned in `info`                               | Parse locally with `OperationsSchema`, or run via the CLI                    |
| Task `error`: `No converter found for intent item/unpublish` | `item/unpublish` is unimplemented in the runner                               | Remove it; use the Core API `unpublishItem` mutation                         |
| Task `error`: `TypeError: Invalid Version: 1`                | `version` is `1`, `1.0` or `*` — valid per the regex, invalid per semver      | Use `"1.0.0"`                                                                |
| Task `error`: `info.cause` `No operations retrieved…`        | Empty `operations` array                                                      | Check the file you uploaded                                                  |
| Task `error`: `Cannot run bulk task …`                       | The task's creator was deleted or has no role on the tenant                   | Recreate the task as a user with a role on the tenant                        |
| Task stuck in `pending`                                      | `autoStart: false` and never started, or `key` has no uploaded file behind it | Call `startMassOperationBulkTask`, or re-upload and create a new task        |
| `crystallize mass-operation run` never returns               | The task ended in `error`: `run` only exits on `complete`                     | Read `bulkTask`, and put a timeout around `run`                              |
| Re-run created duplicate products/folders                    | Item `upsert` without `itemId` or `resourceIdentifier` always creates         | Add a `resourceIdentifier` to every item upsert                              |
| Re-run created duplicate orders/contracts                    | `order/upsert` and `subscription-contract/upsert` only dedupe on a real `id`  | Track ids, or accept non-idempotence                                         |
| `ResourceIdentifier is not implemented yet`                  | That intent doesn't support it                                                | See `intents.md` § "Where `resourceIdentifier` actually works"               |
| Operation missing entirely from `operationLogs`              | Converter returned no command                                                 | See `intents.md` § "Silent skips"                                            |
| A field literally contains `{{ myRef.id }}`                  | Template render threw (syntax error or failing helper); raw string is stored  | Fix the template or the helper call                                          |
| A field is blank where a reference should have resolved      | The `_ref` is missing, failed or skipped, or the property is wrong            | Check the `_ref` operation's log and its real `output`                       |
| Text contains `&amp;` or `&#x27;`                            | `{{ x }}` HTML-escapes its output                                             | Use `{{{ x }}}`                                                              |
| Reference resolves to an object, not an ID                   | Running at `version: "0.0.1"`                                                 | Use `"1.0.0"`, where upserts are normalised flat                             |
| `fetch*` returned pre-update data                            | Fetch cache isn't invalidated by that intent                                  | Use an uncached helper (`*ByResourceIdentifier`, `fetchProductVariantBySku`) |
| Variant `topicIds` didn't apply                              | Stripped by the schema, not re-attached by the runner                         | Assign variant topics via another API                                        |
| Component content saved but wrong                            | `item/updateComponent/item` runs with content validation disabled             | Verify component IDs against `dump-content-model`                            |
| `400 Bad Request` on mutations                               | Missing union type fragments                                                  | Add `... on BulkTaskMassOperation` and `... on BasicError`                   |
| `Failed to fetch` on upload                                  | Browser CORS restriction                                                      | Upload server-side or proxy the upload request                               |
| `key` is undefined                                           | Looking for a top-level `key`                                                 | Read it from the fields array: `fields.find(f => f.name === 'key').value`    |
| Task `error` with no message                                 | Not querying `info`                                                           | Add `info` to the `bulkTask` query                                           |
| `Invalid component id specified: …`                          | `item/updateComponent/*` on a component that isn't on that shape              | Re-check against `dump-content-model` output                                 |
| `Component type or content not provided.`                    | A component entry has no recognised type key                                  | Fix the key, e.g. `singleLine`                                               |

## Browser CORS

The upload URL may block cross-origin requests from a browser. Options, in order of preference:

1. **Use the CLI** — recommended for production migrations
2. **Server-side proxy** — route uploads through your backend
3. **Dev proxy** — Vite/webpack dev server

```javascript
export default defineConfig({
    server: {
        proxy: {
            "/api/mass-operation-upload": {
                target: "<origin of the url from generatePresignedUploadRequest>",
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/mass-operation-upload/, ""),
            },
        },
    },
});
```
