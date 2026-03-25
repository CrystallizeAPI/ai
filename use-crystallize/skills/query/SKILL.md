---
name: query
description: Query Crystallize APIs for product data, content, and commerce information. Use this skill when fetching product catalogs, listing items, searching products, filtering by attributes, browsing categories, building storefronts, retrieving cart data, reading orders or customers, building admin dashboards, getting item details by path or ID, implementing faceted navigation, paginating results, or reading any data from Crystallize. Covers Core API, Discovery API, Catalogue API, and Shop API queries. Also use when the user asks about GraphQL queries against Crystallize, reading product variants, getting component data, checking stock levels, or any read operation — even if they don't explicitly say "query".
metadata:
    author: Crystallize
    version: "2.0"
---

# Crystallize Query Skill

Query product data, content, and commerce information from Crystallize using GraphQL APIs. This skill covers reading data for storefronts, admin interfaces, product pages, search, and cart operations.

## Consultation Approach

Before writing queries, understand the context. Ask clarifying questions:

1. **What data do you need?** Products, orders, customers, content, shapes?
2. **Is this for a storefront or admin interface?** Discovery/Catalogue for storefronts, Core for admin.
3. **Do you need search/filtering or exact path reads?** Discovery for search and faceted navigation, Catalogue for deterministic reads by path.
4. **Do you have authentication configured?** Core API requires access tokens. Discovery/Catalogue can be open but should be secured in production.
5. **What volume of results?** Pagination strategy matters — cursor-based is recommended for all APIs.

## Choosing the Right API

- Need search, filtering, or faceting? → **Discovery API**
- Know the exact path? Need strong consistency? → **Catalogue API**
- Admin interface? Orders, customers, shapes? → **Core API**
- Cart/checkout operations? → **Shop API**

## How It Works

Crystallize provides four main APIs for querying data:

1. **Core API** - Full read/write API with advanced filtering. Best for admin interfaces, customer/order management.
2. **Discovery API** - Semantic API for search, browse, filter, and faceting. Best for storefronts.
3. **Catalogue API** - Path-based reads for deterministic data access.
4. **Shop API** - Cart and checkout queries at the edge.

## API Endpoints

| API         | Endpoint                                          | Auth Required           | Use For                        |
| ----------- | ------------------------------------------------- | ----------------------- | ------------------------------ |
| Core        | `https://api.crystallize.com/@{tenant}`           | Yes (access tokens)     | Admin, customers, orders       |
| Discovery   | `https://api.crystallize.com/{tenant}/discovery`  | Optional (configurable) | Storefront search/filter       |
| Catalogue   | `https://api.crystallize.com/{tenant}/catalogue`  | Optional (configurable) | Storefront path-based reads    |
| Shop /cart  | `https://shop-api.crystallize.com/{tenant}/cart`  | Yes (JWT)               | Cart hydration, checkout flows |
| Shop /order | `https://shop-api.crystallize.com/{tenant}/order` | Yes (JWT)               | Order queries by ID/customer   |

## Usage

### Core API (Admin & Advanced Queries)

The Core API provides full read/write access with advanced filtering capabilities:

- Read items by ID with full component data
- List items with pagination and filtering
- Query customers and orders with complex filters
- Filter orders by customer, SKU, payment provider, metadata
- Access shape and piece definitions
- Manage flows and archives

```graphql
# Example: Get item with components
query GetItem {
    item(id: "item-id", language: "en") {
        ... on Product {
            id
            name
            components {
                componentId
                content
            }
            defaultVariant {
                sku
                price
                stock
            }
        }
    }
}

# Example: List orders filtered by customer
query ListOrders {
    orders(
        tenantId: "tenant-id"
        first: 20
        filter: { customerIdentifier: "customer@example.com" }
        sort: { field: createdAt, direction: desc }
    ) {
        edges {
            node {
                id
                total {
                    gross
                    currency
                }
                customer {
                    identifier
                }
            }
        }
    }
}
```

See [Core API Queries Reference](references/core-api.md) for complete documentation.

### Discovery API (Recommended for Storefronts)

The Discovery API is the primary API for frontend development. It supports:

- Full-text search
- Filtering by any component or attribute
- Faceted navigation
- Sorting and cursor-based pagination

The Discovery API has two entry points: `search` for full-text queries with facets, and `browse` for shape-typed access where each shape becomes its own query type.

> **Note**: The Discovery API uses lowercase type names in inline fragments (`... on product`, `... on category`) because types are derived from your shape identifiers. You can still use it for interface (`... on Product`, `... on Folder`).

```graphql
# Example: Browse products by shape with pagination
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
                ... on Product {
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
}

# Example: Search with facets and filtering
{
    search(
        language: en
        term: "green"
        filters: { type_in: [product] }
        facets: { shape: { limit: 5 } }
        pagination: { limit: 20 }
    ) {
        summary {
            totalHits
            hasMoreHits
            endCursor
            facets
        }
        hits {
            name
            path
            ... on product {
                defaultVariant {
                    defaultPrice
                }
            }
        }
    }
}
```

### Catalogue API (Path-Based Reads)

Use for deterministic reads when you know the exact path:

```graphql
{
    catalogue(language: "en", path: "/shop/plants") {
        name
        ... on Product {
            variants {
                sku
                name
                price
            }
        }
    }
}
```

### Shop API Queries

Retrieve cart and order intent data:

```graphql
query {
    cart(id: "cart-id") {
        id
        items {
            sku
            name
            quantity
            price {
                gross
                net
            }
        }
        total {
            gross
            net
        }
    }
}
```

## Best Practices

1. **Choose the right API** - Core for admin, Discovery for storefront search, Catalogue for path-based reads
2. **Use Discovery API for storefronts** - It's optimized for performance and supports search/filter
3. **Include deterministic sorting** - Always add a secondary sort field (like itemId) for stable pagination
4. **Request only needed fields** - GraphQL allows precise field selection to minimize payload
5. **Handle async updates** - Discovery API may have sub-second delay for recently published content
6. **Protect APIs in production** - Configure authentication for sensitive data
7. **Use Core API for complex filters** - Only Core API supports filtering orders by customer, SKU, payment provider

## References

- [Core API Queries Reference](references/core-api.md) - Items, customers, orders, shapes with advanced filtering
- [Discovery API Reference](references/discovery-api.md) - Detailed search, filter, and faceting documentation
- [Catalogue API Reference](references/catalogue-api.md) - Path-based query documentation
- [Shop API Queries Reference](references/shop-api-queries.md) - Cart and checkout query documentation (`/cart` endpoint)
- [Shop API Order Queries Reference](references/shop-api-order-queries.md) - Order queries by ID or customer (`/order` endpoint)
