# Ranking Signals (`rankBy`)

Discovery API, `https://api.crystallize.com/<tenant>/discovery`, no auth unless the tenant requires a
static token.

On a tenant served for ranking, a query with no `sorting` is **not** in relevance order: hits come back by
`itemId` descending, even with a `term`. `sorting: { score: desc }` gives relevance order. `rankBy` blends
several weighted signals into one score instead:

```text
rankScore = Σ (weight × signal)
```

Positive weights boost, negative weights penalize — a high return rate can legitimately push a product
down. Different surfaces carry different rules: a category page may lean on margin, a search page on
relevance, a clearance page on stock.

## Schema

```text
RankByInput      { terms: [RankByTermInput!]!, tieBreaker: TenantRankByTieBreaker!, explain: Boolean }

RankByTermInput  { signal:       RankBySignal!              # required
                   weight:       Float!                     # required
                   field:        TenantRankByField          # fieldBoost | inStockBoost | recency
                   halfLifeDays: Float                      # recency
                   vocabulary:   TenantVocabularyIdentifier # tasteCosine
                   from:         TasteCosineFrom            # tasteCosine
                   normalize:    Boolean }

RankBySignal     = relevance | fieldBoost | inStockBoost | recency | tasteCosine
TasteCosineFrom  = userTaste | nearestTo
```

`terms` must hold at least one term. `tieBreaker` is **required** — it settles ties deterministically so
the order stays stable across pages.

## The five signals

| Signal         | Required                | Optional    | What it scores                                                                                                                           |
| -------------- | ----------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `relevance`    | —                       | —           | Text match against `term`. **Contributes 0 when there is no `term`.**                                                                    |
| `fieldBoost`   | `field`                 | `normalize` | A rankable number on the item, used directly as a boost.                                                                                 |
| `inStockBoost` | `field`                 | —           | Binary: contributes **1** when the named numeric field is `> 0`. Ignores quantity.                                                       |
| `recency`      | `field`, `halfLifeDays` | —           | Exponential time-decay on the age of a date field: `0.5 ^ (ageInDays / halfLifeDays)`.                                                   |
| `tasteCosine`  | `vocabulary`, `from`    | —           | Cosine to the shopper vector (`from: userTaste`) or to an anchor item (`from: nearestTo`). See [personalization.md](personalization.md). |

`recency` needs a date field; `fieldBoost` and `inStockBoost` need a number field. `TenantRankByField`
holds both kinds, so the wrong one passes schema validation and the query fails with
`Field <name> not found`.

An item without the value scores 0 on all three. That is the worst value under a positive weight and the
best under a negative one, so a penalty on, say, return rate lifts every item that has no return rate.

## The field enums are per tenant

`field` and `tieBreaker` are **not free-form strings** — they are enums generated from the tenant's
index settings. Introspect them; do not guess.

| Enum                         | Built from                                                              |
| ---------------------------- | ----------------------------------------------------------------------- |
| `TenantRankByField`          | NUMBER and DATE **sortable** attributes, **with facet fields excluded** |
| `TenantRankByTieBreaker`     | sortable fields (token, number and date)                                |
| `TenantVocabularyIdentifier` | the tenant's vocabularies, **only after the next index run**            |

Following `sortable` is the trap: a number you can filter or facet on drops out of both enums when its
component sets `sortable: false`, so it is not necessarily a number you can boost on.

```graphql
{
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

Typical values on a commerce tenant: `price_default`, `price_sales`, `defaultVariantPrice_default`,
`lowestVariantPrice_default`, `highestVariantPrice_default`, `stock_default`, `stock_oslo`, `publishedAt`,
`createdAt`, `updatedAt`, `position`, `depth`, and any numeric component (`dimensions_weight_number`,
`sold_30d_number`, `margin_number`, `rating_number`, …). A numeric component is always `<id>_number`, never
the bare `<id>`.

## Example

```graphql
query Catalogue($rankBy: RankByInput!) {
    search(term: "espresso", rankBy: $rankBy, sorting: { score: desc }, pagination: { limit: 24 }) {
        hits {
            ... on product {
                name
                score
                rankScore
                rankExplain {
                    signal
                    index
                    contribution
                }
            }
        }
    }
}
```

```json
{
    "rankBy": {
        "terms": [
            { "signal": "relevance", "weight": 1.0 },
            { "signal": "fieldBoost", "weight": 0.6, "field": "margin_number", "normalize": true },
            { "signal": "fieldBoost", "weight": 0.5, "field": "sold_30d_number", "normalize": true },
            { "signal": "inStockBoost", "weight": 0.4, "field": "stock_default" },
            { "signal": "recency", "weight": 0.3, "field": "publishedAt", "halfLifeDays": 60 }
        ],
        "tieBreaker": "sku",
        "explain": true
    }
}
```

```text
rankScore = 1.0·relevance + 0.6·margin + 0.5·sold_30d + 0.4·inStock + 0.3·recency
```

## Zero weights are dropped

A term with `weight: 0` is removed **before** scoring. If _every_ term is 0, the query runs unranked and
**skips the rerank window entirely** — no rerank runs, `rankScore` comes back `null`, and a `context` or
`nearestTo` sent beside it no longer ranks either. Turning a signal off by zeroing it is fine; zeroing all
of them silently disables ranking.

## Normalization

`normalize` applies **min–max normalization across the rerank window**, so signals on wildly different
scales can share a weight. A term whose value is the same across the window normalizes to 0. The default
depends on the signal — set `normalize` explicitly to override.

| Signal         | `normalize` default | Why                 |
| -------------- | ------------------- | ------------------- |
| `relevance`    | **on**              | unbounded magnitude |
| `fieldBoost`   | **on**              | unbounded magnitude |
| `tasteCosine`  | off                 | already roughly 0–1 |
| `recency`      | off                 | already roughly 0–1 |
| `inStockBoost` | off                 | already roughly 0–1 |

Because normalization is computed over the window, the same item can score differently under different
`rerankWindow` sizes. That is expected, not a bug.

## Multi-valued fields are collapsed

Anything with several values per item — fields under `variants` (such as `price_*` / `stock_*`), fields
under `shortcuts`, or a repeatable component — is collapsed to one value before scoring. **The direction
is fixed and cannot be overridden:**

| Signal         | Collapses to | Rationale                                 |
| -------------- | ------------ | ----------------------------------------- |
| `fieldBoost`   | **lowest**   | the "from" price a shopper is shown       |
| `inStockBoost` | **highest**  | buyable in any variant counts as in stock |
| `recency`      | **highest**  | the most recent date wins                 |

To boost on another end of a product's prices, use the single-valued `defaultVariantPrice_<id>`,
`lowestVariantPrice_<id>` or `highestVariantPrice_<id>` fields.

## `rankScore` and `rankExplain`

`rankScore` on each hit is the **raw, un-normalized value the hits were ordered by** — `Σ weight × term`
under `rankBy`, the summed per-vocabulary cosine under `context` or `nearestTo`. It is the actual sort key,
which `score` is not guaranteed to be. `rankScore` is `null` whenever no rerank ran: no `rankBy`, `context`
or `nearestTo`, or every `rankBy` term dropped.

With `explain: true` each hit carries one `rankExplain` entry per **scored** term, **in `rankBy.terms`
order**. A `weight: 0` term has no entry, so join on `index`, never on an entry's position in the list:

```text
RankExplainEntry { signal: RankBySignal, index: Int, contribution: Float }
```

`index` is the term's position in the `terms` you sent. It disambiguates a repeated signal — two
`fieldBoost` terms, say — and the contributions **sum to `rankScore` by construction**, which makes it a
usable self-check.

```json
{
    "name": "Cobán Dark",
    "rankScore": 1.71,
    "rankExplain": [
        { "signal": "relevance", "index": 0, "contribution": 0.42 },
        { "signal": "fieldBoost", "index": 1, "contribution": 0.51 },
        { "signal": "fieldBoost", "index": 2, "contribution": 0.3 },
        { "signal": "inStockBoost", "index": 3, "contribution": 0.4 },
        { "signal": "recency", "index": 4, "contribution": 0.08 }
    ]
}
```

`rankExplain` is populated **only** with `explain: true`, and is `null` on the `userTaste`-only and
`nearestTo`-only paths, which have no `terms`.

Ship `explain: true` behind a merchandiser flag, not in the hot storefront path — it is a tuning tool.

## The rerank window

`options.rerankWindow` sets how many documents a windowed query reranks: the **first N under the query's
effective sort** — the `sorting` you sent, or `itemId` descending when you sent none. Those N are scored and
re-sorted among themselves. **That is not the N best matches unless you ask for it**: `sorting: { score: desc }`
selects candidates by relevance. On a catalogue larger than the window, a `rankBy` with no `sorting` never
sees the rest.

- default **500**
- hard server cap **2000**; a larger value is clamped
- rerank cost is per candidate, so a larger window costs more

```graphql
search(
  term: "espresso",
  rankBy: $rankBy,
  sorting: { score: desc },
  options: { rerankWindow: 1000 }
) { hits { ... on product { name rankScore } } }
```

**Which queries are windowed.** `context.userTaste` or `nearestTo` with no `rankBy` and no `sorting` are
ranked over the **whole result set**: no window applies, `skip` and `after`/`before` page the ranked set as
usual (`summary.endToken` is the cursor for the next page), and `rerankWindow` only caps `nearestTo.k`.
Every other ranked query takes the window:

- any query with a `rankBy`
- any query with a `sorting`, including `Folder.children` and `Topic.items`, which default to
  `sorting: { position: asc }` — pass `sorting: {}` to clear it
- `autocomplete`
- a `userTaste` weight below zero, or an anchor vector holding one
- more than about 800 weights across the vocabularies
- an item in scope whose taste holds a negative weight
- an index from an older ignition; `igniteDiscoApi(stacks: opensearch)` rebuilds it for the whole-set path

**Paging happens inside the window.** On a windowed query `skip` offsets into the reranked window. A `skip`
past the window returns no hits, while `totalHits` still counts every match and `summary.hasMoreHits`
reports `false`. Size the window for the depth you intend to page, not just for the first page.

**`after`/`before` move the window, not the page.** A hit's token is its position under the effective sort,
not its reranked rank, so a cursor taken from a reranked page selects the next N documents past that
position and reranks those. Items the page pulled up from later positions come back again, and items from
earlier positions that missed the page are never reached. Use `skip` + `limit` on windowed queries.
