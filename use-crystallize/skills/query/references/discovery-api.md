# Discovery API Reference

The Discovery API is the primary API for powering storefronts with product information and marketing
content. It is a read-only API optimized for high performance.

## Base URL

```
https://api.crystallize.com/{tenant-identifier}/discovery
```

Replace `{tenant-identifier}` with your tenant name — the **bare** identifier, no `@` (that prefix
belongs to the Core API).

## Authentication

By default, the Discovery API is open. Restrict it with the **Search & Discovery** entry under Settings → API
Access, which is separate from the Catalogue entry, then send the tenant's static token:

```
X-Crystallize-Static-Auth-Token: YOUR_STATIC_TOKEN
```

That header is the only credential Discovery reads, whichever restricted level the entry is set to, so an
access token pair is not accepted. A missing or wrong token answers HTTP 401.

> **Important**: Always secure your API with authentication in production environments.

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
    search(language: en, term: "plop") {
        hits {
            name
            path
        }
    }
}
```

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

`type_in: [ItemType]` (`product`, `document`, `folder`) is the common way to narrow a `search`. It exists on
`TenantFilter` only: a shape's own filter has no use for it.

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
        product(language: en, sorting: { price_default: asc, itemId: asc }) {
            hits {
                name
                path
            }
        }
    }
}
```

**Always add a deterministic secondary field** (such as `itemId`) so pagination stays stable across
pages. Note that `sorting` does **not** compose predictably with ranking — see below.

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

`pagination` accepts `limit`, `after`, `before` and `skip`.

> **Note**: `skip`-based pagination is deprecated for ordinary queries. Use cursor-based pagination
> (`after`). `skip` becomes increasingly expensive on large result sets. **The exception is ranked
> queries** — see below.

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

The Discovery API is asynchronously updated from your published data and therefore eventually
consistent:

- Typical delay: under 1 second
- Large imports may take longer to surface
- A full re-index (`igniteDiscoApi`) takes minutes, not seconds, to propagate

For cases requiring exact current state, use the Catalogue API instead.

## Related Links

- [[vector-ranking]] — ranking, personalization and similarity
- [Crystallize Discovery API Documentation](https://crystallize.com/docs/developer/apis/discovery-api)
- [Demo tenant: Furnitut](https://www.furnitut.com/)
