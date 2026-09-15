# Vocabulary & Taste Authoring (Core API)

Everything on this page runs against the **Core API** at `https://api.crystallize.com/@<tenant>/core`
with an access token pair. Vocabulary and index mutations are **not** on the PIM API.

## 1. Design the vocabulary

Decide what a person could plausibly have a preference _about_. That is your dimension list. Two tests:

- **Could a shopper move a slider for it?** Roast level, yes. SKU prefix, no. Dimensions nobody has
  taste about add noise to every score.
- **Does assignment order mean anything?** If the first flavour listed is the signature note, give the
  dimension a positional weight list. If not, one weight is enough.

Keep genuinely different concerns in **separate vocabularies**. What a coffee tastes like and where it
comes from are questions a shopper may weigh differently, so they are two vocabularies rather than five
dimensions in one. Vocabularies are scored independently and summed, so splitting a concern out is what
lets a shopper — and you, via a per-vocabulary `tasteCosine` term — weight it on its own.

```text
taste     roast    [1.0]              one roast level, order meaningless
          flavor   [1.0, 0.6, 0.3]    ordered: the signature note dominates
          body     [0.8]              matters, but less than roast

origin    region   [1.0]
          process  [1.0, 0.5]
```

**Values become the second half of every key, so keep them slug-shaped and stable:**
`flavor:blackcurrant`, not `flavor:Black Currant`. Renaming a value later means rewriting every item
that used it and re-indexing.

### Business dimensions are welcome

A vocabulary does not have to be about taste in the narrow sense. Margin band, stock depth, seasonality,
audience or tier all work as dimensions **when you want them inside a similarity score**. Use `rankBy`
instead when they should stay separate and be weighted on their own — that is usually the better
default for anything you already hold as a number on the product.

### Weights are positional

A dimension's `weight` is a **list**. One element means every entry in that dimension weighs the same.
More than one means entry _i_ takes `weight[min(i, length - 1)]`, clamping to the last element once you
run past the end.

```text
weight: [1.0, 0.6, 0.3]    1st entry  1.0
                           2nd entry  0.6
                           3rd entry  0.3
                           4th entry  0.3   (clamped to last)
```

## 2. Create the vocabulary

`upsertVocabulary` creates or replaces a vocabulary **in full**. It is a full replace, not a patch —
send the whole dimension list every time. **Any dimension you omit is gone.**

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
```

```json
{
    "input": {
        "name": "taste",
        "dimensions": [
            { "id": "roast", "weight": [1.0] },
            { "id": "flavor", "weight": [1.0, 0.6, 0.3] },
            { "id": "body", "weight": [0.8] }
        ]
    }
}
```

Schema:

```text
UpsertVocabularyInput   { name: String!, dimensions: [GraphqlInputVocabularyDimension!]! }
GraphqlInputVocabularyDimension { id: String!, weight: [Float!]! }
GraphqlVocabulary       { name: String!, dimensions: [GraphqlVocabularyDimension!]!, lastUpdated: Date }
```

Read it back with the `vocabulary` query — useful as an idempotency check before a bulk re-author:

```graphql
query {
    vocabulary(name: "taste") {
        name
        lastUpdated
        dimensions {
            id
            weight
        }
    }
}
```

## 3. Attach taste to items

`setItemTaste` writes the ordered entries for **one item, one language, one vocabulary**. Two
vocabularies means two calls per item.

```graphql
mutation SetItemTaste($input: SetItemTasteInput!) {
    setItemTaste(input: $input) {
        __typename
        ... on Product {
            id
        }
        ... on Folder {
            id
        }
        ... on Document {
            id
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

Every error member of the union implements the `BasicError` interface, so one fragment covers all of
them — `errorName` tells you which one you got. Spelling out individual error types is only worth it
when you branch on a field the interface does not carry.

```json
{
    "input": {
        "itemId": "<ITEM_ID>",
        "language": "en",
        "vocabulary": "taste",
        "entries": [
            { "key": "roast:light" },
            { "key": "flavor:berry" },
            { "key": "flavor:blackcurrant" },
            { "key": "flavor:caramel" },
            { "key": "body:light", "weight": 1.2 }
        ]
    }
}
```

Schema:

```text
SetItemTasteInput            { itemId: String!, language: String!, vocabulary: String!,
                               entries: [GraphqlInputItemTasteEntry!]! }
GraphqlInputItemTasteEntry   { key: String!, weight: Float }
SetItemTasteResult (union)   Product | Folder | Document
                             | ItemNotFoundError | ExperimentalFeaturesNotAvailableError
                             | UnauthorizedError | UnknownError
```

`ExperimentalFeaturesNotAvailableError` is in the result union and is **not** in the public docs. It
means vectors are not enabled for the tenant at all — read `errorName` off the `BasicError` fragment to
tell it apart from the others.

### Order is the input to positional weights

Entries are read **in array order, per dimension**. Above, `flavor:berry` takes 1.0,
`flavor:blackcurrant` 0.6 and `flavor:caramel` 0.3. The optional per-entry `weight` overrides the
vocabulary weight for that entry only — and **still consumes its positional slot**, so it does not shift
the entries that follow.

### The key format is validated

Every key is `<dimensionId>:<value>`. Everything before the first colon must be a **declared dimension
in that vocabulary**. Either mistake rejects the whole call, so there are **no partial writes** — fix
the key and resend the full set of entries.

| Bad entry              | Rejection message                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `{ key: "chocolate" }` | `Malformed taste entry key "chocolate": expected "<dimensionId>:<value>"`               |
| `{ key: "mood:cozy" }` | `Unknown dimension "mood" in vocabulary "taste". Known dimensions: roast, flavor, body` |

### Read taste back

Core exposes taste on the item, which is the reliable way to verify a bulk author before indexing.
It is **not** exposed on Discovery hits.

```graphql
query {
    item(id: "<ITEM_ID>", language: "en") {
        taste {
            vocabulary
            entries {
                key
                weight
            }
        }
    }
}
```

```text
GraphqlItemTaste       { vocabulary: String!, entries: [GraphqlItemTasteEntry!]! }
GraphqlItemTasteEntry  { key: String!, weight: Float }
```

### Keep one source of truth

If you also assign topics for the same concepts, **derive** the taste entries from the topic assignments
— for example by storing the key in the topic's `meta` — rather than maintaining two parallel lists.
See [[taxonomy]] for the topic side.

## 4. Publish

`setItemTaste` writes to the **draft** version. The indexer reads the **published** version. If your
items were published before you attached taste, publish them again or the served documents carry no
vectors.

```graphql
mutation Publish($ids: [ID!]!, $language: String!) {
    publishItems(ids: $ids, language: $language) {
        __typename
    }
}
```

**Skipping this step produces no error.** Queries still return results, and the order may even change —
it just has no relation to taste. The check in step 6 is the only thing that catches it.

## 5. Index

`igniteDiscoApi` rebuilds the tenant's Discovery index and materializes the vectors. Run it after **any**
change to vocabularies or taste entries, not only the first time.

**Pass `stacks: opensearch`.** The argument is optional in the schema but it selects which index stack
is built, and vector ranking is only served from the `opensearch` stack — an ignition without it
produces a working Discovery index with no vectors in it, and no error.

```graphql
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

```text
igniteDiscoApi(stacks: DiscoIgnitionStacks): IgnitionBulkTaskResult!
DiscoIgnitionStacks   = atlasSearch | both | opensearch
IgnitionBulkTaskResult (union)  BulkTaskIgnition | ExperimentalFeaturesNotAvailableError
                                | InvalidIdError | UnauthorizedError | UnknownError
```

The mutation is asynchronous. Poll the returned task until it reports `complete`, then allow a few
minutes for Discovery to propagate the new index.

```graphql
query Task($id: ID!) {
    bulkTask(id: $id) {
        ... on BulkTask {
            id
            status
        } # pending, started, complete, error
    }
}
```

From then on the tenant's Discovery schema includes `context`, `rankBy` and `nearestTo`, and every
vocabulary you created becomes a value of the `TenantVocabularyIdentifier` enum. **A vocabulary is only
a valid enum value after the next index run** — until then, queries referencing it fail schema
validation.

## 6. Verify

Two checks, in this order. Both are cheap and both catch a silent failure.

```graphql
# a) Did the index actually rebuild? The timestamp must have moved.
{
    search {
        summary {
            profiling {
                lastIndexCompletedAt
            }
        }
    }
}
```

```text
b) Run the same query with and without `context` and compare the order.
   If the two match, no vectors reached the index — go back to step 4 (publish), then step 5 (index).
```

## Authoring at scale

`setItemTaste` is one call per item per vocabulary, so a full catalogue is a bulk job. Drive it from
[[mass-operations]] or a script over [[js-api-client]], and **index once at the end** rather than per
item. Order matters: vocabulary → taste → publish → index.
