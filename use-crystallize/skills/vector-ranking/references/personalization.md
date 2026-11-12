# Personalization & Similarity (`context.userTaste`, `nearestTo`)

Discovery API, `https://api.crystallize.com/<tenant>/discovery`, no auth unless the tenant requires a
static token. **Nothing about the shopper is stored in Crystallize** — you send the vector with each query.

## `context.userTaste`

```text
UserTasteInput { vocabulary: TenantVocabularyIdentifier!   # enum, generated per tenant
                 weights:    JSON!                         # { "dimensionId:value": number }
                 magnitude:  Float! }                      # L2 norm of weights

ContextInput   { userTaste: [UserTasteInput!]! }           # one entry per vocabulary
```

`userTaste` is a **list**, one entry per vocabulary. A map keyed by vocabulary is not rejected: every item
then scores 0, silently. It must be **non-empty**, and a vocabulary may appear **at most once**. `weights` maps
`dimensionId:value` to a number — **positive means likes, negative means dislikes**. A negative weight
puts the query on the windowed path; see
[the rerank window](ranking-signals.md#the-rerank-window).

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

Supplied **without** `rankBy`, results are ranked toward that taste automatically, over the whole result
set unless [a windowed case](ranking-signals.md#the-rerank-window) applies. `rankScore` carries the summed
cosine. There are no `terms` on this path, so `rankExplain` is `null`.

## You supply the magnitude

`magnitude` is the length of the shopper vector — one number that lets the index compare **direction**
(what they like) without being fooled by **size** (how much they like it). It is `sqrt(Σ w²)`: square
every weight, add them up, take the square root. For `{ "flavor:berry": 1.0, "roast:light": 1.0 }` that
is `sqrt(1 + 1) = 1.414`.

**A miscomputed magnitude raises no error.** The server divides by the number you send and never
recomputes it, so a wrong value rescales that vocabulary's contribution. That is harmless with a single
vocabulary and no `rankBy`, and a ranking bug as soon as you sum vocabularies or blend with other signals:
the results look plausible and are wrong. `magnitude: 0` is not "let the server work it out": it zeroes that
vocabulary for every item. Compute it in exactly one place and unit test it against a known case.

```ts
type SparseVector = Record<string, number>;

const magnitude = (w: SparseVector) => Math.sqrt(Object.values(w).reduce((sum, x) => sum + x * x, 0));

const toUserTaste = (vocabulary: string, weights: SparseVector) => ({
    vocabulary,
    weights,
    magnitude: magnitude(weights),
});
```

**Prune near-zero weights before sending, and compute `magnitude` after pruning.** They cost payload and
contribute nothing beyond rounding, and past about 800 weights the query takes the windowed path.

## Where the shopper vector comes from

The vector is UI state or session state, whichever you have. All of these are one query each:

- **Sliders and chips.** A slider from light to dark spread over `roast:light`, `roast:medium`,
  `roast:dark`; a chip that sets `flavor:chocolate` to 1.
- **Cold start from picks.** Let a new visitor pick two or three products, read what they are made of,
  rebuild the vectors with the same positional rule, and sum them. No history needed. Item taste is
  **not** exposed on Discovery hits — read `topicPaths` from the hit if your taste keys are derived from
  topics, or read `item { ... on Item { taste { ... } } }` from Core server-side.
- **Decayed session behaviour.** Add a little weight for every product a shopper opens or adds, decay it
  over time, and send the result. The profile lives in the browser or your session store.
- **Order history, rebuilt per request.** Read the shopper's orders from the Shop API (`orders(customerIdentifier)`)
  on the server, take the keys of what they bought (the topic paths in each order line's meta), weight them with
  the same positional rule as the items, and send the result. Nothing is stored per person, and in one build a
  joiner, an electrician and a carpenter got clearly different home grids, category orders and menu images. Cache
  the vector per customer for a short while; the order listing lags new orders by seconds to minutes anyway.
- **Agents.** An MCP server or an on-site assistant ranks every tool result for the shopper behind the call: when
  its access token or session identifies the shopper, rebuild `context.userTaste` from Shop API order history
  **per call**, as above (no stored profile), and send it with every search, similar-products and recommendation
  tool. A signed-out call falls back to the house ranking (`rankBy` without `tasteCosine`). Add `relevance` to the
  terms whenever the tool passes a `term`. See [[agentic-commerce]].

Order history and the agent's identity are server-side, so this vector is built on the server even when the
rest of the page could call Discovery from the browser.

## Blending taste with your rules

`context` alone ranks purely by taste. To put the shopper **on top of** the catalogue rules, add one
`tasteCosine` term to a `rankBy` and **pass both** — taste terms read the shopper vector from `context`.
Neither half errors without the other: a `tasteCosine` term with no `context` entry for its vocabulary
scores 0, and a `context` with no `tasteCosine` term in the `rankBy` is ignored.

```graphql
query Blended($context: ContextInput!, $rankBy: RankByInput!) {
    search(term: "espresso", context: $context, rankBy: $rankBy, sorting: { score: desc }, pagination: { limit: 24 }) {
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
            { "signal": "fieldBoost", "weight": 0.6, "field": "margin_number", "normalize": true },
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

**A dial on one vocabulary needs that vocabulary's term weighted up.** A slider that adds keys to one vocabulary
only moves that term's cosine, so a shopper with a strong taste in another vocabulary keeps the same top items
whatever the slider says. Weight the dialled term up (3 against 0.8 worked in one build) while the dial is set.

**Rank once, reuse everywhere.** One `rankBy` over the catalogue per request (`limit: 250`, `explain: true`) can
feed every rail on a page — "For you", the home rows, the hero. Discovery reads are cached on query + variables,
and the taste is part of the variables, so each shopper's ranking is computed once per cache lifetime.

**Let Discovery filter, rank and page in one query** for interactive surfaces. Ranking 250 cached cards in code
cost about 0.5 s and 255 KB per slider move; one `browse.<shape>(filters, rankBy, context, pagination: { limit: 12 })`
query per move, plus a cached `limit: 0` query for counts and facets, brought it to about 0.2 s and half the
payload. Skip the shared cache for reads that are almost never repeated, such as every slider position.

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
  So does an anchor not found in the query's language and publication state. Check the anchor before
  rendering an empty shelf.
- **`k` replaces `pagination.limit`** when `nearestTo` is set, and is itself capped by the rerank window.
- **`nearestTo` alone does not combine `context.userTaste`.** It scores from the anchor vector only, in **one**
  vocabulary: on a mood vocabulary alone, a film's neighbours shared its mood and nothing else. For a "more like
  this" that spans vocabularies and follows the shopper, use `rankBy` with a `userTaste` built from the item's own
  keys blended with the shopper's (the item's keys at 0.8 kept it in the lead; 1.2 let the shopper take over).

Observed on single tenants and not resolved, so verify on yours: `nearestTo` answered no hits for one
vocabulary while ranking by a `userTaste` in that same vocabulary worked, and on another tenant a `tasteCosine`
term `from: nearestTo` contributed 0 to every hit, while `nearestTo` alone (with `filters`) returned the right
neighbours. Read `rankExplain` before you ship the blended path.

To blend neighbours with stock, margin or the shopper's own taste, add a `tasteCosine` term with
`from: nearestTo` to a `rankBy`, and keep `nearestTo` in the query: the term reads the anchor from it and
scores 0 without it. A `rankBy` is windowed, so neighbours outside the window are never considered; narrow
the set with `filters`, or raise `options.rerankWindow`, on a catalogue larger than the window.

```json
{
    "rankBy": {
        "terms": [
            { "signal": "tasteCosine", "weight": 1.0, "vocabulary": "taste", "from": "nearestTo" },
            { "signal": "inStockBoost", "weight": 0.5, "field": "stock_default" },
            { "signal": "fieldBoost", "weight": 0.3, "field": "margin_number", "normalize": true }
        ],
        "tieBreaker": "sku"
    }
}
```

## Verifying personalization actually works

Run the same query **with and without** `context` and compare the order. If the two match, no vectors
reached the index — the items were never published after `setItemTaste`, or the index was never re-run.
See steps 4–6 in [vocabulary-authoring.md](vocabulary-authoring.md).
