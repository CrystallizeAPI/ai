---
name: vector-ranking
description: >
    Rank and personalize the Crystallize Discovery catalogue with vectors — author vocabularies and item
    taste on the Core API, then rank with rankBy, context.userTaste and nearestTo on Discovery. Use when
    the user wants personalized search or category ordering, "more like this" / similar-product /
    pairing recommendations, cold-start onboarding from a few picks, boosting by margin, stock, sales
    velocity, newness, campaign priority or review score, penalizing by return rate, explaining why a
    product ranks where it does, or ranking a catalogue for one shopper, buyer or learner. Trigger on
    "vector", "vector ranking", "vector search", "personalization", "taste", "vocabulary", "rankBy",
    "rankScore", "rankExplain", "tasteCosine", "nearestTo", "userTaste", "upsertVocabulary",
    "setItemTaste", "igniteDiscoApi", "rerankWindow", "cosine similarity", "recommendations",
    "more like this", "boost by margin", "relevance tuning" — and on any request to reorder Discovery
    results by something other than a plain sort field.
metadata:
    author: Crystallize
    version: "1.0"
---

# Crystallize Vector Ranking

Discovery ranks the whole catalogue for the person in front of it, inside the same query you already use
for search and browse. You describe products in **a vocabulary of your own** — roast, flavour, fit,
finish, use case, margin band. A shopper is described in that same vocabulary. The index scores every
item by cosine similarity and sorts. Then you put your own weighted rules on top, and every position
can come back with an explanation.

**These are sparse, author-supplied, named vectors — not dense ML embeddings, and not a trained model.**
Nothing is learned; the vocabulary is the model. There is nothing to train and nothing to sync.

> Verified on 2026-09-15 against the live Core API (`upsertVocabulary`, `vocabulary`, `setItemTaste`,
> `igniteDiscoApi`) and against a ranking-enabled Discovery tenant by introspection, and reconciled with
> the Discovery vector-search documentation as of the same day. Where the public docs and the served
> schema disagree, this skill follows the schema and says so. Ranking is a capability that is enabled
> per tenant — how it is served is an implementation detail and is deliberately not documented here.

## Detect the capability before you write a query

**This is the failure mode that catches agents.** Ranking is enabled **per tenant**. Until it is,
`rankBy`, `context` and `nearestTo` are **absent from that tenant's Discovery schema** — referencing them
is a GraphQL validation error, not a query that quietly returns unranked results. The surface can also
disappear again if ranking is disabled for a tenant.

```graphql
# Probe once, cache the answer. Non-null => this tenant is served for ranking.
{
    __type(name: "RankByInput") {
        name
    }
}
```

An un-ignited tenant does not even serve the schema:

```json
{ "success": false, "message": "There is no ignited Tenant for <tenant>." }
```

A tenant that has ranking enabled but still refuses a vector argument answers with an error stating
that ranking is not available for this tenant. Do not match on the message text — treat the presence of
the argument in the schema as the capability check.

Three enums are generated **per tenant**, so they are never hardcodable:

| Enum                         | Built from                                                           | Gotcha                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `TenantVocabularyIdentifier` | your vocabularies                                                    | a new vocabulary is only a valid value **after the next index run**; until a tenant has one, the argument is a `String` |
| `TenantRankByField`          | NUMBER and DATE **filterable** attributes, **facet fields excluded** | it is _not_ "any numeric field" — introspect it                                                                         |
| `TenantRankByTieBreaker`     | sortable fields (token, number, date)                                | `tieBreaker` is **required** on every `rankBy`                                                                          |

Introspect all three rather than guessing:

```graphql
{
    v: __type(name: "TenantVocabularyIdentifier") {
        enumValues {
            name
        }
    }
    f: __type(name: "TenantRankByField") {
        enumValues {
            name
        }
    }
    tb: __type(name: "TenantRankByTieBreaker") {
        enumValues {
            name
        }
    }
}
```

## Two APIs

| API           | Endpoint                                         | Auth              | Used for                                          |
| ------------- | ------------------------------------------------ | ----------------- | ------------------------------------------------- |
| **Core**      | `https://api.crystallize.com/@<tenant>/core`     | access token pair | vocabularies, taste entries, publishing, indexing |
| **Discovery** | `https://api.crystallize.com/<tenant>/discovery` | none              | querying                                          |

Core takes `@tenant` with an at-sign; Discovery takes the bare `tenant`. Vocabulary and index mutations
live on **Core**, not on the PIM API. Everything before Discovery is authenticated and server-side; the
queries themselves need no credentials, so a browser can build the shopper vector client-side and call
Discovery directly.

## Five concepts

| Concept            | What it is                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| **Vocabulary**     | A named set of dimensions, each carrying a weight list. A tenant can have several; each is scored on its own. |
| **Dimension**      | One axis inside a vocabulary — `roast`, `flavor`, `region`. Carries a weight list.                            |
| **Entry**          | A `dimensionId:value` key attached to one item, **in a meaningful order**.                                    |
| **Item vector**    | Built at index time. Every entry becomes a key with the weight its dimension and position give it.            |
| **Shopper vector** | The same shape, sent with the query as `context.userTaste`.                                                   |

Two properties fall out of this and drive every design decision:

- **Shoppers and products share the keys.** A shopper who likes `flavor:chocolate` at `1.0` is compared
  to products carrying `flavor:chocolate`. Nothing has to be learned.
- **Vocabularies are summed.** One shopper vector per vocabulary; the index adds the per-vocabulary
  cosines. A product matching two vocabularies outranks a product matching one.

## The pipeline

```text
Core        upsertVocabulary                    once per vocabulary — FULL REPLACE, not a patch
Core        setItemTaste                        once per item, per vocabulary — writes the DRAFT
Core        publishItem                         per item and language — the step that is easy to miss
Core        igniteDiscoApi(stacks: opensearch)  poll bulkTask until "complete", then let it propagate
Discovery   search(rankBy:)                     your rules: margin, stock, velocity, recency
Discovery   search(context:)                    ranked for this shopper
Discovery   search(rankBy: + context:)          your rules, plus this shopper
Discovery   search(nearestTo:)                  ranked by a reference item
```

**Re-run the index after any change to vocabularies or taste entries** — not only the first time. An
unindexed change has no effect and raises no error. `stacks: opensearch` is required for vectors to be
built; see step 5 in the authoring reference.

Authoring detail — vocabulary design, positional weights, key validation, publishing and indexing — is
in [references/vocabulary-authoring.md](references/vocabulary-authoring.md).

## Choosing the query path

| You want                                                      | Use                                                          | Notes                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| A house order for everyone (margin, stock, velocity, newness) | `rankBy` alone                                               | The baseline every personalized result builds on                         |
| Results ordered for this shopper                              | `context.userTaste` alone                                    | Reranks toward taste automatically; no `terms`, so `rankExplain` is null |
| Your rules **and** this shopper, weighted independently       | `rankBy` + `context`, with a `tasteCosine` term              | The only way to weight vocabularies separately                           |
| "Similar products", basket pairings                           | `nearestTo`                                                  | `k` replaces `pagination.limit`; anchor is excluded                      |
| Neighbours that also respect stock/margin                     | `nearestTo` + `rankBy` with `tasteCosine`, `from: nearestTo` | `nearestTo` alone ignores `context.userTaste`                            |

Signals, normalization, `rankScore`/`rankExplain` and the rerank window are in
[references/ranking-signals.md](references/ranking-signals.md). Shopper vectors, `magnitude`, where the
vector comes from and `nearestTo` are in [references/personalization.md](references/personalization.md).

## Where the vector arguments are accepted

Verified by introspection on a ranking-enabled tenant — `rankBy`, `context` and `nearestTo` are on:

- `search` and `autocomplete`
- **every** shape field under `browse` (`browse { product(...) }`, `browse { category(...) }`, …)
- `Folder.children` and `Topic.items`

They are **not** on `Topic.children`, which takes `language` only. Note the naming: the public docs say
"the children queries on topics and folders", but the field on `Topic` is `items`.

## Failure modes

Four of these produce **no error at all** — they are the reason this skill exists.

| Symptom                                 | Cause                                                       | Fix                                                                                                                     |
| --------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Order unrelated to taste, no errors     | Taste is on the draft only                                  | `publishItem`, index again, retest                                                                                      |
| Order unchanged after editing taste     | No index run since the change                               | `igniteDiscoApi(stacks: opensearch)`, wait for `complete`                                                               |
| Index rebuilt, still no vectors         | `igniteDiscoApi` run without `stacks: opensearch`           | Re-run with `stacks: opensearch`                                                                                        |
| Rankings subtly wrong, no errors        | `magnitude` miscomputed client-side                         | Assert `sqrt(Σ w²)` against a known case                                                                                |
| `rankScore` comes back `null`           | No rerank ran — no `rankBy`, or every term had `weight: 0`  | Give at least one term a non-zero weight                                                                                |
| Vocabulary "does not exist in enum"     | No index run since it was created                           | `igniteDiscoApi(stacks: opensearch)`, wait for `complete`                                                               |
| `Vocabulary <name> not found`           | No vocabulary indexed yet; the argument is still a `String` | `igniteDiscoApi(stacks: opensearch)`, wait for `complete`, then pass the enum value unquoted                            |
| `context` / `rankBy` unknown in schema  | Ranking not enabled for the tenant, or not indexed          | Confirm ranking is enabled, then index and wait for `complete` plus propagation. Detect the capability, don't assume it |
| `Malformed taste entry key`             | Key has no colon                                            | Use `dimensionId:value`                                                                                                 |
| `Unknown dimension`                     | Prefix is not a declared dimension                          | Add it to the vocabulary, or fix the key                                                                                |
| `tieBreaker` validation error           | Required field missing                                      | Add a `tieBreaker`                                                                                                      |
| `ExperimentalFeaturesNotAvailableError` | Vectors not enabled for the tenant                          | Enable the feature before authoring taste                                                                               |
| Page 2 empty under ranking              | `skip` ran past the rerank window                           | Raise `options.rerankWindow` (default 500, cap 2000)                                                                    |

## How ranking composes with the rest of the query

- **`filters`, `facets` and `term` apply as usual.** Ranking decides the order **inside** the filtered
  set; it does not change which items match.
- **Items without a vector are still returned.** They score 0 on taste and sort after the ones that
  match, rather than disappearing. `tasteCosine` contributes 0 for them, so unmapped products fall back
  to your other rules.
- **Ranking happens inside a bounded window** of the top matches — see `rerankWindow` in
  [references/ranking-signals.md](references/ranking-signals.md).
- **Cursor pagination degrades under ranking.** When a rerank runs, `after`/`before` fall back to offset
  pagination — page with `skip` and `limit`, and size the window for the depth you intend to page.
- **Do not combine `sorting` with ranking.** The public docs contradict themselves here (one page says
  sorting selects which candidates enter the window, another says it is applied after the ranking
  score). When `rankBy` or `context` is present the reranked order is what you get back — treat any
  `sorting` you pass as unspecified behaviour.

## Related skills

Use [[query]] for the rest of the Discovery API — filters, facets, pagination, browse vs search.
Use [[mutation]] for the Core API mutations these sit next to, and [[js-api-client]] to call either
from JS/TS. Vocabularies overlap conceptually with topic maps: [[taxonomy]] designs the classification,
and a taste entry can be **derived** from a topic assignment — see "Keep one source of truth" in
[references/vocabulary-authoring.md](references/vocabulary-authoring.md). [[content-model]] covers the
shapes whose numeric components become `TenantRankByField` values.
