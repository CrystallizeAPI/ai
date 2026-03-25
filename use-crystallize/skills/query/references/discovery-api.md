# Discovery API Reference

The Discovery API is the primary API for powering storefronts with product information and marketing content. It is a read-only API optimized for high performance.

## Base URL

```
https://api.crystallize.com/{tenant-identifier}/discovery
```

Replace `{tenant-identifier}` with your tenant name.

## Authentication

By default, the Discovery API is open. If you configure restricted access for your Catalogue API, you need to provide authentication:

- Static token via header
- Access tokens for programmatic access

> **Important**: Always secure your API with authentication in production environments.

## Key Features

### Semantic Schema

The Discovery API follows the structure of your shapes and components. Field names in queries match your shape definitions, making the API intuitive to use.

### Combined Browse and Search

One query model for both browsing categories and searching products. This simplifies frontend development.

### Filtering and Faceting

Filter by any attribute, component, or price range. Get facet counts for building filter UIs.

## Query Structure

### Basic Search

```graphql
{
    search(language: en, filters: { type_in: [product] }, pagination: { limit: 20, after: "XXXX" }) {
        summary {
            totalHits
            facets
            endCursor: endToken
        }
        hits {
            id
            name
            path
        }
    }
}
```

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
    search(language: en, filters: { price_sales: { range: { gte: 20, lte: 20 } } }) {
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

## Browse Queries

The `browse` API provides **shape-typed access** — each shape becomes its own query type with all component fields available directly. This is the recommended approach for storefronts.

### Browse by Shape

```graphql
{
    browse {
        product(language: en, pagination: { limit: 25 }) {
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

## Pagination

### Cursor-Based Pagination (Recommended)

Use `paginationToken` (returned as `endCursor` in summary) for efficient, consistent pagination:

```graphql
{
    browse {
        product(language: en, pagination: { limit: 25, after: "CURSOR_FROM_PREVIOUS_PAGE" }) {
            summary {
                totalHits
                hasMoreHits
                endCursor
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
2. Use `summary.endCursor` as the `after` value for the next page
3. Stop when `summary.hasMoreHits` is `false`

> **Note**: `skip`-based pagination is deprecated. Use cursor-based pagination (`after`) for all new implementations. `skip` becomes increasingly expensive on large result sets.

The same cursor pattern works with `search`:

```graphql
{
    search(language: en, pagination: { limit: 20, after: "CURSOR" }) {
        summary {
            totalHits
            hasMoreHits
            endCursor
        }
        hits {
            name
            path
        }
    }
}
```

## Faceting

Get counts for filter values:

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

## Async Updates

The Discovery API is asynchronously updated from your published data and therefore eventually consistent:

- Typical delay: under 1 second
- Large imports may take longer to surface

For cases requiring exact current state, use the Catalogue API instead.

## Related Links

- [Crystallize Discovery API Documentation](https://crystallize.com/docs/developer/apis/discovery-api)
- [Demo tenant: Furnitut](https://www.furnitut.com/)
