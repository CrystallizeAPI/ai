# Intents

`intent` is a `z.literal` in a `z.discriminatedUnion`. The list below is **exhaustive** for
`@crystallize/schema` v6.17.0 — 61 intents. An intent not listed here will fail validation.

The rest of the operation object is the matching GraphQL input's fields, **inlined at the top level**.

Runtime facts on this page describe what the mass-operations runner actually does, verified as of
2026-10-29. They are observed behaviours, not contractual guarantees.

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
61 intents in this position.

The failure mode is unusually harsh. The file validates locally, uploads, and the task starts — then
fails when it reaches the operation, and unlike an ordinary per-operation error it is **not** caught
and logged. The task is marked `error` and **every remaining operation is abandoned**. Operations
already applied are not rolled back.

Unpublish via the Core API `unpublishItem` or `unpublishItems` mutation instead.

## Required fields per intent

Derived by parsing empty payloads against the real schema. `_ref` is optional on every intent.
"+ id" means `checkResourceIdentifierOrId` applies at the _schema_ level: supply `itemId`/`id`/`topicId`
**or** `resourceIdentifier`. Whether the runner then honours `resourceIdentifier` is a separate
question — see the next section.

| Intent                                                                    | Required fields                                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `folder/create`                                                           | `name`, `shapeIdentifier`, `tree`, `language`                                                      |
| `folder/update`                                                           | `language`, + id — everything else optional                                                        |
| `folder/upsert`                                                           | as create                                                                                          |
| `document/create`                                                         | `name`, `shapeIdentifier`, `tree`, `language`                                                      |
| `document/update`                                                         | `language`, + id — everything else optional                                                        |
| `document/upsert`                                                         | as create                                                                                          |
| `product/create`                                                          | `name`, `shapeIdentifier`, `tree`, `vatTypeId`, `variants`, `language`                             |
| `product/update`                                                          | `language`, + id — everything else optional                                                        |
| `product/upsert`                                                          | as create                                                                                          |
| `item/updateComponent/item`                                               | `language`, `component`, + id — **runner requires `itemId` specifically**                          |
| `item/updateComponent/sku`                                                | `language`, `component`, `sku`                                                                     |
| `item/publish`                                                            | `language`, + id — **runner requires `itemId` specifically**                                       |
| `item/unpublish`                                                          | schema-valid, **not implemented** — see above                                                      |
| `item/delete`                                                             | + id. Passing _both_ `itemId` and `resourceIdentifier` throws                                      |
| `item/flow/stage/addItems`                                                | `items` (min 1), `stageIdentifier`. Optional `moveFromFlowIdentifier`, `actionConfig`              |
| `shape/create`, `shape/upsert`                                            | `identifier`, `name`, `type`                                                                       |
| `shape/update`                                                            | `identifier`, `name` — **omitted `components` are wiped**, see quirks below                        |
| `piece/create`, `piece/update`, `piece/upsert`                            | `identifier`, `name`                                                                               |
| `product/variant/create`                                                  | `sku`, `name`, `language`, `productId`                                                             |
| `product/variant/update`                                                  | `language`, `sku` — **everything else optional** (`.partial()`)                                    |
| `product/variant/upsert`                                                  | `sku`, `name`, `language`, `productId`                                                             |
| `product/variant/delete`                                                  | `sku`                                                                                              |
| `product/variant/stock/modify`                                            | `sku`, `quantity`, `stockLocationIdentifier`, `operation`                                          |
| `product/variant/price/modify`                                            | `sku`, `priceVariantIdentifier`, `price`                                                           |
| `customer/create`, `customer/update`, `customer/upsert`                   | `identifier`                                                                                       |
| `customer/group/create`, `customer/group/update`, `customer/group/upsert` | `identifier`                                                                                       |
| `order/register`                                                          | `cart`, `customer`                                                                                 |
| `order/update`                                                            | + id — **runner requires `id` specifically**; everything else optional                             |
| `order/upsert`                                                            | `cart`, `customer` — **`pipelines` is omitted from this intent**                                   |
| `subscription-contract/create`                                            | `customerIdentifier`, `subscriptionPlan`, `status`, `item`, `recurring`                            |
| `subscription-contract/update`                                            | + id — **runner requires `id` specifically**; everything else optional                             |
| `subscription-contract/upsert`                                            | as create                                                                                          |
| `pricelist/create`, `pricelist/upsert`                                    | `identifier`, `name`, `modifierType`, `priceVariants`, `selectedProductVariants`, `targetAudience` |
| `pricelist/update`                                                        | `identifier`                                                                                       |
| `pricelist/selectedProductVariants/upsert`                                | `identifier`, `variants` (`[{sku, priceVariants?}]`). Optional `ignoreInvalidSkus`                 |
| `pricelist/selectedProductVariants/remove`                                | `identifier`, `skus`                                                                               |
| `topic/create`                                                            | `name`, `language`                                                                                 |
| `topic/update`                                                            | `language`, + id (`topicId` or `resourceIdentifier`)                                               |
| `topic/upsert`                                                            | `name`, `language`, + id (`topicId` or `resourceIdentifier`)                                       |
| `topic/delete`                                                            | + id                                                                                               |
| `flow/create`, `flow/upsert`                                              | `name`, `stages`, `identifier`, `type`                                                             |
| `flow/update`                                                             | `identifier`                                                                                       |
| `image/register`                                                          | `key`                                                                                              |
| `item/paths/addAliases`, `setAliases`, `removeAliases`                    | `language`, `paths`, + `itemId`/`resourceIdentifier`                                               |
| `item/paths/addHistory`, `setHistory`, `removeHistory`                    | `language`, `paths`, + `itemId`/`resourceIdentifier`                                               |
| `item/paths/addShortcuts`, `setShortcuts`                                 | **`shortcuts`** (`[{parentId, position?}]`), + `itemId`/`resourceIdentifier`                       |
| `item/paths/removeShortcuts`                                              | **`parentIds`**, + `itemId`/`resourceIdentifier`                                                   |

The three shortcut intents take `shortcuts`/`parentIds`, **not `paths`**, and they ignore any `language`
you pass — the runner always uses `en` for shortcut operations, not the tenant default language.

`product/variant/stock/modify` `operation` is `increase`, `decrease` or `overwrite`.

`pricelist/selectedProductVariants/*` add or remove SKUs on an existing list without resending it. The list
must exist. `/upsert` fails on an unknown SKU unless `ignoreInvalidSkus` is true, which skips it and reports
it in `skippedSkus`. `/remove` fails on an `ALL_SKUS` list.

## Where `resourceIdentifier` actually works

The schema accepts `resourceIdentifier` far more widely than the runner implements it. Several
converters carry a literal `ResourceIdentifier is not implemented yet` error.

| Intent                              | Behaviour when you supply only `resourceIdentifier`                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `product\|document\|folder /update` | ✅ resolved, in every language                                                         |
| `product\|document\|folder /upsert` | ✅ resolved; used to decide create-vs-update                                           |
| `product\|document\|folder /create` | ✅ stored on the new item, so later ops can find it                                    |
| `item/delete`                       | ✅ resolved. Supplying both it and `itemId` **throws**                                 |
| `topic/update`, `topic/upsert`      | ✅ resolved; mismatch against a supplied `topicId` throws                              |
| `topic/delete`                      | ✅ resolved                                                                            |
| `topic/create`                      | ✅ stored on the new topic                                                             |
| `image/register`                    | ⚠️ looked up, **never stored** — a re-run registers a new image, see below             |
| `item/paths/*`                      | ✅ resolved; throws `Item with resourceIdentifier … not found` if missing              |
| `item/updateComponent/item`         | ❌ **throws** `itemId is required … ResourceIdentifier is not implemented yet`         |
| `item/publish`                      | ❌ **throws** `Operation is missing itemId. ResourceIdentifier is not implemented yet` |
| `order/update`                      | ❌ **throws** `Operation is missing id. ResourceIdentifier is not implemented yet`     |
| `order/upsert`                      | ❌ **silently registers a brand-new order**                                            |
| `subscription-contract/update`      | ❌ **throws** the same "not implemented" error                                         |
| `subscription-contract/upsert`      | ❌ **silently creates a new contract**                                                 |
| `order/register`                    | ❌ accepted and ignored, not stored on the order                                       |
| `subscription-contract/create`      | ❌ accepted and ignored, not stored on the contract                                    |

For the ❌ rows, resolve the ID yourself first — either with a `_ref` to the operation that created the
entity, or with a `fetch*` helper (`references/templating.md`).

`image/register` skips the operation if an image already carries that `resourceIdentifier`, but it does not
write the field and no public API sets it on an image, so that match does not happen in practice.

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
duplicate product on every run. The item lookup is **not** language-scoped: the same `itemId` or
`resourceIdentifier` finds the item in every language, so upserting under a second language writes that
translation on the existing item. `order/upsert` and `subscription-contract/upsert` with an `id` that
doesn't exist create a new record under a generated id, not yours.

## Properties exposed to `_ref`

An operation's `_ref` output is the normalised result of the command it ran. The same value is stored
in `OperationLog.output`, which is the authoritative view. A failed or skipped operation stores `{}`.

**Verified** (at `version: "1.0.0"`):

| Intent                                                  | `_ref` output                                                                                                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product/create`, `folder/create`, `document/create`    | `{ id, language, versionLabel }` — `{{ myRef.id }}` is the item id                                                                                                                      |
| `product/upsert`, `folder/upsert`, `document/upsert`    | `{ id: string }` — flat, in all branches                                                                                                                                                |
| `topic/create`                                          | an **array** of `{ id, language }`, root first, then descendants — `{{ myRef.[0].id }}`                                                                                                 |
| `order/register`                                        | `{ id, createdAt }`                                                                                                                                                                     |
| `shape/upsert`                                          | `{ identifier: string }`                                                                                                                                                                |
| `piece/create`, `piece/upsert`                          | `{ identifier: string }`                                                                                                                                                                |
| `customer/create`, `customer/update`, `customer/upsert` | `{ identifier: string }`                                                                                                                                                                |
| `product/variant/create`, `/update`, `/upsert`          | the **full variant DTO** minus `tenantId`/`language` (id, sku, name, isDefault, priceVariants, stockLocations, components, …); falls back to `{ sku }` if the variant can't be resolved |
| `product/variant/delete`                                | `{ sku: string }`                                                                                                                                                                       |
| `item/publish`                                          | `{ language, success: string[], failure: [{ itemId, error }] }`                                                                                                                         |
| `item/updateComponent/item`, `item/updateComponent/sku` | a **bare ID string**, not `{ id }` — reference it as `{{ myRef }}`                                                                                                                      |
| `product/variant/stock/modify`                          | a **bare ID string**, same as above                                                                                                                                                     |
| `pricelist/selectedProductVariants/upsert`              | `{ identifier, upsertedSkus, skippedSkus }`                                                                                                                                             |
| `pricelist/selectedProductVariants/remove`              | `{ identifier, removedSkus }`                                                                                                                                                           |

**`topic/upsert` has no stable output:** the `topic/create` array when it created, an object with a nested
id when it updated. Read the id with `fetchTopicByResourceIdentifier` instead.

**Not verified.** Every other intent returns whatever its underlying operation produces, and the shape
varies — several return nothing at all, which normalises to `null`. The public docs' table for these
is unreliable and is not reproduced here. Read the `output` field of a real `OperationLog` before
depending on one, or key off `resourceIdentifier` + a `fetch*` helper instead
(`references/templating.md`).

Note that `item/publish` is special-cased by the runner and stores its raw result.

## Silent skips

If the runner builds no command for an operation, **nothing runs and no `OperationLog` row is written.**
The operation vanishes from the logs. Its `_ref` and position still exist and hold `{}`, so
`{{ myRef.id }}` renders empty and positional numbering does not shift (see `references/templating.md`).

Known cases:

- `image/register` whose `resourceIdentifier` already exists on an image.
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
- **`shape/update` validates with only `identifier` and `name`, but it is not a patch.** `components` and
  `variantComponents` default to empty, so omitting them wipes them from the shape. The same goes for a
  `shape/upsert` that hits an existing shape. Always send the full definition.
- **`order/upsert` omits `pipelines`** — present on `order/register`, silently stripped here.
- **`product/variant/update` omits `sku` and `isDefault` from the variant input, then `.partial()`s the
  rest**, re-adding `sku` as required.
- **`product|document|folder /update` are patches, except for `components` and `variants`.** Either one,
  when sent, replaces the whole list. See `SKILL.md`.
- **`topic/upsert` ignores `children` when the topic already exists.** Add child topics with `topic/create`
  and `parentId`.
- **`subscription-contract/update` resets `addresses` to empty** unless you resend them.
- **`order/*` drops fields the schema accepts.** `relatedOrderIds`, `stockLocationIdentifier` and a cart
  line's `subscription` are dropped on every order intent. `appliedPromotions` is dropped on `order/register`
  and on the create branch of `order/upsert`.
- **`payment` keeps only `provider`**, on `order/*` and `subscription-contract/*`. The provider details you
  send under `stripe`, `klarna`, `paypal`, `cash` or `custom` validate and are discarded, with no error.
- **`order/register` is asynchronous.** You get `{ id, createdAt }` straight away, but the order is stored
  later. Later in the same file, `order/update` can fail, `fetchOrderById` can return `null`, and
  `order/upsert` can register a second order. Run follow-ups in a separate task.
- **`item/publish` only requests the publish.** `success` lists accepted ids and the published version
  appears afterwards. It does validate component content, so content written by `item/updateComponent/item`
  can fail here as `partial` / 206. `includeDescendants` validates and is ignored: publish each item.
- **`flow/*` requires `identifier`** on top of the flow input.
- **`product/variant/create` and `/upsert` require `productId`**; `/update` and `/delete` key off `sku`.
- **`version` regex is `/^(\d+\.)?(\d+\.)?(\*|\d+)$/`** — looser than the runner. Only `1.0.0` is safe;
  `1`, `1.0` and `*` validate and then crash the task. See `SKILL.md` § "The `version` field".
- **`priceVariants[].tierType` and `.tiers` are stripped by the schema but re-attached by the runner.**
  It reads them back from the raw file for `product/create|update|upsert` and
  `product/variant/create|update|upsert`. So volume and graduated tiers work even though the fields don't
  appear in the schema. Matching is by `identifier`, falling back to array position only when no raw entry
  has one.
    - `tierType` is `volume` or `graduated`; `tiers` is `[{ "threshold": 1, "price": 100 }, …]`.
    - The schema still requires `price`, and it must equal the first tier's price. The first `threshold`
      must be 1, thresholds must strictly increase, and every price must be above 0. A breach fails that
      operation.
    - Upload the raw file, not the output of `OperationsSchema.parse`, which has no tiers left. The CLI
      uploads the raw file. The MCP tools refuse these keys as unrecognised, so use the CLI or the raw API.
    - `product/variant/price/modify` is flat: on a tiered price it replaces the whole ladder with one price.
- **`variant.topicIds` is silently dropped.** Also stripped by the schema, and _not_ re-attached.
  Assign variant topics another way.
- **`item/updateComponent/item` runs with content validation disabled.** Component content is
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
`name`, and its settings go under `config`:

```json
{
    "version": "1.0.0",
    "operations": [
        {
            "intent": "piece/upsert",
            "identifier": "rating-system",
            "name": "Rating System",
            "components": [
                { "id": "name", "name": "Name", "type": "singleLine", "config": { "singleLine": { "required": true } } }
            ]
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
