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

By default, the Discovery API is open. If you configure restricted access for your Catalogue API, you
need to provide authentication:

- Static token via header
- Access tokens for programmatic access

> **Important**: Always secure your API with authentication in production environments.

## The schema is generated per tenant

This is the single most important thing to know before writing a query. The Discovery schema is
**derived from the tenant's shapes and index settings**, so it differs between tenants and changes when
the tenant is re-indexed:

- Every shape becomes a type and a `browse` field — `product`, `category`, `brand`, …
- Filter, facet and sort inputs (`TenantFilter`, `ProductFacet`, `TenantSort`, …) are generated from
  indexed component fields — `price_default`, `stock_oslo`, `specs_label`, `variants_topics`, …
- `TenantLanguage` is an enum of the tenant's languages
- Ranking inputs and their enums appear **only** on tenants served for ranking (see below)

**Introspect, do not assume.** An un-ignited tenant answers
`{"success": false, "message": "There is no ignited Tenant for <tenant>."}` rather than serving a
schema at all.

> **Note**: The Discovery API uses **lowercase** type names in inline fragments (`... on product`,
> `... on category`) because types are derived from your shape identifiers. Interface fragments keep
> their capital (`... on Product`, `... on Folder`, `... on Document`).

## Queries

| Query          | Use for                                                                             |
| -------------- | ----------------------------------------------------------------------------------- |
| `search`       | Full-text search across **all** shapes; polymorphic hits                            |
| `browse`       | Shape-typed access — each shape becomes its own query with all its component fields |
| `autocomplete` | Type-ahead; hardcoded on `name`                                                     |
| `topics`       | Children of a topic in the topic map                                                |

`search`, `autocomplete` and every field under `browse` take the same argument set:

```text
language, publicationState, path, pathResolutionMethod, term,
pagination, options, rankBy, context, nearestTo, filters, facets, sorting
```

`Folder.children` and `Topic.items` take that same set, which is what makes nested category listings
filterable and rankable in one round trip.

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

`type_in: [ItemType]` (`product`, `document`, `folder`) is the common way to narrow a `search`.

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
| `maxExpensions` | `50`    | Max term variations generated                                 |

Raising `fuzziness` widens the candidate set and costs latency — prefer `SINGLE` before `DOUBLE`, and
use `prefixLength` to keep short, common terms precise.

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
                endCursor
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

- Use `path: "/shop/*"` for direct children (wildcard)
- Use `path: "/shop/exact-item"` for a specific item
- `pathResolutionMethod` (`canonical`, `alias`, `history`, `shortcut`) controls how a path is resolved
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

1. First request: omit `after` (or set to `null`)
2. Use `summary.endToken` as the `after` value for the next page
3. Stop when `summary.hasMoreHits` is `false`

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

## Ranking, personalization and similarity

Ranking-enabled tenants additionally accept `rankBy`, `context` and `nearestTo`, and expose `rankScore`
and `rankExplain` on hits. That surface — vocabularies, `setItemTaste`, `igniteDiscoApi`, the five
`rankBy` signals, `context.userTaste`, `nearestTo` and the rerank window — is covered by the
[[vector-ranking]] skill.

Two things to know from here:

1. **The arguments are absent from the schema until the tenant is served for ranking.** Referencing them
   on an ordinary tenant is a GraphQL validation error, not an unranked result. Detect the capability:
   `{ __type(name: "RankByInput") { name } }`.
2. **Ranked queries page differently.** When a rerank runs, cursor tokens fall back to offset
   pagination — use `skip` + `limit`, and remember that `skip` offsets into a bounded rerank window
   (`options.rerankWindow`, default 500, cap 2000).

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
