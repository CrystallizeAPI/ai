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

**Use the positions, or tastes collapse.** When every item carries several entries of one dimension at weight 1,
every shopper matches every item about equally and the house boosts decide the order. In one build, decaying the
secondary entries (`[1.0, 0.5, 0.35]`) made all 16 profile × category listings differ from the unpersonalised one.

**Broad entries dilute the cosine.** A spare part that fits 200 machines carries 200 `machine:` keys, so its cosine
to a shopper with one machine is about 1/√200, while an item with one key scores about 0.8. Ranking inside such a
category still works (everything is diluted alike), but a mixed rail needs its own query for those items, with a
filter instead of a taste.

## 2. Create the vocabulary

`upsertVocabulary` creates or replaces a vocabulary **in full**. It is a full replace, not a patch —
send the whole dimension list every time. **Any dimension you omit is gone**, and the entries items still
hold for it are skipped, without error, the next time their vectors are built.

A vocabulary needs at least one dimension, dimension ids must be unique, and every weight must be positive.

**There is no `deleteVocabulary`, and no query lists vocabularies.** `upsertVocabulary` with an empty dimension list
fails ("Cannot return null for non-nullable field GraphqlVocabulary.name") and deletes nothing, so every vocabulary
you create stays a value of the tenant's enum for good. Do not test with throwaway vocabularies on a real tenant.

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

Discovery exposes the name normalized for GraphQL (`coffee-taste` becomes the enum value `coffeeTaste`),
and `upsertVocabulary` refuses a new name that normalizes to the same value as an existing one. Core keeps
taking the name as you wrote it.

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

`setItemTaste` writes the ordered entries for **one item, one language, one vocabulary**, replacing what
that vocabulary held on the item. Two vocabularies means two calls per item.

**Write one item's vocabularies and languages one after another.** Concurrent `setItemTaste` calls on the same
item lose writes with no error: each call reads, changes and writes the item's draft, and the last write wins. With
three vocabularies × two languages in parallel, one item kept a single vocabulary; another build found 34
(item, language) pairs missing a whole vocabulary after eight writes at once. Seen on three tenants. Run **items**
in parallel, never the calls for one item, and read the taste back afterwards (below).

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

Documents and folders take taste too, and rank like products: banner documents with taste derived from their
topics, filtered by `itemId` and ranked with `tasteCosine` and a `context`, came back in a different order per
shopper after one ignition. A numeric `priority` on the document shape became a `TenantRankByField` and works as a
small `fieldBoost` tie-break.

`ExperimentalFeaturesNotAvailableError` is a standard member of Core result unions, not a signal about
vectors: nothing in vocabulary or taste authoring raises it, and ranking is switched on by the ignition in
step 5. The validation rejections below come back as `UnknownError`, with the reason in `message`.

### Order is the input to positional weights

Entries are read **in array order, per dimension**. Above, `flavor:berry` takes 1.0,
`flavor:blackcurrant` 0.6 and `flavor:caramel` 0.3. The optional per-entry `weight` overrides the
vocabulary weight for that entry only — and **still consumes its positional slot**, so it does not shift
the entries that follow. Overrides are not range-checked: keep them positive, because a negative one puts
every query that reaches the item on the windowed path.

### The key format is validated

Every key is `<dimensionId>:<value>`. Everything before the first colon must be a **declared dimension
in that vocabulary**, and the vocabulary must exist. Any of these mistakes rejects the whole call, so there
are **no partial writes** — fix it and resend the full set of entries.

| Bad entry              | Rejection message                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `{ key: "chocolate" }` | `Malformed taste entry key "chocolate": expected "<dimensionId>:<value>"`               |
| `{ key: "mood:cozy" }` | `Unknown dimension "mood" in vocabulary "taste". Known dimensions: roast, flavor, body` |
| `vocabulary: "nope"`   | `Vocabulary "nope" not found for this tenant`                                           |

### Read taste back

Core exposes taste on the item, which is the reliable way to verify a bulk author before indexing.
It is **not** exposed on Discovery hits. `taste` is on `Item`, not on `GetItemResult`, so the inline fragment is required;
without it the query fails validation.

```graphql
query {
    item(id: "<ITEM_ID>", language: "en") {
        ... on Item {
            taste {
                vocabulary
                entries {
                    key
                    weight
                }
            }
        }
    }
}
```

```text
GraphqlItemTaste       { vocabulary: String!, entries: [GraphqlItemTasteEntry!]! }
GraphqlItemTasteEntry  { key: String!, weight: Float }
```

After a bulk run, read every item back per language and rewrite only the vocabularies that are missing or
differ. Even sequential runs lost the odd write in one build, so make this repair step part of the job.

### Observed both ways: verify on your tenant

| Claim                                     | Seen                                                        | Not seen                                        |
| ----------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------- |
| `setItemTaste` empties variant components | once (2026-09): variant chunks and numerics gone from draft | four later tenants, variants checked            |
| Item taste is per language                | one tenant: a taste written in `no` was absent in `en`      | another: written in `no`, read the same in `en` |

So keep two checks rather than a rule: read the variant components back after the taste step on a catalogue
whose variants carry components, and write taste for **every** language you serve (it costs calls, not
correctness). Taste does survive a translation: after translating and publishing in `no`, a `tasteCosine` query in
`no` scored the same as in `en`.

### Keep one source of truth

If you also assign topics for the same concepts, **derive** the taste entries from the topic assignments
— for example by storing the key in the topic's `meta` — rather than maintaining two parallel lists.
See [[taxonomy]] for the topic side.

## 4. Publish

`setItemTaste` writes to the **draft** version. Discovery serves the **published** version by default. If
your items were published before you attached taste, publish them again or the served documents carry no
vectors.

```graphql
mutation Publish($id: ID!, $language: String!) {
    publishItem(id: $id, language: $language) {
        __typename
        ... on PublishInfo {
            versionId
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

Publish **per item and per language**. `publishItem` and `publishItems` both run in the background, so
neither return is proof that the items are published yet — index right after them and the index may read
the old versions. Wait for `item(id:, language:, versionLabel: published)` to show the new taste first.

On a tenant already served for ranking, each publish re-indexes that item in the background, vectors
included, so a taste change needs no ignition.

**Skipping this step produces no error.** Queries still return results, and the order may even change —
it just has no relation to taste. The check in step 6 is the only thing that catches it.

## 5. Index

`igniteDiscoApi` rebuilds the tenant's Discovery index and materializes the vectors. Run it the first
time, and again after **any** `upsertVocabulary`: new weights reach existing items only at an index run, and
a new vocabulary only joins the Discovery enum then.

Only a tenant admin can ignite, and a tenant runs one ignition at a time. Either refusal comes back as a
`BasicError`. The Discovery page in the app's settings runs the same mutation, with `stacks: opensearch`.

**Ignite last.** Run it once the shapes exist, each with at least one component, and the content is
published, not as an early setup step. A tenant with no shapes that Discovery can index is refused: the
task ends in `error`.

**Pass `stacks: opensearch`.** The argument is optional in the schema but it selects which index stack
is built, and vector ranking is only served from the `opensearch` stack. Without it, a tenant not yet
served gets a working Discovery index, no ranking arguments and no error. `both` builds the stack but
leaves reads where they are, so it does not turn ranking on either. A tenant already served for ranking
refuses an ignition that leaves the stack out: the task ends in `error`.

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
            status # pending, started, complete, error
            info # on error, info.traces says why
        }
    }
}
```

**`error` is blocking.** Read `info.traces`, fix what it names and only then ignite again. Re-running an
ignition that failed, unchanged, fails the same way. Before reporting success, probe Discovery itself:

```graphql
{
    __typename
}
```

Anything but `{"data":{"__typename":"Query"}}` means the tenant is not serving, whatever the task said.

From then on the tenant's Discovery schema includes `context`, `rankBy` and `nearestTo`, and every
vocabulary you created becomes a value of the `TenantVocabularyIdentifier` enum, under its normalized
name. **A vocabulary is only a valid enum value after the next index run** — until then, queries
referencing it fail schema validation.

**The enum is not the end of the wait.** In one build `Vocabulary <name> not found` came back for about five
minutes after the task said `complete`, while `TenantVocabularyIdentifier` already listed the value; in others the
enum and `lastIndexCompletedAt` themselves stayed stale for minutes, and one vocabulary scored 0 for a while as the
others ranked. Probe with a real `context` query per vocabulary, and check `rankScore` per vocabulary, before
concluding that the vectors are wrong.

Before a tenant has any indexed vocabulary, the same arguments (`nearestTo.vocabulary`,
`userTaste.vocabulary`) are typed `String`, and a query fails with `Vocabulary <name> not found`. After
the index run they take the enum: `vocabulary: taste`, not `vocabulary: "taste"`. A query or a typed
variable written for one form fails on the other, so check the type with introspection (see
[SKILL.md](../SKILL.md)) before you hardcode either.

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

`setItemTaste` is one call per item per vocabulary, so a full catalogue is a bulk job. Mass operations
have no taste intent, so drive it from a script over [[js-api-client]]. The `item/publish` intent of
[[mass-operations]] covers the publish step. **Index once at the end** rather than per item. Order
matters: vocabulary → taste → publish → index.
