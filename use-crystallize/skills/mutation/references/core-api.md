# Core API Mutations Reference

The Core API provides full read/write access to items, shapes, customers, orders, and configuration.

See [SKILL.md](../SKILL.md) for endpoint URLs and authentication headers.

Two things decide the shape of every call on this page:

- **Mutations are top level.** `createProduct`, `publishItem`, `updateComponent` — there is no `product { … }`
  or `item { … }` wrapper. That wrapper belongs to the legacy PIM API, which is a different endpoint with a
  different schema.
- **The tenant is in the URL** (`https://api.crystallize.com/@<tenant>/core`), so no input takes a `tenantId`.
  The PIM API does, which is the quickest way to tell a Core example from a PIM one.

## Table of Contents

- [Reading a result](#reading-a-result) - The union pattern every mutation uses
- [Item Mutations](#item-mutations) - Create, publish, unpublish, delete, move
- [Component Updates](#component-updates) - Update individual fields on items and variants
- [Product Variants](#product-variants) - SKUs, pricing, stock, images
- [Customer Mutations](#customer-mutations) - Create, update, delete, hierarchies
- [Order Mutations](#order-mutations) - Update orders and their metadata
- [Media & Images](#media--images) - Upload images for items and variants
- [Flow Mutations](#flow-mutations) - Manage item workflows
- [Vector Ranking Mutations](#vector-ranking-mutations) - Vocabularies, item taste, re-indexing
- [Only in the legacy PIM API](#only-in-the-legacy-pim-api) - What Core does not have
- [Error Handling](#error-handling)

---

## Reading a result

Every mutation returns a **union**: the thing you asked for, or one of several error types. The error members
all implement `BasicError`, so one fragment catches every failure and `errorName` identifies it:

```graphql
mutation PublishItem($id: ID!, $language: String!) {
    publishItem(id: $id, language: $language) {
        __typename
        ... on PublishInfo {
            id
            versionId
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

Three error members are on almost every union: `UnauthorizedError` (the token lacks the permission),
`UnknownError`, and `ExperimentalFeaturesNotAvailableError` (the feature is not enabled for the tenant). Select
`__typename` when you want to branch on the outcome in code.

**The success member is often not the item.** Reaching for `... on Item` is the most common mistake here:

| Mutation                                     | Success member            |
| -------------------------------------------- | ------------------------- |
| `createProduct` / `updateProduct`            | `Product`                 |
| `createDocument` / `createFolder`            | `Document` / `Folder`     |
| `publishItem` / `unpublishItem`              | `PublishInfo`             |
| `deleteItem` / `deleteCustomer`              | `DeleteCount { removed }` |
| `updateComponent`                            | `UpdatedComponent`        |
| `removeComponent`                            | `ItemComponentRemoved`    |
| `addProductVariant` / `updateProductVariant` | `ProductVariant`          |
| `modifyProductVariantStock`                  | `ProductStockLocation`    |
| `modifyProductVariantPrice`                  | `ProductPriceVariant`     |
| `addItemsToFlowStage`                        | `FlowContentList`         |

The examples below keep the `BasicError` fragment where a call is easy to get wrong, and leave it out where it
would only repeat itself. Add it everywhere in real code.

---

## Item Mutations

`language` is an **argument**, not an input field, on every create and update.

### Create Product

`variants` and `vatTypeId` are required — a product cannot exist without at least one SKU and a VAT type. Read
the VAT types from the PIM API (see [below](#only-in-the-legacy-pim-api)) and keep the id in your config.

```graphql
mutation CreateProduct($input: CreateProductInput!, $language: String!) {
    createProduct(input: $input, language: $language) {
        __typename
        ... on Product {
            id
            name
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

```json
{
    "language": "en",
    "input": {
        "shapeIdentifier": "sneaker",
        "name": "Air Max 2024",
        "vatTypeId": "<vat type id>",
        "tree": { "parentId": "<folder id>" },
        "variants": [{ "sku": "air-max-2024-42", "name": "Size 42", "isDefault": true, "price": 129.99 }]
    }
}
```

`tree` is `{ parentId, position }`. Leave it out and the item is created without a place in the tree; add one
later with `createItemTreeNode(input: { itemId, parentId, position })`.

**Send every required component on create.** Creation validates the shape, so a required relation or a numeric
with a unit list fails with `ComponentContentValidationFailedError` unless its content is in `components`.
Create-then-fill does not work.

### Create Document

```graphql
mutation CreateDocument($input: CreateDocumentInput!, $language: String!) {
    createDocument(input: $input, language: $language) {
        ... on Document {
            id
            name
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

```json
{
    "language": "en",
    "input": {
        "shapeIdentifier": "blog-post",
        "name": "Welcome to Our Store",
        "tree": { "parentId": "<folder id>" }
    }
}
```

### Create Folder

```graphql
mutation CreateFolder($input: CreateFolderInput!, $language: String!) {
    createFolder(input: $input, language: $language) {
        ... on Folder {
            id
            name
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

```json
{
    "language": "en",
    "input": {
        "shapeIdentifier": "category",
        "name": "Summer Collection",
        "tree": { "parentId": "<shop folder id>" }
    }
}
```

### Publish Item

Publishing makes the item visible on the storefront. Creating an item does NOT publish it.

```graphql
mutation PublishItem {
    publishItem(id: "<item id>", language: "en", includeDescendants: false) {
        ... on PublishInfo {
            id
            versionId
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

`includeDescendants: true` publishes the children too, which is what you want for a folder.
`disableComponentValidation: true` publishes an item whose shape validation would otherwise block it — an empty
numeric piece is the usual reason.

`publishItems(ids: [ID!]!, language: String!)` exists for batches, but it answers with a `PublishItemsRequest`
whose return is not proof that the items are published yet. Prefer `publishItem` per item when the next step
depends on the published version.

### Unpublish Item

```graphql
mutation UnpublishItem {
    unpublishItem(id: "<item id>", language: "en", includeDescendants: false) {
        ... on PublishInfo {
            id
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

### Delete Item

```graphql
mutation DeleteItem {
    deleteItem(itemId: "<item id>") {
        ... on DeleteCount {
            removed
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

The argument is `itemId`, and the answer is a count, not the item. Deleting a folder with children fails until
the children are moved or deleted.

### Move Item in Tree

```graphql
mutation MoveItem {
    moveItemTreeNode(itemId: "<item id>", language: "en", input: { parentId: "<new parent id>", position: 1 }) {
        itemId
        parentId
        path
        position
    }
}
```

`moveItemTreeNode` returns an `ItemTreeNode` directly — it is one of the few mutations that is not a union.
`position` is a `PositiveInt`, so it counts from 1.

---

## What a partial write replaces

The item mutations are not patches. Sending a component list means "these are the components now", and
the calls that look narrow have the widest blast radius. Every row below cost a build a round of
re-imports.

| Call                                                 | What it does to everything you did not send                         |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| `updateProduct` / `updateDocument` with `components` | **Replaces the whole component set** for that language              |
| `updateProduct` / `updateDocument` with only `name`  | Leaves components alone — the safe way to rename                    |
| `updateProductVariant` **without** `components`      | **Empties that variant's components** in that language              |
| `updateComponent(itemId, language, component)`       | Touches that one component only — use it for partial edits          |
| `product/upsert` and friends in a mass operation     | Replace all components, so send every one, not only the changed one |
| `setItemTaste`                                       | Empties every **variant's** components on the draft (see below)     |

**Translating is where this bites.** Writing two fields in a second language with
`updateProduct(language: "no", input: { components: [tagline, summary] })` fails with "Need to provide at
least 1 related items for component brand" — and had it passed, it would have dropped everything not
sent. Translate with `updateComponent` per component, and rename with `update*(input: { name })`. Shared
(non-multilingual) components then keep showing in every language, untouched.

**`setItemTaste` has a side effect on variants.** After writing taste, the draft's variant components were
gone in every language while product components survived, and the publish that follows taste then
published them empty. Order the pipeline: taste first, then (re)write variant components, then publish.
(Tools Universe. The same build first blamed a shape update and re-ran it, which changed nothing.)

**A variant's content chunks may not publish at all.** On the same tenant a variant chunk sat in the
draft, but after `publishItem` the `current` version — and Discovery — had `chunks: []`, while a
`singleLine` on the same variant and a numeric on another shape's variants published fine. If a variant
chunk disappears on publish, move that data to the product (one row per variant, with the SKU in it).

**Creating an item validates its required components**, so create is not "create then fill": a document
whose relation has `minItems: 1`, or a numeric with a unit list, fails `createDocument` with
`ComponentContentValidationFailedError` unless those components are in the create input. Send everything
on create.

---

## Component Updates

`updateComponent` changes one component on one item, in one language. It is the call to reach for when you are
editing rather than rebuilding: everything else that takes `components` replaces the whole set.

```graphql
mutation UpdateComponent($itemId: ID!, $language: String!, $component: ComponentInput!) {
    updateComponent(itemId: $itemId, language: $language, component: $component) {
        __typename
        ... on UpdatedComponent {
            updatedComponentPath
            item {
                id
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

Arguments worth knowing:

| Argument                   | Meaning                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| `itemId`                   | The item to edit                                                           |
| `sku`                      | Edit a **variant's** component instead — pass the SKU rather than `itemId` |
| `language`                 | Required; components are per language unless the shape says otherwise      |
| `disableContentValidation` | Write content the shape would otherwise reject                             |

`ComponentInput` is `{ componentId, <one content key> }`. The content key names the component type, and the
examples below differ only in that key. `removeComponent(itemId:, language:, componentId:)` clears one.

### Rich Text

`html` and `json` are **lists** — one entry per block.

```json
{ "componentId": "description", "richText": { "html": ["<p>New product description</p>"] } }
```

### Single Line

```json
{ "componentId": "tagline", "singleLine": { "text": "Premium quality materials" } }
```

### Numeric

`number` is required, so a numeric cannot carry a unit without a value.

```json
{ "componentId": "weight", "numeric": { "number": 1.5, "unit": "kg" } }
```

### Boolean (Switch)

```json
{ "componentId": "featured", "boolean": { "value": true } }
```

### Images Component

`images` is a list of `ImageInput`, and `key` is the only required field. The key comes from the media library —
see [Media & Images](#media--images).

```json
{ "componentId": "gallery", "images": [{ "key": "<image key>", "altText": "Product front view" }] }
```

### Selection

```json
{ "componentId": "color", "selection": { "keys": ["red"] } }
```

### Colors

```json
{
    "componentId": "brand-color",
    "colors": { "colors": [{ "label": "Midnight Blue", "hex": "#191970", "rgb": { "r": 25, "g": 25, "b": 112 } }] }
}
```

The content input is `colors: { colors: [GraphqlInputColorEntry!] }` — note the doubled key: the
component input field is `colors`, and it wraps a list also called `colors`.

Each entry carries any combination of `hex`, `rgb { r g b a }`, `hsl { h s l a }`,
`cmyk { c m y k }`, `pantone`, `ral` and `label`. **They are notations of the same colour, not
separate colours** — send as many as the item actually has, and write the whole list every time, since
the list replaces rather than merges. `colors` is also valid inside `NestableComponentInput`, so it
works within chunks, choices and pieces.

See the [[content-model]] skill for when to use Colors rather than a Selection.

### Item Relations

Relate by item, by SKU, or both.

```json
{ "componentId": "related-products", "itemRelations": { "itemIds": ["<item id>"], "skus": ["<sku>"] } }
```

### Content Chunk (repeatable)

`chunks` is a list of lists: one inner list per repetition, holding that repetition's components.

```json
{
    "componentId": "specifications",
    "contentChunk": {
        "chunks": [
            [
                { "componentId": "label", "singleLine": { "text": "Weight" } },
                { "componentId": "value", "singleLine": { "text": "1.5 kg" } }
            ],
            [
                { "componentId": "label", "singleLine": { "text": "Dimensions" } },
                { "componentId": "value", "singleLine": { "text": "30x20x10 cm" } }
            ]
        ]
    }
}
```

The other content keys on `ComponentInput` follow the same pattern: `datetime`, `files`, `gridRelations`,
`location`, `paragraphCollection`, `piece`, `propertiesTable`, `videos`, and the structural
`componentChoice` / `componentMultipleChoice`, which nest a `NestableComponentInput`.

---

## Product Variants

Variants are purchasable SKUs on a product. There is no `setVariants` on Core: variants are added, updated and
deleted one at a time, and stock and price have their own mutations.

| Task                  | Mutation                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Add a variant         | `addProductVariant(productId:, language:, input: CreateProductVariantInput!)`             |
| Change one variant    | `updateProductVariant(sku:, language:, input: UpdateSingleProductVariantInput!)`          |
| Delete one            | `deleteProductVariant(sku:)` — refuses the default with `CannotDeleteDefaultVariantError` |
| Replace the whole set | `updateProduct(id:, language:, input: { variants: [...] })`                               |
| Stock                 | `modifyProductVariantStock(sku:, stockLocationIdentifier:, operation:, quantity:)`        |
| Price                 | `modifyProductVariantPrice(sku:, priceVariantIdentifier:, price:, tiers:, tierType:)`     |

### Add a Variant

```graphql
mutation AddVariant($productId: String!, $language: String!, $input: CreateProductVariantInput!) {
    addProductVariant(productId: $productId, language: $language, input: $input) {
        ... on ProductVariant {
            sku
            name
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

```json
{
    "productId": "<product id>",
    "language": "en",
    "input": {
        "sku": "sneaker-red-42",
        "name": "Red - Size 42",
        "isDefault": false,
        "priceVariants": [{ "identifier": "default", "price": 129.99 }],
        "attributes": [
            { "attribute": "color", "value": "Red" },
            { "attribute": "size", "value": "42" }
        ],
        "images": [{ "key": "<image key>", "altText": "Red sneaker size 42" }]
    }
}
```

`price` sets the default price variant; `priceVariants: [{ identifier, price }]` sets any of them, which is what
you want on a multi-currency tenant. See [[pricing]].

### Update Stock

```graphql
mutation SetStock {
    modifyProductVariantStock(
        sku: "sneaker-red-42"
        stockLocationIdentifier: "oslo"
        operation: overwrite
        quantity: 50
    ) {
        ... on ProductStockLocation {
            identifier
            stock
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

`operation` is `increase`, `decrease` or `overwrite`, so a delta needs no read first. The stock location must
exist — create it in the PIM API.

### Variant Attributes

Attributes define the variant matrix (e.g. colour + size) and appear as filterable properties in the storefront.
Use consistent attribute names across products so the filters line up.

---

## Customer Mutations

One mutation creates both kinds of customer: `type` is `individual` or `organization`. There is no
`createIndividual` or `createOrganization` on Core.

### Create a Customer

```graphql
mutation CreateCustomer($input: CreateCustomerInput!) {
    createCustomer(input: $input) {
        __typename
        ... on Customer {
            identifier
            type
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

```json
{
    "input": {
        "identifier": "jane@example.com",
        "type": "individual",
        "firstName": "Jane",
        "lastName": "Smith",
        "email": "jane@example.com",
        "phone": "+1234567890",
        "addresses": [
            {
                "type": "delivery",
                "street": "123 Main St",
                "city": "New York",
                "postalCode": "10001",
                "country": "US"
            }
        ]
    }
}
```

`identifier` is the only required field and it is the customer's key everywhere else — carts, orders,
subscription contracts and customer-targeted price lists all name it. An address `type` is the enum
`billing`, `delivery` or `other`, not a string. A company uses `type: organization` with `companyName` and
`taxNumber`.

### Customer Hierarchies

`parents` links a customer to a company or a group:

```json
{
    "input": {
        "identifier": "buyer@acme.example.com",
        "type": "individual",
        "parents": [{ "identifier": "acme", "type": "customer" }]
    }
}
```

`type` on a parent is `customer` or `customerGroup`, and a customer can have more than one — too many answers
`TooManyCustomerParentsProvidedError`. This is how a B2B contact belongs to its company, which in turn decides
whose orders it sees and which contract prices apply — see [[pricing]].

### Update and Delete

```graphql
mutation UpdateCustomer {
    updateCustomer(identifier: "jane@example.com", input: { lastName: "Doe" }) {
        ... on Customer {
            identifier
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

Both `updateCustomer` and `deleteCustomer` take the **identifier**, not an id.
`deleteCustomer(identifier:, deleteSubscriptionContracts: true)` removes the customer and its contracts in one
call; orders are deleted separately. As with items, a list you send replaces the stored one — sending `meta` or
`addresses` drops whatever you left out.

---

## Order Mutations

> **If a storefront lists these orders, change them on the Shop API instead.** Every `updateOrder`
> in Core adds **another copy** of the order to the Shop store: three updates on one order left three
> Shop orders with new ids, the same `coreId` and different `updatedAt`, and a storefront summing that
> list counted the money three times. `updateOrderPipelineStage` and `deleteOrder` in Core, by contrast,
> never reach the Shop store at all. Use Shop `/order` `setMeta` and `addToStage` for anything a
> storefront reads, and keep Core order writes for back-office work on orders nobody lists from the edge.
> See [Shop API Order Mutations](shop-api-order-mutations.md).

### Update Order

```graphql
mutation UpdateOrder($id: ID!, $input: UpdateOrderInput!) {
    updateOrder(id: $id, input: $input) {
        __typename
        ... on Order {
            id
            updatedAt
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

```json
{ "id": "<order id>", "input": { "meta": [{ "key": "tracking_number", "value": "1Z999AA10123456784" }] } }
```

`UpdateOrderInput` also carries `cart`, `customer`, `payment`, `paymentStatus`, `total`,
`additionalInformation`, `relatedOrderIds` and `stockLocationIdentifier`. For a single key,
`updateOrderMetadata(id:, key:, value:)` is narrower and does not touch the rest;
`deleteOrderMetadata(id:, key:)` removes one.

`registerOrder(input: RegisterOrderInput!)` writes an order that did not come from a cart — a renewal invoice, a
POS sale, an import. Before using it, read what it does to an order a storefront lists, in
[shop-api-order-mutations.md](shop-api-order-mutations.md).

---

## Media & Images

Media is registered in the tenant's library first, then referenced **by key** in components or on
variants. Six mutations cover it:

| Mutation                                                                     | Notes                                                                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `copyRemoteAsset(sourceUrl:, type: image, targetFilename:, requestHeaders:)` | Crystallize fetches the URL. A **bulk task**: it returns `targetKey` before the file lands, and it registers the image for you |
| `generatePresignedUploadRequest(filename:, contentType:, type: MEDIA)`       | A target to POST your own bytes to — the only path for video                                                                   |
| `registerImage(imageKey:)`                                                   | Registers an uploaded key. Not needed after `copyRemoteAsset`                                                                  |
| `registerImageRevision(imageKey:, revisionKey:)`                             | Repoints the library entry — it does **not** reach published items                                                             |
| `updateImage(key:, language:, input:)`                                       | `altText`, `caption`, `focalPoint`, `meta`, `topicIds`, `showcase` — per language                                              |
| `deleteImage(key:, force:)`                                                  | Refuses while any item version references it; `force: true` overrides                                                          |

An import that follows these six in the obvious order still breaks in four different ways — keys whose
file never arrives, renditions that are not ready, revisions that never reach the storefront, and
deletes that refuse. **See [Media & Images](media.md)** for the working pipeline, what to verify after an
import, and how to replace an image later.

---

## Flow Mutations

Flows model item workflows (e.g. Draft > Review > Published). Items are added to a stage and removed from it;
there is no `setFlowStage` on Core.

```graphql
mutation AddToStage($items: [ItemFlowStageAssociationInput!]!) {
    addItemsToFlowStage(stageIdentifier: "review", items: $items) {
        __typename
        ... on FlowContentList {
            content {
                id
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

```json
{ "items": [{ "id": "<item id>", "language": "en", "version": "draft" }] }
```

An item is named by `{ id, language, version }`, where `version` is `current`, `draft` or `published`.
`moveFromFlowIdentifier` moves items out of another flow in the same call, and
`deleteItemsFromFlowStage(stageIdentifier:, items:)` takes them out again. Stage and flow identifiers are the
ones you gave `createFlow` / `createFlowStage`.

---

## Vector Ranking Mutations

Discovery's vector ranking is authored entirely on the Core API. Four calls, in this order:

| Mutation                                          | Notes                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `upsertVocabulary(input: UpsertVocabularyInput!)` | **Full replace**, not a patch — omitted dimensions are dropped                                                                 |
| `setItemTaste(input: SetItemTasteInput!)`         | One item, one language, one vocabulary. Writes the **draft**                                                                   |
| `publishItem(id: ID!, language: String!)`         | The indexer reads the published version — skipping this fails silently. See the note on `publishItems` below                   |
| `igniteDiscoApi(stacks: opensearch)`              | Async; poll `bulkTask(id:)` until `complete`, then allow propagation. `stacks: opensearch` is required for vectors to be built |

```graphql
mutation UpsertVocabulary($input: UpsertVocabularyInput!) {
    upsertVocabulary(input: $input) {
        name
        dimensions {
            id
            weight
        }
        lastUpdated
    }
}

mutation SetItemTaste($input: SetItemTasteInput!) {
    setItemTaste(input: $input) {
        __typename
        ... on Product {
            id
        }
        ... on BasicError {
            errorName
            message
        }
    }
}

mutation Index {
    igniteDiscoApi(stacks: opensearch) {
        __typename
        ... on BulkTaskIgnition {
            id
            type
            status
            createdAt
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

All three results are unions whose error members implement `BasicError`, so a single fragment covers
every failure and `errorName` identifies it. `setItemTaste` and `igniteDiscoApi` can both return
`ExperimentalFeaturesNotAvailableError`, which means vectors are not enabled for the tenant.

Read back with `vocabulary(name:)` and `item(id:, language:) { taste { vocabulary entries { key weight } } }`.

Prefer `publishItem` per item over `publishItems` here. `publishItem` returns the published version
(`PublishInfo`) or an error for that item; `publishItems` returns a `PublishItemsRequest`, and its return
is not proof that the items are published yet — index right after it and the index may read the old
versions.

**Re-run `igniteDiscoApi` after every change to vocabularies or taste entries** — an unindexed change
has no effect and raises no error. Omitting `stacks: opensearch` likewise fails silently: the index
rebuilds, but without vectors. Full guidance, including vocabulary design, positional weights and
key validation, is in the [[vector-ranking]] skill.

## Only in the legacy PIM API

Some tenant configuration has no Core equivalent at all — it is neither readable nor writable there. For these,
use `https://pim.crystallize.com/graphql`, which is namespaced (`subscriptionPlan { create(...) }`) and takes the
tenant **id** as an argument rather than `@tenant` in the URL:

| Concept                               | Why you need it                                                        |
| ------------------------------------- | ---------------------------------------------------------------------- |
| Subscription plans, periods, meters   | The template a subscription contract points at — see [[subscriptions]] |
| Order pipelines and their stages      | Creating them; Core can move an order between existing stages          |
| Stock locations                       | `modifyProductVariantStock` needs one to exist                         |
| VAT types                             | `createProduct` requires a `vatTypeId`                                 |
| Markets                               | Targeting price lists at a market — see [[pricing]]                    |
| Tenant preferences (`setPreferences`) | Registering a custom admin view through `input: { frontends }`         |

Price variants are **not** in this list: `createPriceVariant`, `updatePriceVariant`, `deletePriceVariant` and the
`priceVariant` / `priceVariants` queries are all on Core.

Anything created in the PIM API is read back through its own generated ids — plan period ids in particular —
so capture them when you create them rather than re-deriving them later.

## Error Handling

The Core API uses union return types. Always handle potential errors:

```graphql
mutation UpdateComponent($itemId: ID!, $language: String!, $component: ComponentInput!) {
    updateComponent(itemId: $itemId, language: $language, component: $component) {
        __typename
        ... on UpdatedComponent {
            updatedComponentPath
        }
        ... on ComponentContentValidationFailedError {
            errors {
                componentId
                message
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

A specific member first, then `BasicError` as the catch-all, is the pattern to copy: `errorName` tells you which
one you actually got.

Common error types:

| Error                                   | Cause                                                          |
| --------------------------------------- | -------------------------------------------------------------- |
| `UnauthorizedError`                     | Missing or insufficient access token permissions               |
| `UnknownError`                          | Unclassified failure                                           |
| `ExperimentalFeaturesNotAvailableError` | The feature is not enabled for this tenant                     |
| `ItemNotFoundError`                     | Item ID doesn't exist                                          |
| `ItemDoesNotBelongToTenantError`        | Item ID belongs to a different tenant                          |
| `ComponentContentValidationFailedError` | Content does not match the shape; carries per-component errors |
| `ProductVariantNotFoundError`           | No variant with that SKU                                       |
| `OrderNotFoundError`                    | Order ID doesn't exist                                         |

## Related Links

- [Crystallize Core API Documentation](https://crystallize.com/docs/developer/apis/core-api)
- [Managing Flows](https://crystallize.com/learn/developer-guides/core-api/managing-flows)
- [Component Updates](https://crystallize.com/learn/developer-guides/core-api/component-updates)
