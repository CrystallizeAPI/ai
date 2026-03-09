---
name: get-data-from-crystallize
description: Query Crystallize APIs for product data, content, and commerce information. Use this skill when fetching product catalogs, searching products, filtering by attributes, building storefronts, retrieving cart data, admin interfaces, or reading any data from Crystallize. Covers Core API, Discovery API, Catalogue API, and Shop API queries.
metadata:
  author: Crystallize
  version: "1.0"
---

# Crystallize Query Skill

Query product data, content, and commerce information from Crystallize using GraphQL APIs. This skill covers reading data for storefronts, admin interfaces, product pages, search, and cart operations.

## How It Works

Crystallize provides four main APIs for querying data:

1. **Core API** - Full read/write API with advanced filtering. Best for admin interfaces, customer/order management.
2. **Discovery API** - Semantic API for search, browse, filter, and faceting. Best for storefronts.
3. **Catalogue API** - Path-based reads for deterministic data access.
4. **Shop API** - Cart and checkout queries at the edge.

## API Endpoints

| API       | Endpoint                                         | Auth Required           | Use For                        |
| --------- | ------------------------------------------------ | ----------------------- | ------------------------------ |
| Core      | `https://api.crystallize.com/@{tenant}`          | Yes (access tokens)     | Admin, customers, orders       |
| Discovery | `https://api.crystallize.com/{tenant}/discovery` | Optional (configurable) | Storefront search/filter       |
| Catalogue | `https://api.crystallize.com/{tenant}/catalogue` | Optional (configurable) | Storefront path-based reads    |
| Shop      | `https://shop-api.crystallize.com/{tenant}/cart` | Yes (JWT)               | Cart hydration, checkout flows |

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
        total { gross currency }
        customer { identifier }
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
- Sorting and pagination

```graphql
# Example: Search products with filtering
query SearchProducts {
  search(
    term: "green"
    facets: {
      parentPaths: { limit: 5 }
      topics: { key: "topics", limit: 5 }
      brand_items_name: { key: "brand", limit: 5 }
      shape: { limit: 5 }
    }
    # filters: {
    #   shape: {
    #     equals: "story"
    #   }
    # }
    options: { fuzzy: { fuzziness: DOUBLE } }
  ) {
    summary {
      totalHits
      facets
    }
    hits {
      shape
      name
      ... on product {
        defaultVariant {
          name
          defaultPrice
        }
      }
      ... on category {
        name
      }
      ... on story {
        name
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
- [Shop API Queries Reference](references/shop-api-queries.md) - Cart and checkout query documentation
