# Ranking Signals (`rankBy`)

Discovery API, `https://api.crystallize.com/<tenant>/discovery`, no auth.

By default Search orders hits by full-text relevance — a BM25-based score. `rankBy` blends several
weighted signals into one score instead:

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
| `recency`      | `field`, `halfLifeDays` | —           | Exponential time-decay on the age of a date field.                                                                                       |
| `tasteCosine`  | `vocabulary`, `from`    | —           | Cosine to the shopper vector (`from: userTaste`) or to an anchor item (`from: nearestTo`). See [personalization.md](personalization.md). |

## The field enums are per tenant

`field` and `tieBreaker` are **not free-form strings** — they are enums generated from the tenant's
index settings. Introspect them; do not guess.

| Enum                         | Built from                                                                |
| ---------------------------- | ------------------------------------------------------------------------- |
| `TenantRankByField`          | NUMBER and DATE **filterable** attributes, **with facet fields excluded** |
| `TenantRankByTieBreaker`     | sortable fields (token, number and date)                                  |
| `TenantVocabularyIdentifier` | the tenant's vocabularies, **only after the next index run**              |

`TenantRankByField` being facet-excluded is the trap: a number you can facet on is not necessarily a
number you can boost on.

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

Typical values on a commerce tenant: `price_default`, `price_sales`, `stock_default`, `stock_oslo`,
`publishedAt`, `createdAt`, `updatedAt`, `position`, `depth`, and any numeric component
(`dimensions_weight_number`, `sold_30d_number`, `margin_number`, `rating_number`, …).

## Example

```graphql
query Catalogue($rankBy: RankByInput!) {
    search(term: "espresso", rankBy: $rankBy, pagination: { limit: 24 }) {
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
            { "signal": "fieldBoost", "weight": 0.6, "field": "margin", "normalize": true },
            { "signal": "fieldBoost", "weight": 0.5, "field": "sold_30d", "normalize": true },
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

A term with `weight: 0` is removed **before** scoring. If _every_ term is 0, the query falls back to
plain relevance and **skips the rerank window entirely** — no rerank runs, and `rankScore` comes back
`null`. Turning a signal off by zeroing it is fine; zeroing all of them silently disables ranking.

## Normalization

`normalize` applies **min–max normalization across the rerank window**, so signals on wildly different
scales can share a weight. The default depends on the signal — set `normalize` explicitly to override.

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

## `rankScore` and `rankExplain`

`rankScore` on each hit is the **raw, un-normalized value the hits were ordered by** — the actual sort
key. It is distinct from `score`, which stays text relevance. `rankScore` is `null` whenever no rerank
ran: no `rankBy`, or every term dropped.

With `explain: true` each hit carries one `rankExplain` entry per term, **in `rankBy.terms` order**:

```text
RankExplainEntry { signal: RankBySignal, index: Int, contribution: Float }
```

`index` disambiguates a repeated signal — two `fieldBoost` terms, say — and the contributions **sum to
`rankScore` by construction**, which makes it a usable self-check.

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

`options.rerankWindow` is the **single knob shared by all three rerank paths** (`rankBy`, `context` and
`nearestTo`). The top-N candidates are scored and re-sorted; results beyond N keep plain relevance
order.

- default **500**
- hard server cap **2000**
- rerank cost is per candidate, so a larger window costs more

```graphql
search(
  term: "espresso",
  rankBy: $rankBy,
  options: { rerankWindow: 1000 }
) { hits { ... on product { name rankScore } } }
```

**Paging happens inside the window.** Under ranking, `skip` offsets into the reranked window, and a
`skip` past the window returns nothing. Size the window for the depth you intend to page, not just for
the first page. Cursor tokens (`after`/`before`) fall back to offset pagination when a rerank is active,
so use `skip` + `limit` on ranked queries.
