# Intents

`intent` is a `z.literal` in a `z.discriminatedUnion`. The list below is **exhaustive** for
`@crystallize/schema` v6.13.0 — 59 intents. An intent not listed here will fail validation.

The rest of the operation object is the matching GraphQL input's fields, **inlined at the top level**.

Runtime facts on this page describe what the mass-operations runner actually does, verified as of
2026-08-18. They are observed behaviours, not contractual guarantees.

## Contents

- [Not supported by the runner](#not-supported-by-the-runner)
- [Required fields per intent](#required-fields-per-intent)
- [Where `resourceIdentifier` actually works](#where-resourceidentifier-actually-works)
- [Which upserts are idempotent](#which-upserts-are-idempotent)
- [Properties exposed to `_ref`](#properties-exposed-to-_ref)
- [Silent skips](#silent-skips)
- [Limits](#limits)
- [Schema quirks worth knowing](#schema-quirks-worth-knowing)
- [Corrected examples](#corrected-examples)
- [Documentation discrepancies](#documentation-discrepancies)

## Not supported by the runner

**`item/unpublish` is in the schema but the runner has no handler for it.** It is the only one of the
59 intents in this position.

The failure mode is unusually harsh. The file validates locally, uploads, and the task starts — then
fails when it reaches the operation, and unlike an ordinary per-operation error it is **not** caught
and logged. The task is marked `error` and **every remaining operation is abandoned**. Operations
already applied are not rolled back.

Unpublish via the Core API `unpublishItem` mutation instead.

## Required fields per intent

Derived by parsing empty payloads against the real schema. `_ref` is optional on every intent.
"+ id" means `checkResourceIdentifierOrId` applies at the _schema_ level: supply `itemId`/`id`/`topicId`
**or** `resourceIdentifier`. Whether the runner then honours `resourceIdentifier` is a separate
question — see the next section.

| Intent                                                                    | Required fields                                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `folder/create`                                                           | `name`, `shapeIdentifier`, `tree`, `language`                                         |
| `folder/update`                                                           | as create, + id                                                                       |
| `folder/upsert`                                                           | as create                                                                             |
| `document/create`                                                         | `name`, `shapeIdentifier`, `tree`, `language`                                         |
| `document/update`                                                         | as create, + id                                                                       |
| `document/upsert`                                                         | as create                                                                             |
| `product/create`                                                          | `name`, `shapeIdentifier`, `tree`, `vatTypeId`, `variants`, `language`                |
| `product/update`                                                          | as create, + id                                                                       |
| `product/upsert`                                                          | as create                                                                             |
| `item/updateComponent/item`                                               | `language`, `component`, + id — **runner requires `itemId` specifically**             |
| `item/updateComponent/sku`                                                | `language`, `component`, `sku`                                                        |
| `item/publish`                                                            | `language`, + id — **runner requires `itemId` specifically**                          |
| `item/unpublish`                                                          | schema-valid, **not implemented** — see above                                         |
| `item/delete`                                                             | + id. Passing _both_ `itemId` and `resourceIdentifier` throws                         |
| `item/flow/stage/addItems`                                                | `items` (min 1), `stageIdentifier`. Optional `moveFromFlowIdentifier`, `actionConfig` |
| `shape/create`                                                            | `identifier`, `name`                                                                  |
| `shape/update`, `shape/upsert`                                            | `identifier`, `name`                                                                  |
| `piece/create`, `piece/update`, `piece/upsert`                            | `identifier`, `name`                                                                  |
| `product/variant/create`                                                  | `sku`, `name`, `language`, `productId`                                                |
| `product/variant/update`                                                  | `language`, `sku` — **everything else optional** (`.partial()`)                       |
| `product/variant/upsert`                                                  | `sku`, `name`, `language`, `productId`                                                |
| `product/variant/delete`                                                  | `sku`                                                                                 |
| `product/variant/stock/modify`                                            | `sku`, `quantity`, `stockLocationIdentifier`                                          |
| `product/variant/price/modify`                                            | `sku`, `priceVariantIdentifier`, `price`                                              |
| `customer/create`, `customer/upsert`                                      | `identifier`                                                                          |
| `customer/update`                                                         | per `UpdateCustomerInputSchema`                                                       |
| `customer/group/create`, `customer/group/update`, `customer/group/upsert` | per group input schema                                                                |
| `order/register`                                                          | `cart`, `customer`                                                                    |
| `order/update`                                                            | `cart`, `customer`, + id — **runner requires `id` specifically**                      |
| `order/upsert`                                                            | `cart`, `customer` — **`pipelines` is omitted from this intent**                      |
| `subscription-contract/create`                                            | `customerIdentifier`, `subscriptionPlan`, `status`, `item`, `recurring`               |
| `subscription-contract/update`                                            | as create, + id — **runner requires `id` specifically**                               |
| `subscription-contract/upsert`                                            | as create                                                                             |
| `pricelist/create`, `pricelist/upsert`                                    | `identifier`, `name`, `priceVariants`, `selectedProductVariants`, `targetAudience`    |
| `pricelist/update`                                                        | per `UpdatePriceListInputSchema`                                                      |
| `topic/create`                                                            | `name`, `language`                                                                    |
| `topic/update`, `topic/upsert`                                            | `name`, `language`, + id (`topicId` or `resourceIdentifier`)                          |
| `topic/delete`                                                            | + id                                                                                  |
| `flow/create`, `flow/upsert`                                              | `name`, `stages`, `identifier` (`type` drives restriction mapping)                    |
| `flow/update`                                                             | `identifier` + per `UpdateFlowInputSchema`                                            |
| `image/register`                                                          | `key`                                                                                 |
| `item/paths/addAliases`, `setAliases`, `removeAliases`                    | `language`, `paths`, + `itemId`/`resourceIdentifier`                                  |
| `item/paths/addHistory`, `setHistory`, `removeHistory`                    | `language`, `paths`, + `itemId`/`resourceIdentifier`                                  |
| `item/paths/addShortcuts`, `setShortcuts`                                 | **`shortcuts`** (`[{parentId, position?}]`), + `itemId`/`resourceIdentifier`          |
| `item/paths/removeShortcuts`                                              | **`parentIds`**, + `itemId`/`resourceIdentifier`                                      |

The three shortcut intents take `shortcuts`/`parentIds`, **not `paths`**, and they ignore any `language`
you pass — the converter hardcodes the tenant default language for shortcut operations.

## Where `resourceIdentifier` actually works

The schema accepts `resourceIdentifier` far more widely than the runner implements it. Several
converters carry a literal `ResourceIdentifier is not implemented yet` error.

| Intent                              | Behaviour when you supply only `resourceIdentifier`                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `product\|document\|folder /update` | ✅ resolved via `loadByResourceIdentifier` (scoped by `language`)                      |
| `product\|document\|folder /upsert` | ✅ resolved; used to decide create-vs-update                                           |
| `product\|document\|folder /create` | ✅ stored on the new item, so later ops can find it                                    |
| `item/delete`                       | ✅ resolved. Supplying both it and `itemId` **throws**                                 |
| `topic/update`, `topic/upsert`      | ✅ resolved; mismatch against a supplied `topicId` throws                              |
| `topic/delete`                      | ✅ resolved (default language)                                                         |
| `topic/create`                      | ✅ stored on the new topic                                                             |
| `image/register`                    | ✅ used as a dedupe key — if already registered, the operation is skipped              |
| `item/paths/*`                      | ✅ resolved; throws `Item with resourceIdentifier … not found` if missing              |
| `item/updateComponent/item`         | ❌ **throws** `itemId is required … ResourceIdentifier is not implemented yet`         |
| `item/publish`                      | ❌ **throws** `Operation is missing itemId. ResourceIdentifier is not implemented yet` |
| `order/update`                      | ❌ **throws** `Operation is missing id. ResourceIdentifier is not implemented yet`     |
| `order/upsert`                      | ❌ **silently registers a brand-new order**                                            |
| `subscription-contract/update`      | ❌ **throws** the same "not implemented" error                                         |
| `subscription-contract/upsert`      | ❌ **silently creates a new contract**                                                 |

For the ❌ rows, resolve the ID yourself first — either with a `_ref` to the operation that created the
entity, or with a `fetch*` helper (`references/templating.md`).

## Which upserts are idempotent

An `upsert` is only idempotent if the converter has something to look the entity up by.

| Intent                              | Lookup key                                                    | Re-run safe? |
| ----------------------------------- | ------------------------------------------------------------- | ------------ |
| `piece/upsert`                      | `identifier`                                                  | ✅           |
| `shape/upsert`                      | `identifier`                                                  | ✅           |
| `customer/upsert`                   | `identifier`                                                  | ✅           |
| `customer/group/upsert`             | `identifier`                                                  | ✅           |
| `pricelist/upsert`                  | `identifier`                                                  | ✅           |
| `flow/upsert`                       | `identifier`                                                  | ✅           |
| `product/variant/upsert`            | `productId` + `sku`                                           | ✅           |
| `topic/upsert`                      | `topicId` or `resourceIdentifier` (one is required)           | ✅           |
| `product\|document\|folder /upsert` | `itemId` or `resourceIdentifier` — **only if you supply one** | ⚠️           |
| `order/upsert`                      | `id` only                                                     | ⚠️           |
| `subscription-contract/upsert`      | `id` only                                                     | ⚠️           |

The ⚠️ rows are the trap. With neither key present the runner short-circuits straight to a create, every run.
`externalReference` is _not_ consulted. A `product/upsert` keyed only on `externalReference` creates a
duplicate product on every run. The item lookup is also **language-scoped**, so upserting the same item
under a second language without an `itemId` will create a second item.

## Properties exposed to `_ref`

An operation's `_ref` output is the normalised result of the command it ran. The same value is stored
in `OperationLog.output`, which is the authoritative view.

**Verified** (at `version: "1.0.0"`):

| Intent                                                  | `_ref` output                                                                                                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product/upsert`, `folder/upsert`, `document/upsert`    | `{ id: string }` — flat, in all branches                                                                                                                                                |
| `shape/upsert`                                          | `{ identifier: string }`                                                                                                                                                                |
| `piece/create`, `piece/upsert`                          | `{ identifier: string }`                                                                                                                                                                |
| `customer/create`, `customer/update`, `customer/upsert` | `{ identifier: string }`                                                                                                                                                                |
| `product/variant/create`, `/update`, `/upsert`          | the **full variant DTO** minus `tenantId`/`language` (id, sku, name, isDefault, priceVariants, stockLocations, components, …); falls back to `{ sku }` if the variant can't be resolved |
| `product/variant/delete`                                | `{ sku: string }`                                                                                                                                                                       |
| `item/publish`                                          | `{ language, success: string[], failure: [{ itemId, error }] }`                                                                                                                         |
| `item/updateComponent/item`, `item/updateComponent/sku` | a **bare ID string**, not `{ id }` — reference it as `{{ myRef }}`                                                                                                                      |
| `product/variant/stock/modify`                          | a **bare ID string**, same as above                                                                                                                                                     |

**Not verified.** Every other intent returns whatever its underlying operation produces, and the shape
varies — several return nothing at all, which normalises to `null`. The public docs' table for these
is unreliable and is not reproduced here. Read the `output` field of a real `OperationLog` before
depending on one, or key off `resourceIdentifier` + a `fetch*` helper instead
(`references/templating.md`).

Note that `item/publish` is special-cased by the runner and stores its raw result.

## Silent skips

If a converter returns `null`/`undefined`, the runner's `if (command)` guard is false: **no command
runs, no `OperationLog` row is written, and no `_ref` output is saved.** The operation vanishes. A
`_ref` pointing at it resolves to nothing, and positional `_ref` numbering shifts (see
`references/templating.md`).

Known cases:

- `image/register` whose `resourceIdentifier` is already registered — intentional dedupe.
- `item/delete` where neither `itemId` nor a resolvable `resourceIdentifier` yields an id.
- `topic/delete` where the `resourceIdentifier` doesn't resolve.
- `item/paths/setAliases | setShortcuts | setHistory` targeting the tree **root** node.

If an operation you expected has no log entry, this is why — not a monitoring gap.

## Limits

Moved to its own file: **`references/limits.md`** — every bound that can break a mass operation, or
silently change what it writes, from an exhaustive source audit.

The headline ones: **one invalid operation rejects the entire file**; **30 topics** per `topic/create`
counting the whole subtree; **50 items** per `item/flow/stage/addItems`; **500 cart items** per order;
**250 `topicIds`** per item; **75** item relations; component nesting depth **5**; and a large class of
**silent** truncations and drops that raise no error at all.

## Schema quirks worth knowing

- **Upsert = create schema.** `UpsertProductOperationSchema` extends `CreateProductInputSchema`, not the
  update one. So an upsert needs the full create payload — it is _not_ a sparse patch. Same for
  document, folder, piece, shape, customer, customer group, pricelist, topic, flow, variant, and
  subscription contract.
- **`piece/update` also uses `CreatePieceInputSchema`**, so it too requires the full payload — and the
  converter sends the whole input, so omitted components are dropped, not preserved.
- **`order/upsert` omits `pipelines`** — present on `order/register`, rejected here.
- **`product/variant/update` omits `sku` and `isDefault` from the variant input, then `.partial()`s the
  rest**, re-adding `sku` as required. It's the only genuinely patch-style intent.
- **`flow/*` requires `identifier`** on top of the flow input.
- **`product/variant/create` and `/upsert` require `productId`**; `/update` and `/delete` key off `sku`.
- **`version` regex is `/^(\d+\.)?(\d+\.)?(\*|\d+)$/`** — looser than the runner. Only `1.0.0` is safe;
  `1`, `1.0` and `*` validate and then crash the task. See `SKILL.md` § "The `version` field".
- **`priceVariants[].tierType` and `.tiers` are stripped by the schema but re-attached by the runner.**
  `enrichPriceVariantTiers` walks the parsed result against the raw JSON and puts them back for
  `product/create|update|upsert` and `product/variant/create|update|upsert`. So tiered pricing works
  even though the fields don't appear in the schema. Matching is by `identifier`, falling back to array
  position only when no raw entry has one.
- **`variant.topicIds` is silently dropped.** Also stripped by the schema, and _not_ re-attached —
  there is an explicit `blocked on @crystallize/schema bump` comment in both variant converters.
  Assign variant topics another way.
- **`item/updateComponent/item` runs with `disableContentValidation: true`.** Component content is
  written without validation, so malformed content lands silently. `item/updateComponent/sku` does
  not disable it.

## Corrected examples

### Customer → order → component (docs example, valid as published)

```json
{
    "version": "1.0.0",
    "operations": [
        {
            "intent": "customer/upsert",
            "identifier": "customer-for-order-123",
            "firstName": "John",
            "lastName": "Doe",
            "type": "individual"
        },
        {
            "intent": "order/register",
            "customer": { "identifier": "customer-for-order-123", "type": "individual" },
            "additionalInformation": "Please deliver between 9am-5pm",
            "cart": [
                {
                    "sku": "SP-RED-001",
                    "name": "Sample Product",
                    "productId": "67e5d2d12d31ee752710a74b",
                    "quantity": 2,
                    "price": {
                        "currency": "USD",
                        "gross": 1000,
                        "net": 800,
                        "tax": { "name": "VAT", "percent": 20 }
                    }
                }
            ]
        },
        {
            "intent": "item/updateComponent/item",
            "itemId": "632958a35dfc2c90cbbad20d",
            "language": "en",
            "component": {
                "componentId": "title",
                "singleLine": { "text": "Mass operation updated title" }
            }
        }
    ]
}
```

The customer link uses a **shared identifier**, not `_ref`. Prefer that where a natural identifier
exists. Note `order/register` is not idempotent — re-running this file registers a second order.

### Product upsert → component update

The published docs version omits `tree`, `vatTypeId` and `variants`, passes `richText.html` as a
string, and — the part that actually costs you data — keys the upsert on `externalReference` alone, so
it duplicates the product on every run. Corrected:

```json
{
    "version": "1.0.0",
    "operations": [
        {
            "_ref": "rootProducts",
            "intent": "product/upsert",
            "resourceIdentifier": "product-sku-12345",
            "externalReference": "SKU-12345",
            "name": "My Product",
            "language": "en",
            "shapeIdentifier": "product",
            "tree": { "parentId": "{{ defaults.rootItemId }}" },
            "vatTypeId": "{{ defaults.vatTypeIds.[0] }}",
            "variants": [{ "sku": "SKU-12345", "name": "My Product", "isDefault": true }]
        },
        {
            "intent": "item/updateComponent/item",
            "itemId": "{{ rootProducts.id }}",
            "language": "en",
            "component": {
                "componentId": "description",
                "richText": { "html": ["<p>Updated description</p>"] }
            }
        }
    ]
}
```

`resourceIdentifier` is what makes the upsert an upsert. `{{ rootProducts.id }}` is a plain string at
`version: "1.0.0"` — the `{{#if rootProducts.id.id}}` dance in the docs is legacy `0.0.1` behaviour.

### Piece upsert (docs version is invalid)

The published version omits `name` on the component. Every component definition needs both `id` and
`name`:

```json
{
    "version": "1.0.0",
    "operations": [
        {
            "intent": "piece/upsert",
            "identifier": "rating-system",
            "name": "Rating System",
            "components": [{ "id": "name", "name": "Name", "type": "singleLine", "singleLine": { "required": true } }]
        }
    ]
}
```

## Documentation discrepancies

Points where <https://crystallize.com/docs/developer/mass-operations> differs from what the runner
does. The skill follows the runner.

### Examples that fail schema validation

1. `piece/upsert` example omits `name` on the component definition.
2. `product/upsert` example omits `tree`, `vatTypeId` and `variants` (upserts extend the _create_
   schema).
3. `richText.html` is passed as a string; the schema requires an array of strings.

### Statements contradicted by the runner

4. Task lifecycle is documented as `pending → started → running → complete | error`. There is no
   `running` state; the enum is `{pending, started, complete, error}`.
5. The `_ref` property table is largely wrong for v1.0.0 — upserts are normalised to flat `{id}` /
   `{identifier}`, `item/updateComponent/*` and `product/variant/stock/modify` return a bare string,
   and `product/variant/*` returns a full DTO rather than `{sku}`.
6. The "upsert returns `{id}` on create and `{id:{id}}` on update" guidance describes `version: "0.0.1"`
   only, but the docs pair it with `version: "1.0.0"` examples.
7. `resourceIdentifier` is presented as generally available. It is unimplemented on
   `item/updateComponent/item`, `item/publish`, `order/update|upsert` and
   `subscription-contract/update|upsert`.
8. `item/unpublish` is documented as a usable intent; it has no converter and aborts the whole task.
9. `item/paths/*Shortcuts` are documented as taking `paths`; they take `shortcuts` / `parentIds`.
10. `item/paths/set*` is presented as a set operation; it removes _or_ adds in a single run, never both.
11. `version` is presented as a version label. It selects the converter set, and three of the four
    formats the regex accepts crash the runner.
12. `externalReference` is used as the de-duplication key in the flagship `product/upsert` example,
    which duplicates data on re-run.
