# Personalization & Similarity (`context.userTaste`, `nearestTo`)

Discovery API, `https://api.crystallize.com/<tenant>/discovery`, no auth. **Nothing about the shopper is
stored in Crystallize** — you send the vector with each query.

## `context.userTaste`

```text
UserTasteInput { vocabulary: TenantVocabularyIdentifier!   # enum, generated per tenant
                 weights:    JSON!                         # { "dimensionId:value": number }
                 magnitude:  Float! }                      # L2 norm of weights

ContextInput   { userTaste: [UserTasteInput!]! }           # one entry per vocabulary
```

`userTaste` must be **non-empty**, and a vocabulary may appear **at most once**. `weights` maps
`dimensionId:value` to a number — **positive means likes, negative means dislikes**.

Weight keys contain a colon, which is not a valid GraphQL name, so **pass the context as a variable**,
never inline in the query document.

```graphql
query SearchWithTaste($context: ContextInput!) {
    search(context: $context, pagination: { limit: 24 }) {
        summary {
            totalHits
        }
        hits {
            ... on product {
                itemId
                name
                rankScore
                topicPaths(leafOnly: true)
                defaultVariant {
                    sku
                    defaultPrice
                    firstImage {
                        url
                    }
                }
            }
        }
    }
}
```

```json
{
    "context": {
        "userTaste": [
            {
                "vocabulary": "taste",
                "weights": { "flavor:berry": 1.0, "roast:light": 1.0 },
                "magnitude": 1.4142135623730951
            },
            {
                "vocabulary": "origin",
                "weights": { "region:kenya": 1.0 },
                "magnitude": 1.0
            }
        ]
    }
}
```

The two entries are scored separately and **added**, so Kenyan light-roast berry coffees rise above
coffees that satisfy only one of them.

Supplied **without** `rankBy`, results are reranked toward that taste automatically. There are no
`terms` on this path, so `rankExplain` is `null`.

## You supply the magnitude

`magnitude` is the length of the shopper vector — one number that lets the index compare **direction**
(what they like) without being fooled by **size** (how much they like it). It is `sqrt(Σ w²)`: square
every weight, add them up, take the square root. For `{ "flavor:berry": 1.0, "roast:light": 1.0 }` that
is `sqrt(1 + 1) = 1.414`.

**A miscomputed magnitude raises no error.** It quietly distorts every cosine, so the results look
plausible and are wrong. Compute it in exactly one place and unit test it against a known case.

```ts
type SparseVector = Record<string, number>;

const magnitude = (w: SparseVector) => Math.sqrt(Object.values(w).reduce((sum, x) => sum + x * x, 0));

const toUserTaste = (vocabulary: string, weights: SparseVector) => ({
    vocabulary,
    weights,
    magnitude: magnitude(weights),
});
```

**Prune near-zero weights before sending.** They cost payload and contribute nothing beyond rounding.

## Where the shopper vector comes from

The vector is UI state or session state, whichever you have. All of these are one query each:

- **Sliders and chips.** A slider from light to dark spread over `roast:light`, `roast:medium`,
  `roast:dark`; a chip that sets `flavor:chocolate` to 1.
- **Cold start from picks.** Let a new visitor pick two or three products, read what they are made of,
  rebuild the vectors with the same positional rule, and sum them. No history needed. Item taste is
  **not** exposed on Discovery hits — read `topicPaths` from the hit if your taste keys are derived from
  topics, or read `item { taste { ... } }` from Core server-side.
- **Decayed session behaviour.** Add a little weight for every product a shopper opens or adds, decay it
  over time, and send the result. The profile lives in the browser or your session store.
- **Agents.** An AI agent holds a structured taste vector for a customer and sends it with every search,
  so the results it reads are already ranked for that customer.

## Blending taste with your rules

`context` alone ranks purely by taste. To put the shopper **on top of** the catalogue rules, add one
`tasteCosine` term to a `rankBy` and **pass both** — taste terms read the shopper vector from `context`.

```graphql
query Blended($context: ContextInput!, $rankBy: RankByInput!) {
    search(term: "espresso", context: $context, rankBy: $rankBy, pagination: { limit: 24 }) {
        hits {
            ... on product {
                name
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
            { "signal": "inStockBoost", "weight": 0.4, "field": "stock_default" },
            { "signal": "recency", "weight": 0.3, "field": "publishedAt", "halfLifeDays": 60 },
            { "signal": "tasteCosine", "weight": 1.2, "vocabulary": "taste", "from": "userTaste" }
        ],
        "tieBreaker": "sku",
        "explain": true
    }
}
```

```text
rankScore = 1.0·relevance + 0.6·margin + 0.4·inStock + 0.3·recency + 1.2·cos(taste)
```

The split is explicit: the first four terms are **your rules** and apply to everyone, the last is **this
shopper**. Raise the taste weight and the shelf becomes more personal; lower it and your rules take
over.

**One `tasteCosine` term per vocabulary** lets you weight vocabularies independently — taste at 1.2,
origin at 0.3 — which plain `context` cannot do. This is the main reason to reach for the blended path.

`tasteCosine` contributes **0** for items with no vector in that vocabulary, so unmapped products fall
back to your other rules rather than disappearing.

## `nearestTo` — "more like this"

Ranks by similarity to a **reference item's own stored vector** instead of a hand-built one. Use it for
"similar products" on a product page, or pairing suggestions from a basket.

```text
NearestToInput     { vocabulary: TenantVocabularyIdentifier!, like: NearestToLikeInput!, k: Int! }
NearestToLikeInput { sku: String, itemId: String }   # pass exactly one
```

```graphql
{
    search(nearestTo: { vocabulary: taste, like: { sku: "ET-006" }, k: 12 }) {
        hits {
            ... on product {
                itemId
                name
                rankScore
            }
        }
    }
}
```

Four things to know:

- **The anchor item is excluded** from the results.
- **An anchor with no vector for that vocabulary yields an empty result** — not a fallback to relevance.
  Check the anchor before rendering an empty shelf.
- **`k` replaces `pagination.limit`** when `nearestTo` is set, and is itself capped by the rerank window.
- **`nearestTo` alone does not combine `context.userTaste`.** It scores from the anchor vector only.

To blend neighbours with stock, margin or the shopper's own taste, add a `tasteCosine` term with
`from: nearestTo` to a `rankBy`:

```json
{
    "rankBy": {
        "terms": [
            { "signal": "tasteCosine", "weight": 1.0, "vocabulary": "taste", "from": "nearestTo" },
            { "signal": "inStockBoost", "weight": 0.5, "field": "stock_default" },
            { "signal": "fieldBoost", "weight": 0.3, "field": "margin", "normalize": true }
        ],
        "tieBreaker": "sku"
    }
}
```

## Verifying personalization actually works

Run the same query **with and without** `context` and compare the order. If the two match, no vectors
reached the index — the items were never published after `setItemTaste`, or the index was never re-run.
See steps 4–6 in [vocabulary-authoring.md](vocabulary-authoring.md).
