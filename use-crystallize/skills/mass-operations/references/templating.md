# Templating: references, helpers, and variables

Operations run sequentially, so a later operation can consume an earlier one's output. The templating
layer is Handlebars (async, via `handlebars-async-helpers`) — `{{ ... }}` expressions are resolved by
the runner immediately before each operation is converted to a command.

**The schema is templating-aware.** `IdSchema` is `/^(?:[0-9a-f]{24}|{{.*}})$/`: an ID field accepts a
24-character hex ID *or* a handlebars expression, and nothing else. A placeholder like `"TODO"` or
`"<parent-id>"` fails validation immediately — which is useful, because it means malformed references
are caught locally rather than at runtime.

Verified against runner behaviour as of 2026-08-18.

## Contents

- [How enrichment works](#how-enrichment-works)
- [`_ref` chaining](#_ref-chaining)
- [Positional references](#positional-references)
- [The upsert return-shape trap (legacy only)](#the-upsert-return-shape-trap-legacy-only)
- [Default context variables](#default-context-variables)
- [Uploading images](#uploading-images)
- [Fetch helpers](#fetch-helpers)
- [`valueOf`](#valueof)

## How enrichment works

`MassOperationEnricherService.enrich` walks the operation object recursively and renders **every string
value** as a Handlebars template. Two consequences:

- Any string field can contain `{{ ... }}`, not just ID fields.
- The `_ref` key itself is skipped, so a `_ref` name is never templated.

**A template that throws is swallowed.** `MassOperationTemplateRenderer.renderTemplate` catches the
error, logs it, and returns the **original template string**. So a broken reference does not fail the
operation — it writes the literal `{{ myRef.id }}` into your data, and you find out later. On an ID
field the downstream command then fails with a confusing cast error; on a text field it just persists.
Grep your `operationLogs` output for `{{` after a run.

## `_ref` chaining

Tag an operation with `_ref` (a non-empty string), then reference its output by that name.

```json
[
  {
    "_ref": "rooms",
    "intent": "folder/create",
    "name": "My Rooms",
    "language": "en",
    "shapeIdentifier": "folder",
    "tree": { "parentId": "6902a7a78f7d45cf23343fab" }
  },
  {
    "intent": "folder/create",
    "name": "My Kitchen",
    "language": "en",
    "shapeIdentifier": "folder",
    "tree": { "parentId": "{{ rooms.id }}" }
  }
]
```

"My Kitchen" is created inside "My Rooms".

Which properties a `_ref` exposes depends on the intent — see `intents.md` § "Properties exposed to
`_ref`". Some outputs are a bare string rather than an object; for those, use `{{ myRef }}` directly.
An operation whose converter produced no command saves nothing at all, so a `_ref` to it resolves to
empty (see `intents.md` § "Silent skips").

## Positional references

Undocumented, but implemented and unit-tested: a reference whose first segment parses as a number is
looked up by **operation number** rather than by `_ref`.

```handlebars
{{ 0.firstName }}
```

`MassOperationTemplateRenderer.getOperationId` does `Number.isNaN(+id)` and routes to
`findByOperationNumber(taskId, n)` when it's numeric.

The counter is **0-based and assigned at save time**, not from your file's array index:
`MassOperationRepository.save` sets `operationNumber = count(existing rows for this task)`. Only
operations that actually produced a command are saved — a silently-skipped operation writes no row,
so everything after it shifts down by one relative to the file.

**Prefer named `_ref`.** Positional references are brittle against exactly the failure mode that is
hardest to notice.

## The upsert return-shape trap (legacy only)

The public docs warn that an upsert returns `{ id }` when it creates and `{ id: { id } }` when it
updates, and prescribe a Handlebars conditional to cope.

**That applies to `version: "0.0.1"` only.** At `version: "1.0.0"` the runner flattens every upsert
result before storing it, whichever path the backend took — create or update. `product/upsert`,
`folder/upsert` and `document/upsert` all yield a flat `{ id: string }`. `shape/upsert`, `piece/create|upsert` and
`customer/create|update|upsert` normalise to `{ identifier: string }`.

So at `1.0.0`, this is correct and sufficient:

```handlebars
{{ rootProducts.id }}
```

The defensive form still works — `id.id` is undefined on a flat `{id}`, so the `else` branch fires —
but it is noise:

```handlebars
{{#if rootProducts.id.id}}{{ rootProducts.id.id }}{{else}}{{ rootProducts.id }}{{/if}}
```

Keep it only if you genuinely target `version: "0.0.1"`. You should not.

## Default context variables

Injected by the runner without any `_ref`, assembled once per (tenant, task) by `DefaultsService`:

| Variable | Source |
| --- | --- |
| `{{ defaults.taskId }}` | the bulk task id |
| `{{ defaults.tenantId }}` | tenant ObjectId |
| `{{ defaults.tenantIdentifier }}` | tenant identifier, falling back to the id |
| `{{ defaults.rootItemId }}` | the catalogue tree root |
| `{{ defaults.languages.[0] }}` | **tenant default language**; `[1..]` are the custom languages |
| `{{ defaults.vatTypeIds.[0] }}` | vat type ids, **first 100 only** (the repository query is capped) |

These are the idiomatic way to satisfy required ID fields portably. `product/create` and
`product/upsert` both require `vatTypeId`, which must match `IdSchema` — so
`"vatTypeId": "{{ defaults.vatTypeIds.[0] }}"` is how you write a product operation that runs against
any tenant. Likewise `{{ defaults.rootItemId }}` for a top-level `tree.parentId`.

Note the `.[0]` bracket syntax for array indexing — Handlebars requires it for numeric segments.
`defaults.vatTypeIds` has no guaranteed ordering, so `[0]` means "some vat type", not "the default
one" — name the vat type explicitly if it matters.

## Uploading images

```handlebars
{{ upload "https://my-image.com/image.jpg" }}
{{ upload "https://my-image.com/image.jpg" "hero-image-1" }}
```

The optional **second argument is a `resourceIdentifier`** (undocumented). If an image is already
registered under it in this tenant, `upload` returns that image's existing key and nothing is
re-fetched — this is what makes image imports re-runnable.

```json
{
  "intent": "image/register",
  "key": "{{ upload \"https://my-image.com/image.jpg\" \"hero-image-1\" }}",
  "resourceIdentifier": "hero-image-1"
}
```

Mechanics worth knowing:

- `upload` **does not upload during the expression.** It reserves a storage key and queues the job.
  The actual download-and-upload runs after the operation completes, on a `p-queue` with concurrency
  **10**, and the runner awaits `queue.onIdle()` before the next operation.
- Within one task, repeated calls with the same URL return the same key (deduped in the runner's
  SQLite scratch DB) — so calling `upload` inline in several operations is safe.
- The filename is `path.basename(sourceUrl)`, so query strings and redirect URLs can produce odd names.
- Image uploads are logged as their own entries with `"intent": "image/upload"` and statusCode 200/500,
  **separate** from the operation that called `upload`. A failed image does not fail its operation.
- You can call `upload` inline anywhere a key is expected in another operation.

The file is strict JSON, so inner double quotes must be escaped as `\"` — or use single quotes, as the
fetch helpers below do.

## Fetch helpers

For pulling in entities that already exist in the tenant, rather than ones created earlier in the file.
Ten helpers, all registered via `@HandlebarsHelper`:

| Helper | Arguments |
| --- | --- |
| `fetchItemById` | `itemId`, `language`, `version` |
| `fetchItemByResourceIdentifier` | `resourceIdentifier`, `language` |
| `fetchOrderById` | `orderId` |
| `fetchSubscriptionContractById` | `id` |
| `fetchCustomerByIdentifier` | `identifier` |
| `fetchCustomerGroupByIdentifier` | `identifier` |
| `fetchPriceListByIdentifier` | `identifier` |
| `fetchProductVariantBySku` | `sku`, `language` |
| `fetchTopicByResourceIdentifier` | `resourceIdentifier`, `language` |
| `fetchImageByResourceIdentifier` | `resourceIdentifier`, `language` |

**Always pass every argument explicitly.** Handlebars appends its own options hash as the final
argument, so omitting `language` puts that object into the `language` slot rather than falling back to
a default. The runner's own tests call the helper as
`fetchItemById('item-1', 'en', 'published', {})` — the trailing `{}` is the options hash.

```handlebars
{{ valueOf (fetchItemById '626af86d6f9c909e39ecb8a6' 'en' 'published') 'name' }}
{{ valueOf (fetchOrderById '626af86d6f9c909e39ecb8a6') 'reference' }}
```

`fetchItemById`'s `version` argument is coerced: **only the literal `'published'` is honoured, anything
else silently becomes `'draft'`** (`version === 'published' ? 'published' : 'draft'`). So `'latest'` or
`'live'` quietly reads the draft.

### Caching and staleness

Six helpers read through a per-task cache (`MassOperationResourceCacheService`): `fetchItemById`,
`fetchOrderById`, `fetchCustomerByIdentifier`, `fetchCustomerGroupByIdentifier`,
`fetchPriceListByIdentifier`, `fetchSubscriptionContractById`. The cache is emptied at task start and
end.

After each successful operation the runner calls `refreshFetchedResourceCache`, which invalidates only
these intents:

`product|document|folder /update|upsert` · `order/update|upsert` · `customer/update|upsert` ·
`customer/group/update|upsert` · `pricelist/update|upsert` · `subscription-contract/update|upsert`

**Anything else leaves the cache stale.** In particular `item/updateComponent/item|sku`,
`product/variant/*`, `topic/*` and `image/register` do *not* invalidate — so a `fetchItemById` after a
component update in the same task can return pre-update data. The item refresh is also keyed on
`operation.itemId`, so an update resolved via `resourceIdentifier` alone may not invalidate either.

The four uncached helpers — `fetchItemByResourceIdentifier`, `fetchProductVariantBySku`,
`fetchTopicByResourceIdentifier`, `fetchImageByResourceIdentifier` — hit the repository every time and
are always fresh. Prefer them when you need to read something you just wrote.

`fetchOrderById` and `fetchSubscriptionContractById` load by raw id and then verify tenant ownership,
returning `null` for a foreign-tenant record — indistinguishable from "not found".

The `*ByResourceIdentifier` / `*ByIdentifier` variants pair naturally with writing `resourceIdentifier`
on your create/upsert operations: you set a stable key on the way in, then look entities up by that key
later, without ever hardcoding a Crystallize ID. This is the main workaround for intents whose `_ref`
output is unhelpful, and for the intents where the runner ignores `resourceIdentifier` (see
`intents.md`).

## `valueOf`

Reads a property off a helper result. It **splits on `.`**, so dotted paths work:

```handlebars
{{ valueOf (fetchItemById '626af86d…' 'en' 'draft') 'name' }}
{{ valueOf (fetchItemById '626af86d…' 'en' 'draft') 'components.description.content.plainText' }}
```

Implementation is `prop.split('.').reduce((acc, curr) => acc?.[curr], await obj)`, so a missing segment
yields `undefined` (rendered as an empty string) rather than throwing.
