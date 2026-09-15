---
name: mass-operations
description: Author, validate, run, and monitor Crystallize mass operation files — the JSON batch format executed by the mass-operations runner as a BulkTask. Use this skill whenever the user wants to bulk create, update, or upsert Crystallize data (products, folders, documents, variants, prices, stock, customers, orders, subscription contracts, shapes, pieces, topics, flows, price lists, paths, images), seed or migrate a tenant, import a catalog or customer/order backlog, fix or replay data outside API rate limits, publish or unpublish items at scale, or debug a failed or stuck bulk task. Trigger on mentions of "mass operation", "mass-operation", "bulk task", "bulkTask", "operations.json", "intent", "_ref", "createMassOperationBulkTask", "operationLogs", or on any request phrased as "import X into Crystallize", "update all products", "migrate this tenant" — even when the user does not name the mass operations feature itself.
metadata:
    author: Crystallize
    version: "1.0"
---

# Crystallize Mass Operations

A mass operation file is a strict JSON document listing every mutation you want Crystallize to run.
Each entry is an **operation**. The **mass-operations runner** consumes them as a **BulkTask**, applying
the same validation and side effects as the equivalent GraphQL mutation.

Use this for: tenant seeding/migration, catalog and customer/order imports, replaying or fixing data
outside API rate limits, coordinated multi-step changes, and large-scale content updates.

**The runner acts as a tenant admin.** These files are infrastructure artefacts — review them like code.

> Verified against `@crystallize/schema` v6.13.0 and the behaviour of the mass-operations
> runner as of 2026-08-18. These are observed runtime behaviours, not contractual API
> guarantees — re-check anything load-bearing before depending on it.
> Several examples in the public docs do not validate, and several documented behaviours differ
> from what the runner does — see `references/intents.md` § "Documentation discrepancies".

## Decide the execution path first

| Situation                                                          | Path                                        |
| ------------------------------------------------------------------ | ------------------------------------------- |
| User has the Crystallize CLI, or is doing a production migration   | **CLI** (default — recommended)             |
| Browser/app context, CI without CLI, or building tooling around it | **Raw API** (see `references/lifecycle.md`) |

## Workflow

### 1. Establish tenant context before writing anything

Do not invent IDs, shape identifiers, component IDs, or languages. Confirm with the user, or pull them:

```
crystallize mass-operation dump-content-model <tenant> <file>
```

Component IDs that don't exist on the target shape are the single most common cause of a failed task.

### 2. Write the file

```json
{
    "version": "1.0.0",
    "operations": [
        {
            "intent": "piece/upsert",
            "identifier": "rating-system",
            "name": "Rating System",
            "components": [
                {
                    "id": "name",
                    "name": "Name",
                    "type": "singleLine",
                    "config": { "singleLine": { "required": true } }
                }
            ]
        }
    ]
}
```

Top-level shape (`OperationsSchema`):

- `version` — **must be exactly `"1.0.0"`.** This is a behaviour switch, not a label: the runner picks
  the highest converter registered at a version `<=` this string. See "The `version` field" below.
- `operations` — ordered array; executed **sequentially, in order**. An empty array fails the task.

Every operation:

- has an `intent` — a literal string in a discriminated union. An unrecognised intent fails validation.
- carries the matching GraphQL input's fields **inlined at the top level** (not nested under `input`).
- accepts an optional `_ref` (non-empty string) for downstream references.

**Required fields per intent are listed in `references/intents.md` — check them before writing.**
For `_ref` chaining, handlebars, and helpers, read `references/templating.md`.

### 3. The `version` field selects the converter set

The runner resolves each intent to the newest handler whose version is equal to or lower than the
file's `version`. Two sets exist: `0.0.1` (legacy) and `1.0.0` (current).

- `"1.0.0"` — current converters. **Always use this.**
- `"0.0.1"` — legacy converters with no result normalisation. This is where the "upsert returns a
  different shape" folklore comes from; see `references/templating.md`.
- `"1"`, `"1.0"`, `"*"` — **pass schema validation, then crash the whole task at runtime.** The version
  string is fed to `semver.eq`/`semver.lt`, which throw `TypeError: Invalid Version: 1` on any
  non-full semver. Verified empirically against semver 7.8.5.

### 4. Identify items by `resourceIdentifier` where it is actually implemented

`resourceIdentifier` is your own stable key for an entity. It makes files re-runnable and portable
across tenants without hardcoding Crystallize IDs. The schema's `checkResourceIdentifierOrId`
refinement accepts it in place of `itemId`/`id`/`topicId`:

```
Expected at least a resourceIdentifier or an id/itemId/topicID.
```

**But passing schema validation does not mean the runner honours it.** Only these intents actually
resolve it: `product|document|folder /update` and `/upsert`, `item/delete`, `topic/update|upsert|delete`,
`image/register`, and all `item/paths/*`. Everywhere else it is either rejected at runtime or silently
ignored — the full table is in `references/intents.md` § "Where `resourceIdentifier` actually works".

### 5. Order operations as a dependency tree

**A thing must exist before anything references it.** Execution is strictly sequential, so every
dependency is positional — the referencing operation has to come later in the array than the operation
that creates its target. This is a universal rule: it applies to content exactly as it applies to the
content model. There is no deferred resolution and no second pass.

| Reference                                               | Must already exist                                          |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| `shape/upsert` choice → piece                           | the `piece/upsert`                                          |
| item's `shapeIdentifier`                                | the `shape/upsert`                                          |
| `tree.parentId`                                         | the parent `folder/create` (or `{{ defaults.rootItemId }}`) |
| `topicIds` on an item                                   | the `topic/*` operations                                    |
| `itemRelations` content                                 | every item it points at                                     |
| `item/updateComponent/*`                                | the item, and the component on its shape                    |
| `product/variant/*`, `…/price/modify`, `…/stock/modify` | the product, price variant, stock location                  |
| `item/flow/stage/addItems`                              | the `flow/*` defining that stage                            |
| `order`/`subscription-contract` customer link           | the `customer/upsert`                                       |
| any `{{ myRef.… }}`                                     | the operation carrying that `_ref`                          |

Chain with `_ref` where there is no natural identifier, and with a shared `identifier` /
`resourceIdentifier` where there is.

**Nothing checks this for you.** The schema validates structure, not existence, so a file referencing
something that isn't there yet uploads and starts happily — it fails partway through, after earlier
operations have already been applied, with no rollback. Worse, `item/updateComponent/item` runs with
content validation disabled (see `references/limits.md`), so a dangling reference written that way may
not raise at all. Order the
array correctly rather than relying on an error.

### 6. Validate and run

```
crystallize mass-operation run <tenant> <file>
```

Validates, requests presigned upload, pushes the file, creates the bulk task with `autoStart`, and waits
while tailing logs. Add `--no-interactive` for CI.

To validate without the CLI, parse the file with `OperationsSchema` from `@crystallize/schema/mass-operation`.
**Do this locally every time** — the server discards per-field detail (see step 7).

Raw API sequence: `references/lifecycle.md`.

### 7. Monitor and verify

Lifecycle: `pending → started → complete | error`. There is **no `running` status** — the enum is
exactly `{pending, started, complete, error}`.

**Always check `operationLogs`, not just task status.** A task reaches `complete` if the loop finishes,
even when individual operations failed — each failure is logged and the runner moves to the next
operation. There is no rollback. Per-operation `status` is `success`, `partial`, or `failure`, with
`statusCode` `200`, `206`, or `500` respectively.

Three ways an operation can leave **no log entry at all**:

- its converter returned no command (see `references/intents.md` § "Silent skips"),
- the whole task died first,
- schema validation rejected the file, so nothing ran.

A schema violation or unparseable JSON marks the task `error` before any operation runs, and
`bulkTask.info.error` reads only `Invalid Operation File` — the per-field issues go to the worker's own
logs, not to you. Validate locally to see them.

## Rules that prevent most failures

- **An item `upsert` with neither `itemId` nor `resourceIdentifier` always CREATES** — on every run.
  `externalReference` is _not_ a lookup key. This is the number-one duplicate-data trap: give every
  `product|document|folder /upsert` a `resourceIdentifier`. Identifier-keyed upserts (`piece`, `shape`,
  `customer`, `customer/group`, `pricelist`, `flow`, `product/variant`) are genuinely idempotent;
  `order/upsert` and `subscription-contract/upsert` are not unless you pass a real `id`.
- **`item/unpublish` is accepted by the schema but not supported by the runner.** It validates and
  uploads fine, then fails the whole task at execution and abandons every remaining operation. It is
  the only one of the 59 intents in this position. Unpublish via the Core API `unpublishItem`
  mutation instead.
- **Prefer `upsert` for re-runnability — but upserts derive from the _create_ input schema**, so they
  need the _full_ create payload, not a sparse patch. `product/upsert` requires `tree`, `vatTypeId`, and
  `variants` exactly as `product/create` does. (`product/variant/update` is the exception — it's
  `.partial()`, so it genuinely accepts a sparse patch.)
- **At `version: "1.0.0"` there is no upsert return-shape trap.** The v1.0.0 converters normalise every
  upsert result to a flat `{id}` or `{identifier}`. The `{{#if x.id.id}}…{{else}}…{{/if}}` guard seen in
  the public docs is legacy `0.0.1` behaviour — harmless but unnecessary. See `references/templating.md`.
- **`richText.html` is an array of strings**, not a string.
- **Shape and piece component settings go under `config`**, keyed by type:
  `{"id": "name", "name": "Name", "type": "singleLine", "config": {"singleLine": {"required": true}}}`.
  The inline form the public docs use (`"singleLine": {"required": true}` as a sibling of `type`)
  **validates and is then silently discarded** — the component is created with default settings.
- **`componentChoice` / `componentMultipleChoice` need ≥2 choices, and each choice needs a `type`.**
  When a choice carries more than one field, make it a `piece/upsert` and reference it with
  `{"type": "piece", "config": {"piece": {"identifier": "…"}}}` — an inline `components` array on a
  choice is not a valid API structure. Structural components (`contentChunk`, `componentChoice`,
  `componentMultipleChoice`) can never be direct children of each other; put a piece in between.
- **ID fields accept handlebars.** `IdSchema` is `/^(?:[0-9a-f]{24}|{{.*}})$/` — a 24-char hex ID or a
  `{{ ... }}` expression, nothing else. This is why `{{ defaults.vatTypeIds.[0] }}` and
  `{{ defaults.rootItemId }}` work where a literal placeholder like `"TODO"` fails validation.
- **A handlebars expression that fails to render is written through literally.** The renderer catches
  the error, logs it, and returns the _raw template string_ — so a bad reference silently stores
  `{{ myRef.id }}` as data rather than failing the operation.
- **`item/paths/set*` needs two operations to converge.** If anything must be removed, that run _only_
  removes; the add is expected as a separate operation. Not atomic, despite the name.
- **Respect the domain limits — the schema does not.** A file that exceeds one validates, uploads, and
  fails at execution, or worse succeeds with altered data. **One invalid operation rejects the entire
  file** (all-or-nothing parse), so chunk large jobs. The caps that bite most: **30 topics** per
  `topic/create` (counting the whole `children` subtree), **50 items** per `item/flow/stage/addItems`,
  **500 cart items** per order, **250 `topicIds`** per item, **75** item relations, and component
  nesting depth **5**. Default string fields cap at **256** chars.
- **A large class of limits fails silently** — no error, no log, wrong data stored. Notably: only the
  first component-type key in a content object is used and the rest are discarded; `null` content is
  coerced to empty and wipes the component; `propertiesTable` is rebuilt from the shape config;
  `numeric` `decimalPlaces` floors the stored value; choice/selection values not in the config are
  filtered out; strings are never trimmed. Read `references/limits.md` before writing content at scale.
- **Chunk large jobs** so a failure doesn't force replaying everything.
- **Never guess an intent name.** The union in `references/intents.md` is exhaustive as of v6.13.0.
- **Presigned URLs are short-lived.** Upload immediately after requesting one.

## Reference files

- `references/intents.md` — all 59 intents, required fields, verified `_ref` outputs, silent skips,
  limits, where `resourceIdentifier` works, corrected examples, docs bugs
- `references/templating.md` — `_ref`, positional refs, handlebars, `defaults.*`, `upload`, `fetch*`
- `references/limits.md` — every enforced limit: file-level, batch caps, silent data loss, config
  traps, string/number bounds, structural rules
- `references/lifecycle.md` — raw API upload/run/monitor, CLI commands, troubleshooting
