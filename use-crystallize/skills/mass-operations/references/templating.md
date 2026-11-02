# Templating: references, helpers, and variables

Operations run sequentially, so a later operation can consume an earlier one's output. The templating
layer is Handlebars with async helpers — `{{ ... }}` expressions are resolved by the runner immediately
before each operation is converted to a command.

**The schema is templating-aware.** `IdSchema` is `/^(?:[0-9a-f]{24}|{{.*}})$/`: an ID field accepts a
24-character hex ID *or* a handlebars expression, and nothing else. A placeholder like `"TODO"` or
`"<parent-id>"` fails validation immediately — which is useful, because it means malformed references
are caught locally rather than at runtime.

Verified against runner behaviour as of 2026-10-29.

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

The runner walks the operation object recursively and renders **every string value** as a Handlebars
template. Two consequences:

- Any string field can contain `{{ ... }}`, not just ID fields.
- The `_ref` key itself is skipped, so a `_ref` name is never templated.

**A reference that resolves to nothing renders as an empty string.** A `_ref` that doesn't exist yet, a
failed or skipped operation and a wrong property all give `""`, and the operation still runs with the
blank value. On a text field that stores a blank. On an upsert's `itemId` it reads as "no id", so the upsert
creates. On `tree.parentId` the item is created **outside the catalogue tree** and logged as a success, so
one failed parent folder orphans its children. `item/publish` and `item/updateComponent/item` do fail on a
blank `itemId`. Check `input` in `operationLogs` for blanks after a run.

**A template that throws is swallowed.** A syntax error or a failing helper does not fail the operation:
the runner returns the **original template string**, so the literal `{{ myRef.id }}` lands in your data.
On an ID field the downstream command then fails with a confusing cast error; on a text field it just
persists. Grep your `operationLogs` output for `{{` after a run.

**`{{ x }}` HTML-escapes its output.** `Tom & Jerry` renders as `Tom &amp; Jerry`, and quotes and `=` are
escaped too. IDs are unaffected. Copy text with the triple form, `{{{ x }}}`.

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
An operation that failed, or that produced no command, stores `{}`, so `{{ myRef.id }}` renders empty
(see `intents.md` § "Silent skips").

## Positional references

Undocumented, but implemented: a reference whose first segment parses as a number is looked up by
**operation number** rather than by `_ref`.

```handlebars
{{ 0.firstName }}
```

The number is the operation's **0-based index in the file**. Every operation gets a slot, including
failed and skipped ones, which hold `{}`, so numbering never shifts.

**Prefer named `_ref`.** Positional references break as soon as the file is reordered or chunked.

## The upsert return-shape trap (legacy only)

The public docs warn that an upsert returns `{ id }` when it creates and `{ id: { id } }` when it
updates, and prescribe a Handlebars conditional to cope.

**That applies to `version: "0.0.1"` only.** At `version: "1.0.0"` the runner flattens these upsert
results before storing them, whichever path the backend took — create or update. `product/upsert`,
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

Injected by the runner without any `_ref`, assembled once per task:

| Variable | Source |
| --- | --- |
| `{{ defaults.taskId }}` | the bulk task id |
| `{{ defaults.tenantId }}` | tenant ObjectId |
| `{{ defaults.tenantIdentifier }}` | tenant identifier, falling back to the id |
| `{{ defaults.rootItemId }}` | the catalogue tree root |
| `{{ defaults.languages.[0] }}` | **tenant default language**; `[1..]` are the custom languages |
| `{{ defaults.vatTypeIds.[0] }}` | vat type ids, **first 100 only** |

These are the idiomatic way to satisfy required ID fields portably. `product/create` and
`product/upsert` both require `vatTypeId`, which must match `IdSchema` — so
`"vatTypeId": "{{ defaults.vatTypeIds.[0] }}"` is how you write a product operation that runs against
any tenant. Likewise `{{ defaults.rootItemId }}` for a top-level `tree.parentId`.

Note the `.[0]` bracket syntax for array indexing — the form Handlebars documents for numeric segments.
`defaults.vatTypeIds` has no guaranteed ordering, so `[0]` means "some vat type", not "the default
one" — name the vat type explicitly if it matters.

## Uploading images

```handlebars
{{ upload "https://my-image.com/image.jpg" }}
{{ upload "https://my-image.com/image.jpg" "hero-image-1" }}
```

The optional **second argument is a `resourceIdentifier`** (undocumented). If an image in this tenant
already carries it, `upload` returns that image's existing key and nothing is re-fetched.

**This does not make an import re-runnable on its own.** Nothing writes that field: `image/register` only
looks its `resourceIdentifier` up and does not store it on the image, and no public API sets one. A second
run of the file below downloads the image again under a new key and registers a second image.

```json
{
  "intent": "image/register",
  "key": "{{ upload \"https://my-image.com/image.jpg\" \"hero-image-1\" }}",
  "resourceIdentifier": "hero-image-1"
}
```

Mechanics worth knowing:

- `upload` **does not upload during the expression.** It reserves a storage key and queues the job.
  The actual download-and-upload runs after the operation completes, up to **10** at a time, and the
  runner waits for them before the next operation.
- Within one task, repeated calls with the same URL return the same key — so calling `upload` inline in
  several operations is safe.
- The filename is the last segment of the URL, so query strings and redirect URLs can produce odd names.
- The source must send `Content-Length` and an allowed image `Content-Type` (`references/limits.md`).
- Image uploads are logged as their own entries with `"intent": "image/upload"` and statusCode 200/500,
  **separate** from the operation that called `upload`. A failed image does not fail its operation.
- You can call `upload` inline anywhere a key is expected in another operation.

The file is strict JSON, so inner double quotes must be escaped as `\"` — or use single quotes, as the
fetch helpers below do.

## Fetch helpers

For pulling in entities that already exist in the tenant, rather than ones created earlier in the file.
Ten helpers:

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
a default.

```handlebars
{{ valueOf (fetchItemById '626af86d6f9c909e39ecb8a6' 'en' 'published') 'name' }}
{{ valueOf (fetchOrderById '626af86d6f9c909e39ecb8a6') 'reference' }}
```

`fetchItemById`'s `version` argument is coerced: **only the literal `'published'` is honoured, anything
else silently becomes `'draft'`**. So `'latest'` or `'live'` quietly reads the draft.

To feed an ID into an intent that needs one, read the right property. `id` on these results is a composite
object, not the plain ID:

```handlebars
{{ valueOf (fetchItemByResourceIdentifier 'hero-product' 'en') 'itemId' }}
{{ valueOf (fetchItemById '626af86d6f9c909e39ecb8a6' 'en' 'draft') 'id.id' }}
{{ valueOf (fetchTopicByResourceIdentifier 'colors' 'en') 'id.id' }}
```

### Caching and staleness

Six helpers read through a per-task cache: `fetchItemById`,
`fetchOrderById`, `fetchCustomerByIdentifier`, `fetchCustomerGroupByIdentifier`,
`fetchPriceListByIdentifier`, `fetchSubscriptionContractById`. The cache is emptied at task start and
end.

After each successful operation the runner refreshes the cache for these intents only:

`product|document|folder /update|upsert` · `order/update|upsert` · `customer/update|upsert` ·
`customer/group/update|upsert` · `pricelist/update|upsert` · `subscription-contract/update|upsert`

**Anything else leaves the cache stale.** In particular `item/updateComponent/item|sku`,
`product/variant/*`, `topic/*` and `image/register` do *not* refresh it — so a `fetchItemById` after a
component update in the same task can return pre-update data. The item refresh also needs `itemId` on the
operation and only re-reads the `draft` version, so an upsert keyed on `resourceIdentifier` alone, or a
cached `'published'` read, stays stale too.

The four uncached helpers — `fetchItemByResourceIdentifier`, `fetchProductVariantBySku`,
`fetchTopicByResourceIdentifier`, `fetchImageByResourceIdentifier` — read live every time and are always
fresh. Prefer them when you need to read something you just wrote.

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
{{ valueOf (fetchItemById '626af86d…' 'en' 'draft') 'components.0.content.text' }}
```

`components` is an array in shape order, so address a component by position, not by its id. A
`singleLine` holds `content.text`; a `richText` holds `content.json`, not plain text.

A missing segment yields `undefined` (rendered as an empty string) rather than throwing.
