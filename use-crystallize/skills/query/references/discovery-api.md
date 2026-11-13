# Discovery API Reference

The Discovery API is a storefront's catalogue API. Every catalogue read goes here: item by path, listings, search,
facets, variant groups, prices, stock, translated paths, and drafts for preview. It is read-only and eventually
consistent ([Discovery Indexing](discovery-indexing.md)). Which API serves the rest of a storefront is in
[[storefront]].

## Base URL

```
https://api.crystallize.com/{tenant-identifier}/discovery
```

Replace `{tenant-identifier}` with your tenant name — the **bare** identifier, no `@` (that prefix
belongs to the Core API).

## Authentication

By default, the Discovery API is open, and its CORS allows any origin, so a browser can call it. Restrict it with
the **Search & Discovery** entry under Settings → API Access, which is separate from the Catalogue entry.

| Tenant setting | Published reads                                                                 | Drafts (`publicationState: draft`)      |
| -------------- | ------------------------------------------------------------------------------- | --------------------------------------- |
| Open (default) | Nothing                                                                         | Nothing: **drafts are public**          |
| Restricted     | `X-Crystallize-Static-Auth-Token: <static token>`; missing or wrong answers 401 | The same static token, server-side only |

The static token is the one credential Discovery is known to read. Whether a restricted Discovery also accepts the
access token pair is unverified, and a bearer token is ignored.

**When Discovery is open, everything it serves is public**: every price variant (`nokPrice`, `wholesalePrice`),
every market's price list through `…PriceFor(marketIdentifiers:)` to anyone who knows the identifier, and every
draft. Never put confidential terms such as negotiated B2B prices in it ([[pricing]]), and never keep confidential
content or embargoed launches in drafts on an open tenant.

## The schema is generated per tenant

This is the single most important thing to know before writing a query. The Discovery schema is
**derived from the tenant's shapes and index settings**, so it differs between tenants and changes when
the tenant is re-indexed:

- Every shape becomes a type and a `browse` field — `product`, `category`, `brand`, … A hyphen in an
  identifier camelCases: the shape `my-shape` is `myShape`, with the input `MyShapeFilter`
- Filter, facet and sort inputs (`TenantFilter`, `ProductFacet`, `TenantSort`, …) are generated from
  indexed component fields — `price_default`, `stock_oslo`, `specs_label`, `variants_topics`, …
- A component with `discoverable: false` is left out, and a shape with none left is dropped
- `TenantLanguage` is an enum of the tenant's languages, under the same rule: `nb-no` is `nbNo`
- Ranking inputs and their enums appear **only** on tenants served for ranking (see below)

**Introspect, do not assume.** An un-ignited tenant answers HTTP 404 with
`{"success": false, "message": "There is no ignited Tenant for <tenant>."}` rather than serving a
schema at all. A tenant with no shapes has no `browse` field. A tenant whose schema cannot be built
answers HTTP 500 with `extensions.code: "TENANT_SCHEMA_UNAVAILABLE"`. Retrying will not help, so report
it with the tenant identifier. `{ __typename }` is the cheapest check that a tenant is serving.

> **Note**: The Discovery API uses **lowercase** type names in inline fragments (`... on product`,
> `... on category`) because types are derived from your shape identifiers. Interface fragments keep
> their capital (`... on Product`, `... on Folder`, `... on Document`).

## Generated field names

Nothing in the schema says which component or option a generated field belongs to, so builds kept deriving names and
getting them wrong. The rules seen across builds (introspect `TenantFilter`, `<Shape>Filter` and `TenantRankByField`
after each ignite to confirm them):

| Source                           | Field                                                                                | Filter with                                |
| -------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------ |
| Component in a piece             | `<componentId>_<pieceComponentId>` (`physical_beltHook`)                             | its type's filter                          |
| Piece inside a `componentChoice` | `<choiceId>_<pieceId>_<componentId>` (`specs_drilling_gears_number`)                 | its type's filter                          |
| Numeric                          | `<path>_number`, and `<path>Unit` on hits                                            | `range: { gte, lte }`                      |
| Boolean                          | `<path>`                                                                             | `equals`, `exists`                         |
| Selection, single or multiple    | **One field per option**: `<path>_<optionKeyCamel>` (`specs_extraction_dustClass_m`) | `{ exists: true }` (`false` for "without") |
| Variant component                | `variants_<componentId>` (`variants_gtin`, `variants_durationHours_number`)          | its type's filter                          |
| Price variant, stock location    | `price_<variant>`, `stock_<location>` (one value per variant)                        | `range`                                    |
| Shape type                       | the shape identifier in camelCase (`machineUnit`; `product` stays lowercase)         | `shape: { equals }`                        |

- **Ids and option keys are camelCased, except that a hyphen before a digit becomes `_`**: `sds-plus` → `sdsPlus`,
  `keyless-13` → `keyless_13`, `core-1-1-4-unc` → `core_1_1_4Unc`, `sold-30d` → `sold_30d_number`, but
  `gwp-a1-a3` → `gwpA1A3_number`. The field name doesn't spell the selection's own key (`ull-silke` →
  `woolSilk`), so map options from the field list rather than by hand.
- `{ variants_markets: { in: [...] } }` on a multi-selection is rejected: use the per-option fields with `exists`.
- **A selection field holds the option's label**, and its facet is keyed by the **label**, with the option key as
  `label`: `{ "SDS-plus": { "count": 14, "label": "sds-plus", "filter": "specs_concrete_toolHolder_sdsPlus" } }`.
- A component called `type` becomes `component_type`. Nested numerics are named after the component id on the
  shape, not the piece's own id.
- The same field name with two types on two shapes must be aliased in one query (`a: price` / `b: price`), or the
  query fails validation.
- There is no "has this choice" filter on a `componentChoice`. To find the products of one spec family, `OR` an
  `exists: true` over that family's fields.

## Shapes of values

| Value                 | Comes back as                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| Selection             | A `Hash` `{ key: label }` (`{ "sds-plus": "SDS-plus" }`), not a list                                     |
| Item topics           | `topics`: a `Hash` of the leaves with labels (use it for chips); `topicPaths`: every ancestor, unordered |
| Image topics          | A flat hash of every ancestor path (`{ "0": "/bilde", "1": "/bilde/type", … }`)                          |
| Content chunk         | An object when not repeatable, a list when repeatable                                                    |
| `paragraphCollection` | A flat list                                                                                              |
| Rich text             | A scalar; ask for a format with `format:`                                                                |
| `breadcrumbs`         | A list of lists (one per path to the item), each ending with the item itself                             |
| Boolean never written | **`false`**, see below                                                                                   |
| Colors                | A plain list                                                                                             |

Selection labels come back in the editor language, so a multilingual storefront localises option labels itself.

**Unset booleans read `false`.** A boolean component that was never written comes back `false` on the hit. Measured
on tools-universe (2026-11-12) for `physical_beltHook`: 30 items set it to `true`, none to `false`, and the other 510
read `false`.

| Filter             | Matches                               |
| ------------------ | ------------------------------------- |
| `equals: true`     | items where it was written `true`     |
| `equals: false`    | only items where `false` was written  |
| `exists: false`    | items where it was never written      |
| `not_equals: true` | written `false` **and** never written |

So JSON-LD, feeds and agent filters must treat `false` as "not stated", and a model should not write `false` for
"unknown" ([[content-model]], [[seo-geo]]).

## Queries

| Query          | Use for                                                                             |
| -------------- | ----------------------------------------------------------------------------------- |
| `search`       | Full-text search across **all** shapes; polymorphic hits                            |
| `browse`       | Shape-typed access — each shape becomes its own query with all its component fields |
| `autocomplete` | Type-ahead on `name` — it **restricts**, it does not rank (see below)               |
| `topics`       | Children of a topic in the topic map                                                |

> **Never send an explicit `null` for an optional argument.** `pagination: { after: null }` is rejected
> with `invalid_type: after Invalid input: expected string, received null`, and the same goes for `term`
> and `context`. Leave the key out on the first page instead — with GraphQL variables that means building
> the argument object conditionally, not passing `null`.

> **A hit type keeps the shape identifier's case.** A shape called `tool` gives the Discovery type `tool`
> (lower case) while its inputs are `ToolFilter`, `ToolFacet` and `ToolSort`. `__type(name: "Tool")`
> answers `null`, so a script that introspects the schema should read the hit type from the shape query's
> `hits` rather than capitalise the identifier itself.

`search`, `autocomplete` and every field under `browse` take the same argument set:

```text
language, publicationState, path, pathResolutionMethod, term,
pagination, options, rankBy, context, nearestTo, filters, facets, sorting
```

`Folder.children` and `Topic.items` take that same set, which is what makes nested category listings
filterable and rankable in one round trip. Their `filters` are a `TenantFilter`, and they sort by
`position: asc` unless told otherwise.

A query nested deeper than 20 levels is refused, fragments included, and a batched request carries at most
10 operations.

### Basic Search

```graphql
{
    search(language: en, filters: { type_in: [product] }, pagination: { limit: 20, after: "XXXX" }) {
        summary {
            totalHits
            hasMoreHits
            endCursor: endToken
            facets
        }
        hits {
            id
            name
            path
            shape
            score
        }
    }
}
```

Hits are polymorphic — use one inline fragment per shape, and read `shape` to tell them apart.

### Filtering by Shape

```graphql
{
    search(language: en, filters: { shape: { equals: "sneaker" } }) {
        hits {
            name
            path
        }
    }
}
```

### Price Range Filter

```graphql
{
    search(language: en, filters: { price_sales: { range: { gte: 20, lte: 100 } } }) {
        hits {
            name
            path
        }
    }
}
```

### Full-Text Search

```graphql
{
    search(language: en, term: "plop", sorting: { score: desc }) {
        hits {
            name
            path
        }
    }
}
```

- **`term` matches whole words only**: "drill" does not find "drills" or "hammerdrill". Add fuzzy options for typos,
  and the autocomplete filter for prefixes (below).
- **Search is per language.** A Norwegian term on `language: en` finds nothing.
- **A `term` is expensive**: full-text reads took 0.4-0.9 s where filter-only reads took under 0.1 s. Search once for
  the ids, and read the page's details by id with filters.
- With `rankBy`, the ranking signals **replace** text relevance. Add `{ signal: relevance }` to the terms whenever
  there is a `term` ([[vector-ranking]]).

## Filter operators

Filters compose with `AND` and `OR`, each taking a list of nested filters.

| Input                          | Operators                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `StringFilter`                 | `exists`, `equals`, `not_equals`, `in`, `not_in`, `contains`, `not_contains`, `phrase`, `regex`, `not_regex` |
| `StringFilterWithAutocomplete` | the above plus `autocomplete: { term, options }`                                                             |
| `NumberFilter`                 | `exists`, `equals`, `not_equals`, `in`, `not_in`, `range: { gt, gte, lt, lte }`                              |
| `DateFilter`                   | `exists`, `equals`, `not_equals`, `in`, `not_in`, `range: { gt, gte, lt, lte }`                              |
| `BooleanFilter`                | `exists`, `equals`, `not_equals`                                                                             |
| `GeoFilter`                    | `exists`, `within: { box, circle, polygon }` — on Location components                                        |

`type_in: [ItemType]` (`product`, `document`, `folder`) is the common way to narrow a `search`. It is a top-level
key of `TenantFilter` only: a shape's own filter has no use for it.

Operators that differ from what builds expected:

- **There is no `prefix`.** `regex` is anchored and must match the whole value: on tools-universe `sku: { regex:
  "4885" }` matched 0 items and `"4885.*"` matched 2.
- `NumberFilter` has `range: { gt, gte, lt, lte }`, not `lte` at the top level.
- Filter on `itemId`, not `id`: the hit `id` is the document id (`<itemId>-<lang>-<state>`).
- `sku: { in: [...] }` filters products by SKU. There is no `variants` filter; use the `variants_*` fields, or
  `variants(filter:)` on the hit.
- Topics: `topics: { equals: "/city/helsinki" }`, a plain `StringFilter` on the path; there is no `topics_path`.
  Two builds found no `topics` key on `browse.<shape>` filters, while tools-universe has one (2026-11-12): check the
  shape's filter type, and fall back to `search` with `type_in` or to generated fields.
- `parentPaths: { equals: "/shop" }` matches every descendant of `/shop`; `parentId` matches direct children.
- `not_equals` keeps documents that have no value at all, and so does `exists: false`. See
  [unset booleans](#shapes-of-values).
- **Explicit `null` is rejected** for `after`, `term`, `context`, `sorting`, `filters` and `rankBy`. Leave the key
  out.

## Typo tolerance (fuzzy search)

Search is **exact by default**. Opt into typo tolerance through `options.fuzzy`:

```graphql
{
    search(language: en, term: "gren", options: { fuzzy: { fuzziness: SINGLE, prefixLength: 1 } }) {
        hits {
            name
            path
        }
    }
}
```

| Option          | Default | Meaning                                                       |
| --------------- | ------- | ------------------------------------------------------------- |
| `fuzziness`     | `NONE`  | Max single-character edits: `NONE`, `SINGLE`, `DOUBLE`        |
| `prefixLength`  | `0`     | Leading characters that must match exactly before edits apply |
| `maxExpensions` | `50`    | Misspelled and inert: accepted, and the value is discarded    |
| `maxExpansions` | `50`    | Max term variations generated                                 |

Two spelling traps: `FuzzySearchOptions` carries **`maxExpensions`** on every tenant but the working
**`maxExpansions`** only on tenants served for ranking, and sending it anywhere else is a validation error.
And the enum type is **`Fuziness`**, not `Fuzziness` — a typed variable (`$f: Fuzziness!`) fails schema
validation.

Raising `fuzziness` widens the candidate set and costs latency — prefer `SINGLE` before `DOUBLE`, and
use `prefixLength` to keep short, common terms precise. `DOUBLE` is very loose on short tokens: on a
540-document tenant a multi-word query matched almost everything, which makes counts and facets
meaningless. Keep a results page at `SINGLE`, and use `DOUBLE` only as a last-chance fallback when
`SINGLE` found nothing.

## Autocomplete

```graphql
{
    autocomplete(language: en, term: "espr", pagination: { limit: 8 }) {
        hits {
            name
            path
        }
    }
}
```

`autocomplete` matches on `name` and otherwise takes the same arguments as `search` — including filters
and ranking.

### Autocomplete restricts; it does not rank

This is the trap. Measured on a 540-document tenant:

| Query                                                                | `totalHits` | Scores      |
| -------------------------------------------------------------------- | ----------- | ----------- |
| `autocomplete(term: "milwaukee")`                                    | **540**     | mixed       |
| `autocomplete(term: "zzzzqq")` — matches nothing                     | **540**     | all `0`     |
| `search(filters: { name: { autocomplete: { term: "milwaukee" } } })` | 146         | all `0`     |
| the same filter **plus** `term` and `sorting: { score: desc }`       | 146         | 25.9 … 11.6 |

Two things follow:

- **The top-level `autocomplete` query answers with the whole index**, padding the tail with score-0
  hits, whatever the term. Drop hits with `score: 0`, or add the name filter, or you will show a
  type-ahead list of everything you sell.
- **`name: { autocomplete: { term } }` is a filter on `StringFilterWithAutocomplete`** — `name`, `sku` and
  `variants_name` have it — and on its own every hit comes back scored `0`, in no useful order. Pass the
  same text as `term` as well and sort by `score: desc`: the term scores the matches, the filter restricts
  the set.

Autocomplete is prefix matching per token, so without fuzzy options (`options` beside the filter's `term`
takes `FuzzySearchOptions`) it does not fix a typo **inside** a word ("nikkon", "hitli"), and it does not
match inside a compound word ("kjernebor" does not come up for "diamantkjernebor"). Full-text
`search(term:, options: { fuzzy: … })` does both. The pattern that works: prefix autocomplete first, and
full-text fuzzy as the fallback when it finds nothing.

## Browse Queries

The `browse` API provides **shape-typed access** — each shape becomes its own query type with all
component fields available directly. This is the recommended approach for storefronts.

### Browse by Shape

```graphql
{
    browse {
        product(language: en, pagination: { limit: 25 }) {
            summary {
                totalHits
                hasMoreHits
                endToken
            }
            hits {
                name
                path
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

### Browse by Path (Folder Listing)

```graphql
{
    browse {
        category(language: en, path: "/shop/*") {
            hits {
                name
                path
                children(language: en) {
                    hits {
                        ... on product {
                            name
                            path
                            defaultVariant {
                                sku
                                defaultPrice
                            }
                        }
                    }
                }
            }
        }
    }
}
```

- Use `path: "/shop/*"` for everything under `/shop`, at any depth. For direct children only, use
  `Folder.children` as above, or filter on `parentId`
- Use `path: "/shop/exact-item"` for a specific item
- `pathResolutionMethod` (`canonical`, `alias`, `history`, `shortcut`) controls how a path is resolved; left
  out, a path matches on all four
- Use aliases to combine multiple browse queries in one request

### Combined Query with Aliases

```graphql
{
    folder: browse {
        category(language: en, path: "/shop") {
            hits {
                name
                path
            }
        }
    }
    products: browse {
        product(language: en, path: "/shop/*") {
            hits {
                name
                path
                defaultVariant {
                    sku
                    defaultPrice
                }
            }
        }
    }
}
```

## Sorting

`sorting` takes one or more generated fields plus `score`, each `asc` or `desc`:

```graphql
{
    browse {
        product(language: en, sorting: { price_default: asc }) {
            hits {
                name
                path
            }
        }
    }
}
```

**With no `sorting`, hits come back by `itemId` descending, not by relevance**, even with a `term`. Send
`sorting: { score: desc }` to order by relevance.

**Sort keys apply in schema order, not in the order you write them.** In `{ price_default: asc, itemId: asc }`,
`itemId` comes before the price fields in `TenantSort`, so it became the primary key and the price order was lost
(one build; reproduced on tools-universe, 2026-11-12). Use one key per sort, or check the field order in the generated sort input before adding a second.
`score` is first, so it is safe as the primary. For a full scan, `{ itemId: asc }` alone gave stable cursor paging.
Note that `sorting` does **not** compose predictably with ranking, see below.

In an `asc` price sort, items without a price come **first**. Filter them out with `exists: true` when that matters.

`price_default` holds one value per variant. For one value per product, sort or filter on
`defaultVariantPrice_default`, `lowestVariantPrice_default` or `highestVariantPrice_default`.

## Pagination

### Cursor-Based Pagination (Recommended)

Use `paginationToken` (returned as `endToken` in summary) for efficient, consistent pagination:

```graphql
{
    browse {
        product(language: en, pagination: { limit: 25, after: "CURSOR_FROM_PREVIOUS_PAGE" }) {
            summary {
                totalHits
                hasMoreHits
                endCursor: endToken
            }
            hits {
                name
                path
            }
        }
    }
}
```

**Flow:**

1. First request: omit `after`
2. Use `summary.endToken` as the `after` value for the next page
3. Stop when `summary.hasMoreHits` is `false` **or** `hits` is empty. The last page can still read
   `hasMoreHits: true`, and the empty page after it has no `endToken` to send

`pagination` accepts `limit`, `after`, `before` and `skip`. The summary field is `endToken`; there is no
`endCursor` (alias it if your code expects one).

> **Note**: `skip`-based pagination is deprecated for ordinary queries. Use cursor-based pagination
> (`after`). `skip` becomes increasingly expensive on large result sets. **The exception is ranked
> queries** — see below.

- **Page size**: `limit: 500` worked on one tenant, and `limit: 1000` returned all 540 documents of tools-universe in
  one page (2026-11-12). No cap was hit below that; page anyway for anything larger.
- `limit` is ignored under `nearestTo`.
- Many aliased lookups in one request scale badly: batch about 25 aliases per request.
- **A full scan can come back incomplete** during re-indexing: four passes over one 590-product tenant returned
  173, 590, 556 and 375 hits, with `hasMoreHits: false` too early. For "every product" (a sitemap, an index), retry,
  take the union of passes, and check the count against `search { summary { totalHits } }`
  ([Discovery Indexing](discovery-indexing.md#under-load)).

## Faceting

Get counts for filter values. `StringFacet` takes `key` and `limit`; `NumberFacet` and `DateFacet` also
require `boundaries`.

```graphql
{
    search(language: en, term: "blue", facets: { shape: { limit: 5 } }) {
        summary {
            facets
        }
        hits {
            name
            path
        }
    }
}
```

`summary.facets` is a `Hash`, and accepts an optional `key` argument to pull a single facet out.

- A selection facet is keyed by the option **label**, with the key as `label` (see
  [Generated field names](#generated-field-names)).
- The `topics` facet counts every level of the path, and its `limit` defaults to 10 across all topic maps together:
  raise it, or the second map's topics never show.
- A `parentPaths` facet on a category listing gives its subfolders with counts.
- Facets cost about 17 KB per read. Leave them out of rails, menus and anything that doesn't render filters.

`summary.priceRange(priceIdentifier: "default", quantity: 1) { min max }` gives the price bounds of the
current result set — useful for a range slider that matches the active filters.

## Variants on a Hit

Listing `filters` match a product as soon as **different** variants satisfy different conditions. To check
conditions against one variant at a time, use the variant fields on the hit:

| Field                                       | Use for                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| `variants(skus:, first:, filter:)`          | The variants that satisfy `filter` on their own, in product order         |
| `variant(selected: [{ attribute, value }])` | The first variant carrying every pair: product pages, add to cart         |
| `variantGroups(by:, filter:, first:)`       | One group per attribute value, so a listing card shows one colourway each |

```graphql
{
    browse {
        product(language: en) {
            hits {
                name
                variantGroups(by: ["colour"], filter: { price_default: { range: { lte: 100 } } }, first: 4) {
                    matched
                    attributes {
                        attribute
                        value
                    }
                    representative {
                        sku
                        defaultPrice
                    }
                    values(of: "size") {
                        value
                        sku
                        inStock
                    }
                }
            }
        }
    }
}
```

`filter` is a `VariantFilterInput`: the variant fields of the listing filter, with exact operators only (no
`contains`, `phrase`, `regex` or `autocomplete`). `variantGroups` never drops a group or changes hits, facets
or pagination: groups with a matching variant come first, the others read `matched: false`. Attribute names
and values are case-sensitive. A key that only matches in another case changes nothing in the result and adds a
warning under `extensions.warnings`.

What a `ProductVariantGroup` carries (introspected on tools-universe, 2026-11-12):

| Field                                                                                                                | Notes                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `key`, `matched`, `attributes`                                                                                       | The group's attribute values; URL-encode `key` in links                                                          |
| `representative(pick:, priceVariant:)`                                                                               | `DEFAULT` (default, else first in stock, else first), `FIRST_IN_STOCK`, `CHEAPEST` (for `priceVariant`), `FIRST` |
| `summary { count matchedCount inStock(location:) matchedInStock(location:) price(variant:) matchedPrice(variant:) }` | `price` is the "from"/"to" range for a card                                                                      |
| `values(of:) { value sku matched inStock(location:) stock(location:) }`                                              | One entry per value of another attribute (sizes); alias one `stock` per location                                 |
| `variants(first:, filter:)`                                                                                          | The group's variants                                                                                             |
| `images`, `videos`                                                                                                   | No arguments: every image of every variant in the group                                                          |

- **`images` on a group is the payload trap**: it takes no rendition filter and was about 70 % of one listing's
  bytes. On a card, use `representative { firstImage { variants(types: "webp", minWidth:, maxWidth:) } }`. Repeated
  `variants { images }` on a 260-size product made 24 cards 8.2 MB ([[responsive-images]]).
- **Product-level variant filters can be satisfied by two different variants.** "Red and in size M" matches a
  product with a red S and a blue M. Use `variants(filter:)` or `variantGroups(filter:)` to require one variant.
- `variants(skus:)` takes **one** SKU (`String`); a comma-separated list returns `[]` silently. `variants` is not
  paginated on the product.
- Variant components need the generated type: `... on ProductVariantFor<Shape> { <component> }`.
- `variant(selected:)` answers `null` when no variant carries every pair. On a product page, feed it the chosen
  options, then send its `sku` to the Shop API `hydrate`.

## Prices and stock on a variant

Every price variant and stock location becomes its own set of fields on `ProductVariant`. For a price variant `nok`:

| Field                                                               | Gives                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------- |
| `nokPrice(count:)`                                                  | The list price (at a quantity, for tiers)                     |
| `nokPriceTiers`, `nokPriceTierType`                                 | Volume tiers                                                  |
| `nokPriceFor(marketIdentifiers:, count:)`                           | The lowest price for those markets' price lists               |
| `nokBestPriceListFor(marketIdentifiers:)`                           | Which list applied (`identifier`, `modifier`, `modifierType`) |
| `nokPriceForEveryone`, `nokBestPriceListForEveryone`                | Lists aimed at everyone                                       |
| `priceVariants`, `priceVariantFor(identifier:, marketIdentifiers:)` | The same by identifier, as a hash or one value                |
| `<location>Stock` (`oslStock`), `stockLocations`                    | Stock per location; `stock_<location>` to filter              |

- **Market prices are slow**: about 1.4 s per 100 products per market (one tenant). Read them only for the SKUs on
  screen, never for a whole listing, and cache per market. `…PriceForEveryone` is slow under build load too.
- Discovery knows **markets only**. A price for a specific customer is a Shop API (cart) or Catalogue read, on the
  server ([[pricing]]).
- A new stock location or price variant needs a re-ignite before its fields exist
  ([Discovery Indexing](discovery-indexing.md)).

## Paths per language (hreflang, sitemaps)

There is no `hreflangs` field. The same item's path in each language comes from one aliased query by `itemId`
(verified on tools-universe, 2026-11-12):

```graphql
query Paths($id: String!) {
    en: search(language: en, filters: { itemId: { equals: $id } }) {
        hits {
            path
        }
    }
    no: search(language: no, filters: { itemId: { equals: $id } }) {
        hits {
            path
        }
    }
    sv: search(language: sv, filters: { itemId: { equals: $id } }) {
        hits {
            path
        }
    }
}
```

- Paths follow the translated names (`/drilling-and-driving`, `/boring-og-skruing`), so localised URLs need nothing
  more. Empty `hits` in a language means there is no version there: leave that alternate out.
- A sitemap is one `browse` (or `search`) per language joined on `itemId`.
- **`updatedAt` is on every hit and is the sitemap's `lastModified`.** It was the same in every language for the
  same item on tools-universe.
- `aliases`, `history` and `shortcuts` are on every hit too: 301 from `history` after a rename, and keep old paths
  out of the sitemap. Tenant language codes are not BCP 47 (`no` → `nb`). See [[information-architecture]] and
  [[seo-geo]].

## Drafts (`publicationState`)

`publicationState` is `published` (the default) or `draft`, on `search`, `autocomplete` and every `browse` field.
Hits report `publicationState`, and a draft hit carries the draft's `updatedAt` and `publishedAt: null`.

```graphql
query Preview($path: String!) {
    search(language: en, publicationState: draft, filters: { path: { equals: $path } }) {
        hits {
            name
            path
            publicationState
            updatedAt
        }
    }
}
```

Draft preview is this read, run from a server route behind editor login, and never cached.

> **On an open Discovery, every draft is public to anyone who asks.** No credential is needed: tools-universe
> returned the same 541 draft documents (`publicationState: "draft"`, `publishedAt: null`) with and without an
> access token, on `search` and `browse`, in two languages, and another tenant served an unpublished page to an
> anonymous request (2026-11-12). To keep drafts private, restrict Discovery and send
> `X-Crystallize-Static-Auth-Token` from the server only. Whether a restricted Discovery accepts the access token
> pair instead is unverified.

Draft documents are indexed like published ones, so the same eventual consistency applies: a draft saved a moment
ago may not be served yet.

## Ranking, personalization and similarity

Ranking-enabled tenants additionally accept `rankBy`, `context` and `nearestTo`, and expose `rankScore`
and `rankExplain` on hits. That surface — vocabularies, `setItemTaste`, `igniteDiscoApi`, the five
`rankBy` signals, `context.userTaste`, `nearestTo` and the rerank window — is covered by the
[[vector-ranking]] skill.

Two things to know from here:

1. **The arguments are absent from the schema until the tenant is served for ranking.** Referencing them
   on an ordinary tenant is a GraphQL validation error, not an unranked result. Detect the capability:
   `{ __type(name: "RankByInput") { name } }`.
2. **Ranked queries page differently.** When a rerank runs over a window, `after`/`before` move the window
   rather than the page — use `skip` + `limit`, and remember that `skip` offsets into a bounded rerank
   window (`options.rerankWindow`, default 500, cap 2000). Past the window a page is empty and
   `hasMoreHits` is `false`, even when more documents matched. `sorting` picks which documents enter the
   window; the rerank owns the order they come back in.

## Profiling

Every query can report how it was served:

```graphql
{
    search(language: en, term: "chair") {
        summary {
            profiling {
                executionTime
                queryEngine
                collection
                webNode
                lastIndexCompletedAt
            }
        }
    }
}
```

`lastIndexCompletedAt` is the reliable way to confirm a re-index actually landed.

## Async Updates

The Discovery API is updated asynchronously from published data, so it is eventually consistent. A content edit
usually shows within seconds, but publishing answers before anything is published, new shapes and components need an
ignite, schemas roll out over minutes, errors are cached per query body, and relations and media are snapshotted at
indexing time. All of it, with what to do, is in [Discovery Indexing](discovery-indexing.md). The Catalogue API is
not the fix for any of it.

## Related Links

- [Discovery Indexing](discovery-indexing.md) — ignite, publish lag, propagation, load errors
- [[storefront]] — which API a storefront calls for each task
- [[vector-ranking]] — ranking, personalization and similarity
- [Crystallize Discovery API Documentation](https://crystallize.com/docs/developer/apis/discovery-api)
- [Demo tenant: Furnitut](https://www.furnitut.com/)
