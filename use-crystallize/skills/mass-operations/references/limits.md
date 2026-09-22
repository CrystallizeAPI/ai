# Limits

Every bound that can break a mass operation, or silently change what it writes.

Compiled from an exhaustive audit of runner behaviour as of 2026-08-18, covering every component
type, primitive and value object. These are **observed limits, not documented API guarantees** —
re-check anything load-bearing before depending on it.

## Contents

- [How limits fail](#how-limits-fail)
- [File-level](#file-level)
- [Batch caps per operation](#batch-caps-per-operation)
- [Silent data loss](#silent-data-loss)
- [Config traps](#config-traps)
- [Component capacity](#component-capacity)
- [String and number bounds](#string-and-number-bounds)
- [Structural rules](#structural-rules)

## How limits fail

Three distinct modes. Knowing which one applies tells you whether to expect an error at all.

| Mode                  | What you see                                         | Blast radius               |
| --------------------- | ---------------------------------------------------- | -------------------------- |
| **schema-validation** | task `error`, `Invalid Operation File`, nothing runs | the whole file             |
| **runtime-throw**     | that operation logs `failure` / 500, run continues   | one operation              |
| **silent**            | **nothing** — no error, no log, wrong data stored    | however many rows carry it |

The silent class is the dangerous one and it is large. Local validation cannot catch any of it,
because the value is legal — it is the _behaviour_ that differs from what you wrote.

## File-level

| Limit                                                | Value                                                             | Mode                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| **One invalid operation rejects the entire file**    | all-or-nothing `safeParse`                                        | schema-validation                            |
| Spec file size (presigned POST content-length-range) | **50 MiB** max, 1 byte min (`UPLOAD_MAX_SIZE`)                    | upload rejected                              |
| Offload to standalone task                           | **1 MiB** (`MASS_OPERATIONS_STANDALONE_TASK_FILE_SIZE_THRESHOLD`) | none — runs elsewhere                        |
| Operations per file                                  | **no cap**                                                        | —                                            |
| `version` format                                     | `/^(\d+\.)?(\d+\.)?(\*                                            | \d+)$/`— but only`1.0.0`works, see`SKILL.md` | runtime-throw |

**All-or-nothing validation is the one to internalise.** There is no partial acceptance: operation
500 of 500 being malformed means operations 1–499 never run. Chunk large files so one bad row costs
you one chunk, and validate locally before every upload.

## Batch caps per operation

| Intent                           | Cap                                                    | Counting subtlety                                                           |
| -------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| `topic/create`, `topic/upsert`   | **30 topics**                                          | counts the **whole subtree recursively** — 1 root + 29 descendants          |
| `item/flow/stage/addItems`       | **50 items**                                           | raw array length; throws during conversion, so the op is skipped with a 500 |
| `order/*`                        | **500 cart items**                                     |                                                                             |
| `order/*`                        | **100 applied promotions**, **50 related orders**      |                                                                             |
| Any item or variant              | **250 `topicIds`**                                     | product variants share one **deduplicated union** across all variants       |
| `flow/*`                         | **30 stages**, **8 actions per stage**                 | nested `onFailure` actions are **not** counted                              |
| `customer/*`, `customer/group/*` | **5 parents**, **20 addresses**, hierarchy depth **5** |                                                                             |

`item/publish` has a 50-id batch cap that you **cannot reach** — the converter always sends exactly
one `itemId`.

## Silent data loss

Nothing below raises. Ordered by how many intents carry the risk.

### The component-content mapper

All component content passes through a single input mapper, and it is the largest source of silent
loss in the whole format.

- **Only the first present type key is used.** `{componentId: "media", images: [...], videos: [...]}`
  writes one and **silently discards the other**. Same rule in the config mapper.
- **`null` is coerced to empty, wiping the component.** `{"componentId":"gallery","images":null}`
  stores an empty list rather than erroring. Same for `numeric: null` (writes a contentless
  component), `chunks` missing/null (empty chunk list), `paragraphs` omitted (**wipes the whole
  collection**), per-paragraph `images` omitted (wipes that paragraph's images).
- **Unrecognised component types are dropped** by `filterComponents()` via the mapper's `unknownType`
  branch — no error, the component simply does not appear.
- **Stored content is dropped when its type no longer matches the definition**, e.g. after a shape
  change.

### `propertiesTable` is rebuilt from the shape config

If the shape config declares `sections`, the content constructor **ignores your structure entirely**
and regenerates it:

- sections are matched **by array index only**; sections beyond `config.sections.length` are dropped
- property keys not declared in the config are dropped
- your section title is **discarded and replaced** by the config's
- property order is forced to the config's key order
- every configured key is materialised as a valueless row, so omitting a key does not omit the row
- mentioning the component with an empty content object writes a **full empty skeleton**
- a property `value: null` is silently dropped, storing a bare key

Treat `propertiesTable` as config-driven: the shape decides the shape of the data, not your payload.

### `numeric` decimal places

- **`decimalPlaces` FLOORS the stored number.** It is not a display setting — the value is truncated
  on write, and it does not round.
- **`decimalPlaces: 0` is rejected** by mass-operation validation (`Too small: expected number to be >0`).
  Leave the key out for integers. If a shape's config holds 0 anyway, the runner's content path takes a
  `parseInt(String(...))` branch that destroys small-magnitude numbers.
- An empty-string `unit` is silently dropped in content, but **throws** in shape config.

### Choice and selection filter to configured options

- A `componentChoice` selection that is not one of the configured choices is **silently discarded**.
- `componentMultipleChoice` entries not matching a configured choice are **filtered out**.
- `selection` keys not present in the shape config's options are **filtered out**.
- `itemRelations`: falsy entries in `itemIds`/`skus` are filtered; an all-falsy array becomes empty.

In every case the write "succeeds" with fewer values than you sent. If you are seeding a shape and its
content in one file, an ordering mistake (step 5 in `SKILL.md`) shows up here as quiet data loss
rather than an error.

### Strings, dates, identifiers

- **`ValidatedString` never trims.** Leading/trailing whitespace is stored _and counts toward every
  length cap_.
- **`ValidatedString` coerces via `toString()`** — a number or boolean becomes its string form rather
  than being rejected. An explicit `null` raises a raw `TypeError`.
- **Datetime is re-parsed by `new Date()` and re-emitted as UTC ISO.** Offsets are normalised away.
- **Topic `pathIdentifier` is sliced to 64 chars _before_ slugification**, so a long topic name
  silently produces a different stored path.
- **`KeyValuePair` coerces an empty-string value to `null`.**
- **Tree-path collisions are silently rewritten** with a random suffix — one 5-char attempt, one
  10-char, then a forced 15-char. Your requested path is not necessarily the stored one.
- **Colour entries are whitelisted to exactly seven fields**; anything else is dropped.

### Retention

- **Path history keeps 100 entries** per item/language, enforced by a Mongo `$slice: -100`. No error
  type exists.
- **Archived published versions keep 50** per item/language; older ones are removed on publish.

### Images

- Remote download cap **50 MiB**, per-image timeout **30 s**. Both surface as separate `image/upload`
  log entries with status 500 — **the operation that queued the image still reports success.**

## Config traps

Cases where two components behave oppositely from the same JSON.

- **`max: 0` on a `files` component silently means 512.** A `max` of `0` is treated as "unset" for files and
  falls back to the ceiling. The same `max: 0` on `images` or `videos` rejects **every** entry.
  Identical JSON, opposite outcome.
- **`required: false` disables the configured `min` entirely.** `{min: 3, required: false}` accepts
  zero items. **Omitting `required` is stricter than setting it to `false`.**
- **`richText` `min`/`max` of 0 is a silent no-op** — the opposite of `singleLine`.
- **`item/updateComponent/item` skips ALL component content validation**: min/max counts, file size, MIME type and `required` are simply not executed. The identical payload
  via `item/updateComponent/sku`, `product/upsert`, `document/upsert` **is** validated and throws.
  Only reference existence and type are still checked. Enforcement depends on which intent you chose.
- **Order line items and payment objects are `.strict()`** — they reject _any_ unknown key, while
  nearly every other schema silently strips them. The one place a typo errors instead of vanishing.

## Component capacity

Ceilings on the `max` you may configure, and therefore on content.

| Component                                    | Cap                                |
| -------------------------------------------- | ---------------------------------- |
| `itemRelations`                              | **75** (quick-select folders: 100) |
| `images`, `files`, `videos`, `gridRelations` | **512**                            |
| `colors`                                     | **100**                            |
| `numeric` `decimalPlaces`                    | 1–**64** (0 is rejected)           |
| Configurable `min`/`max` bounds              | max **1048576**, min **256**       |
| Component nesting depth                      | **5**, following piece expansion   |

## String and number bounds

| Field                                                | Bound                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| **Default for every unqualified string**             | min 1, **max 256**                                          |
| Shape / piece / flow identifier                      | **2–64**, charset `[A-Za-z0-9]` plus `; : + @ (` and space  |
| `resourceIdentifier`                                 | 1–**256**, charset `[A-Za-z0-9]` plus `. - _ / @`           |
| `externalReference`                                  | 1–256                                                       |
| Item / catalogue item name                           | **512**                                                     |
| Product variant name                                 | **1024**                                                    |
| SKU                                                  | **512**                                                     |
| Variant attribute key / value                        | **128** / **2048**                                          |
| Component name / description                         | 256 / 1024                                                  |
| `singleLine` text, meta value, tree path             | **1048576**                                                 |
| Meta key                                             | 256                                                         |
| Image alt text / URL                                 | 1024 / 10240                                                |
| Order `additionalInformation`                        | 10240                                                       |
| Language code                                        | 2–20                                                        |
| Currency code                                        | 10                                                          |
| Topic display colour                                 | 4–9, `/^#([A-Fa-f0-9]{3}                                    | [A-Fa-f0-9]{6})$/` |
| Uploaded filename (basename of the `{{upload}}` URL) | 3–512                                                       |
| Every `id` field                                     | exactly 24 lowercase hex, or `{{ ... }}`                    |
| Price                                                | −1e9 … 1e9                                                  |
| Percent (order tax & discount)                       | −1000 … 1000                                                |
| Order cart item quantity                             | 0 … 1e6                                                     |
| Item tree position                                   | 1 … 100000                                                  |
| Latitude / longitude                                 | ±90 / ±180                                                  |
| Focal point                                          | x, y each 0 … 1                                             |
| **`product/variant/price/modify` price**             | **minimum 1** — you cannot set 0 this way                   |
| **`product/variant/stock/modify` quantity**          | **positive integer**                                        |
| Stock (elsewhere)                                    | `ValidatedInteger`, **fractional input silently truncated** |

## Structural rules

Minimums and shape rules, not maximums.

- `componentChoice` requires **≥ 2** choices; `componentMultipleChoice` **≥ 1**; `contentChunk` **≥ 1**
  component.
- `contentChunk` with `repeatable: false` accepts exactly **1** chunk.
- `selection` needs ≥ 1 option, keys unique.
- `product/*` requires a **non-empty `variants`** array; `pricelist/*` a non-empty `priceVariants`;
  `item/flow/stage/addItems` a non-empty `items`.
- Component identifiers must be **unique within a component list**.
- `min` must not exceed `max` in any component config.
- **Structural components cannot nest** — `contentChunk`, `componentChoice`, `componentMultipleChoice`
  can never be direct children of each other. Put a piece in between.
- `variantComponents` are allowed **only on product shapes**.
- Handlebars enrichment substitutes into **string values only** — a `{{ ... }}` inside a number or
  boolean is never resolved.
- At least one of `resourceIdentifier` / `id` / `itemId` / `topicId` is required where
  `checkResourceIdentifierOrId` applies.

## Operational note

A worker that dies mid-run leaves the task stuck in `started`. SQS redelivery after the 90 s
visibility timeout is **refused**, because `getTask` accepts only `pending` tasks and `markStarted`
fires before the run — so there is no double execution, but also no automatic retry. A task sitting in
`started` with no progress needs manual intervention.
