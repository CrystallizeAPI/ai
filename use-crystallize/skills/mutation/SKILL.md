---
name: mutation
description: Mutate data in Crystallize - create and update items, manage orders, customers, carts, and checkout. Use this skill when creating products, updating content, managing cart operations, placing orders, or modifying any data in Crystallize. Covers Core API and Shop API mutations.
metadata:
  author: Crystallize
  version: "1.0"
---

# Crystallize Mutation Skill

Create, update, and manage data in Crystallize using GraphQL mutations. This skill covers write operations for items, orders, customers, carts, and checkout flows.

## How It Works

Crystallize provides two main APIs for mutations:

1. **Core API** - Full read/write API for managing shapes, items, customers, orders, and configuration
2. **Shop API** - Edge-distributed API for cart hydration, checkout, and order creation

## API Endpoints

| API  | Endpoint                                         | Auth Required |
| ---- | ------------------------------------------------ | ------------- |
| Core | `https://api.crystallize.com/@{tenant}`          | Yes           |
| Shop | `https://shop-api.crystallize.com/{tenant}/cart` | Yes (JWT)     |

## Authentication

### Core API

Requires access tokens. Generate them in the Crystallize App under Settings → Access Tokens.

```bash
curl -X POST 'https://api.crystallize.com/@your-tenant' \
  -H 'Content-Type: application/json' \
  -H 'X-Crystallize-Access-Token-Id: YOUR_TOKEN_ID' \
  -H 'X-Crystallize-Access-Token-Secret: YOUR_TOKEN_SECRET' \
  -d '{"query": "mutation { ... }"}'
```

### Shop API

Requires JWT tokens obtained from the auth endpoint.

## Usage

### Core API Mutations

#### Create a Product

```graphql
mutation {
  product {
    create(
      input: {
        tenantId: "your-tenant-id"
        shapeIdentifier: "product-shape"
        name: "New Product"
        tree: { parentId: "folder-id" }
      }
    ) {
      ... on Product {
        id
        name
      }
      ... on BasicError {
        errorName
        message
      }
    }
  }
}
```

#### Update Item Components

```graphql
mutation {
  item {
    updateComponent(
      itemId: "item-id"
      language: "en"
      component: {
        componentId: "description"
        richText: { html: "<p>Updated description</p>" }
      }
    ) {
      ... on Item {
        id
      }
      ... on BasicError {
        message
      }
    }
  }
}
```

#### Create a Customer

```graphql
mutation {
  customer {
    createIndividual(
      input: {
        tenantId: "your-tenant-id"
        firstName: "John"
        lastName: "Doe"
        email: "john@example.com"
      }
    ) {
      ... on Customer {
        id
      }
    }
  }
}
```

### Shop API Mutations

#### Hydrate Cart

```graphql
mutation {
  hydrate(
    input: {
      items: [
        { sku: "product-sku-1", quantity: 2 }
        { sku: "product-sku-2", quantity: 1 }
      ]
      context: {
        language: "en"
        price: { selectedVariantIdentifier: "default" }
      }
    }
  ) {
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

#### Add Items to Cart

```graphql
mutation {
  addItems(
    id: "existing-cart-id"
    items: [{ sku: "new-product-sku", quantity: 1 }]
  ) {
    id
    items {
      sku
      quantity
    }
  }
}
```

## Error Handling

The Core API uses union types for error handling. Always query error fields:

```graphql
mutation {
  order(id: "order-id") {
    ... on Order {
      id
      createdAt
    }
    ... on OrderDoesNotBelongToTenantError {
      errorName
      message
    }
    ... on UnauthorizedError {
      errorName
      message
    }
    ... on BasicError {
      errorName
      message
    }
  }
}
```

## Best Practices

1. **Always handle errors** - Use union types to catch specific error cases
2. **Use Core API for admin operations** - Managing shapes, items, customers
3. **Use Shop API for storefront operations** - Cart and checkout at the edge
4. **Validate before mutating** - Check item exists before updating
5. **Use appropriate scopes** - Request only needed permissions in tokens

## References

- [Core API Reference](references/core-api.md) - Item, shape, customer, and order mutations
- [Shop API Mutations Reference](references/shop-api-mutations.md) - Cart hydration and checkout
